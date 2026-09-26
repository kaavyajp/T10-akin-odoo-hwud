#!/usr/bin/env python3
"""Same-origin Refound web server and authenticated Odoo JSON-2 gateway.

Run the application with `python3 server.py`. Odoo mode requires a trusted
authentication reverse proxy plus environment configuration; credentials never
enter browser code.
"""

from __future__ import annotations

import base64
import hmac
import json
import mimetypes
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = 12 * 1024 * 1024
MAX_DOCUMENT_BYTES = 3 * 1024 * 1024

DEFAULT_MODELS = {
    "organization": "refound.organization",
    "resource": "refound.resource",
    "need": "refound.need",
    "order": "refound.order",
    "message": "refound.order.message",
    "document": "refound.organization.document",
    "attachment": "ir.attachment",
}
DEFAULT_FIELDS = {
    "organization": {
        "name": "name", "organizationType": "organization_type",
        "contactName": "contact_name", "email": "contact_email", "location": "location",
        "registrationId": "registration_number", "status": "verification_status",
        "notes": "application_notes", "submittedAt": "create_date", "decisionNote": "review_note",
        "reviewedAt": "reviewed_at", "reviewerEmail": "reviewer_email", "documents": "document_ids",
        "registrationChecked": "review_registration_checked", "authorityChecked": "review_authority_checked",
        "evidenceChecked": "review_evidence_checked",
    },
    "resource": {
        "id": "id", "title": "name", "resourceType": "resource_type", "category": "category",
        "quantity": "quantity", "unit": "unit", "location": "location",
        "availableUntil": "available_until", "expiresAt": "expires_at",
        "priceAED": "price_aed", "condition": "item_condition",
        "specifications": "specifications", "storageInstructions": "storage_instructions",
        "notes": "notes", "status": "state", "donor": "organization_id",
    },
    "need": {
        "id": "id", "organization": "organization_id", "contact": "contact_name",
        "resourceType": "resource_type", "category": "category", "quantity": "quantity",
        "unit": "unit", "location": "delivery_address", "urgency": "urgency",
        "neededBy": "needed_by", "expiresAt": "minimum_expiry", "maxPriceAED": "max_price_aed",
        "preferredCondition": "preferred_condition", "specifications": "specifications",
        "storageInstructions": "receiving_instructions", "note": "description",
    },
    "order": {
        "id": "id", "orderId": "name", "buyerOrganization": "buyer_organization_id",
        "sellerOrganization": "seller_organization_id", "surplusId": "resource_id",
        "needId": "need_id", "quantity": "quantity", "unitPriceAED": "unit_price_aed",
        "paymentAmountAED": "product_total_aed", "paymentStatus": "payment_status",
        "paymentMethod": "payment_method", "paymentReference": "payment_reference",
        "status": "state", "logisticsMethod": "logistics_method",
        "deliveryFeeAED": "delivery_fee_aed", "trackingReference": "tracking_reference",
        "expectedDeliveryAt": "expected_delivery_at", "logisticsNotes": "logistics_notes",
        "createdAt": "create_date", "score": "match_score",
    },
    "message": {
        "id": "id", "orderId": "order_id", "senderOrganization": "sender_organization_id",
        "senderRole": "sender_role", "body": "body", "createdAt": "create_date",
    },
    "document": {
        "id": "id", "name": "name", "mimeType": "mimetype",
        "uploadedAt": "create_date", "reviewStatus": "review_status",
        "organizationId": "organization_id", "attachmentId": "attachment_id",
    },
}

ALLOWED_DOCUMENT_MIMES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def load_local_env_file(env_path: Path):
    """Read literal NAME=value settings without shell evaluation or interpolation."""
    if not env_path.is_file():
        return
    for line_number, raw_line in enumerate(env_path.read_text(encoding="utf-8").splitlines(), start=1):
        entry = raw_line.strip()
        if not entry or entry.startswith("#"):
            continue
        if "=" not in entry:
            raise RuntimeError(f".env line {line_number} must contain NAME=value.")
        key, value = entry.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise RuntimeError(f".env line {line_number} has an invalid setting name.")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


class Settings:
    def __init__(self) -> None:
        self.odoo_url = os.getenv("ODOO_URL", "").rstrip("/")
        self.odoo_database = os.getenv("ODOO_DATABASE", "")
        self.odoo_api_key = os.getenv("ODOO_API_KEY", "")
        self.proxy_secret = os.getenv("REFOUND_PROXY_SECRET", "")
        self.host = os.getenv("REFOUND_HOST", "127.0.0.1")
        self.port = int(os.getenv("REFOUND_PORT", "4173"))
        self.login_path = os.getenv("REFOUND_LOGIN_PATH", "/api/session")
        self.models = self._read_mapping("ODOO_MODEL_MAP", DEFAULT_MODELS)
        self.fields = self._read_mapping("ODOO_FIELD_MAP", DEFAULT_FIELDS)
        if self.live:
            if not self.odoo_url.startswith("https://"):
                raise RuntimeError("Live Odoo connections require HTTPS.")
            if len(self.proxy_secret) < 32:
                raise RuntimeError("REFOUND_PROXY_SECRET must contain at least 32 characters.")
            if not self.login_path.startswith("/") or self.login_path.startswith("//"):
                raise RuntimeError("REFOUND_LOGIN_PATH must be a same-origin absolute path.")

    @staticmethod
    def _read_mapping(name: str, fallback: dict) -> dict:
        raw = os.getenv(name)
        if not raw:
            return fallback
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"{name} must be valid JSON.") from error
        if not isinstance(value, dict) or any(not isinstance(k, str) or not isinstance(v, (str, dict)) for k, v in value.items()):
            raise RuntimeError(f"{name} must be a JSON object.")
        return value

    @property
    def live(self) -> bool:
        return all((self.odoo_url, self.odoo_database, self.odoo_api_key, self.proxy_secret))

    @property
    def has_partial_live_config(self) -> bool:
        return any((self.odoo_url, self.odoo_database, self.odoo_api_key, self.proxy_secret)) and not self.live

    @property
    def missing_live_settings(self) -> list[str]:
        return [
            label for label, value in (
                ("ODOO_URL", self.odoo_url),
                ("ODOO_DATABASE", self.odoo_database),
                ("ODOO_API_KEY", self.odoo_api_key),
                ("REFOUND_PROXY_SECRET", self.proxy_secret),
            ) if not value
        ]


load_local_env_file(ROOT / ".env")
SETTINGS = Settings()


class OdooJson2:
    def __init__(self, settings: Settings):
        self.settings = settings

    def call(self, entity: str, method: str, **params):
        if not self.settings.live:
            raise ApiError(503, "Odoo is not configured. Set ODOO_URL, ODOO_DATABASE, ODOO_API_KEY and REFOUND_PROXY_SECRET.")
        model = self.settings.models.get(entity)
        if not model or not re.fullmatch(r"[A-Za-z0-9_.]+", model):
            raise ApiError(503, f"Odoo model mapping is missing for {entity}.")
        url = f"{self.settings.odoo_url}/json/2/{urllib.parse.quote(model, safe='.')}/{urllib.parse.quote(method, safe='')}"
        body = json.dumps(params).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.settings.odoo_api_key}",
                "X-Odoo-Database": self.settings.odoo_database,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Refound-Odoo-Connector/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = response.read(4 * 1024 * 1024 + 1)
                if len(payload) > 4 * 1024 * 1024:
                    raise ApiError(502, "Odoo returned a response larger than the configured limit.")
                return json.loads(payload.decode("utf-8")) if payload else None
        except urllib.error.HTTPError as error:
            response = error.read(4096).decode("utf-8", "replace")
            raise ApiError(502, f"Odoo rejected {entity}.{method} ({error.code}): {response[:500]}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ApiError(502, f"Could not connect to the configured Odoo server: {error}") from error
        except json.JSONDecodeError as error:
            raise ApiError(502, "Odoo returned a response that was not valid JSON.") from error

    def fields_for(self, entity: str) -> list[str]:
        mapping = self.settings.fields.get(entity, {})
        if not isinstance(mapping, dict):
            raise ApiError(503, f"Odoo field mapping for {entity} must be an object.")
        return sorted(set(mapping.values()) | {"id"})

    def normalize(self, entity: str, records):
        mapping = self.settings.fields.get(entity, {})
        if isinstance(records, dict):
            records = [records]
        normalized = []
        for record in records or []:
            result = {}
            for public_name, field in mapping.items():
                value = record.get(field)
                if isinstance(value, list) and len(value) == 2 and isinstance(value[0], int):
                    value = value[1]
                    if public_name in {"donor", "organization", "buyerOrganization", "sellerOrganization", "orderId"}:
                        result[f"{public_name}Id"] = record.get(field, [None])[0]
                result[public_name] = value
            if "id" in record:
                result["id"] = str(record["id"])
            for key in ("quantity", "priceAED", "maxPriceAED", "deliveryFeeAED", "unitPriceAED", "paymentAmountAED", "score"):
                if key in result and result[key] is not None:
                    result[key] = float(result[key]) if key.endswith("AED") else int(result[key])
            if entity == "resource":
                result["resourceType"] = result.get("resourceType") or "Food"
                result["priceAED"] = result.get("priceAED") or 0
                result["status"] = "available" if result.get("status") == "published" else result.get("status")
            if entity == "need":
                result["resourceType"] = result.get("resourceType") or "Food"
            if entity == "order":
                result["orderId"] = str(record.get(mapping.get("orderId", "name")) or record.get("id"))
                result["surplusId"] = str(record.get(mapping.get("surplusId", "resource_id"), [None])[0])
                result["needId"] = str(record.get(mapping.get("needId", "need_id"), [None])[0])
                result["orderId"] = str(record.get("id"))
                result["createdAt"] = record.get(mapping.get("createdAt", "create_date"))
                result["status"] = {
                    "confirmed": "approved",
                    "dispatched": "in_transit",
                    "received": "delivered",
                }.get(result.get("status"), result.get("status"))
            normalized.append(result)
        return normalized


ODOO = OdooJson2(SETTINGS)


def authenticated(handler: BaseHTTPRequestHandler, allowed_roles: set[str]):
    if not SETTINGS.live:
        raise ApiError(503, "Live Odoo service is not configured.")
    proxy_key = handler.headers.get("X-Refound-Proxy-Auth", "")
    if not hmac.compare_digest(proxy_key, SETTINGS.proxy_secret):
        raise ApiError(401, "Sign in through the configured Refound identity provider.")
    principal = handler.headers.get("X-Refound-User", "").strip().lower()
    role = handler.headers.get("X-Refound-Role", "").strip().lower()
    organization_id = handler.headers.get("X-Refound-Organization-ID", "").strip()
    if not principal or role not in {"company", "ngo", "admin"}:
        raise ApiError(401, "The trusted identity provider did not supply a Refound user and role.")
    if role not in allowed_roles:
        raise ApiError(403, "Your organization role cannot perform this action.")
    resolved_organization_id = int(organization_id) if organization_id.isdigit() else 0
    if role != "admin" and not resolved_organization_id:
        matches = ODOO.call("organization", "search_read", domain=[("contact_email", "=", principal)], fields=["id"], limit=1)
        if matches:
            resolved_organization_id = int(matches[0]["id"])
    return {"user": principal, "role": role, "organizationId": resolved_organization_id}


def require_organization(principal: dict, organization_type: str | None = None, approved: bool = True):
    if principal["role"] == "admin":
        return None
    organization_id = principal.get("organizationId", 0)
    if not organization_id:
        raise ApiError(403, "Submit an organization application before using partner features.")
    records = ODOO.call("organization", "search_read", domain=[("id", "=", organization_id)], fields=ODOO.fields_for("organization"), limit=1)
    if not records:
        raise ApiError(403, "The signed-in user is not linked to a Refound organization.")
    organization = records[0]
    actual_type = organization.get(SETTINGS.fields["organization"].get("organizationType", "organization_type"))
    expected_type = organization_type or principal["role"]
    if actual_type != expected_type:
        raise ApiError(403, "The signed-in role does not match the registered organization type.")
    status = organization.get(SETTINGS.fields["organization"].get("status", "verification_status"))
    if approved and status != "approved":
        raise ApiError(403, "Your organization must be verified before it can list, order, or message partners.")
    return organization


def mapped_values(entity: str, payload: dict, exclude: set[str] | None = None):
    mapping = SETTINGS.fields.get(entity, {})
    excluded = exclude or set()
    values = {}
    for public_name, field_name in mapping.items():
        if public_name in payload and public_name not in excluded and isinstance(field_name, str):
            value = payload[public_name]
            if public_name in {"availableUntil", "neededBy", "expectedDeliveryAt"} and value:
                try:
                    value = datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                except ValueError as error:
                    raise ApiError(400, f"{public_name} must be an ISO-8601 date/time.") from error
            elif public_name == "expiresAt" and value:
                value = str(value)[:10]
            values[field_name] = value
    return values


def relation_id(value):
    if isinstance(value, list) and value:
        return value[0]
    return value


class Handler(BaseHTTPRequestHandler):
    server_version = "RefoundServer/1.0"

    def log_message(self, format_string: str, *args) -> None:
        # Avoid logging email, document names, query bodies, or Odoo credentials.
        print(f"{self.log_date_time_string()} {self.address_string()} {format_string % args}")

    def send_json(self, status: int, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ApiError(400, "Invalid request size.") from error
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ApiError(413, "Request is empty or exceeds the 12 MB limit.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ApiError(400, "Request body must be valid JSON.") from error
        if not isinstance(payload, dict):
            raise ApiError(400, "Request body must be a JSON object.")
        return payload

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/health":
            mode = "odoo" if SETTINGS.live else "misconfigured" if SETTINGS.has_partial_live_config else "demo"
            self.send_json(200, {"mode": mode, "missingSettings": SETTINGS.missing_live_settings if mode == "misconfigured" else [], "authenticated": bool(SETTINGS.live), "loginPath": SETTINGS.login_path, "odooApi": "json-2" if SETTINGS.live else None})
            return
        if not path.startswith("/api/"):
            self.serve_static(path)
            return
        try:
            principal = authenticated(self, {"company", "ngo", "admin"})
            if path == "/api/session":
                organizations = ODOO.call("organization", "search_read", domain=[("contact_email", "=", principal["user"])], fields=ODOO.fields_for("organization"), limit=1)
                records = ODOO.normalize("organization", organizations)
                organization = records[0] if records else {}
                self.send_json(200, {
                    "role": principal["role"],
                    "name": organization.get("name") or principal["user"],
                    "email": principal["user"],
                    "contactName": organization.get("contactName") or principal["user"],
                    "organizationId": principal["organizationId"],
                    "organizationStatus": organization.get("status") or "pending",
                })
                return
            if path == "/api/surplus":
                if principal["role"] != "admin":
                    require_organization(principal, approved=False)
                organization_domain = [] if principal["role"] in {"ngo", "admin"} else [("organization_id", "=", principal["organizationId"])]
                domain = [("state", "=", "published")] + organization_domain
                records = ODOO.call("resource", "search_read", domain=domain, fields=ODOO.fields_for("resource"), limit=1000, order="available_until asc")
                self.send_json(200, ODOO.normalize("resource", records))
                return
            if path == "/api/needs":
                if principal["role"] != "admin":
                    require_organization(principal, approved=False)
                domain = [("state", "=", "open")]
                if principal["role"] == "ngo":
                    domain.append(("organization_id", "=", principal["organizationId"]))
                records = ODOO.call("need", "search_read", domain=domain, fields=ODOO.fields_for("need"), limit=1000, order="needed_by asc")
                self.send_json(200, ODOO.normalize("need", records))
                return
            if path == "/api/transfers":
                if principal["role"] != "admin":
                    require_organization(principal)
                domain = [] if principal["role"] == "admin" else (
                    [("seller_organization_id", "=", principal["organizationId"])] if principal["role"] == "company"
                    else [("buyer_organization_id", "=", principal["organizationId"])]
                )
                records = ODOO.call("order", "search_read", domain=domain, fields=ODOO.fields_for("order"), limit=1000, order="create_date desc")
                self.send_json(200, ODOO.normalize("order", records))
                return
            if path == "/api/metrics":
                orders = ODOO.call("order", "search_read", domain=[("state", "=", "received")], fields=ODOO.fields_for("order"), limit=1000)
                self.send_json(200, {"deliveredOrders": len(orders), "mealsRescued": 0, "kgDiverted": 0, "peopleReached": 0, "partnerOrgs": 0, "mealsThisMonth": 0, "source": "Odoo verified orders; conversions require operator-approved weights"})
                return
            if path == "/api/orders":
                if principal["role"] != "admin":
                    require_organization(principal)
                records = ODOO.call("order", "search_read", domain=[("buyer_organization_id", "=", principal["organizationId"])] if principal["role"] == "ngo" else [("seller_organization_id", "=", principal["organizationId"])] if principal["role"] == "company" else [], fields=ODOO.fields_for("order"), limit=1000, order="create_date desc")
                self.send_json(200, ODOO.normalize("order", records))
                return
            match = re.fullmatch(r"/api/orders/([A-Za-z0-9_-]+)/messages", path)
            if match:
                if principal["role"] != "admin":
                    require_organization(principal)
                records = ODOO.call("message", "search_read", domain=[("order_id", "=", int(match.group(1)))], fields=ODOO.fields_for("message"), limit=500, order="create_date asc")
                self.send_json(200, ODOO.normalize("message", records))
                return
            match = re.fullmatch(r"/api/verifications(?:/([A-Za-z0-9_-]+))?", path)
            if match:
                domain = [] if principal["role"] == "admin" else [("contact_email", "=", principal["user"])]
                records = ODOO.call("organization", "search_read", domain=domain, fields=ODOO.fields_for("organization"), limit=500, order="create_date desc")
                self.send_json(200, ODOO.normalize("organization", records))
                return
            match = re.fullmatch(r"/api/verifications/([0-9]+)/documents", path)
            if match:
                organization_id = int(match.group(1))
                organizations = ODOO.call("organization", "search_read", domain=[("id", "=", organization_id)], fields=["id", "contact_email"], limit=1)
                if not organizations or (principal["role"] != "admin" and organizations[0].get("contact_email", "").lower() != principal["user"]):
                    raise ApiError(403, "You cannot view this organization's verification documents.")
                documents = ODOO.call("document", "search_read", domain=[("organization_id", "=", organization_id)], fields=ODOO.fields_for("document"), limit=20)
                self.send_json(200, ODOO.normalize("document", documents))
                return
            match = re.fullmatch(r"/api/verifications/([0-9]+)/documents/([0-9]+)", path)
            if match:
                self.serve_verification_document(int(match.group(1)), int(match.group(2)), principal)
                return
            raise ApiError(404, "API endpoint not found.")
        except ApiError as error:
            self.send_json(error.status, {"error": str(error)})
        except Exception as error:
            print(f"API error {type(error).__name__}")
            self.send_json(500, {"error": "The Refound service could not complete this request. Check server logs for the request error."})

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if not path.startswith("/api/"):
            self.send_json(404, {"error": "Endpoint not found."})
            return
        try:
            self.validate_same_origin()
            principal = authenticated(self, {"company", "ngo", "admin"})
            payload = self.read_json()
            if path == "/api/surplus":
                if principal["role"] != "company":
                    raise ApiError(403, "Only companies can list surplus resources.")
                require_organization(principal, "company")
                payload["resourceType"] = payload.get("resourceType") or "Food"
                payload.update({"donor": [principal["organizationId"], ""]})
                if payload["resourceType"] in {"Food", "Medical equipment"} and not payload.get("expiresAt"):
                    raise ApiError(400, "An item expiry/use-by date is required for this resource type.")
                if float(payload.get("priceAED", 0)) < 0:
                    raise ApiError(400, "Resource price cannot be negative.")
                values = mapped_values("resource", payload, {"id", "status", "listedAt"})
                values[SETTINGS.fields["resource"]["donor"]] = principal["organizationId"]
                record_id = ODOO.call("resource", "create", vals=values)
                ODOO.call("resource", "action_refound_publish_from_api", resource_id=record_id, organization_id=principal["organizationId"], role=principal["role"])
                self.send_json(201, {"id": str(record_id), **payload, "status": "available"})
                return
            if path == "/api/needs":
                if principal["role"] != "ngo":
                    raise ApiError(403, "Only community organizations can post requirements.")
                require_organization(principal, "ngo")
                payload.update({"organization": [principal["organizationId"], ""]})
                values = mapped_values("need", payload, {"id", "organization"})
                values[SETTINGS.fields["need"]["organization"]] = principal["organizationId"]
                record_id = ODOO.call("need", "create", vals=values)
                self.send_json(201, {"id": str(record_id), **payload, "organization": principal["user"]})
                return
            if path == "/api/orders":
                if principal["role"] != "ngo":
                    raise ApiError(403, "Only verified NGOs can check out a resource basket.")
                require_organization(principal, "ngo")
                lines = payload.get("lines")
                if not isinstance(lines, list) or not 1 <= len(lines) <= 50:
                    raise ApiError(400, "An order must contain 1–50 resource lines.")
                created = ODOO.call("order", "create_from_refound_cart", lines=lines, buyer_organization_id=principal["organizationId"], payment_provider_configured=False)
                records = ODOO.call("order", "search_read", domain=[("id", "=", int(created))], fields=ODOO.fields_for("order"), limit=1)
                order = ODOO.normalize("order", records)[0] if records else {"id": str(created)}
                self.send_json(201, {**order, "id": str(created), "status": order.get("status", "pending_payment"), "paymentStatus": order.get("paymentStatus", "pending"), "message": "Order and stock reservation saved in Odoo. Paid checkout stays disabled until an Odoo payment provider is configured."})
                return
            match = re.fullmatch(r"/api/transfers/([A-Za-z0-9_-]+)/accept", path)
            if match:
                record_id = self.parse_id(match.group(1))
                if principal["role"] != "admin":
                    require_organization(principal, "company" if principal["role"] == "company" else "ngo")
                result = ODOO.call("order", "action_refound_accept", order_id=record_id, organization_id=principal["organizationId"], role=principal["role"])
                self.send_json(200, {"id": str(record_id), "status": result})
                return
            match = re.fullmatch(r"/api/transfers/([A-Za-z0-9_-]+)/dispatch", path)
            if match:
                record_id = self.parse_id(match.group(1))
                if principal["role"] != "admin":
                    require_organization(principal, "company")
                logistics = dict(payload)
                if logistics.get("expectedDeliveryAt"):
                    logistics["expectedDeliveryAt"] = mapped_values("order", {"expectedDeliveryAt": logistics["expectedDeliveryAt"]}, set()).get(SETTINGS.fields["order"]["expectedDeliveryAt"])
                result = ODOO.call("order", "action_refound_dispatch", order_id=record_id, organization_id=principal["organizationId"], role=principal["role"], logistics=logistics)
                self.send_json(200, {"id": str(record_id), **result})
                return
            match = re.fullmatch(r"/api/transfers/([A-Za-z0-9_-]+)/receipt", path)
            if match:
                record_id = self.parse_id(match.group(1))
                if principal["role"] != "admin":
                    require_organization(principal, "ngo")
                result = ODOO.call("order", "action_refound_confirm_receipt", order_id=record_id, organization_id=principal["organizationId"], role=principal["role"])
                self.send_json(200, {"id": str(record_id), "status": result})
                return
            match = re.fullmatch(r"/api/orders/([A-Za-z0-9_-]+)/messages", path)
            if match:
                order_id = self.parse_id(match.group(1))
                if principal["role"] != "admin":
                    require_organization(principal)
                record_id = ODOO.call("message", "create_for_order", order_id=order_id, user_email=principal["user"], role=principal["role"], body=payload.get("body", ""))
                self.send_json(201, {"id": str(record_id), "orderId": str(order_id), "senderRole": principal["role"], "senderOrganization": principal["user"], "body": payload.get("body", "")})
                return
            match = re.fullmatch(r"/api/verifications(?:/([A-Za-z0-9_-]+)/review|)", path)
            if match and path.endswith("/review"):
                if principal["role"] != "admin":
                    raise ApiError(403, "Only Refound reviewers can change organization status.")
                record_id = self.parse_id(match.group(1))
                result = ODOO.call(
                    "organization", "action_refound_review",
                    organization_id=record_id,
                    decision=payload.get("decision"),
                    decision_note=payload.get("decisionNote", ""),
                    reviewer_email=principal["user"],
                    registration_checked=bool(payload.get("registrationChecked")),
                    authority_checked=bool(payload.get("authorityChecked")),
                    evidence_checked=bool(payload.get("evidenceChecked")),
                )
                self.send_json(200, {"id": str(record_id), **result})
                return
            if path == "/api/verifications":
                if principal["role"] not in {"company", "ngo"}:
                    raise ApiError(403, "Organization applications can only be submitted as a company or NGO.")
                if payload.get("organizationType") != principal["role"]:
                    raise ApiError(403, "Organization type does not match the signed-in role.")
                payload["email"] = principal["user"]
                record_id = ODOO.call("organization", "create_from_refound_application", application=payload)
                self.send_json(201, {"id": str(record_id), **payload, "status": "pending", "submittedAt": None})
                return
            match = re.fullmatch(r"/api/verifications/([A-Za-z0-9_-]+)/documents", path)
            if match:
                if principal["role"] not in {"company", "ngo"}:
                    raise ApiError(403, "Only an organization applicant can upload verification documents.")
                self.save_verification_document(self.parse_id(match.group(1)), payload, principal)
                return
            raise ApiError(404, "API endpoint not found.")
        except ApiError as error:
            self.send_json(error.status, {"error": str(error)})
        except Exception as error:
            print(f"API error {type(error).__name__}")
            self.send_json(500, {"error": "The Refound service could not complete this request. Check server logs for the request error."})

    @staticmethod
    def parse_id(value: str) -> int:
        if not value.isdigit() or int(value) <= 0:
            raise ApiError(400, "Invalid record identifier.")
        return int(value)

    def validate_same_origin(self):
        origin = urllib.parse.urlsplit(self.headers.get("Origin", ""))
        host = self.headers.get("Host", "").lower()
        if origin.scheme not in {"http", "https"} or not origin.netloc or origin.netloc.lower() != host:
            raise ApiError(403, "Cross-origin requests are not accepted.")
        fetch_site = self.headers.get("Sec-Fetch-Site", "same-origin")
        if fetch_site not in {"same-origin", "none"}:
            raise ApiError(403, "Cross-site requests are not accepted.")

    def save_verification_document(self, organization_id: int, payload: dict, principal: dict):
        if not isinstance(payload.get("fileName"), str) or not isinstance(payload.get("contentBase64"), str):
            raise ApiError(400, "A file name and encoded document are required.")
        file_name = Path(payload["fileName"]).name
        mime_type = payload.get("mimeType", "")
        if mime_type not in ALLOWED_DOCUMENT_MIMES or Path(file_name).suffix.lower() not in {".pdf", ".jpg", ".jpeg", ".png"}:
            raise ApiError(400, "Upload a PDF, JPG, or PNG registration document.")
        try:
            content = base64.b64decode(payload["contentBase64"], validate=True)
        except (ValueError, base64.binascii.Error) as error:
            raise ApiError(400, "Uploaded document data is invalid.") from error
        if not content or len(content) > MAX_DOCUMENT_BYTES:
            raise ApiError(413, "Each verification document must be smaller than 3 MB.")
        result = ODOO.call(
            "document", "create_for_verification",
            organization_id=organization_id,
            user_email=principal["user"],
            file_name=file_name,
            mime_type=mime_type,
            content_base64=base64.b64encode(content).decode("ascii"),
        )
        self.send_json(201, {"id": str(result), "name": file_name, "reviewStatus": "pending_review"})

    def serve_verification_document(self, organization_id: int, document_id: int, principal: dict):
        documents = ODOO.call(
            "document", "search_read",
            domain=[("id", "=", document_id), ("organization_id", "=", organization_id)],
            fields=["id", "name", "mime_type", "attachment_id"],
            limit=1,
        )
        organizations = ODOO.call("organization", "search_read", domain=[("id", "=", organization_id)], fields=["id", "contact_email"], limit=1)
        if not documents or not organizations:
            raise ApiError(404, "Verification document not found.")
        if principal["role"] != "admin" and organizations[0].get("contact_email", "").lower() != principal["user"]:
            raise ApiError(403, "You cannot view this organization's verification documents.")
        attachment_id = relation_id(documents[0].get("attachment_id"))
        if not attachment_id:
            raise ApiError(404, "Document attachment not found.")
        attachments = ODOO.call("attachment", "read", ids=[attachment_id], fields=["name", "datas", "mimetype", "public", "res_model", "res_id"])
        if not attachments:
            raise ApiError(404, "Document attachment not found.")
        record = attachments[0]
        if record.get("public") or record.get("res_model") != "refound.organization" or int(record.get("res_id", 0)) != organization_id:
            raise ApiError(403, "This is not a private organization verification attachment.")
        mime_type = record.get("mimetype", "")
        if mime_type not in ALLOWED_DOCUMENT_MIMES:
            raise ApiError(415, "Only PDF, JPG, and PNG verification documents can be viewed.")
        try:
            content = base64.b64decode(record.get("datas", ""), validate=True)
        except (ValueError, base64.binascii.Error) as error:
            raise ApiError(502, "Stored Odoo document data could not be decoded.") from error
        if not content or len(content) > MAX_DOCUMENT_BYTES:
            raise ApiError(413, "Stored verification document exceeds the 3 MB preview limit.")
        file_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(record.get("name", "document")).name)[:120] or "document"
        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Content-Disposition", f'inline; filename="{file_name}"')
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(content)

    def serve_static(self, path: str):
        decoded = urllib.parse.unquote(path)
        relative = Path(decoded.lstrip("/") or "index.html")
        target = (ROOT / relative).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_json(400, {"error": "Invalid file path."})
            return
        if not target.is_file():
            self.send_json(404, {"error": "File not found."})
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        content = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith(("text/", "application/javascript")) else content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()
        self.wfile.write(content)

    def do_HEAD(self):
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/api/"):
            self.send_json(405, {"error": "Use GET or POST."})
            return
        decoded = urllib.parse.unquote(path)
        target = (ROOT / Path(decoded.lstrip("/") or "index.html")).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_json(400, {"error": "Invalid file path."})
        elif not target.is_file():
            self.send_json(404, {"error": "File not found."})
        else:
            self.send_response(200)
            self.send_header("Content-Length", str(target.stat().st_size))
            self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            self.end_headers()


def main():
    server = ThreadingHTTPServer((SETTINGS.host, SETTINGS.port), Handler)
    print(f"Refound listening on http://{SETTINGS.host}:{SETTINGS.port} ({'Odoo JSON-2' if SETTINGS.live else 'demo mode'})")
    if SETTINGS.live:
        print("Live API access is restricted to requests authenticated by the configured trusted identity reverse proxy.")
    server.serve_forever()


if __name__ == "__main__":
    main()

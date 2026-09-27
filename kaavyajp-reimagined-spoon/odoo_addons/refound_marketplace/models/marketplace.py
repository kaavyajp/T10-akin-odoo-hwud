import base64
import re

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, ValidationError


RESOURCE_TYPES = [
    ("Food", "Food"),
    ("Medical equipment", "Medical equipment"),
    ("Study resources", "Study resources"),
    ("Other essentials", "Other essentials"),
]
RESOURCE_CATEGORIES = {
    "Food": {"Produce", "Bakery", "Prepared meals", "Dairy", "Pantry"},
    "Medical equipment": {"Mobility aids", "Clinical equipment", "PPE", "First-aid kits", "Other medical equipment"},
    "Study resources": {"Textbooks", "School supplies", "Computers & calculators", "Art materials", "Other study resources"},
    "Other essentials": {"Clothing", "Hygiene", "Household goods", "Furniture", "Electronics", "Other essentials"},
}
URGENCY = [("standard", "Standard"), ("high", "High"), ("critical", "Critical")]


class RefoundOrganization(models.Model):
    _name = "refound.organization"
    _description = "Refound Verified Organization"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "create_date desc"

    name = fields.Char(required=True, tracking=True, index=True)
    organization_type = fields.Selection([("company", "Company"), ("ngo", "NGO")], required=True, tracking=True, index=True)
    contact_name = fields.Char(required=True)
    contact_email = fields.Char(required=True, index=True)
    location = fields.Char(required=True)
    registration_number = fields.Char()
    application_notes = fields.Text()
    verification_status = fields.Selection(
        [("pending", "Pending review"), ("approved", "Verified"), ("rejected", "Changes requested"), ("suspended", "Suspended")],
        required=True, default="pending", tracking=True, index=True,
    )
    review_note = fields.Text()
    reviewed_at = fields.Datetime(readonly=True)
    reviewer_email = fields.Char(readonly=True, tracking=True)
    reviewed_by = fields.Many2one("res.users", readonly=True)
    review_registration_checked = fields.Boolean(readonly=True)
    review_authority_checked = fields.Boolean(readonly=True)
    review_evidence_checked = fields.Boolean(readonly=True)
    document_ids = fields.One2many("refound.organization.document", "organization_id", string="Verification documents")

    def action_refound_review(self, organization_id, decision, decision_note="", reviewer_email="", registration_checked=False, authority_checked=False, evidence_checked=False):
        organization = self.browse(int(organization_id)).exists()
        if not organization:
            raise ValidationError(_("Organization application not found."))
        if decision not in {"approved", "rejected"}:
            raise ValidationError(_("Review decision must be approved or rejected."))
        if organization.verification_status != "pending":
            raise ValidationError(_("Only pending applications can be reviewed."))
        if decision == "approved":
            if not organization.registration_number or not organization.document_ids:
                raise ValidationError(_("Approval requires a registration number and submitted evidence."))
            if not (registration_checked and authority_checked and evidence_checked):
                raise ValidationError(_("Complete all three identity and evidence checks before approval."))
        if decision == "rejected" and not str(decision_note).strip():
            raise ValidationError(_("Record a reason or a follow-up request before rejection."))
        reviewed_at = fields.Datetime.now()
        reviewer_email = str(reviewer_email).strip().lower()[:254]
        organization.write({
            "verification_status": decision,
            "review_note": str(decision_note)[:1000],
            "reviewed_at": reviewed_at,
            "reviewer_email": reviewer_email,
            "reviewed_by": self.env.user.id,
            "review_registration_checked": bool(registration_checked),
            "review_authority_checked": bool(authority_checked),
            "review_evidence_checked": bool(evidence_checked),
        })
        organization.message_post(body=_("Verification decision: %s by %s. %s") % (
            decision, reviewer_email or self.env.user.display_name, str(decision_note)[:1000],
        ))
        organization.document_ids.write({"review_status": "accepted" if decision == "approved" else "rejected"})
        return {
            "status": organization.verification_status,
            "decisionNote": organization.review_note or "",
            "reviewedAt": fields.Datetime.to_string(reviewed_at),
            "reviewerEmail": reviewer_email,
        }

    @api.model
    def create_from_refound_application(self, application):
        if not isinstance(application, dict):
            raise ValidationError(_("Organization application is invalid."))
        email = str(application.get("email", "")).strip().lower()
        if not email or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ValidationError(_("A valid organization contact email is required."))
        existing = self.search([("contact_email", "=", email), ("verification_status", "!=", "rejected")], limit=1)
        if existing:
            raise ValidationError(_("This contact email already has a pending or verified organization."))
        role = str(application.get("organizationType", ""))
        if role not in {"company", "ngo"}:
            raise ValidationError(_("Organization must be a company or NGO."))
        return self.create({
            "name": str(application.get("organizationName", "")).strip(),
            "organization_type": role,
            "contact_name": str(application.get("contactName", "")).strip(),
            "contact_email": email,
            "location": str(application.get("location", "")).strip(),
            "registration_number": str(application.get("registrationId", "")).strip(),
            "application_notes": str(application.get("notes", ""))[:2000],
            "verification_status": "pending",
        }).id


class RefoundOrganizationDocument(models.Model):
    _name = "refound.organization.document"
    _description = "Private Refound Verification Document"
    _order = "create_date desc"

    organization_id = fields.Many2one("refound.organization", required=True, ondelete="cascade", index=True)
    name = fields.Char(required=True)
    attachment_id = fields.Many2one("ir.attachment", required=True, ondelete="restrict")
    mime_type = fields.Char(required=True)
    review_status = fields.Selection(
        [("pending_review", "Pending review"), ("accepted", "Accepted"), ("rejected", "Rejected")],
        default="pending_review", required=True, tracking=True,
    )
    reviewer_note = fields.Text()

    @api.model
    def create_for_verification(self, organization_id, user_email, file_name, mime_type, content_base64):
        organization = self.env["refound.organization"].browse(int(organization_id)).exists()
        if not organization or organization.contact_email.lower() != str(user_email).lower():
            raise AccessError(_("This user cannot upload documents to that organization."))
        if organization.verification_status != "pending":
            raise ValidationError(_("Documents can only be added to a pending application."))
        content = base64.b64decode(content_base64, validate=True)
        if not content or len(content) > 8 * 1024 * 1024:
            raise ValidationError(_("Each verification document must be smaller than 8 MB."))
        attachment = self.env["ir.attachment"].create({
            "name": str(file_name)[:180],
            "type": "binary",
            "datas": content_base64,
            "mimetype": str(mime_type),
            "res_model": organization._name,
            "res_id": organization.id,
            "public": False,
        })
        return self.create({
            "organization_id": organization.id,
            "name": attachment.name,
            "attachment_id": attachment.id,
            "mime_type": attachment.mimetype,
        }).id


class RefoundResource(models.Model):
    _name = "refound.resource"
    _description = "Refound Surplus Resource"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "available_until asc, create_date desc"

    name = fields.Char(required=True, tracking=True, index=True)
    organization_id = fields.Many2one("refound.organization", required=True, index=True, ondelete="restrict")
    resource_type = fields.Selection(RESOURCE_TYPES, required=True, index=True)
    category = fields.Char(required=True, index=True)
    quantity = fields.Integer(required=True, default=1)
    unit = fields.Char(required=True)
    location = fields.Char(required=True)
    available_until = fields.Datetime(required=True, index=True)
    expires_at = fields.Date(index=True)
    price_aed = fields.Monetary(required=True, default=0, currency_field="currency_id")
    currency_id = fields.Many2one("res.currency", required=True, default=lambda self: self.env.ref("base.AED", raise_if_not_found=False) or self.env.company.currency_id)
    item_condition = fields.Char(required=True)
    specifications = fields.Text()
    storage_instructions = fields.Text()
    notes = fields.Text()
    state = fields.Selection(
        [("draft", "Draft"), ("published", "Published"), ("reserved", "Reserved"), ("fulfilled", "Fulfilled"), ("expired", "Expired"), ("withdrawn", "Withdrawn")],
        required=True, default="draft", tracking=True, index=True,
    )

    @api.constrains("quantity", "price_aed", "available_until", "expires_at")
    def _check_refound_resource(self):
        for resource in self:
            if resource.quantity < 1 or resource.price_aed < 0:
                raise ValidationError(_("Quantity must be positive and AED price must not be negative."))
            if resource.available_until <= fields.Datetime.now():
                raise ValidationError(_("The company order-by window must be in the future."))
            if resource.resource_type in {"Food", "Medical equipment"} and not resource.expires_at:
                raise ValidationError(_("Food and medical equipment require the labeled use-by or expiry date."))
            if resource.expires_at and fields.Date.to_date(resource.expires_at) <= fields.Date.today():
                raise ValidationError(_("Expired resources cannot be listed."))
            if resource.expires_at and fields.Datetime.to_datetime(resource.available_until).date() > fields.Date.to_date(resource.expires_at):
                raise ValidationError(_("The company must be able to fulfil before the item expiry."))

    @api.constrains("resource_type", "category", "item_condition", "storage_instructions", "specifications", "notes")
    def _check_refound_resource_details(self):
        for resource in self:
            if resource.category not in RESOURCE_CATEGORIES.get(resource.resource_type, set()):
                raise ValidationError(_("Choose a category belonging to this resource type."))
            if resource.resource_type in {"Food", "Medical equipment"} and not resource.storage_instructions:
                raise ValidationError(_("Food and medical equipment need clear storage/handling instructions."))
            forbidden = "%s %s" % (resource.name or "", resource.notes or "")
            if resource.resource_type == "Medical equipment" and re.search(r"\b(medicines?|prescriptions?|pharmaceuticals?|sharps?|recalled|expired)\b", forbidden, re.I):
                raise ValidationError(_("Medicines, sharps, recalled, and expired items are not eligible for this marketplace."))

    def action_refound_publish(self):
        for resource in self:
            if resource.organization_id.verification_status != "approved" or resource.organization_id.organization_type != "company":
                raise AccessError(_("Only a verified company can publish surplus."))
            resource.state = "published"
        return True

    @api.model
    def action_refound_publish_from_api(self, resource_id, organization_id, role):
        resource = self.browse(int(resource_id)).exists()
        if not resource or role != "company" or resource.organization_id.id != int(organization_id):
            raise AccessError(_("Only the verified donating company can publish this listing."))
        resource.action_refound_publish()
        return "published"


class RefoundNeed(models.Model):
    _name = "refound.need"
    _description = "Refound Community Requirement"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "needed_by asc, urgency desc, create_date desc"

    name = fields.Char(compute="_compute_name", store=True)
    organization_id = fields.Many2one("refound.organization", required=True, index=True, ondelete="restrict")
    contact_name = fields.Char(required=True)
    resource_type = fields.Selection(RESOURCE_TYPES, required=True, index=True)
    category = fields.Char(required=True, index=True)
    quantity = fields.Integer(required=True, default=1)
    unit = fields.Char(required=True)
    delivery_address = fields.Char(required=True)
    urgency = fields.Selection(URGENCY, required=True, default="standard", index=True)
    needed_by = fields.Datetime(required=True, index=True)
    minimum_expiry = fields.Date()
    max_price_aed = fields.Monetary(required=True, default=0, currency_field="currency_id")
    currency_id = fields.Many2one("res.currency", required=True, default=lambda self: self.env.ref("base.AED", raise_if_not_found=False) or self.env.company.currency_id)
    preferred_condition = fields.Char()
    specifications = fields.Text()
    receiving_instructions = fields.Text()
    description = fields.Text(required=True)
    state = fields.Selection([("open", "Open"), ("fulfilled", "Fulfilled"), ("closed", "Closed")], default="open", required=True, index=True)

    @api.depends("organization_id.name", "resource_type", "category")
    def _compute_name(self):
        for need in self:
            need.name = "%s · %s" % (need.organization_id.name or "", need.category or need.resource_type or "")

    @api.constrains("quantity", "max_price_aed", "needed_by", "minimum_expiry")
    def _check_refound_need(self):
        for need in self:
            if need.quantity < 1 or need.max_price_aed < 0:
                raise ValidationError(_("Required quantity must be positive and the maximum unit budget cannot be negative."))
            if need.needed_by <= fields.Datetime.now():
                raise ValidationError(_("Requirement delivery date must be in the future."))
            if need.minimum_expiry and fields.Date.to_date(need.minimum_expiry) <= fields.Date.today():
                raise ValidationError(_("Minimum remaining shelf-life date must be in the future."))
            if need.category not in RESOURCE_CATEGORIES.get(need.resource_type, set()):
                raise ValidationError(_("Choose a category belonging to this resource type."))


class RefoundOrder(models.Model):
    _name = "refound.order"
    _description = "Refound Resource Order"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "create_date desc"

    name = fields.Char(required=True, default="New", copy=False, index=True)
    buyer_organization_id = fields.Many2one("refound.organization", required=True, index=True, ondelete="restrict")
    seller_organization_id = fields.Many2one("refound.organization", required=True, index=True, ondelete="restrict")
    resource_id = fields.Many2one("refound.resource", required=True, ondelete="restrict", index=True)
    need_id = fields.Many2one("refound.need", required=True, ondelete="restrict", index=True)
    quantity = fields.Integer(required=True)
    unit_price_aed = fields.Monetary(required=True, currency_field="currency_id")
    product_total_aed = fields.Monetary(required=True, currency_field="currency_id")
    delivery_fee_aed = fields.Monetary(default=0, currency_field="currency_id")
    currency_id = fields.Many2one("res.currency", required=True, default=lambda self: self.env.ref("base.AED", raise_if_not_found=False) or self.env.company.currency_id)
    payment_status = fields.Selection(
        [("not_required", "No charge"), ("pending", "Payment pending"), ("paid", "Paid"), ("failed", "Failed"), ("refunded", "Refunded")],
        default="pending", required=True, tracking=True,
    )
    payment_method = fields.Char()
    payment_reference = fields.Char(copy=False, index=True)
    state = fields.Selection(
        [("pending_payment", "Payment pending"), ("pending", "Awaiting company review"), ("confirmed", "Company confirmed"), ("dispatched", "Company dispatched"), ("received", "Received"), ("cancelled", "Cancelled")],
        required=True, default="pending_payment", tracking=True, index=True,
    )
    logistics_method = fields.Char()
    tracking_reference = fields.Char()
    expected_delivery_at = fields.Datetime()
    logistics_notes = fields.Text()
    buyer_receipt_at = fields.Datetime()
    match_score = fields.Integer()

    @api.model_create_multi
    def create(self, vals_list):
        for values in vals_list:
            if values.get("name", "New") == "New":
                values["name"] = self.env["ir.sequence"].next_by_code("refound.order") or "New"
        return super().create(vals_list)

    @api.model
    def create_from_refound_cart(self, lines, buyer_organization_id, payment_provider_configured=False):
        buyer = self.env["refound.organization"].browse(int(buyer_organization_id)).exists()
        if not buyer or buyer.organization_type != "ngo" or buyer.verification_status != "approved":
            raise AccessError(_("An approved NGO account is required to place orders."))
        if not isinstance(lines, list) or not 1 <= len(lines) <= 50:
            raise ValidationError(_("An order must contain 1–50 resource lines."))
        orders = self.browse()
        for line in lines:
            resource = self.env["refound.resource"].browse(int(line.get("surplusId", 0))).exists()
            need = self.env["refound.need"].browse(int(line.get("needId", 0))).exists()
            quantity = int(line.get("quantity", 0))
            if not resource or not need or need.organization_id != buyer:
                raise AccessError(_("Every basket line must match the purchasing NGO's own requirement."))
            if resource.organization_id.verification_status != "approved" or resource.organization_id.organization_type != "company":
                raise AccessError(_("Only verified company listings can be ordered."))
            if resource.state != "published" or need.state != "open" or quantity < 1:
                raise ValidationError(_("A basket item is no longer available."))
            if resource.resource_type != need.resource_type or resource.category != need.category or resource.unit != need.unit:
                raise ValidationError(_("Resource type, category, and units must match the NGO requirement."))
            if resource.price_aed > need.max_price_aed:
                raise ValidationError(_("The unit price exceeds the NGO's approved budget."))
            if need.minimum_expiry and (not resource.expires_at or resource.expires_at < need.minimum_expiry):
                raise ValidationError(_("The item does not meet the NGO's minimum remaining shelf life."))
            if resource.quantity < quantity or need.quantity < quantity:
                raise ValidationError(_("Available resource or NGO request quantity changed."))
            if resource.expires_at and resource.expires_at < fields.Date.today():
                raise ValidationError(_("Expired resources cannot be ordered."))
            product_total = resource.price_aed * quantity
            if product_total > 0 and not payment_provider_configured:
                raise ValidationError(_("Paid orders are disabled until a secure payment provider and verified payment callbacks are connected."))
            order = self.create({
                "buyer_organization_id": buyer.id,
                "seller_organization_id": resource.organization_id.id,
                "resource_id": resource.id,
                "need_id": need.id,
                "quantity": quantity,
                "unit_price_aed": resource.price_aed,
                "product_total_aed": product_total,
                "payment_status": "not_required" if product_total == 0 else "pending",
                "state": "pending" if product_total == 0 else "pending_payment",
            })
            resource.quantity -= quantity
            need.quantity -= quantity
            if resource.quantity == 0:
                resource.state = "reserved"
            if need.quantity == 0:
                need.state = "fulfilled"
            orders |= order
        return orders.ids if payment_provider_configured else orders[:1].id

    @api.model
    def action_refound_mark_paid(self, order_ids, session_id, payment_intent=""):
        ids = [int(value) for value in order_ids]
        orders = self.browse(ids).exists()
        if not orders or len(orders) != len(ids):
            raise ValidationError(_("The Stripe checkout references an unknown order."))
        for order in orders:
            if order.payment_status == "paid" and order.payment_reference == str(session_id):
                continue
            if order.state != "pending_payment" or order.payment_status != "pending":
                raise ValidationError(_("Only a pending Stripe order can be marked paid."))
            order.write({
                "payment_status": "paid",
                "payment_method": "Stripe",
                "payment_reference": str(session_id)[:255],
                "state": "pending",
            })
        return {"status": "paid", "paymentIntent": str(payment_intent)[:255]}

    @api.model
    def action_refound_cancel_unpaid(self, order_ids):
        orders = self.browse([int(value) for value in order_ids]).exists()
        for order in orders:
            if order.state not in {"pending", "pending_payment"} or order.payment_status not in {"pending", "not_required"}:
                continue
            order.resource_id.quantity += order.quantity
            if order.resource_id.state == "reserved":
                order.resource_id.state = "published"
            order.need_id.quantity += order.quantity
            if order.need_id.state == "fulfilled":
                order.need_id.state = "open"
            order.write({
                "payment_status": "failed" if order.payment_status == "pending" else "not_required",
                "state": "cancelled",
                "payment_reference": "Stripe checkout not completed",
            })
        return True

    @api.model
    def action_refound_mark_paid(self, order_ids, session_id, payment_intent=""):
        orders = self.browse([int(value) for value in order_ids]).exists()
        if not orders or len(orders) != len(order_ids):
            raise ValidationError(_("The Stripe checkout references an unknown order."))
        for order in orders:
            if order.payment_status == "paid" and order.payment_reference == str(session_id):
                continue
            if order.state != "pending_payment" or order.payment_status != "pending":
                raise ValidationError(_("Only a pending Stripe order can be marked paid."))
            order.write({
                "payment_status": "paid",
                "payment_method": "Stripe",
                "payment_reference": str(session_id)[:255],
                "state": "pending",
            })
        return {"status": "paid", "paymentIntent": str(payment_intent)[:255]}

    @api.model
    def action_refound_cancel_unpaid(self, order_ids):
        orders = self.browse([int(value) for value in order_ids]).exists()
        if not orders:
            return True
        for order in orders:
            if order.state not in {"pending", "pending_payment"} or order.payment_status not in {"pending", "not_required"}:
                continue
            order.resource_id.quantity += order.quantity
            if order.resource_id.state == "reserved":
                order.resource_id.state = "published"
            order.need_id.quantity += order.quantity
            if order.need_id.state == "fulfilled":
                order.need_id.state = "open"
            order.write({
                "payment_status": "failed" if order.payment_status == "pending" else "not_required",
                "state": "cancelled",
                "payment_reference": "Stripe checkout not completed",
            })
        return True

    def action_refound_accept(self, order_id, organization_id, role):
        order = self.browse(int(order_id)).exists()
        if not order or role != "company" or order.seller_organization_id.id != int(organization_id):
            raise AccessError(_("Only the selling company can accept this order."))
        if order.state != "pending" or order.payment_status not in {"paid", "not_required"}:
            raise ValidationError(_("Confirm product payment before accepting this order."))
        order.state = "confirmed"
        return "approved"

    def action_refound_dispatch(self, order_id, organization_id, role, logistics):
        order = self.browse(int(order_id)).exists()
        if not order or role != "company" or order.seller_organization_id.id != int(organization_id):
            raise AccessError(_("Only the selling company arranges delivery."))
        eta = logistics.get("expectedDeliveryAt")
        method = str(logistics.get("method", "")).strip()
        if order.state != "confirmed" or not method or not eta:
            raise ValidationError(_("Confirm the order and provide a carrier/method and ETA."))
        try:
            delivery_eta = fields.Datetime.to_datetime(eta)
        except (TypeError, ValueError) as error:
            raise ValidationError(_("Delivery ETA is invalid.")) from error
        if not delivery_eta or delivery_eta <= fields.Datetime.now():
            raise ValidationError(_("Delivery ETA must be in the future."))
        fee = float(logistics.get("deliveryFeeAED", 0))
        if fee < 0 or fee > 100000:
            raise ValidationError(_("Delivery fee is invalid."))
        order.write({
            "state": "dispatched",
            "logistics_method": method,
            "delivery_fee_aed": fee,
            "tracking_reference": str(logistics.get("trackingReference", ""))[:120],
            "expected_delivery_at": delivery_eta,
            "logistics_notes": str(logistics.get("logisticsNotes", ""))[:2000],
        })
        return {"status": "in_transit", "logisticsMethod": method, "deliveryFeeAED": fee, "trackingReference": order.tracking_reference, "expectedDeliveryAt": fields.Datetime.to_string(delivery_eta)}

    def action_refound_confirm_receipt(self, order_id, organization_id, role):
        order = self.browse(int(order_id)).exists()
        if not order or role != "ngo" or order.buyer_organization_id.id != int(organization_id):
            raise AccessError(_("Only the receiving NGO can confirm receipt."))
        if order.state != "dispatched":
            raise ValidationError(_("Only a dispatched order can be marked received."))
        order.write({"state": "received", "buyer_receipt_at": fields.Datetime.now()})
        return "delivered"


class RefoundOrderMessage(models.Model):
    _name = "refound.order.message"
    _description = "Refound Order Message"
    _order = "create_date asc"

    order_id = fields.Many2one("refound.order", required=True, ondelete="cascade", index=True)
    sender_organization_id = fields.Many2one("refound.organization", ondelete="restrict")
    sender_role = fields.Selection([("company", "Company"), ("ngo", "NGO"), ("admin", "Refound")], required=True)
    body = fields.Text(required=True)

    @api.model
    def create_for_order(self, order_id, user_email, role, body):
        order = self.env["refound.order"].browse(int(order_id)).exists()
        organization = self.env["refound.organization"].search([("contact_email", "=", str(user_email).lower())], limit=1)
        if not order or role not in {"company", "ngo", "admin"}:
            raise AccessError(_("Order message sender is not authorized."))
        if role == "company" and order.seller_organization_id != organization:
            raise AccessError(_("Only the selling company can message this order."))
        if role == "ngo" and order.buyer_organization_id != organization:
            raise AccessError(_("Only the purchasing NGO can message this order."))
        text = str(body).strip()
        if not text or len(text) > 1500:
            raise ValidationError(_("Order messages must contain 1–1,500 characters."))
        message = self.create({
            "order_id": order.id,
            "sender_organization_id": organization.id if organization else False,
            "sender_role": role,
            "body": text,
        })
        return message.id


class RefoundConversation(models.Model):
    _name = "refound.conversation"
    _description = "Refound Verified Partner Conversation"
    _order = "write_date desc, create_date desc"

    company_organization_id = fields.Many2one("refound.organization", required=True, ondelete="cascade", index=True)
    ngo_organization_id = fields.Many2one("refound.organization", required=True, ondelete="cascade", index=True)
    message_ids = fields.One2many("refound.conversation.message", "conversation_id")

    _sql_constraints = [
        ("refound_conversation_partner_pair_unique", "unique(company_organization_id, ngo_organization_id)", "A conversation already exists for this partner pair."),
        ("refound_conversation_distinct_partners", "check(company_organization_id != ngo_organization_id)", "A conversation must be between two distinct organizations."),
    ]

    @api.model
    def _refound_verified_actor(self, organization_id):
        organization = self.env["refound.organization"].browse(int(organization_id)).exists()
        if not organization or organization.verification_status != "approved" or organization.organization_type not in {"company", "ngo"}:
            raise AccessError(_("Only verified businesses and NGOs can use partner chat."))
        return organization

    @api.model
    def list_for_refound_organization(self, organization_id):
        organization = self._refound_verified_actor(organization_id)
        domain = [("company_organization_id", "=", organization.id)] if organization.organization_type == "company" else [("ngo_organization_id", "=", organization.id)]
        conversations = self.search(domain, order="write_date desc, create_date desc")
        results = []
        for conversation in conversations:
            peer = conversation.ngo_organization_id if organization == conversation.company_organization_id else conversation.company_organization_id
            latest = conversation.message_ids.sorted("create_date")[-1:]
            last_message = latest[0] if latest else False
            results.append({
                "id": str(conversation.id),
                "peerOrganizationId": str(peer.id),
                "peerOrganizationName": peer.name,
                "peerRole": peer.organization_type,
                "lastMessage": last_message.body if last_message else "",
                "lastMessageAt": fields.Datetime.to_string(last_message.create_date) if last_message else fields.Datetime.to_string(conversation.create_date),
            })
        return results

    @api.model
    def get_or_create_for_refound_partners(self, organization_id, peer_organization_id):
        actor = self._refound_verified_actor(organization_id)
        peer = self._refound_verified_actor(peer_organization_id)
        if actor == peer or actor.organization_type == peer.organization_type:
            raise ValidationError(_("Chat must be between a business and a different verified NGO."))
        company = actor if actor.organization_type == "company" else peer
        ngo = actor if actor.organization_type == "ngo" else peer
        conversation = self.search([
            ("company_organization_id", "=", company.id),
            ("ngo_organization_id", "=", ngo.id),
        ], limit=1)
        if not conversation:
            conversation = self.create({
                "company_organization_id": company.id,
                "ngo_organization_id": ngo.id,
            })
        return str(conversation.id)

    def _refound_require_participant(self, organization_id):
        self.ensure_one()
        organization = self._refound_verified_actor(organization_id)
        if organization not in (self.company_organization_id | self.ngo_organization_id):
            raise AccessError(_("You are not a participant in this conversation."))
        return organization

    @api.model
    def get_messages_for_refound_organization(self, conversation_id, organization_id):
        conversation = self.browse(int(conversation_id)).exists()
        if not conversation:
            raise ValidationError(_("Chat not found."))
        conversation._refound_require_participant(organization_id)
        return [{
            "id": str(message.id),
            "senderOrganizationId": str(message.sender_organization_id.id),
            "senderOrganization": message.sender_organization_id.name,
            "senderRole": message.sender_role,
            "body": message.body,
            "createdAt": fields.Datetime.to_string(message.create_date),
        } for message in conversation.message_ids.sorted("create_date")]

    @api.model
    def create_message_for_refound_organization(self, conversation_id, organization_id, body):
        conversation = self.browse(int(conversation_id)).exists()
        if not conversation:
            raise ValidationError(_("Chat not found."))
        organization = conversation._refound_require_participant(organization_id)
        text = str(body).strip()
        if not text or len(text) > 1500:
            raise ValidationError(_("Messages must contain 1–1,500 characters."))
        message = self.env["refound.conversation.message"].create({
            "conversation_id": conversation.id,
            "sender_organization_id": organization.id,
            "sender_role": organization.organization_type,
            "body": text,
        })
        return {
            "id": str(message.id),
            "senderOrganizationId": str(organization.id),
            "senderOrganization": organization.name,
            "senderRole": organization.organization_type,
            "body": text,
            "createdAt": fields.Datetime.to_string(message.create_date),
        }


class RefoundConversationMessage(models.Model):
    _name = "refound.conversation.message"
    _description = "Refound Partner Chat Message"
    _order = "create_date asc, id asc"

    conversation_id = fields.Many2one("refound.conversation", required=True, ondelete="cascade", index=True)
    sender_organization_id = fields.Many2one("refound.organization", required=True, ondelete="restrict")
    sender_role = fields.Selection([("company", "Company"), ("ngo", "NGO")], required=True)
    body = fields.Text(required=True)

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import http.cookiejar
from http.server import ThreadingHTTPServer
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import server


class OdooMappingTests(unittest.TestCase):
    def test_local_env_file_fills_empty_process_environment_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            env_file = server.Path(temporary) / ".env"
            env_file.write_text("GEMINI_API_KEY=local-test-value\n", encoding="utf-8")
            with patch.dict(os.environ, {"GEMINI_API_KEY": ""}, clear=True):
                server.load_local_env_file(env_file)
                self.assertEqual(os.environ["GEMINI_API_KEY"], "local-test-value")

    def test_newsletter_connection_is_independent_of_marketplace_demo_mode(self):
        environment = {
            "REFOUND_MODE": "demo",
            "ODOO_MARKETING_ENABLED": "true",
            "ODOO_MARKETING_URL": "http://localhost:8069",
            "ODOO_MARKETING_DATABASE": "newsletter-test",
            "ODOO_MARKETING_API_KEY": "dedicated-test-key",
            "ODOO_MARKETING_LIST_NAME": "Newsletter",
        }
        with patch.dict(os.environ, environment, clear=True):
            settings = server.Settings()
        self.assertFalse(settings.live)
        self.assertTrue(settings.newsletter_configured)

    def test_newsletter_connection_rejects_remote_http_and_missing_credentials(self):
        environment = {
            "ODOO_MARKETING_ENABLED": "true",
            "ODOO_MARKETING_URL": "http://odoo.example.test",
            "ODOO_MARKETING_DATABASE": "newsletter-test",
            "ODOO_MARKETING_API_KEY": "dedicated-test-key",
            "ODOO_MARKETING_LIST_NAME": "Newsletter",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertFalse(server.Settings().newsletter_configured)
        with patch.dict(os.environ, {"ODOO_MARKETING_ENABLED": "true"}, clear=True):
            self.assertFalse(server.Settings().newsletter_configured)

    def test_odoo_newsletter_subscribes_new_contact_to_configured_list(self):
        settings = server.Settings()
        settings.odoo_marketing_enabled = True
        settings.odoo_marketing_url = "http://localhost:8069"
        settings.odoo_marketing_database = "newsletter-test"
        settings.odoo_marketing_api_key = "dedicated-test-key"
        settings.odoo_marketing_list_name = "Newsletter"
        marketing = server.OdooMarketingJson2(settings)
        with patch.object(marketing, "call", side_effect=[
            [{"id": 4, "name": "Newsletter"}],
            [],
            (19, "Jamie Example"),
            True,
        ]) as call:
            marketing.subscribe("jamie@example.test", "Jamie Example")
        self.assertEqual(call.call_args_list[0].args, ("mailing.list", "search_read"))
        self.assertEqual(call.call_args_list[1].args, ("mailing.contact", "search_read"))
        self.assertEqual(call.call_args_list[2].args, ("mailing.contact", "add_to_list"))
        self.assertEqual(call.call_args_list[2].kwargs, {
            "name": "jamie@example.test",
            "list_id": 4,
        })
        self.assertEqual(call.call_args_list[3].args, ("mailing.contact", "write"))
        self.assertEqual(call.call_args_list[3].kwargs, {
            "ids": [19],
            "vals": {"name": "Jamie Example"},
        })

    def test_odoo_newsletter_requests_use_the_private_marketing_api_key(self):
        settings = server.Settings()
        settings.odoo_marketing_enabled = True
        settings.odoo_marketing_url = "http://localhost:8069"
        settings.odoo_marketing_database = "newsletter-test"
        settings.odoo_marketing_api_key = "private-test-key"
        settings.odoo_marketing_list_name = "Newsletter"
        marketing = server.OdooMarketingJson2(settings)

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _size):
                return b"[]"

        with patch.object(server.urllib.request, "urlopen", return_value=FakeResponse()) as urlopen:
            self.assertEqual(marketing.call("mailing.list", "search_read", limit=1), [])
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer private-test-key")
        self.assertEqual(request.get_header("X-odoo-database"), "newsletter-test")
        self.assertEqual(request.full_url, "http://localhost:8069/json/2/mailing.list/search_read")

    def test_odoo_newsletter_reactivates_only_explicitly_consented_subscription(self):
        settings = server.Settings()
        settings.odoo_marketing_enabled = True
        settings.odoo_marketing_url = "http://localhost:8069"
        settings.odoo_marketing_database = "newsletter-test"
        settings.odoo_marketing_api_key = "dedicated-test-key"
        settings.odoo_marketing_list_name = "Newsletter"
        marketing = server.OdooMarketingJson2(settings)
        with patch.object(marketing, "call", side_effect=[
            [{"id": 4, "name": "Newsletter"}],
            [{"id": 19, "is_blacklisted": False}],
            [{"id": 28, "opt_out": True}],
            True,
        ]) as call:
            marketing.subscribe("jamie@example.test")
        self.assertEqual(call.call_args_list[-1].args, ("mailing.subscription", "write"))
        self.assertEqual(call.call_args_list[-1].kwargs, {
            "ids": [28],
            "vals": {"opt_out": False},
        })

    def test_odoo_newsletter_preserves_global_blacklist(self):
        settings = server.Settings()
        settings.odoo_marketing_enabled = True
        settings.odoo_marketing_url = "http://localhost:8069"
        settings.odoo_marketing_database = "newsletter-test"
        settings.odoo_marketing_api_key = "dedicated-test-key"
        settings.odoo_marketing_list_name = "Newsletter"
        marketing = server.OdooMarketingJson2(settings)
        with patch.object(marketing, "call", side_effect=[
            [{"id": 4, "name": "Newsletter"}],
            [{"id": 19, "is_blacklisted": True}],
        ]) as call:
            marketing.subscribe("jamie@example.test")
        self.assertEqual(call.call_count, 2)

    def test_newsletter_endpoint_accepts_public_consent_submission(self):
        settings = server.Settings()
        settings.mode = "demo"
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        server.NEWSLETTER_RATE_LIMITER = server.NewsletterRateLimiter()
        try:
            with patch.object(server, "SETTINGS", settings), \
                    patch.object(server, "ODOO_MARKETING") as marketing, \
                    patch.object(server, "NEWSLETTER_RATE_LIMITER") as limiter:
                limiter.allow.return_value = True
                origin = f"http://127.0.0.1:{httpd.server_port}"
                request = urllib.request.Request(
                    f"{origin}/api/newsletter/subscribe",
                    data=json.dumps({
                        "name": "Jamie Example",
                        "email": "Jamie@Example.test",
                        "consent": True,
                    }).encode("utf-8"),
                    method="POST",
                    headers={"Origin": origin, "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(request, timeout=2) as response:
                    payload = json.loads(response.read())
            self.assertEqual(payload["subscribed"], True)
            marketing.subscribe.assert_called_once_with("jamie@example.test", "Jamie Example")
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join(timeout=2)

    def test_newsletter_endpoint_requires_explicit_consent(self):
        settings = server.Settings()
        settings.mode = "demo"
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            with patch.object(server, "SETTINGS", settings), patch.object(server, "ODOO_MARKETING") as marketing:
                origin = f"http://127.0.0.1:{httpd.server_port}"
                request = urllib.request.Request(
                    f"{origin}/api/newsletter/subscribe",
                    data=json.dumps({"email": "jamie@example.test", "consent": False}).encode("utf-8"),
                    method="POST",
                    headers={"Origin": origin, "Content-Type": "application/json"},
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=2)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
            marketing.subscribe.assert_not_called()
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join(timeout=2)

    def test_configured_login_path_shows_helpful_missing_proxy_page(self):
        settings = server.Settings()
        settings.odoo_url = "https://odoo.example.test"
        settings.odoo_database = "refound"
        settings.odoo_api_key = "local-api-key"
        settings.proxy_secret = "x" * 32
        settings.login_path = "/auth/login"
        settings.mode = "auto"
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        try:
            with patch.object(server, "SETTINGS", settings):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{httpd.server_port}/auth/login",
                    headers={"Accept": "text/html"},
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=2)
            self.assertEqual(error.exception.code, 503)
            payload = error.exception.read().decode("utf-8")
            self.assertIn("<title>Sign-in proxy unavailable</title>", payload)
            self.assertIn("trusted identity proxy", payload)
            self.assertIn("Return to Refound", payload)
            error.exception.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join(timeout=2)

    def test_partial_live_configuration_is_not_reported_as_demo(self):
        with patch.dict(os.environ, {"ODOO_URL": "https://odoo.example"}, clear=True):
            settings = server.Settings()
        self.assertTrue(settings.has_partial_live_config)
        self.assertEqual(settings.missing_live_settings, [
            "ODOO_DATABASE", "ODOO_API_KEY", "REFOUND_PROXY_SECRET",
        ])

    def test_explicit_demo_mode_disables_odoo_without_removing_credentials(self):
        environment = {
            "REFOUND_MODE": "demo",
            "ODOO_URL": "https://odoo.example.test",
            "ODOO_DATABASE": "refound",
            "ODOO_API_KEY": "local-api-key",
            "REFOUND_PROXY_SECRET": "x" * 32,
        }
        with patch.dict(os.environ, environment, clear=True):
            settings = server.Settings()
        self.assertFalse(settings.live)
        self.assertFalse(settings.has_partial_live_config)

    def test_unknown_runtime_mode_fails_clearly(self):
        with patch.dict(os.environ, {"REFOUND_MODE": "localish"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "REFOUND_MODE"):
                server.Settings()

    def test_local_odoo_accepts_loopback_http(self):
        environment = {
            "ODOO_URL": "http://localhost:8069",
            "ODOO_DATABASE": "refound",
            "ODOO_API_KEY": "local-api-key",
            "REFOUND_PROXY_SECRET": "x" * 32,
        }
        with patch.dict(os.environ, environment, clear=True):
            settings = server.Settings()
        self.assertTrue(settings.live)

    def test_remote_odoo_requires_https_and_endpoint_has_no_userinfo(self):
        base_environment = {
            "ODOO_DATABASE": "refound",
            "ODOO_API_KEY": "local-api-key",
            "REFOUND_PROXY_SECRET": "x" * 32,
        }
        for url in ("http://odoo.example.test", "https://user:password@odoo.example.test"):
            with self.subTest(url=url), patch.dict(os.environ, {**base_environment, "ODOO_URL": url}, clear=True):
                with self.assertRaises(RuntimeError):
                    server.Settings()

    def test_remote_odoo_https_is_allowed(self):
        environment = {
            "ODOO_URL": "https://odoo.example.test",
            "ODOO_DATABASE": "refound",
            "ODOO_API_KEY": "local-api-key",
            "REFOUND_PROXY_SECRET": "x" * 32,
        }
        with patch.dict(os.environ, environment, clear=True):
            settings = server.Settings()
        self.assertTrue(settings.live)

    def test_normalize_maps_company_relations_and_resource_values(self):
        adapter = server.OdooJson2(server.Settings())
        records = adapter.normalize("resource", [{
            "id": 12,
            "name": "Sealed device kits",
            "resource_type": "Medical equipment",
            "category": "First-aid kits",
            "quantity": 5,
            "unit": "kits",
            "price_aed": 7.5,
            "organization_id": [44, "Northside Supply"],
            "state": "published",
        }])
        self.assertEqual(records[0]["id"], "12")
        self.assertEqual(records[0]["donor"], "Northside Supply")
        self.assertEqual(records[0]["donorId"], 44)
        self.assertEqual(records[0]["priceAED"], 7.5)
        self.assertEqual(records[0]["status"], "available")

    def test_normalize_translates_company_delivery_states(self):
        adapter = server.OdooJson2(server.Settings())
        records = adapter.normalize("order", [{
            "id": 23,
            "name": "RF/2026/000023",
            "resource_id": [5, "Current edition workbooks"],
            "need_id": [8, "School request"],
            "state": "dispatched",
            "product_total_aed": 200,
            "seller_organization_id": [11, "Campus Book Co."],
        }])
        self.assertEqual(records[0]["id"], "23")
        self.assertEqual(records[0]["surplusId"], "5")
        self.assertEqual(records[0]["needId"], "8")
        self.assertEqual(records[0]["status"], "in_transit")

    def test_normalize_preserves_verification_reviewer_audit_fields(self):
        adapter = server.OdooJson2(server.Settings())
        records = adapter.normalize("organization", [{
            "id": 42,
            "name": "Verified Community Kitchen",
            "organization_type": "ngo",
            "verification_status": "approved",
            "reviewed_at": "2026-09-26 09:30:00",
            "reviewer_email": "admin@example.test",
        }])
        self.assertEqual(records[0]["organizationName"], "Verified Community Kitchen")
        self.assertEqual(records[0]["organizationType"], "ngo")
        self.assertEqual(records[0]["reviewedAt"], "2026-09-26 09:30:00")
        self.assertEqual(records[0]["reviewerEmail"], "admin@example.test")

    def test_normalize_includes_open_need_status_for_admin_audit(self):
        adapter = server.OdooJson2(server.Settings())
        records = adapter.normalize("need", [{
            "id": 9,
            "organization_id": [21, "Community Kitchen"],
            "state": "open",
            "quantity": 15,
        }])
        self.assertEqual(records[0]["organization"], "Community Kitchen")
        self.assertEqual(records[0]["organizationId"], 21)
        self.assertEqual(records[0]["status"], "open")

    def test_mapped_values_converts_iso_dates_to_odoo_datetime(self):
        payload = {"availableUntil": "2026-10-01T10:20:30.000Z", "expiresAt": "2026-10-05T23:59:59.000Z"}
        mapped = server.mapped_values("resource", payload)
        self.assertEqual(mapped["available_until"], "2026-10-01 10:20:30")
        self.assertEqual(mapped["expires_at"], "2026-10-05")

    def test_untrusted_or_missing_proxy_headers_fail_closed(self):
        class FakeHandler:
            headers = {
                "X-Refound-Proxy-Auth": "incorrect",
                "X-Refound-User": "user@example.test",
                "X-Refound-Role": "company",
            }

        settings = server.Settings()
        settings.proxy_secret = "correct-proxy-secret"
        settings.odoo_url = "https://odoo.example"
        settings.odoo_database = "staging"
        settings.odoo_api_key = "not-a-real-api-key"
        settings.mode = "auto"
        with patch.object(server, "SETTINGS", settings), self.assertRaises(server.ApiError) as error:
            server.authenticated(FakeHandler(), {"company"})
        self.assertEqual(error.exception.status, 401)

    def test_admin_identity_is_taken_from_trusted_proxy_headers(self):
        class FakeHandler:
            headers = {
                "X-Refound-Proxy-Auth": "correct-proxy-secret",
                "X-Refound-User": "TRIAL.ADMIN@example.test",
                "X-Refound-Role": "admin",
            }

        settings = server.Settings()
        settings.proxy_secret = "correct-proxy-secret"
        settings.odoo_url = "https://odoo.example"
        settings.odoo_database = "staging"
        settings.odoo_api_key = "not-a-real-api-key"
        settings.mode = "auto"
        with patch.object(server, "SETTINGS", settings):
            principal = server.authenticated(FakeHandler(), {"admin"})
        self.assertEqual(principal, {"user": "trial.admin@example.test", "role": "admin", "organizationId": 0})

    def test_demo_account_login_uses_http_only_cookie_and_server_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = server.DemoStore(server.Path(temporary) / "test.sqlite3")
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            worker = threading.Thread(target=httpd.serve_forever, daemon=True)
            worker.start()
            try:
                with patch.object(server, "DEMO_STORE", store):
                    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                    login_url = f"http://127.0.0.1:{httpd.server_port}/api/auth/login"
                    request = urllib.request.Request(
                        login_url,
                        data=json.dumps({"email": "morgan@meadowfig.demo", "password": "MeadowTrial!2026"}).encode(),
                        headers={"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{httpd.server_port}", "Sec-Fetch-Site": "same-origin"},
                        method="POST",
                    )
                    with opener.open(request, timeout=4) as response:
                        login = json.loads(response.read())
                        cookie = response.headers.get("Set-Cookie", "")
                    self.assertEqual(login["user"]["role"], "company")
                    self.assertIn("HttpOnly", cookie)
                    self.assertIn("SameSite=Strict", cookie)

                    with opener.open(f"http://127.0.0.1:{httpd.server_port}/api/session", timeout=4) as response:
                        session = json.loads(response.read())
                    self.assertEqual(session["email"], "morgan@meadowfig.demo")
                    self.assertEqual(session["role"], "company")
            finally:
                httpd.shutdown()
                httpd.server_close()
                worker.join(timeout=2)

    def test_demo_login_rejects_wrong_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = server.DemoStore(server.Path(temporary) / "test.sqlite3")
            with self.assertRaises(server.ApiError) as error:
                store.login("admin@refound.demo", "not-the-password", "127.0.0.1")
            self.assertEqual(error.exception.status, 401)

    def test_sqlite_marketplace_state_round_trips_and_notifications_are_user_scoped(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = server.DemoStore(server.Path(temporary) / "test.sqlite3")
            state = {"surplus": [], "needs": [], "transfers": [], "metrics": {}, "orders": [], "messages": []}
            store.put_app_state(state)
            self.assertEqual(store.get_app_state(), state)
            with store.connect() as connection:
                user = connection.execute("SELECT id FROM users WHERE role='company'").fetchone()
                other = connection.execute("SELECT id FROM users WHERE role='ngo'").fetchone()
            notification = store.notifications_for(user["id"])
            self.assertEqual(len(notification), 1)
            store.mark_notification_read(notification[0]["id"], user["id"])
            self.assertTrue(store.notifications_for(user["id"])[0]["readAt"])
            self.assertEqual(store.notifications_for(other["id"])[0]["readAt"], None)

    def test_demo_stripe_checkout_reserves_and_confirms_paid_order_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = server.DemoStore(server.Path(temporary) / "test.sqlite3")
            state = {
                "surplus": [{
                    "id": "s1", "title": "Meal packs", "resourceType": "Food",
                    "category": "Prepared meals", "quantity": 5, "unit": "meals",
                    "priceAED": 5.25, "donor": "Meadow & Fig", "status": "available",
                    "availableUntil": "2030-01-01T00:00:00Z", "expiresAt": "2030-02-01",
                }],
                "needs": [{
                    "id": "n1", "organization": "Northside Food Collective",
                    "resourceType": "Food", "category": "Prepared meals",
                    "quantity": 4, "unit": "meals", "maxPriceAED": 6, "status": "open",
                    "neededBy": "2030-01-15",
                }],
                "transfers": [], "orders": [], "messages": [], "metrics": {},
            }
            store.put_app_state(state)
            user = {"role": "ngo", "organization_status": "approved", "display_name": "Northside Food Collective"}
            reservation = store.create_stripe_order(user, [{"surplusId": "s1", "needId": "n1", "quantity": 2}])
            order = reservation["order"]
            self.assertEqual(reservation["amountTotal"], 1050)
            self.assertEqual(order["paymentStatus"], "awaiting_payment")
            self.assertEqual(store.get_app_state()["surplus"][0]["quantity"], 3)

            store.attach_stripe_session(order["id"], "cs_test_123")
            completed_session = {
                "id": "cs_test_123", "currency": "aed", "amount_total": 1050,
                "payment_status": "paid",
            }
            store.finish_stripe_checkout(order["id"], completed_session, paid=True)
            store.finish_stripe_checkout(order["id"], completed_session, paid=True)

            saved = store.get_app_state()
            self.assertEqual(saved["orders"][0]["paymentStatus"], "paid")
            self.assertEqual(saved["transfers"][0]["paymentStatus"], "paid")
            with store.connect() as connection:
                self.assertEqual(connection.execute("SELECT status FROM stripe_checkouts").fetchone()["status"], "paid")
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM notifications").fetchone()[0], 5)

    def test_demo_stripe_expiry_releases_reserved_quantities(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = server.DemoStore(server.Path(temporary) / "test.sqlite3")
            store.put_app_state({
                "surplus": [{
                    "id": "s1", "title": "Meal packs", "resourceType": "Food",
                    "category": "Prepared meals", "quantity": 2, "unit": "meals",
                    "priceAED": 5, "donor": "Meadow & Fig", "status": "available",
                    "availableUntil": "2030-01-01T00:00:00Z", "expiresAt": "2030-02-01",
                }],
                "needs": [{
                    "id": "n1", "organization": "Northside Food Collective",
                    "resourceType": "Food", "category": "Prepared meals",
                    "quantity": 2, "unit": "meals", "maxPriceAED": 6, "status": "open",
                    "neededBy": "2030-01-15",
                }],
                "transfers": [], "orders": [], "messages": [], "metrics": {},
            })
            order = store.create_stripe_order(
                {"role": "ngo", "organization_status": "approved", "display_name": "Northside Food Collective"},
                [{"surplusId": "s1", "needId": "n1", "quantity": 2}],
            )["order"]
            store.attach_stripe_session(order["id"], "cs_test_expired")
            store.finish_stripe_checkout(order["id"], {"id": "cs_test_expired"}, paid=False)

            saved = store.get_app_state()
            self.assertEqual(saved["surplus"][0]["quantity"], 2)
            self.assertEqual(saved["surplus"][0]["status"], "available")
            self.assertEqual(saved["needs"][0]["quantity"], 2)
            self.assertEqual(saved["needs"][0]["status"], "open")
            self.assertEqual(saved["orders"][0]["status"], "cancelled")
            self.assertEqual(saved["transfers"][0]["status"], "cancelled")

    def test_demo_stripe_checkout_rejects_unowned_and_free_items(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = server.DemoStore(server.Path(temporary) / "test.sqlite3")
            store.put_app_state({
                "surplus": [{
                    "id": "s1", "title": "Meal packs", "resourceType": "Food",
                    "category": "Prepared meals", "quantity": 2, "unit": "meals",
                    "priceAED": 0, "donor": "Meadow & Fig", "status": "available",
                    "availableUntil": "2030-01-01T00:00:00Z", "expiresAt": "2030-02-01",
                }],
                "needs": [{
                    "id": "n1", "organization": "Another NGO",
                    "resourceType": "Food", "category": "Prepared meals",
                    "quantity": 2, "unit": "meals", "maxPriceAED": 6, "status": "open",
                    "neededBy": "2030-01-15",
                }],
                "transfers": [], "orders": [], "messages": [], "metrics": {},
            })
            user = {"role": "ngo", "organization_status": "approved", "display_name": "Northside Food Collective"}
            with self.assertRaises(server.ApiError) as error:
                store.create_stripe_order(user, [{"surplusId": "s1", "needId": "n1", "quantity": 1}])
            self.assertEqual(error.exception.status, 403)

            state = store.get_app_state()
            state["needs"][0]["organization"] = user["display_name"]
            store.put_app_state(state)
            with self.assertRaisesRegex(server.ApiError, "paid products only"):
                store.create_stripe_order(user, [{"surplusId": "s1", "needId": "n1", "quantity": 1}])

    def test_demo_stripe_webhook_requires_signature_and_marks_sqlite_order_paid(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = server.DemoStore(server.Path(temporary) / "test.sqlite3")
            store.put_app_state({
                "surplus": [{
                    "id": "s1", "title": "Meal packs", "resourceType": "Food",
                    "category": "Prepared meals", "quantity": 2, "unit": "meals",
                    "priceAED": 5, "donor": "Meadow & Fig", "status": "available",
                    "availableUntil": "2030-01-01T00:00:00Z", "expiresAt": "2030-02-01",
                }],
                "needs": [{
                    "id": "n1", "organization": "Northside Food Collective",
                    "resourceType": "Food", "category": "Prepared meals",
                    "quantity": 2, "unit": "meals", "maxPriceAED": 6, "status": "open",
                    "neededBy": "2030-01-15",
                }],
                "transfers": [], "orders": [], "messages": [], "metrics": {},
            })
            order = store.create_stripe_order(
                {"role": "ngo", "organization_status": "approved", "display_name": "Northside Food Collective"},
                [{"surplusId": "s1", "needId": "n1", "quantity": 1}],
            )["order"]
            store.attach_stripe_session(order["id"], "cs_test_webhook")
            settings = server.Settings()
            settings.mode = "demo"
            settings.odoo_url = ""
            settings.odoo_database = ""
            settings.odoo_api_key = ""
            settings.proxy_secret = ""
            settings.stripe_secret_key = "sk_test_unit_test"
            settings.stripe_webhook_secret = "whsec_unit_test"
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            worker = threading.Thread(target=httpd.serve_forever, daemon=True)
            worker.start()
            timestamp = int(server.time.time())
            event = {
                "type": "checkout.session.completed",
                "data": {"object": {
                    "id": "cs_test_webhook", "metadata": {"order_id": order["id"]},
                    "payment_status": "paid", "currency": "aed", "amount_total": 500,
                }},
            }
            raw = json.dumps(event).encode("utf-8")
            signature = server.hmac.new(
                settings.stripe_webhook_secret.encode("utf-8"),
                str(timestamp).encode("ascii") + b"." + raw,
                server.hashlib.sha256,
            ).hexdigest()
            url = f"http://127.0.0.1:{httpd.server_port}/api/stripe/webhook"
            try:
                with patch.object(server, "SETTINGS", settings), patch.object(server, "DEMO_STORE", store):
                    bad_request = urllib.request.Request(
                        url, data=raw, headers={"Stripe-Signature": f"t={timestamp},v1=invalid"}, method="POST",
                    )
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(bad_request, timeout=4)
                    self.assertEqual(error.exception.code, 400)
                    error.exception.close()
                    self.assertEqual(store.get_app_state()["orders"][0]["paymentStatus"], "awaiting_payment")

                    good_request = urllib.request.Request(
                        url, data=raw, headers={"Stripe-Signature": f"t={timestamp},v1={signature}"}, method="POST",
                    )
                    with urllib.request.urlopen(good_request, timeout=4) as response:
                        self.assertEqual(response.status, 200)
                    self.assertEqual(store.get_app_state()["orders"][0]["paymentStatus"], "paid")
            finally:
                httpd.shutdown()
                httpd.server_close()
                worker.join(timeout=2)

    def test_demo_stripe_checkout_stays_disabled_without_webhook_secret(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = server.DemoStore(server.Path(temporary) / "test.sqlite3")
            settings = server.Settings()
            settings.mode = "demo"
            settings.odoo_url = ""
            settings.odoo_database = ""
            settings.odoo_api_key = ""
            settings.proxy_secret = ""
            settings.stripe_secret_key = "sk_test_unit_test"
            settings.stripe_webhook_secret = ""
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            worker = threading.Thread(target=httpd.serve_forever, daemon=True)
            worker.start()
            origin = f"http://127.0.0.1:{httpd.server_port}"
            try:
                with patch.object(server, "SETTINGS", settings), patch.object(server, "DEMO_STORE", store):
                    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                    login = urllib.request.Request(
                        f"{origin}/api/auth/login",
                        data=json.dumps({"email": "jamie@northside.demo", "password": "NorthsideTrial!2026"}).encode(),
                        headers={"Content-Type": "application/json", "Origin": origin, "Sec-Fetch-Site": "same-origin"},
                        method="POST",
                    )
                    with opener.open(login, timeout=4):
                        pass
                    checkout = urllib.request.Request(
                        f"{origin}/api/stripe/checkout",
                        data=json.dumps({"lines": []}).encode(),
                        headers={"Content-Type": "application/json", "Origin": origin, "Sec-Fetch-Site": "same-origin"},
                        method="POST",
                    )
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        opener.open(checkout, timeout=4)
                    self.assertEqual(error.exception.code, 503)
                    self.assertIn(b"webhook signing secret", error.exception.read())
                    error.exception.close()
                    self.assertIsNone(store.get_app_state())
            finally:
                httpd.shutdown()
                httpd.server_close()
                worker.join(timeout=2)

    def test_gemini_assistant_uses_server_key_and_sends_only_minimal_match_context(self):
        class FakeGeminiResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                return json.dumps({
                    "candidates": [{"content": {"parts": [{"text": "Check the listing details with the supplier."}]}}],
                }).encode("utf-8")

        with tempfile.TemporaryDirectory() as temporary:
            store = server.DemoStore(server.Path(temporary) / "test.sqlite3")
            settings = server.Settings()
            settings.mode = "demo"
            settings.odoo_url = ""
            settings.odoo_database = ""
            settings.odoo_api_key = ""
            settings.proxy_secret = ""
            settings.gemini_api_key = "test-key-not-for-production"
            settings.gemini_model = "gemini-flash-latest"
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            worker = threading.Thread(target=httpd.serve_forever, daemon=True)
            worker.start()
            origin = f"http://127.0.0.1:{httpd.server_port}"
            try:
                with patch.object(server, "SETTINGS", settings), patch.object(server, "DEMO_STORE", store):
                    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                    login = urllib.request.Request(
                        f"{origin}/api/auth/login",
                        data=json.dumps({"email": "jamie@northside.demo", "password": "NorthsideTrial!2026"}).encode(),
                        headers={"Content-Type": "application/json", "Origin": origin, "Sec-Fetch-Site": "same-origin"},
                        method="POST",
                    )
                    with opener.open(login, timeout=4):
                        pass
                    assistant_request = urllib.request.Request(
                        f"{origin}/api/assistant",
                        data=json.dumps({
                            "prompt": "How should I compare this resource?",
                            "matches": [{
                                "title": "Workbook bundle", "category": "Textbooks", "quantity": 10,
                                "unit": "books", "priceAED": 9.5, "organization": "must-not-be-sent",
                            }],
                        }).encode(),
                        headers={"Content-Type": "application/json", "Origin": origin, "Sec-Fetch-Site": "same-origin"},
                        method="POST",
                    )
                    with patch("server.urllib.request.urlopen", return_value=FakeGeminiResponse()) as gemini_call:
                        with opener.open(assistant_request, timeout=4) as response:
                            result = json.loads(response.read())
                    self.assertEqual(result["provider"], "Gemini")
                    self.assertEqual(result["answer"], "Check the listing details with the supplier.")
                    outbound = gemini_call.call_args.args[0]
                    self.assertEqual(outbound.get_header("X-goog-api-key"), "test-key-not-for-production")
                    request_body = outbound.data.decode("utf-8")
                    self.assertIn("Workbook bundle", request_body)
                    self.assertNotIn("must-not-be-sent", request_body)
                    self.assertNotIn("test-key-not-for-production", request_body)
            finally:
                httpd.shutdown()
                httpd.server_close()
                worker.join(timeout=2)


if __name__ == "__main__":
    unittest.main()

import os
import sys
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import server


class OdooMappingTests(unittest.TestCase):
    def test_partial_live_configuration_is_not_reported_as_demo(self):
        with patch.dict(os.environ, {"ODOO_URL": "https://odoo.example"}, clear=True):
            settings = server.Settings()
        self.assertTrue(settings.has_partial_live_config)
        self.assertEqual(settings.missing_live_settings, [
            "ODOO_DATABASE", "ODOO_API_KEY", "REFOUND_PROXY_SECRET",
        ])

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
        with patch.object(server, "SETTINGS", settings), self.assertRaises(server.ApiError) as error:
            server.authenticated(FakeHandler(), {"company"})
        self.assertEqual(error.exception.status, 401)


if __name__ == "__main__":
    unittest.main()

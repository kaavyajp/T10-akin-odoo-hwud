# REFOUND — From surplus to significance

Refound connects businesses with community organizations to put surplus resources back to good use: food, eligible medical equipment, study resources, and other essentials. This responsive, dependency-free web app includes local trial mode and an Odoo-backed deployment path for partner verification, company/NGO/admin portals, matching, orders, reports, and impact reporting.

The logo mark is cropped from the supplied Refound brand PDF and shown with the wordmark and slogan throughout the app.

## Run locally

Requires Python 3 (no Node.js, package installation, build, credentials, or database required).

```bash
python3 server.py
```

Open [http://localhost:4173](http://localhost:4173). `server.py` serves the site and reports `mode: demo` while no Odoo configuration is present. It also hosts the same-origin `/api` routes used by live mode. Opening `index.html` directly with `file://` is not supported.

## Demo flow

1. Start on the public **Home** page. Browse About, Why Refound, Quality & Standards, FAQ, Terms, Privacy, Copyright, Contact, and the local AI assistant from the top navigation and footer.
2. Visit **Pricing** for the proposed one-plan Refound Membership: one month free, then **AED 29/month** for both businesses and NGOs. The button starts the organization onboarding flow. No payment details are collected and no subscription or trial is actually created by this demo.
3. Choose **Sales** to submit a demo membership enquiry. The local admin portal has a **Membership enquiries** inbox where enquiries can be marked followed up. These leads stay in this browser; they are not emailed or sent to a sales system.
4. Choose **Join Refound** to submit as a business or NGO. Verification records are stored in this browser; uploaded documents are never read or uploaded, only selected filenames appear in the admin demo queue.
5. Sign in with the top navigation and choose **Business**, **Community organization / NGO**, or **Refound administrator**. Sign-in is intentionally simulated—any email and password opens the selected local demo portal. The seeded business (`morgan@meadowfig.demo`), NGO (`jamie@northside.demo`), and admin (`admin@refound.demo`) examples are available; no real accounts or passwords exist.
6. As the company, go to **My surplus → List resources** and provide quantity/unit, unit price in AED (zero means a donation), exact condition, model/edition/size and restrictions, item expiry when applicable, handling/storage/cold-chain instructions, company handoff area, and order-by deadline. The local AI-style draft is only a suggestion; verify the source label and edit each field. Food and medical equipment require an item expiry and handling instructions.
7. As the NGO, post an equally detailed requirement: exact type/category/unit, quantity, acceptable price per unit, minimum remaining shelf life, acceptable condition, specifications/exclusions, need-by time, actual receiving address/service hours, storage/cold-chain capability, and intended use.
8. An NGO selects a compatible company resource, adds a quantity to its basket, reviews the specifications, and checks out. Demo card/bank choices only simulate payment locally. In Odoo mode, no paid order is accepted until a genuine payment provider is configured; free donations can be ordered in the connected Odoo backend.
9. The company reviews and confirms paid/free orders, then chooses and pays its carrier, negotiates any transport fee directly with the NGO, and records method, tracking reference, ETA, and delivery notes. Refound coordinates messages and records status but does not provide, arrange, insure, or book physical logistics. The NGO checks the item and confirms receipt.
10. **Order messages** keep company/NGO communication with the order; **Reports** filters the handoff period and exports CSV. As admin, use **Review applications** to inspect private uploaded Odoo evidence, check the official registration/contact/evidence boxes, and record a reason before approval/rejection.

In demo mode, listings, needs, orders, demo payments, messages, verification decisions, sales enquiries, and account sessions persist in local browser storage. In Odoo mode, the backend is the record of organizations, listings, needs, orders, delivery, messages, and private verification documents; an unsubmitted shopping basket remains browser-local. Reports can be filtered by 7/30/90 days or all activity and exported.

## Architecture and extension points

- `src/data.js` contains the normalized record shapes, resource categories, and deterministic seed data.
- `src/services.js` defines detailed listing/request/cart/order/verification services, safe demo payment adapter, local extraction and assistant, explainable matching, and the authenticated Odoo API client.
- `src/reporting.js` builds date-filtered transfer summaries and spreadsheet-safe CSV exports.
- `src/public-pages.js` renders the marketing site, verification workflow, policy/help pages, local assistant, and admin verification screens.
- `src/main.js` manages role-specific navigation, reports/export, forms, and the end-to-end demo workflow.
- `styles.css` contains the responsive visual system.
- `server.py` serves the app and, when configured, acts as the authenticated same-origin gateway to Odoo 19 JSON-2.
- `odoo_addons/refound_marketplace/` is the installable Odoo add-on with persistent organizations, review evidence, detailed resources/needs, paid/donation order records, messages, and company-managed delivery records.

## Connect a staging Odoo database

The real database integration is implemented as a server-side Odoo JSON-2 connector plus an installable add-on; browser code never receives the Odoo API key. A live connection cannot be activated from this workspace until it is configured against your actual Odoo instance. No credentials were supplied here, so the app remains in demo mode until you connect a staging database.

1. Install `odoo_addons/refound_marketplace` into an **Odoo 19** staging instance, update the Apps list, and install or upgrade **Refound Marketplace**. Upgrade the add-on after code changes so the verification audit fields (`reviewed_at`, `reviewer_email`) are present. The connector targets Odoo 19's JSON-2 API. Older Odoo releases require a different version-matched connector, not exposing the legacy XML-RPC password in the browser.
2. Create a dedicated internal Odoo API user with the least privileges needed for Refound models and private verification attachments. Generate a restricted API key for the staging database.
3. Copy `.env.example` to `.env` and fill in `ODOO_URL`, `ODOO_DATABASE`, `ODOO_API_KEY`, and a randomly generated `REFOUND_PROXY_SECRET` of at least 32 characters. The local server binds to `127.0.0.1`. Never commit `.env`, send credentials in chat, or expose this app/API server directly to the public internet.
4. Configure the existing HTTPS identity provider/reverse proxy in front of the app. It must authenticate users and overwrite (never pass through user-supplied) `X-Refound-Proxy-Auth`, `X-Refound-User`, and `X-Refound-Role` on every `/api` request. Map the administrator role only from an explicit, invitation-only IdP admin group; do not let users select or submit their own role. For approved partners, set `X-Refound-Organization-ID` to the Odoo verified `refound.organization` record ID. Set `REFOUND_LOGIN_PATH` to the provider's same-origin sign-in entry. Provision trial admins in that IdP group; there is no default live admin password or backdoor account.
5. Run `python3 server.py` and check `/api/health` reports `mode: odoo`, then sign in through the trusted provider and confirm Odoo-backed records load. The health endpoint reports configuration mode, not an end-to-end Odoo availability check. Missing or partial Odoo configuration fails visibly; the server will not silently swap a configured live environment to demo mode.
6. Configure the organization’s actual Odoo payment provider before charging for surplus. Until a provider/webhook is set up, paid checkout is deliberately disabled in Odoo mode; orders remain unpaid and the company cannot accept them. Free/donation orders can be recorded. Demo card/bank options never contact a gateway or move money.

The included add-on provides Odoo models and validation for organization applications and private registration attachments, detailed companies' resources, detailed NGO needs/budgets, stock/request reservations, payment status, orders, messages, company-managed delivery carrier/tracking/ETA/fee, NGO receipt confirmation, and reviewer decision checklists. The staging add-on creates persistent Odoo models; remove seeded sample records and complete Odoo backups, access-control, attachment-retention, email, payment-provider and legal/privacy reviews before accepting production data.

To adapt this to an existing Odoo deployment, provide the Odoo version/hosting (Odoo Online, Odoo.sh, or self-hosted), installed/custom inventory/sales/website/payment apps, a sanitized model/field map, your staging API approach, and how verified partner users are linked to Odoo organizations. Credentials should be entered only into the private server environment, never shared here.

The local assistant and natural-language draft extraction are deterministic in the browser and do not call an AI provider. A production LLM can be added behind this same secure backend and should never decide organization verification, safe eligibility, payment, or receipt autonomously. Uploaded registration files in Odoo mode are private Odoo attachments, read only through authorized server routes; an actual human reviewer must check official registration and evidence. Approval is an identity/partner review, not a regulatory certification or guarantee of food/medical-device safety. Logistics are arranged by the company and agreed with the NGO, not by Refound.

Matching is deterministic: urgency (42-point maximum), category fit (30), freshness/item expiry (20), and partner proximity (12), capped at 99. Recommendations require available, non-expired surplus; an open, not-past-due need; matching resource type, category, and quantity units. Medical listings require a future labeled expiry date and pickup before that date. Creating a transfer reserves both stock and need quantity.

## Validation

No Node packages or build step are required. Validate the server and Odoo adapter tests with:

```bash
python3 -m unittest discover -s tests -v
python3 server.py
```

Then exercise the signup, verification review, company listing, NGO requirement, cart, demo checkout, company logistics, NGO receipt, messages and reports flows in a modern browser. Google Fonts are optional; system fonts are the fallback.

# REFOUND — From surplus to significance

Refound connects businesses with community organizations to put surplus resources back to good use: food, eligible medical equipment, study resources, and other essentials. This responsive, dependency-free web app includes local trial mode and an Odoo-backed deployment path for partner verification, company/NGO/admin portals, matching, orders, reports, and impact reporting.

The logo mark is cropped from the supplied Refound brand PDF and shown with the wordmark and slogan throughout the app.

## Run locally

Requires Python 3 (no Node.js, package installation, build, credentials, or database required).

```bash
python3 server.py
```

Open [http://localhost:4173](http://localhost:4173). `server.py` serves the site, authenticates local trial accounts, and stores marketplace demo data in `refound.sqlite3` (override with `REFOUND_SQLITE_PATH`). SQLite is local app persistence; DBHub is a separate MCP interface to databases and is not needed by the running site. Opening `index.html` directly with `file://` is not supported. Trial mode must remain bound to loopback and must never be deployed as production authentication.

## Demo flow

1. Start on the public **Home** page. Browse About, Why Refound, Quality & Standards, FAQ, Terms, Privacy, Copyright, Contact, and the local AI assistant from the top navigation and footer.
2. Visit **Pricing** for the proposed one-plan Refound Membership: one month free, then **AED 29/month** for both businesses and NGOs. The button starts the organization onboarding flow. No payment details are collected and no subscription or trial is actually created by this demo.
3. Choose **Sales** to submit a demo membership enquiry. The local admin portal has a **Membership enquiries** inbox where enquiries can be marked followed up. These leads stay in this browser; they are not emailed or sent to a sales system.
4. Choose **Join Refound** to submit as a business or NGO. Verification records are stored in this browser; uploaded documents are never read or uploaded, only selected filenames appear in the admin demo queue.
5. Sign in using the credentials on the login page. Local trial accounts (localhost only): administrator `admin@refound.demo` / `RefoundAdmin!2026`; business `morgan@meadowfig.demo` / `MeadowTrial!2026`; NGO `jamie@northside.demo` / `NorthsideTrial!2026`. The backend hashes passwords with PBKDF2-SHA256 and uses expiring HttpOnly, SameSite cookies. These fixed, published trial passwords are not production credentials; rotate/remove them and deploy a real identity/registration flow before exposure.
6. As the company, go to **My surplus → List resources** and provide quantity/unit, unit price in AED (zero means a donation), exact condition, model/edition/size and restrictions, item expiry when applicable, handling/storage/cold-chain instructions, company handoff area, and order-by deadline. The local AI-style draft is only a suggestion; verify the source label and edit each field. Use **Edit listing** on your own available listings to update the record. Food and medical equipment require an item expiry and handling instructions.
7. As the NGO, post an equally detailed requirement: exact type/category/unit, quantity, acceptable price per unit, minimum remaining shelf life, acceptable condition, specifications/exclusions, need-by time, actual receiving address/service hours, storage/cold-chain capability, and intended use.
8. An NGO selects a compatible company resource, adds a quantity to its basket, reviews the specifications, and checks out. Without Stripe configured, demo card/bank choices only simulate payment locally. With a Stripe test key and verified webhook configured, paid demo orders use Stripe-hosted Checkout and SQLite stores the reservation and signed payment result. In Odoo mode, the same Checkout flow records orders in Odoo; free donations do not go through Stripe.
9. The company reviews and confirms paid/free orders, then chooses and pays its carrier, negotiates any transport fee directly with the NGO, and records method, tracking reference, ETA, and delivery notes. Refound coordinates messages and records status but does not provide, arrange, insure, or book physical logistics. The NGO checks the item and confirms receipt. Admins can inspect order/logistics records but cannot confirm orders, arrange delivery, or acknowledge receipt.
10. **Partner chat** lets approved businesses and NGOs contact each other directly before ordering; **Order messages** remain attached to a placed order. **Reports** filters the handoff period and exports CSV. As admin, use **Review applications** to inspect private uploaded Odoo evidence and **Verification & listings report** to audit organization status against active public records and download CSV.

In demo mode, marketplace listings, needs, orders, metrics, messages, Stripe checkout reservations, and verified test-payment outcomes persist in SQLite; browser storage remains for demo verification data, chats, sales enquiries, and the unsubmitted basket. Account hashes, sessions, and seeded role-specific notifications are stored in SQLite. Demo partners and verification records are fictional trial data; demo approval is not real-world verification. Stripe test mode uses test cards and does not move real funds. In Odoo mode, Odoo stores marketplace records and an unsubmitted shopping basket remains browser-local. Reports can be filtered by 7/30/90 days or all activity and exported.

## Architecture and extension points

- `src/data.js` contains the normalized record shapes, resource categories, and deterministic seed data.
- `src/services.js` defines detailed listing/request/cart/order/verification services, safe demo payment adapter, local extraction and assistant, explainable matching, and the authenticated Odoo API client.
- `src/reporting.js` builds date-filtered transfer summaries, organization/listing audit summaries, and spreadsheet-safe CSV exports.
- `src/public-pages.js` renders the marketing site, verification workflow, policy/help pages, local assistant, and admin verification screens.
- `src/main.js` manages role-specific navigation, reports/export, forms, and the end-to-end demo workflow.
- `styles.css` contains the responsive visual system.
- `server.py` serves the app and, when configured, acts as the authenticated same-origin gateway to Odoo 19 JSON-2.
- `odoo_addons/refound_marketplace/` is the installable Odoo add-on with persistent organizations, review evidence, detailed resources/needs, verified-partner conversations, paid/donation order records, messages, and company-managed delivery records.

## Connect a staging Odoo database

The live marketplace database integration is implemented as a server-side Odoo JSON-2 connector plus an installable add-on; browser code never receives the Odoo API key. Local account authentication remains Refound-owned and is not linked to Odoo users. The app defaults to demo mode until Odoo mode is explicitly enabled and verified against a staging database.

1. Configure the Odoo server's `addons_path` to include this project's `odoo_addons` directory, restart Odoo, update the Apps list, and install or upgrade **Refound Marketplace**. Odoo must be able to discover `odoo_addons/refound_marketplace` before the module can be installed. Upgrade the add-on after code changes so the verification audit fields (`reviewed_at`, `reviewer_email`) and persistent partner chat models/access rules are installed. Existing local-demo chats do not migrate to Odoo. The connector targets Odoo 19's JSON-2 API. Older Odoo releases require a different version-matched connector, not exposing the legacy XML-RPC password in the browser.
2. Create a dedicated internal Odoo API user with the least privileges needed for Refound models and private verification attachments. Generate a restricted API key for the staging database.
3. Copy `.env.example` to `.env` and fill in `ODOO_URL`, `ODOO_DATABASE` (the exact Odoo database name, not the PostgreSQL service name), `ODOO_API_KEY`, and a randomly generated `REFOUND_PROXY_SECRET` of at least 32 characters. Set `REFOUND_MODE=demo` for local trials; this disables Odoo-backed routes while keeping any saved Odoo values untouched. Set `REFOUND_MODE=auto` to activate Odoo when all credentials are present, or `REFOUND_MODE=odoo` to explicitly request live mode. For Odoo running on the same machine, use a full loopback URL such as `http://localhost:8069`; remote Odoo endpoints must use HTTPS. The local Refound server binds to `127.0.0.1`. Never commit `.env`, send credentials in chat, or expose this app/API server directly to the public internet.
4. Configure the existing HTTPS identity provider/reverse proxy in front of the app. It must authenticate users and overwrite (never pass through user-supplied) `X-Refound-Proxy-Auth`, `X-Refound-User`, and `X-Refound-Role` on every `/api` request. Map the administrator role only from an explicit, invitation-only IdP admin group; do not let users select or submit their own role. For approved partners, set `X-Refound-Organization-ID` to the Odoo verified `refound.organization` record ID. Set `REFOUND_LOGIN_PATH` to the provider's same-origin sign-in entry. Opening that path directly on the Python server returns a clear configuration error: the trusted proxy must handle it before forwarding to Refound. Provision trial admins in that IdP group; there is no default live admin password or backdoor account.
5. Run `python3 server.py` and check `/api/health` reports `mode: odoo`, then sign in through the trusted provider and confirm Odoo-backed records load. The health endpoint reports configuration mode, not an end-to-end Odoo availability check. Missing or partial Odoo configuration fails visibly; the server will not silently swap a configured live environment to demo mode.
6. Configure Stripe test mode first. In local demo mode, set a server-only `sk_test_...` value as `STRIPE_SECRET_KEY`, start Stripe CLI with `stripe listen --forward-to http://127.0.0.1:4173/api/stripe/webhook`, and put the CLI's `whsec_...` value in `STRIPE_WEBHOOK_SECRET`. Keep `REFOUND_PUBLIC_URL` pointed at the local Refound URL for the Checkout success/cancel redirects. Restart Refound after editing `.env`. Paid demo checkout stays disabled until the webhook signing secret is configured; paid order reservations and verified outcomes are stored in SQLite. For Odoo mode, configure an externally reachable HTTPS `REFOUND_PUBLIC_URL` and register `/api/stripe/webhook` in Stripe for `checkout.session.completed` and `checkout.session.expired`. Stripe Checkout uses AED and hosted payment pages; only a signature-verified completion event marks an order paid. Do not expose keys in browser code or commit them. Use Stripe test cards only until legal, settlement, refunds, disputes, and production webhook handling are reviewed.
7. Configure the optional Gemini assistant with a rotated key in server-only `GEMINI_API_KEY` in `.env`; `GEMINI_MODEL` defaults to `gemini-flash-latest`. Restart the server and check `/api/health` for `aiAssistantConfigured: true`. Signed-in users' prompts and up to five short public listing summaries are sent to Google Gemini by the backend; the key is never sent to browser code. The assistant endpoint is rate-limited, and the UI warns users not to include personal or sensitive information. Public, signed-out visitors continue to get deterministic local replies.

## Odoo Marketing newsletter

The public **Newsletter** tab subscribes contacts to the Odoo Marketing mailing list named `Newsletter`. Install/enable Odoo's Email Marketing app (`mass_mailing`) and create that list first. This adapts the supplied JSON-RPC example to Odoo 19's JSON-2 API (`/json/2/...`): its API key authenticates the Odoo user, and the actual contact-list relation is `list_ids` (not `mailing_list_ids`). The connector uses Odoo's `mailing.list`, `mailing.contact`, and `mailing.subscription` models through the server-side JSON-2 API. Newsletter signup can run independently while `REFOUND_MODE=demo`; it does not switch the marketplace, authentication, or payments to live mode. A successful signup records consent by creating or updating the contact's list subscription. It does not send a campaign; configure Odoo's outgoing mail and create/schedule campaigns separately.

The API key shared in chat must be revoked and replaced. Create a dedicated Odoo internal user with only the necessary mailing-list/contact/subscription access, generate a new API key for that account, and configure these values in the ignored local `.env`:

```ini
ODOO_MARKETING_ENABLED=true
ODOO_MARKETING_URL=http://localhost:8069
ODOO_MARKETING_DATABASE=Administrator
ODOO_MARKETING_API_KEY=<new dedicated API key>
ODOO_MARKETING_LIST_NAME=Newsletter
```

The numeric Odoo user ID is not sent separately by JSON-2; the API key authenticates as the Odoo user that created it. Do not use an administrator key for this public signup endpoint. The newsletter route validates the email and consent, prevents cross-origin submissions, includes a honeypot and rate limits, and does not reveal whether an email is already subscribed. Odoo's global email blacklist is respected. Restart Refound after changing `.env`; `/api/health` reports `newsletterConfigured: true` when the connection settings are present, but an actual signup is needed to verify Odoo access and the mailing-list name. Review consent wording, privacy/legal requirements, sender identity, unsubscribe behavior, and email delivery before collecting production subscribers.

The included add-on provides Odoo models and validation for organization applications and private registration attachments, verified business–NGO conversations and messages, detailed companies' resources, detailed NGO needs/budgets, stock/request reservations, payment status, orders, order messages, company-managed delivery carrier/tracking/ETA/fee, NGO receipt confirmation, Stripe payment confirmation, and reviewer decision checklists. The admin verification report compares Odoo applications with active resources and open needs, calls out unverified/orphan owners, and exports an audit CSV. Non-admin Odoo feeds exclude unverified-owned listings. The staging add-on creates persistent Odoo models; remove seeded sample records and complete Odoo backups, access-control, attachment-retention, email, payment-provider and legal/privacy reviews before accepting production data.

DBHub is an MCP server for database exploration/querying by compatible agent clients; it is not a Refound runtime database driver. The selected local trial setup uses SQLite directly through Python's standard library. If you want DBHub later, point it at a separately provisioned database and connect the app to that engine through a deliberate backend migration—do not install an MCP tool into the public web server.

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

# Relay — complete AI project handover
_Last prepared: 18 October 2026. This is a handover of intended behaviour and known work, not a guarantee that the deployed application works._

## 1. Product vision — read first
Relay is a UK consumer fintech/retail experience that automatically gathers customers' itemised purchases across participating retailers **after they have paid normally** in-store or online. **Relay is not a checkout.** The core value is (a) a prominently displayed, eligible **instant refund offer** for returned items; (b) the ability to choose a replacement size, colour or different design, with Relay coordinating a retailer-authorised replacement order and return simultaneously; (c) product recommendations; (d) price-drop watching; and (e) an annual shopping recap.

The user has repeatedly stated that the app must look like a polished consumer product rather than a developer control panel. Navigation should integrate **Wallet, Discover, Radar, Wrapped, Profile**. The main purchase detail page must prominently feature **Instant Refund**, with **Exchange / Find a better alternative** immediately visible. The user is nontechnical and expects the AI to actually edit and test the connected repository, not respond with repetitive plans or untested success claims.

## 2. Source of truth, deployment, and known infrastructure
- GitHub repository: https://github.com/zzmm92nr59-cloud/instant-refund-prototype — branch `main`.
- Public GitHub Pages app: https://zzmm92nr59-cloud.github.io/instant-refund-prototype/
- A second app entry point exists: https://zzmm92nr59-cloud.github.io/instant-refund-prototype/relay-app-v2.html . A screenshot on 8 Oct 2026 showed **this page mostly blank**, with a side panel and top label but missing the main content and navigation.
- Earlier developer-oriented wallet: `legacy-wallet.html` (may be different from the newer entry points).
- Dedicated pages: `discover.html`, `wrapped.html`, `matching-lab.html`.
- Cloudflare Worker API: https://relay-square-api2.9pts72cy5j.workers.dev — source `worker/worker.js`, with additional worker modules.
- Cloudflare D1 database: `relay-purchase-ledger`, ID `6d3a035f-b869-4e1f-af61-bb34f2f5c51c`.
- Square Sandbox merchant used: **North & Co.**; Sandbox retailer items and variants.
- Plaid Sandbox integration for bank transaction testing.
- GitHub Actions workflows for Square/Plaid testing. GitHub Actions secrets include integration credentials. **Never ask the user to paste live secret values into chat.** A new AI needs authorised connections to GitHub / Square / Plaid / Cloudflare to operate the same project.

The repository is the code source of truth. Inspect current files and Git history before assuming that any earlier assistant claim is still accurate. On 18 Oct 2026, `index.html` and `relay-app-v2.html` both existed as large (~82KB) documents, and `worker/worker.js` was ~163KB. GitHub Pages deployments can lag commits.

## 3. Critical current blocker
User's screenshots:
1. Original app showed technical verification controls, card registration (e.g. Visa ending 1111), developer test button, **"Verified purchase API returned 403"**, and zero visible purchases.
2. New version at `relay-app-v2.html?v=2` showed sidebar branding and demo toggle, but the main app area was empty. This is **not an acceptable handoff state**. Do not claim the app is complete or working until it is opened and the JS console / runtime error is investigated.

First task: reproduce the blank screen, identify the initialisation/render failure, fix it, and test actual functioning wallet / refund offer / exchange / Discover / Radar / Wrapped on desktop and mobile. Use screenshots or browser verification. Keep the real customer verified-purchase feed permission-gated; a demo purchase must remain **clearly fictitious** and must not be passed off as authenticated.

## 4. Core app flows
### Wallet / purchase detail
- Show actual **verified** customer purchases only when identity ownership checks have succeeded. Do not reveal other customers' itemised purchases.
- Provide a distinct demo switch using **sample data** so users can interact with app without backend connectivity.
- Example fictional purchase: North & Co., Retro High Trainers, UK 7, £129.99.
- Prominent card for **Relay Instant Refund** with an offer and clear demo/eligibility/payout caveat. In production accelerated payout is conditional; no current real money movement.
- Next to/below it: **Exchange** for size, colour, design, or changed mind; check item return eligibility and stock.

### Coordinated exchange
- When a customer chooses another size/design, check inventory, price difference, eligibility and delivery.
- Transactionally coordinate retailer-authorised replacement order with original-item return (handling partial failure, duplicate requests, cancellations, stock reservation, and retailer permissions). Do not say a real return/order was processed if only a demo preview ran.
- User especially values this differentiator. Exchange is **not merely a link to another product**, and it is not a Relay checkout.
- Existing retailer integrations are incomplete: must build genuine exchange/return orchestration.

### Discover
- Recommend retailer catalogue alternatives based on the exchange reason (wrong size, changed mind, dislike design, different colour), selected product, price range, in-stock variants and eventually customers' past cross-retailer purchases.
- Products/prices must come from retailer catalogues; do not invent actual availability.
- Existing Square Sandbox product selector endpoint: `GET /relay/live-test/products` returns demo catalogue product / variation / SKU / priceMinor / currency. `GET /relay/ledger/sandbox-stock?sku=DEMO-...` provides indicative stock snapshots. `GET /relay/returns/sandbox-options?product=...` returns same-product variants, indicative stock. Inspect implementation for exact schema and permissions.
- Some Discover pages currently use **rule-based** ranking. Do not describe as fully AI-personalised yet.

### Radar
- Watch discounted or desired products based on connected retailer catalogues, prior purchases and preferences. Must compare actual prior/current **price history**, variant and available stock. Inventory by itself does not contain discount history.
- Existing `discover.html` supports a browser-local demo SKU watchlist and manual price comparison. No background push alerts yet.
- Future feature: explicit opt-in notifications, frequency settings, price thresholds and consent for profiling / cross-retailer personalisation. Do not make up live discounts.

### Wrapped
- User likes Spotify-Wrapped-style annual visual recap: cross-retailer total spend, item count, favourite category, refunds, brands, sizes, exchanges, savings, busiest month and shopping personality.
- `wrapped.html` contains a styled example with **fictional** values: £4,286, 73 purchases, Fashion (38), £624 returns/refunds, "The Style Explorer". These must remain marked illustrative until verified historical data is available.
- Eventually aggregate authorised real historical purchases and return outcomes, with clear coverage gaps, controls over sharing/personalisation and accurate definition of spend/refunds/savings.

## 5. Purchase matching: what tests proved, and what they did NOT prove
User originally proposed five factors: POS store/location, customer-registered card last four, exact amount, card brand, and exact transaction time. Square can provide merchant-side card last4 / brand / timing / order metadata. **Plaid Transactions Sandbox did not provide authentic POS card last4, merchant location or exact time** in observed tests (mainly amount, merchant string, date and account transaction IDs). Card last four self-declared in Relay is **not proof of ownership**. No verified itemised order should be assigned on an ambiguous or weak match.

Relevant workflows/scripts:
- `.github/workflows/multi-customer-square-test.yml`, `scripts/multi-customer-square-test.mjs`
- `.github/workflows/plaid-sandbox-probe.yml`, `scripts/plaid-sandbox-probe.mjs`
- `.github/workflows/compare-square-plaid-identifiers.yml`, `scripts/compare-square-plaid-identifiers.mjs`
- `.github/workflows/coordinated-square-plaid-test.yml`, `scripts/coordinated-square-plaid-test.mjs`
- `matching-lab.html` for simulated card identification / ambiguous match behaviour.

Four-customer coordinated test (Ava, Ben, Cara, Dylan) created four actual **Square Sandbox** orders of £129.99, and four **independently fabricated Plaid Sandbox** transactions also £129.99. The Square payment source `cnon:card-nonce-ok` produced **VISA last4 5858 on all four**; Plaid card digits were unavailable. Therefore **0 verified wallet purchases** and 0 fraudulent/false assignments (because nothing was assigned). The matching lab uses labelled **fake distinct card last4 fixtures** to test algorithmic collision behaviour. This did **not** prove real card-clearing-based linkage or actual purchase ownership. One stored D1 audit test event had ID `5ea4a459-d900-4885-9426-abaf6e89b94b`.

The user asked why Open Banking is needed. Plaid gives independent bank-transaction corroboration when retailer ID proof is unavailable, but authenticated retailer customer identity could eliminate Open Banking requirement for that purchase. Support both paths eventually, and never conflate candidate matching with ownership verification.

## 6. Database / backend
- D1 migrations: `worker/migrations/0001_relay_purchase_ledger.sql` includes consumers, bank_connections, bank_transactions, retailer_orders, order_items, match_candidates, identity_evidence, verification_challenges, audit_events.
- Worker source: `worker/worker.js`, imports Square webhooks, catalogue sync and Shopify integration modules (inspect current code).
- Original verified purchase endpoint `/relay/verified-purchases` returned HTTP 403 in the screenshot. This is an access/identity-flow issue, not proof of an outage or permission to bypass controls.
- Square Sandbox API tests are **not live retail purchases** and Plaid Sandbox transactions are not actually related payment-clearing data.
- Never store full PAN, CVV or sensitive banking secrets in frontend/local storage. Frontend card last4/brand is only a weak declarative signal.

## 7. Product design and business rules
- Visually polished modern consumer design: dark navy, lime accents, distinct imagery, responsive navigation, prominent product detail refund offer. Do not center developer logs or API status errors in the primary experience.
- Real app should have an approachable landing and demonstrable demo user journey even if verified feed returns 403; developer/API diagnostics belong on a separate technical page.
- Unified sections: Wallet, Discover, Radar, Wrapped and Profile. Refund and exchange available from each purchase; Radar/Discover surfaced contextually from exchange.
- UK regulatory, privacy, consumer rights and retailer contract issues need legal review before using real instant advances, automated returns or behavioural marketing. An instant advance is not the same as underlying retailer statutory refund obligations.
- Clarify staged functionality honestly: visual demo, simulated refund, catalogue snapshot, candidate match, verified purchase, and production integration must never be presented as identical.

## 8. Suggested next engineer/AI tasks (in order)
1. **Fix actual blank rendering at `relay-app-v2.html?v=2` and audit current `index.html`**. Reproduce, inspect console, identify JS error and prove interactive screen works.
2. Consolidate the duplicative app entry points into one coherent primary URL. Keep backups before replacing and do not break working APIs/workflows.
3. Verify a complete demo journey: Wallet → product detail → clear refund offer → simulated refund confirmation; alternatively exchange reason → actual Sandbox catalogue → alternative → clear "not yet submitted" transaction preview.
4. Integrate Discover, Radar and Wrapped into same navigation, not floating unrelated buttons. Test responsive desktop/mobile UI.
5. Build production-grade catalogue records (brand, product type, image, colour, size, price history, inventory) and reliable recommendation inputs, then customer-consented personalisation.
6. Implement and test retailer-authenticated identity linking and robust ambiguous matching abstention.
7. Implement an idempotent exchange state machine backed by retailer permissions and actual test order/return APIs.
8. Implement scheduled Radar price observation/notifications only after opt-in; aggregate Wrapped from verified annual history.

## 9. Engineering working agreement
- Read the existing repo before modifying; don't assume a previously claimed feature works.
- Make direct, scoped GitHub edits and identify commit SHAs.
- Actually check code syntax and browser execution; verify frontend state on laptop and phone widths.
- Explain exact limitations instead of saying "built" when only a mockup or untested code was committed.
- Don't request the user to repeatedly run workflows or copy logs unless essential and no available tool can access them.
- Preserve working prior versions with Git history; fix broken UI without exposing unverified private orders.

## 10. Recommended handoff prompt to paste into a new AI
"Take over the Relay application. Read RELAY_HANDOFF_FOR_NEW_AI.md in my GitHub repository zzmm92nr59-cloud/instant-refund-prototype, inspect the current main branch, and connect to GitHub for edits. The latest relay-app-v2.html screenshot is mostly blank and the prior verified API was returning 403. Your immediate task is to reproduce and FIX the frontend render failure, verify the app actually displays its main wallet and navigation, and then build the cohesive consumer user experience: prominent instant refund offer, coordinated exchange flow, Discover catalogue recommendations, Radar price watching, and Wrapped annual recap. Do not claim the app works without testing it, do not expose unverified purchase data, and clearly mark Sandbox/demo features. Keep Relay as a post-purchase wallet, NOT checkout."

# Relay frontend verification — 18 October 2026

Starting revision: `03c9ef4`. Read the handoff, current source and Git history before editing. The deployed v2 page rendered in a fresh browser; the historical blank screenshot was not reproduced. The current code did contain divergent app entry points, poor text contrast, obsolete test fixtures, and a first-use empty wallet with no direct sample entry.

## Changes

- Identical `index.html` and `relay-app-v2.html`, with an equality assertion to prevent drift. Retains the newer bank check and colour selection behaviour.
- Clear customer navigation, readable surfaces, separate `testing.html` linking existing labs, test store and retailer tools.
- Explicit opt-in sample trainers purchase. Wallet still starts empty. Fictional records remain separate from verified purchases.
- Prominent £129.99 illustrative instant refund and exchange choices. Refund reason/eligibility review and sample return instructions. Free/Plus remain concepts, with no subscription sold.
- Existing exchange engine retained. Added browser-wide transaction locking, fresh stock validation, price-change rejection and preservation of duplicate-prevention records. A failed stock write rolls back the browser exchange record.
- Refund and return events now retain the demo customer, making them visible in that customer's activity.
- Offline demo inventory is available immediately, without waiting for the API. Permission failures remain closed and are not exposed as technical errors in the customer wallet.

## Checked

`node scripts/ui-smoke-test.mjs` — 13 browser scenarios in Chromium: both entry points at 1280 and 390px, five tabs, no horizontal overflow, refund eligibility and duplicate prevention, linked original/replacement wallet, Free held exchange, Plus immediate simulation, out-of-stock at submission, failed storage rollback, two-tab duplicate protection, and unavailable APIs/malformed optional storage. API responses were deliberately denied in these tests. Local runtime used `RELAY_CHROMIUM` to point to an installed Chromium binary; CI installs Playwright Chromium normally.

Also passed: offline rendering, 20 exchange/refund checks, 9 wallet projection checks, Free/Plus rules, recommendation checks, Shopify webhook checks and Worker syntax. Browser screenshots are in this directory. No changes to `worker/`, identity modules, credentials or frozen snapshots.

## Limits

No live money, return authorisation or replacement order was sent by the customer demo. Square Sandbox catalogue listings remain distinct from editable fictional inventory. Browser-local simulated records are not a durable server transaction ledger or authenticated accounts. Browser locks require a supported secure context. Production authentication, verified ownership, retailer authorisation, backend idempotency/compensation and payout arrangements remain necessary.

## Separate Lovable visual prototype

[Open Lovable project](https://lovable.dev/projects/173415f3-26a8-4617-ab3c-b06a8f9722e2)

Lovable reported successful creation and its own tests at commit `aa0ec85b467a4cc2a1df266fbe6159abb019d356`. It is a separate visual prototype, **not synced to this repository or connected to the Worker**. Wallet state resets on reload; Radar stores manual entries locally. It is not published. Independent cloud-browser preview inspection timed out, so Lovable's own reported checks are not treated as independent verification here.

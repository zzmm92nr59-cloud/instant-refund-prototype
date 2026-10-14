# Relay working app — frozen baseline (14 October 2026)

**Do not edit, replace, reformat, delete, or overwrite this baseline during ordinary Relay development.**

The user approved the working Relay consumer app on 14 October 2026 and explicitly requested that it be preserved from future updates.

## Working baseline URLs

- **Independent archived app:** https://zzmm92nr59-cloud.github.io/instant-refund-prototype/snapshots/relay-2026-10-14/
- **Repository snapshot:** [snapshots/relay-2026-10-14/](./snapshots/relay-2026-10-14/)
- **Separate frozen-source branch:** [relay-stable-2026-10-14](https://github.com/zzmm92nr59-cloud/instant-refund-prototype/tree/relay-stable-2026-10-14)
- **Current development version (will keep evolving):** https://zzmm92nr59-cloud.github.io/instant-refund-prototype/

## Rules for all future app updates

1. Work on the normal app in `index.html`, or create explicitly versioned successors.
2. Never modify anything under `snapshots/relay-2026-10-14/` unless the user specifically asks to change the frozen version.
3. Never advance, reset, or delete branch `relay-stable-2026-10-14` unless the user explicitly authorises it.
4. Keep the archived app accessible as an independent rollback/reference link.
5. The five snapshot files are exact byte-for-byte copies, with matching Git blob SHAs, of the corresponding files in the frozen-source branch as of the moment the snapshot was created.

## Included files

- `index.html`: approved Relay app, featuring consumer wallet, refund offer, exchanges, Discover, Radar, Wrapped, sample purchases, retailer view, Free/Plus and Shopify demo experience.
- `relay-exchange-engine.js`: matching version of the exchange simulation script.
- `discover.html` and `wrapped.html`: supporting feature pages.
- `legacy-wallet.html`: older identity/testing flow linked from the app.

**Important limitations:** This freezes the *frontend source files*. It does not freeze remote Cloudflare Worker / Square / Shopify responses, platform hosting settings, or browser local-storage data. Archived features that call external services may behave differently if those services change. The reference version is preserved in GitHub even if the live APIs later change.

If you need stronger enforcement, enable branch protection/rulesets on `relay-stable-2026-10-14` through GitHub settings. The GitHub connector currently cannot configure these protections automatically.

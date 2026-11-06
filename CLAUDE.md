# Relay: rules for anything new

Relay is a consumer app. Every screen must look and behave like a finished product, not a prototype.
Check new work against these before shipping (scripts/test-polish-ui.mjs checks most of them automatically):

1. No purple gradients. Flat colours only: Relay's navy #101828 and lime #c7f567, the light/dark colour tokens (--rl-bg, --rl-card, --rl-text… in index.html), and the category tile colours (TILE_COLOURS in account.js). The look follows Apple Music's: big bold titles in the phone's own font, colourful tiles, flat rounded cards, a floating glass tab bar.
2. No excessive padding. Phone screens: 16–18px page edges, 16–22px inside cards.
3. The keyboard never covers what someone is typing (sheets sit above it; focused fields scroll into view).
4. Everything tappable is at least 44px tall.
5. Cache what was loaded: show the last copy at once, update quietly, remove it on sign-out.
6. No everyday text under 13px (uppercase labels 12px at the smallest).
7. No spinners or bare "Loading…": show greyed-out outlines of the content.
8. No emoji or symbol characters as icons in buttons; use the drawn line icons (ic() in index.html).
9. A double tap must never do the thing twice (guard in index.html; disable buttons while a request is running).
10. A new user never lands on an empty screen: always say what to do first.
11. Must survive bigger phone text, and look right in light and dark mode: the app follows the phone's setting, so colour things with the --rl-* tokens, never a fixed white or near-black (text on a coloured tile or button keeps that tile's own colours).
12. Never show raw error text, codes or server messages: plain English with what to do next.
13. Every button visibly reacts when pressed.
14. Preferences survive updates: keep them with the account where possible; never rename storage keys without moving the old value.
15. Shoppers never see demo, sandbox or test wording; testing tools only with ?testtools=1 or ?testing=1, or the Testing tools switch Relay's team has in Profile → Team. Orders from Relay's test shops show only with testing tools. The preview from shops' own websites shows only with testing tools or the team's Shops' websites switch.
16. A card is one tap: no row of buttons on a card. Tapping it opens its page (a sheet) with what you can do.
17. Say things once and plainly: no facts glued together with dots ("A · B · C"), no underlined links, no grey explaining line under every heading.
18. Back is a drawn chevron and a word in the accent colour (class rl-navback, with data-back). An inner screen shows its own bar, not the tab's big title.
19. Nothing floats over the page except the tab bar and sheets. Something urgent is a red number on its tab.

Also: index.html and relay-app-v2.html must stay identical. Bump VERSION in sw.js when the app shell changes.

Gestures (relay-gestures.js): a new inner screen's Back button gets data-back, so the phone's back and the swipe in from the left edge use it; sheets from the bottom close by swiping down; pull to refresh works on a tab's own screen. Links into the app use #open=… (index.html openLink).

Server (docs/SECURITY.md): a new route that takes a body needs its fields listed in worker/validate.js (unlisted routes take none), and a row in "Who can do what". Keys live only as Cloudflare secrets, never in code (scripts/check-secrets.mjs).

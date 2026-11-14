# Relay: rules for anything new

Relay is a consumer app. Every screen must look and behave like a finished product, not a prototype.
Check new work against these before shipping (scripts/test-polish-ui.mjs checks most of them automatically):

1. No purple gradients. Flat colours only: Relay's navy #101828 and lime #c7f567, the light/dark colour tokens (--rl-bg, --rl-card, --rl-text… in index.html), and the category tile colours (TILE_COLOURS in account.js), on Home's cards at lower strength (look S, class look-s on the page). Big bold titles in the phone's own font on Receipts and Browse; Home has no big title (its top row is your picture, the search and the bell) and Ask has none. Flat rounded cards, a floating glass tab bar of icons.
2. No excessive padding. Phone screens: 16–18px page edges, 16–22px inside cards.
3. The keyboard never covers what someone is typing (sheets sit above it; focused fields scroll into view).
4. Everything tappable is at least 44px tall.
5. Cache what was loaded: show the last copy at once, update quietly, remove it on sign-out.
6. No everyday text under 13px (uppercase labels 12px at the smallest).
7. No spinners or bare "Loading…": show greyed-out outlines of the content.
8. No emoji or symbol characters as icons in buttons; use the drawn line icons (ic() in index.html).
9. A double tap must never do the thing twice (guard in index.html; disable buttons while a request is running).
10. A new user never lands on an empty screen: always say what to do first.
11. Must survive bigger phone text. Relay is always light (white), whatever the phone is set to (Connor, 14 Nov 2026): the dark styles stay in the code behind "and (min-resolution: 9999dppx)", which never matches; remove that to bring dark mode back. Still colour things with the --rl-* tokens, never a fixed white or near-black (text on a coloured tile or button keeps that tile's own colours).
12. Never show raw error text, codes or server messages: plain English with what to do next.
13. Every button visibly reacts when pressed.
14. Preferences survive updates: keep them with the account where possible; never rename storage keys without moving the old value.
15. Shoppers never see demo, sandbox or test wording; testing tools only with ?testtools=1 or ?testing=1, or the Testing tools switch Relay's team has in Profile → Team. Orders from Relay's test shops show only with testing tools. The preview from shops' own websites shows only with testing tools or the team's Shops' websites switch.
16. A card is one tap: no row of buttons on a card. Tapping it opens its page (a sheet) with what you can do. A card's pictures are 140px squares (115 on Ask): a photo fills its square, a logo sits whole on white; one thing has its name and price beside its square, several sit in a sideways row with the price on each. Browse's product sections are the exception: under each kind's name and chevron, two big square photos a row, each with the shop's round logo and name, the product's name and its price.
17. Say things once and plainly: no facts glued together with dots ("A · B · C"), no underlined links, no grey explaining line under every heading.
18. Back is a drawn chevron and a word in the accent colour (class rl-navback, with data-back). An inner screen shows its own bar, not the tab's big title. Profile is not a tab: it opens from your picture (top left on Home, top right on the other tabs) and its Back returns to the tab it came from.
19. Nothing floats over the page except the tab bar, sheets and Home's pinned header (its top row and chips, kept at the top the way the tab bar is kept at the bottom). Something urgent is a red number on its tab.
20. Nothing asks Relay's server on a timer. A screen asks when it's opened or pulled down, and reuses what it just loaded (api() in account.js). The few screens that must stay current while they're open (an auction, a conversation) use keepFresh in account.js: only while on screen, never with Relay in the background, and they stop when there's nothing left to wait for. Every request made on opening the app has to be worth making every time: nothing for test shops without testing tools. scripts/test-quiet-ui.mjs counts the requests.

Also: index.html and relay-app-v2.html must stay identical. Bump VERSION in sw.js when the app shell changes.

Gestures (relay-gestures.js): a new inner screen's Back button gets data-back, so the phone's back and the swipe in from the left edge use it; sheets from the bottom close by swiping down; pull to refresh works on a tab's own screen. Links into the app use #open=… (index.html openLink).

Server (docs/SECURITY.md): a new route that takes a body needs its fields listed in worker/validate.js (unlisted routes take none), and a row in "Who can do what". Keys live only as Cloudflare secrets, never in code (scripts/check-secrets.mjs).

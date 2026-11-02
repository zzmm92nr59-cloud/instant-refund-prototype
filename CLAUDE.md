# Relay: rules for anything new

Relay is a consumer app. Every screen must look and behave like a finished product, not a prototype.
Check new work against these before shipping (scripts/test-polish-ui.mjs checks most of them automatically):

1. No purple gradients. Flat colours from Relay's palette: navy #101828, lime #c7f567, cream #f6f3ec, green, warm orange.
2. No excessive padding. Phone screens: 16–18px page edges, 16–22px inside cards.
3. The keyboard never covers what someone is typing (sheets sit above it; focused fields scroll into view).
4. Everything tappable is at least 44px tall.
5. Cache what was loaded: show the last copy at once, update quietly, remove it on sign-out.
6. No everyday text under 13px (uppercase labels 12px at the smallest).
7. No spinners or bare "Loading…": show greyed-out outlines of the content.
8. No emoji or symbol characters as icons in buttons; use the drawn line icons (ic() in index.html).
9. A double tap must never do the thing twice (guard in index.html; disable buttons while a request is running).
10. A new user never lands on an empty screen: always say what to do first.
11. Must survive bigger phone text and dark mode (the app declares light-only until there is a real dark theme).
12. Never show raw error text, codes or server messages: plain English with what to do next.
13. Every button visibly reacts when pressed.
14. Preferences survive updates: keep them with the account where possible; never rename storage keys without moving the old value.
15. Shoppers never see demo, sandbox or test wording; testing tools only with ?testtools=1 or ?testing=1.

Also: index.html and relay-app-v2.html must stay identical. Bump VERSION in sw.js when the app shell changes.

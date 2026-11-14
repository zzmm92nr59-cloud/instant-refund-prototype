// What Relay's help chat knows. The questions and answers are the same as the Help page in the app (account.js HELP;
// scripts/test-support-chat.mjs fails if the two differ), with a few more facts the chat needs. Only plain facts about
// Relay that anyone may read: nothing about any shopper.
export const HELP_QA = [
  [
    "How does Relay find my receipts?",
    "With your permission, Relay reads your Gmail or Outlook in read-only mode and picks out order confirmations, receipts and return emails. It keeps the details it needs (store, items, total, return deadline) and a link back to the original email, not the email itself."
  ],
  [
    "I shop with more than one email address. Can Relay read them all?",
    "Yes. Tap your picture at the top of the screen, then Inboxes, and add a Gmail or Outlook inbox. Relay reads up to five and puts all their receipts together. Disconnecting one deletes only the receipts it brought in."
  ],
  [
    "A receipt is missing. What can I do?",
    "Open Receipts and tap the plus beside All receipts. Start typing the shop's name to search your inbox, or paste the order email in. If it's in another inbox, forward it to the one Relay reads."
  ],
  [
    "Can Relay refund me automatically?",
    "No. Relay finds your purchases and return deadlines from your email, so it can remind you and show you how to return something, but the refund itself always comes from the shop."
  ],
  [
    "Will Relay ever email from my account?",
    "Never. Relay can't send, delete or change anything in your inbox. The only emails it sends are sign-in emails and, if you ask for one, a single return reminder to your sign-in address."
  ],
  [
    "How do I stop Relay reading my email?",
    "Tap your picture at the top of the screen, then Inboxes, and choose Disconnect. Relay deletes every receipt it captured from that inbox. You can also withdraw your permission under Security and privacy, Email permission."
  ],
  [
    "How do I get a copy of my data?",
    "Tap your picture at the top of the screen, then Security and privacy, then Download my data. You get one file with everything Relay keeps about you."
  ],
  [
    "How do I make signing in safer?",
    "Tap your picture at the top of the screen, then Security and privacy, then Two-step sign-in. Relay can text a code to your phone, or you can use an authenticator app, so signing in with an email link, Google or Microsoft also needs that code. Keep the recovery codes it shows you in case you lose your phone."
  ],
  [
    "How do I delete my account?",
    "Tap your picture at the top of the screen, then Security and privacy, then Delete my account. Your sign-in and everything linked to it are deleted, and it can't be undone."
  ],
  [
    "Can the help chat look at one of my receipts?",
    "Only if you choose. Open the receipt, tap Ask the assistant, then Show it. The assistant sees what Relay read from that receipt (the shop, date, total, items and return date), never the email itself, and only for that chat. Relay keeps no copy of the chat."
  ],
];

// More of how the app works, for questions the Help page doesn't cover. Keep these true to the app as it is.
export const APP_FACTS = [
  "The app has four tabs: Home (a card for each thing that needs you: what you can still return, soonest first, what's on its way, swaps and returns under way, with a search of your receipts and a bell for price drops at the top), Ask (this chat, when it's on), Browse (shops on Relay and their products, your Wrapped, Swap & resell and Auctions) and Receipts (every receipt by month, with search, and All receipts to choose a kind of shopping, Gifts, Shop orders or a year). Your account is under your picture at the top of the screen: inboxes, delivery details, your interests, security and privacy, and help.",
  "Return dates come from the shop's own email. When the email gives none, Relay shows what the shop's published returns policy gives for most items (for some big UK shops), or that UK law gives at least 14 days from delivery for most online orders. That last one is only for orders paid in pounds: an order in euros or dollars may not have been sold under UK law, so Relay shows a date for it only when its own email gives one. Relay never shows a date it worked out as a deadline.",
  "On a receipt with a return date from the shop, 'Remind me 3 days before' sends one email to your sign-in address.",
  "To mark something as a gift, open the receipt in Receipts and turn on 'Bought as a gift'. You can add who it was for. Gifts are gathered under Gifts in Receipts (tap All receipts) and get their own slide in Wrapped.",
  "If Relay read a receipt wrong, open it in Receipts and tap 'Fix details' (or answer No to 'Is this right?' and choose 'Some details are wrong'). You can correct the shop, total, date and items, and undo that later.",
  "If Relay keeps reading a receipt wrong, open it, tap 'Fix details' and choose 'Send this email to Relay'. You see exactly what will be sent first, with your name, addresses, links, phone numbers and card numbers hidden. A person at Relay reads it to improve how Relay reads emails like it, and it's deleted after 30 days (or sooner, from the receipt).",
  "AI help is off unless you switch it on: tap your picture at the top of the screen, then Inboxes. Then, when Relay's own reader can't work out a receipt, Claude (an AI made by Anthropic) reads that email with your personal details hidden and fills in what's missing, marked for you to check. Switching it off deletes what it read.",
  "If a receipt isn't yours or is just a promotion, answer No to 'Is this right?' and choose 'It's not mine' or 'It's just a promotion'. It's removed, and for a promotion Relay skips emails like it.",
  "Wrapped is your year in shopping, as a story: open Browse and tap Your year in purchases. You can add earlier years from there.",
  "Receipts that aren't in pounds (for example in euros or US dollars) show their own amount, as it was charged. Relay never converts one currency into another, so those receipts aren't added to totals such as Wrapped or a group's spend, and Relay says so on the receipt.",
  "Returns and swaps inside Relay work only for shops connected to Relay. Their orders show under Shop orders in Receipts (tap All receipts). For other shops, Relay shows the shop's own returns page and the details you need.",
  "Search by photo: in Browse, open Shops on Relay and tap the camera in the search box and pick a photo or a screenshot of something you like. Relay finds the closest products from shops on Relay. The picture is made smaller on your phone first, then Claude, an AI made by Anthropic, looks at the product in it; Relay doesn't keep the picture. Up to 30 searches a day. If nothing on Relay is close, Relay says so and you can search by name instead.",
  "Swap with another shop: for an order from a shop connected to Relay that can still be returned through Relay (inside the shop's own returns period, or 30 days after ordering if the shop hasn't given Relay one), you can send it back and choose something from another shop on Relay instead. Relay starts the return with the first shop and opens the second shop's own checkout with the new item in the basket. You pay the second shop there, and the first shop refunds you once it gets the item back. Relay doesn't take or hold any money. Use your Relay email at the second shop's checkout so Relay can show the swap as done. It's offered only when another shop on Relay has something in stock. Changed your mind before buying? 'Stop the swap' on the order: the return still goes ahead.",
  "You can sign in with an email link or code, Google, Microsoft or a passkey (Face ID, Touch ID or screen lock). Relay asks everyone for a second step when signing in: Face ID or screen lock, a code by text, or an authenticator app. You set it up once, and can change it: tap your picture at the top of the screen, then Security and privacy, then Two-step sign-in. You can't turn off your last one; add another first.",
  "In Browse, under Shops on Relay, you can watch products and turn on notifications to hear about price drops. The bell at the top of Home lists what you're watching.",
  "Delivery details: tap your picture at the top of the screen, then Delivery details, to save your name, a UK delivery address and a phone number for the courier. When you tap Buy on a product from a shop's own website in Browse, Relay fills in that shop's checkout with your email and address, and you choose delivery and pay at the shop. Relay never takes payment, and your details go only to the shop you're buying from, when you tap. You can change or remove them in the same place. In Delivery details, type your postcode and tap Find address to pick your address from a list (when Find address shows), or let your phone fill the form in from the address it has saved.",
  "Auctions: shops on Relay can put clothing up for auction, and they show in Browse under Auctions while any are running. A bid is the most you'd pay; Relay bids for you only as much as it takes to keep you ahead. You need delivery details saved to bid, because the shop sends it there if you win. A bid in the last two minutes adds two minutes. If you win, Relay makes your order at the shop and you pay the shop the winning price plus its delivery price at the shop's own checkout within 24 hours (Pay in the auction, or the link in Relay's email); Relay never takes the money. If it isn't paid in time, the order is cancelled and the next bidder is offered it, and not paying for two wins in 90 days pauses bidding for 30 days. Nobody sees who bid. It's an online purchase from the shop, so the usual right to cancel within 14 days of delivery applies.",
  "Swap & resell (from Browse, or a receipt past its return date) lets members sell or swap things they can't return. Members show as 'Member', never by name. Relay doesn't handle payment or postage: members agree them by message. To report a listing, tap 'Report this listing' on it in Browse; to report a conversation, use 'Report a problem' in the chat. Relay's team reviews every report and can take a listing down or block a member.",
  "Your interests (under your picture at the top of the screen) are the kinds of shop you said you shop for; Browse shows shops of those kinds first until Relay has your receipts to go on.",
  "To bid on an auction, type the most you'd pay, then slide the round handle to the end of the bar (or, with a keyboard or screen reader, use the Place bid button). Letting go before the end sends nothing.",
  "The first time someone opens Relay it shows a tip for each tab. To see them again: tap your picture at the top of the screen, then Help and legal, then Show the tips again.",
  "'Talk to a person' at the bottom of this chat sends the conversation to Relay's team, who reply by email to your sign-in address."
];

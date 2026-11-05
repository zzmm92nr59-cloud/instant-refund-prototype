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
    "Yes. Open Profile, then Email connection, and add a Gmail or Outlook inbox. Relay reads up to five and puts all their receipts together. Disconnecting one deletes only the receipts it brought in."
  ],
  [
    "A receipt is missing. What can I do?",
    "Open Profile and choose Add a missing receipt. Start typing the shop's name to search your inbox, or paste the order email in. If it's in another inbox, forward it to the one Relay reads."
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
    "Open Profile, then Email connection, and choose Disconnect. Relay deletes every receipt it captured from that inbox. You can also withdraw your permission under Privacy & data."
  ],
  [
    "How do I get a copy of my data?",
    "Open Profile, then Download my data under Privacy & data. You get one file with everything Relay keeps about you."
  ],
  [
    "How do I make signing in safer?",
    "Open Profile, then Two-step sign-in. Relay can text a code to your phone, or you can use an authenticator app, so signing in with an email link, Google or Microsoft also needs that code. Keep the recovery codes it shows you in case you lose your phone."
  ],
  [
    "How do I delete my account?",
    "Open Profile, then Delete my account under Privacy & data. Your sign-in and everything linked to it are deleted, and it can't be undone."
  ]
];

// More of how the app works, for questions the Help page doesn't cover. Keep these true to the app as it is.
export const APP_FACTS = [
  "The app has four tabs: Home (things you can still return, soonest return date first), Receipts (every receipt, grouped by kind of shopping, with search, Wrapped and Gifts), Discover (products from shops on Relay) and Profile (your account, email connection, privacy, Wrapped and help).",
  "Return dates come from the shop's own email. When the email gives none, Relay shows what the shop's published returns policy gives for most items (for some big UK shops), or that UK law gives at least 14 days from delivery for most online orders. Relay never shows a date it worked out as a deadline.",
  "On a receipt with a return date from the shop, 'Remind me 3 days before' sends one email to your sign-in address.",
  "To mark something as a gift, open the receipt in Receipts and turn on 'Bought as a gift'. You can add who it was for. Gifts get their own tile in Receipts and their own slide in Wrapped.",
  "If Relay read a receipt wrong, open it in Receipts and tap 'Fix details' (or answer No to 'Is this right?' and choose 'Some details are wrong'). You can correct the shop, total, date and items, and undo that later.",
  "If Relay keeps reading a receipt wrong, open it, tap 'Fix details' and choose 'Send this email to Relay'. You see exactly what will be sent first, with your name, addresses, links, phone numbers and card numbers hidden. A person at Relay reads it to improve how Relay reads emails like it, and it's deleted after 30 days (or sooner, from the receipt).",
  "AI help is off unless you switch it on, in Profile under Email connection. Then, when Relay's own reader can't work out a receipt, Claude (an AI made by Anthropic) reads that email with your personal details hidden and fills in what's missing, marked for you to check. Switching it off deletes what it read.",
  "If a receipt isn't yours or is just a promotion, answer No to 'Is this right?' and choose 'It's not mine' or 'It's just a promotion'. It's removed, and for a promotion Relay skips emails like it.",
  "Wrapped is your year in shopping, as a story: open Profile and play it. You can add earlier years from there.",
  "Returns and swaps inside Relay work only for shops connected to Relay. Their orders show under 'Shop orders' in Receipts. For other shops, Relay shows the shop's own returns page and the details you need.",
  "Swap with another shop: for an order from a shop connected to Relay that can still be returned through Relay (within 7 days), you can send it back and choose something from another shop on Relay instead. Relay starts the return with the first shop and opens the second shop's own checkout with the new item in the basket. You pay the second shop there, and the first shop refunds you once it gets the item back. Relay doesn't take or hold any money. Use your Relay email at the second shop's checkout so Relay can show the swap as done. It's offered only when another shop on Relay has something in stock. Changed your mind before buying? 'Stop the swap' on the order: the return still goes ahead.",
  "You can sign in with an email link or code, Google, Microsoft or a passkey (Face ID, Touch ID or screen lock), and add two-step sign-in under Profile.",
  "In Discover you can watch products and turn on notifications to hear about price drops.",
  "Swap & resell (from Discover, Profile, or a receipt past its return date) lets members sell or swap things they can't return. Members show as 'Member', never by name. Relay doesn't handle payment or postage: members agree them by message. To report a listing, tap 'Report this listing' on it in Browse; to report a conversation, use 'Report a problem' in the chat. Relay's team reviews every report and can take a listing down or block a member.",
  "'Talk to a person' at the bottom of this chat sends the conversation to Relay's team, who reply by email to your sign-in address."
];

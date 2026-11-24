# Getting Google's approval for Gmail

Written 24 November 2026. Google's rules change: every rule here has a link to Google's own page, checked that day.
Where something is a judgement or an estimate and not Google's own words, it says so.

## The short version

- Today only people Connor lists by hand can connect Gmail, 100 at most. To open it to everyone, Google has to
  **verify** Relay.
- Relay asks for one Gmail permission: read-only access to email. Google puts that in its strictest class
  ("restricted"). That means three reviews, in this order: **branding** (who Relay is), **the permission itself** (why
  Relay needs it, with a video), and a **security assessment by an outside lab that Relay pays for, every year**.
- There is no narrower Gmail permission that reads an email's contents. The only ways round the security assessment are
  not to use Gmail's permission at all (see "Other routes").
- **Money:** Google charges nothing. The lab charges. One Google-approved lab lists US$675 to US$855 for the lower
  level and US$5,400 for the higher one; Google decides which level Relay gets. Plus a domain name, about £10 a year.
- **Time:** Google's own estimate for the permission review is 6 weeks, "not guaranteed". With the domain move, the
  lab's test and fixing what it finds, plan for **2 to 4 months** (an estimate, not Google's figure).
- **Connor has to do** five things himself: buy a domain, prove to Google he owns it, fill in Google's forms, record
  a short video, and pay a lab. Each is spelled out below.
- **One real problem was found and is fixed on this branch** (see "AI and Google's rules"): Relay's permission wording
  said it "never shares" what it finds and didn't mention AI, while AI help now sends email text to Anthropic for
  everyone. Google allows that only with the person's consent. The wording now says it. Putting that live asks every
  member to agree again.

## What Relay asks Google for

Checked in the code (`worker/auth.js`, `worker/gmail.js`), which is what Google sees:

| Permission | When | Google's class | What it needs |
|---|---|---|---|
| `openid`, `email`, `profile` | Continue with Google | Not sensitive | Branding review only |
| `https://www.googleapis.com/auth/gmail.readonly` | Connect Gmail, or creating an account with Google | **Restricted** | Everything on this page |

Nothing else is asked for. Gmail's instant notices (docs/MAIL_PUSH_SETUP.md) use Relay's own Google Cloud account, not
a permission from the member.

Sources: Google's list of restricted permissions names `gmail.readonly`
([Restricted Scopes](https://support.google.com/cloud/answer/13464325?hl=en),
[Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)).

### Could Relay ask for less?

No. Every Gmail permission that lets an app see emails is restricted, including `gmail.metadata`, which shows only who
sent an email and its subject, and wouldn't be enough to read a receipt. The few Gmail permissions that aren't
restricted either can't read email (labels, sending) or only work inside an add-on that lives in Gmail's own window
([Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)). `gmail.readonly` is already
the smallest one that does the job, which is also what Google asks for
([Requesting Minimum Scopes](https://support.google.com/cloud/answer/13807380?hl=en)).

## What Google requires, and where Relay stands

### 1. A home page and privacy policy on a domain Connor owns: NOT DONE, needs Connor

Google's words ([Verification requirements](https://support.google.com/cloud/answer/13464321?hl=en),
[App Homepage](https://support.google.com/cloud/answer/13807376?hl=en)):

- "The homepage must be hosted on a verified domain you own."
- It should not be "hosted on a third-party platform where you can't verify that you own your subdomain". Google's
  examples are Google Sites, Facebook, Instagram and Twitter.
- "Your homepage can not be only a login page." It must "fully describe your apps functionality", "explain with
  transparency the purpose for which your app requests user data", and "include a link to your privacy policy".
- The privacy policy "should be hosted within the domain that hosts your homepage".
- "You must verify that you own all domains listed in your Authorized domains section", using Google Search Console.
  That list has to cover the home page, the privacy policy, the terms and the address Google sends people back to after
  they agree ([brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)).

Where Relay is: the app is at `zzmm92nr59-cloud.github.io` (GitHub's domain) and Google sends people back to
`relay-square-api2.9pts72cy5j.workers.dev` (Cloudflare's domain). Connor owns neither. Google doesn't name GitHub in
its examples, so this isn't certain, but its test is "registered to you", and a common rejection is "The website you
provided as your homepage is not registered to you". **Assume both addresses will be refused and buy a domain.** It is
also what a real product needs anyway.

Done in the repo: `about.html`, a plain public page that says what Relay does, why it asks to read email, what it keeps
and never does, with Google's required sentence and links to the privacy policy and terms. It becomes the home page
Google is given.

### 2. The privacy policy's content: MOSTLY DONE, two gaps need Connor

Google's words ([App Privacy Policy](https://support.google.com/cloud/answer/13806988?hl=en)): it must "comprehensively
disclose how your app accesses, uses, stores, or shares Google user data", say how the data is protected, cover
retention and deletion, and be "clearly linked to your application and/or organization. Do not submit a template".
For AI: "your privacy policy must explicitly affirm that Google Workspace APIs are not used to develop, improve, or
train non-personalized AI and/or ML models".

Done in the repo: `privacy.html` has a new part, "Information from your Google account", that says in one place what
Relay gets from Google, what it uses it for, where it's kept, exactly who it is passed to (Cloudflare, Anthropic, a
shop when you start a return, Ship24, Resend, and a person at Relay only for an email you choose to send), what Relay
never does (sell, adverts, credit decisions, AI training, with Google's affirmation), how to delete it, and Google's
sentence:

> Relay's use of information received from Google APIs will adhere to the Google API Services User Data Policy,
> including the Limited Use requirements.

That is the wording Google's own FAQ gives
([Frequently Asked Questions](https://support.google.com/cloud/answer/13463817?hl=en)).

Still missing, and only Connor can supply them:

- **Who runs Relay.** The policy names no company, address or contact email. Google wants the policy tied to the
  organisation, and UK law wants it too. Give Claude the registered name, company number, address and a contact email
  (for example `privacy@` the new domain) and it goes in.
- **A lawyer's read.** Both pages still carry a note saying they haven't had one. Worth mentioning to them: Relay's
  database is held by Cloudflare in North America.

### 3. Limited Use: what Relay may do with Gmail data: MEETS IT, with three things to watch

Google's rules for Gmail ([Google Workspace user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy),
last updated 3 September 2026; the general
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)):

| Google's rule | Relay |
|---|---|
| Only for an approved kind of app. For Gmail one is "Applications that use information from emails to provide reporting or monitoring services for the benefit of users" (Google's examples: travel itineraries, package tracking). | Relay fits this one: receipts, return dates and parcels from emails. It is a judgement Google's reviewer makes, not a guarantee. |
| "Limit your use of data to providing or improving" features "visible and prominent in the requesting application's user interface". | Receipts, return dates, parcels, codes, Wrapped and picks are all on screen. |
| "Transfers of data are not allowed, except" to provide those features "and only with the user's consent", for security, or to comply with the law. | See "AI and Google's rules" below. |
| No "serving ads, including retargeting, personalized or interest-based advertising"; no selling; no credit decisions. | Relay does none. **Watch:** picks in Browse follow what someone bought. If Relay is ever paid by shops for what appears there, Google could call that interest-based advertising. Today nothing in the app pays Relay for a product shown. |
| "Do not allow humans to read user data, unless" the person agreed "to view specific messages", or for security, the law, or data that is "aggregated and anonymized and used for internal operations". | Nobody at Relay reads email. The one exception is an email a member chooses to send from a receipt that was read wrong, which they see first. That fits. |
| No using the data "to create, train, or improve a machine learning or artificial intelligence model", except a model personal to that one user. | Relay trains no models. See below for Anthropic. |
| Google's privacy policy guidance lists "Creating databases" among uses it doesn't allow. | **Watch:** Relay keeps item names with nothing personal in them (like "Haribo Starmix 140g") and what the AI said each is, not linked to anyone, and keeps them after the account goes. It is small and anonymous, and the privacy policy says so, but a reviewer could question it. If they do, the fix is to delete a name once nobody's receipt uses it. |
| "Honor user requests to delete their data." | Disconnect deletes that inbox's receipts and cancels access at Google; Delete my account removes everything; Download my data gives a copy. |

### 4. AI and Google's rules

This is the part asked about most directly: Relay now sends email text to Anthropic's AI for every member unless they
switch it off. Is that allowed?

**What Google's rules say.**

- Passing Gmail data to another company is allowed "to provide or improve your appropriate use case or user-facing
  features", "and only with the user's consent".
- The data must not be used "to create, train, or improve a machine learning or artificial intelligence model" beyond
  that one user's own. Google's FAQ adds: "Google User Data may not be used to train or improve foundational models".
- Google lists "generative AI summaries" among acceptable Gmail app features, so using an AI on someone's email for a
  feature they see is not itself against the rules.
- If an app changes how it uses Google data, it has to tell people and get their agreement before using the data the
  new way (Google API Services User Data Policy).
- Apps that put this data through an AI must protect "against prompt injection techniques" (an email written to trick
  the AI).

**Where Relay stands.**

- *Using the AI at all:* allowed. It fills in a receipt the member sees, which is a user-facing feature. Personal
  details are hidden before anything is sent, which is more than Google asks.
- *Training:* allowed as long as Anthropic never trains on it. Relay's policy says Anthropic's terms forbid that.
  **Connor should confirm** the Anthropic account Relay's key belongs to is on Anthropic's business terms (not a
  personal plan) and keep a copy of those terms and its data processing agreement: Google or the lab may ask.
- *On by default:* Google's rules don't say "must be opt-in". They say "with the user's consent". So the question is
  whether the member agreed to it. **This is where Relay had a problem:** the wording members agree to before
  connecting an inbox didn't mention AI and said Relay "never sells or shares what it finds". Members who connected
  before 24 November got AI switched on with a notice afterwards. A notice with an off switch is weaker than consent,
  and Relay's own privacy policy promises to "ask for your permission again first" when what happens to email changes.
- *The fix on this branch:* the permission wording (now version 6) says an AI reads the emails Relay's rules can't,
  with details hidden, that Anthropic can't train on it, and how to switch it off; "never shares" is replaced with what
  is true. The sign-in page's summary and the home page say the same. Because the wording changed, **every member is
  asked to agree again**, the way they were when Outlook was added. Until someone agrees, Relay stops reading their
  inbox and doesn't send return reminders they'd asked for. That is the cost of doing it properly; it's one tap for
  the member.
- *What remains a judgement:* a reviewer could still prefer AI to be a separate choice the member makes. If Google
  says so, the answer is a switch on the connect screen. Nothing found in Google's written rules requires it.
- *Tricked by an email:* what the AI returns is treated as untrusted. Relay accepts only a fixed set of fields with
  sensible values, uses them only to fill gaps, marks them for the member to check, and the AI can't take any action
  (`worker/ai-reader.js`). Worth saying in the submission.

### 5. The sign-in button: DONE

Google's sign-in button rules: the button "must always include the standard color" Google "G", with wording such as
"Continue with Google", and must not be less prominent than other sign-in choices
([Sign in with Google Branding Guidelines](https://developers.google.com/identity/branding-guidelines)). Relay's button
was words only. It now carries Google's G (and Microsoft's mark on its button, to match). The white pill with dark
words matches Google's light style.

### 6. The demo video: needs Connor (script below)

Google's words ([Verification requirements](https://support.google.com/cloud/answer/13464321?hl=en),
[restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)):
it "must show the end-to-end flow of your app including the OAuth grant process", "the same application you have
submitted", with Google's permission screen in English showing the app's name and "the same exact scopes", and the
client ID visible in the browser's address bar. Upload to YouTube as **Unlisted**.

### 7. The security assessment (CASA): needs Connor, costs money, every year

Google's words: "Every app that requests access to Google users' restricted data and has the ability to access data
from or through a third-party server must go through a security assessment from Google-empanelled security assessors"
([restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
Relay reads email on its own servers, so it applies.

- It follows a standard called CASA, with two levels: **AL1** and **AL2** (older articles call them Tier 2 and
  Tier 3). Both are checked by an approved lab; AL2 is a fuller test by the lab itself. Google picks the level from
  "user count, requested scopes, and other application-specific signals"
  ([Security Assessment](https://support.google.com/cloud/answer/13465431?hl=en),
  [CASA assurance levels](https://appdefensealliance.dev/casa/casa-tiering)). A small new app usually starts at the
  lower one, but that is Google's decision and it can rise as Relay grows.
- It is the **last** step: Google's team emails when it's time to start. Don't pay a lab before that email.
- Passing gives a Letter of Validation. Anything the lab rates critical or high has to be fixed first.
- "All applications must be revalidated every year."
- "Google does not charge the developer any fees for security assessment." The lab does
  ([Frequently Asked Questions](https://support.google.com/cloud/answer/13463817?hl=en)).
- Approved labs are listed by the App Defense Alliance
  ([authorized labs](https://www.appdefensealliance.org/certification/authorized-labs)): Bishop Fox, DEKRA, Eydle,
  Leviathan Security, NetSentries, Prescient Security, TAC Security and ValueMentor do web and cloud apps.

Where Relay is: in reasonable shape for it. Keys to inboxes are encrypted, everything travels encrypted, secrets are
kept out of the code, every route's input is checked, there are rate limits, two-step sign-in for everyone and a
written breach plan (docs/SECURITY.md), with tests for each. The lab will scan the code and the live site and send a
questionnaire. Expect a list of things to fix; Claude can do the fixes and answer the technical questions.

## Cost and time

| What | Cost | How long | Source |
|---|---|---|---|
| Domain name | About £10 a year | An hour to set up, up to a day to take effect | Estimate |
| Branding review | Free | Minutes if automatic, else "2-3 business days" | [brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification) |
| Restricted permission review | Free | Google's estimate: 6 weeks, "not guaranteed", depends on how fast Relay answers | [FAQ](https://support.google.com/cloud/answer/13463817?hl=en) |
| Security assessment, lower level (AL1) | US$675 to US$855 at TAC Security; other labs roughly US$800 to US$1,500 | 2 to 3 weeks at the lab, plus fixing | [TAC Security's price list](https://casa.tacsecurity.com/site/home), read 24 Nov 2026; other labs from a [third-party comparison](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option), not confirmed with them |
| Security assessment, higher level (AL2) | US$5,400 at TAC Security; other labs roughly US$4,500 to US$8,000 and up | 2 to 6 weeks, plus fixing | Same |
| Every year after | The assessment again | | [Annual Recertification](https://support.google.com/cloud/answer/13463816?hl=en) |

Lab prices are the labs' own and change; get two quotes. Overall, 2 to 4 months from buying the domain to approval is
a sensible plan. That range is an estimate.

## What Connor does, step by step

Tell Claude as each step is done; several need a matching change to Relay.

### Step 1. Buy a domain

Any registrar. Buying it through Cloudflare (Domain Registration, in the same account as Relay's server) saves a step
later. Pick the name Relay will keep: Google's approval is tied to it.

Then tell Claude the name. Claude then moves Relay onto it:

- the app, home page, privacy policy and terms at the new domain (GitHub Pages can serve a domain you own, free);
- Relay's server at `api.` the new domain, so Google sends people back to an address Connor owns;
- the old addresses kept working for a while.

Two honest costs of moving the app's address, both one-off: everyone signs in again at the new address, and Face ID
sign-in (passkeys) has to be set up again, because phones tie both to the address. People who added Relay to their
home screen add it again. Better now, with a hundred people, than later.

### Step 2. Prove to Google the domain is Connor's

1. Go to [Google Search Console](https://search.google.com/search-console), signed in with the Google account that
   owns Relay's Google Cloud project.
2. Add property, choose **Domain**, type the domain.
3. Google shows a line of text (a "TXT record"). Add it where the domain's settings are (in Cloudflare: the domain,
   DNS, Add record, type TXT). Press Verify.

### Step 3. Fill in Google's forms

In the [Google Cloud console](https://console.cloud.google.com/), in Relay's project, open **Google Auth Platform**.

1. **Branding**
   - App name: `Relay`. It has to match the name in the app and the video.
   - User support email: an address people can write to.
   - App logo: Relay's icon (`icons/icon-512.png`), square.
   - Application home page: `https://<domain>/about.html`
   - Privacy policy: `https://<domain>/privacy.html`
   - Terms of service: `https://<domain>/terms.html`
   - Authorized domains: the domain.
   - Developer contact email: one Connor reads. **All of Google's questions come here; a slow reply is the usual
     reason reviews drag.**
2. **Clients**: open Relay's web client. Under Authorized redirect URIs add
   `https://api.<domain>/relay/gmail/callback` and the sign-in one Claude gives you after step 1. Leave the old ones
   until the move is finished.
3. **Data Access**: Add or remove scopes. Make sure exactly these are listed: `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`, and `.../auth/gmail.readonly`. Remove anything else.
4. **Audience**: note what "Publishing status" says today and tell Claude.
   - *Testing* means only the listed people can connect, and Google makes each of them reconnect every 7 days
     ([Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en)).
   - *In production* (unverified) means anyone can, past a warning screen, until 100 people ever have. That count
     never resets.
   Press **Publish app** when steps 1 to 3 and the video are ready; verification starts from "In production".

### Step 4. Record the video

Record the screen of a computer (Chrome, in English) with your voice or captions. Three to five minutes. Use a real
Gmail account of your own with a few order emails in it and no private ones on screen. Shot by shot:

1. **The home page.** Open `https://<domain>/about.html`. Say: "This is Relay. It finds the receipts in your email and
   tracks return dates and parcels." Scroll to "Why Relay asks to read your email" and to the privacy policy link.
2. **Starting.** Open the app, tap through to "Create your account". Tap "What Relay reads" so the points and the full
   permission wording show. Scroll through them slowly.
3. **Google's screen.** Tap "Continue with Google". When Google's page appears, **click the address bar and show the
   whole address** so `client_id=…` can be read (say "this is our client ID"). Pick the account. On the permission
   screen, pause so it can be read: the name **Relay**, and "View your email messages and settings". Press Continue.
4. **What the permission is used for.** Back in Relay, show it finding receipts. Open the Receipts tab. Open one
   receipt: point out the shop, date, total, items and return-by date, and say "all of this was read from the order
   email". Open the original email from the receipt to show the link back.
5. **A parcel and a return code**, if the account has one: show where a parcel is, and a code to show or scan.
6. **AI help.** Tap your picture, AI help. Say: "When our own rules can't read a receipt, an AI reads that one email
   with personal details hidden. It's said before connecting, and it can be switched off here." Switch it off and on.
7. **Connecting from inside the app.** Tap your picture, Email connection. Show the connected inbox. (If you can, show
   "Connect Gmail" with a second account: it's the same Google screen.)
8. **Stopping.** Disconnect the inbox and show the receipts go. Say: "Disconnecting deletes everything Relay captured
   and cancels its access at Google." Then show Delete my account exists (don't press it).
9. Finish on the privacy policy's "Information from your Google account" part.

Upload to YouTube, visibility **Unlisted**, and keep the link.

### Step 5. Submit

Google Auth Platform, **Verification Centre**, Prepare for verification
([Submitting your app](https://support.google.com/cloud/answer/13461325?hl=en)). Paste the text below, add the video
link, submit. Then answer Google's emails quickly. When they say it's time for the security assessment, get quotes from
two labs, pick one, and bring Claude their list.

## Text to paste

**What kind of app is Relay?** (pick the nearest "reporting and monitoring" choice for Gmail)

**How will the scopes be used? (`gmail.readonly`)**

> Relay is a consumer app for UK shoppers that keeps a person's purchases, return deadlines and parcels in one place.
> With the user's permission, Relay uses gmail.readonly to search the user's inbox for order confirmations, receipts,
> and delivery and return emails, and to read those messages. From each it extracts the shop, order number, date,
> total, items, return deadline and return instructions, parcel tracking details, and any barcode or QR code the shop
> sent for a return or collection, and shows them to the user in the Receipts tab, with a link back to the original
> email. Relay stores only these extracted details, never the email. It reads new order emails as they arrive so the
> user's list, return deadlines and parcel status stay up to date.
>
> Access is read-only. Relay never sends, deletes, moves or changes email. The data is used only for these features,
> which the user sees in the app. It is never sold, never used for advertising or credit decisions, and never used to
> train AI models. When Relay's own parsing rules cannot read a receipt, the text of that one email is sent, with the
> user's name, addresses, links, phone numbers and card numbers removed, to Anthropic's Claude API to extract the same
> fields. Users are told this before connecting and can switch it off in the app. Anthropic is not permitted to train
> on this data. No person at Relay reads a user's email unless the user chooses to send a specific email to support.
>
> Users can disconnect Gmail at any time, which deletes everything captured from that inbox and revokes Relay's token
> at Google, and can delete their account or download their data in the app.

**Why can't a narrower scope be used?**

> Relay needs the body of order and receipt emails: the items, prices, totals and return details are only there.
> gmail.metadata exposes headers only (sender, subject), which is not enough to read a receipt. The Gmail add-on
> scopes only work inside the Gmail interface for the message the user has open, and cannot find receipts that arrive
> later or keep return deadlines current. Relay does not need to send, change or delete mail, so it requests
> gmail.readonly and not gmail.modify or the full mail scope. gmail.readonly is the narrowest scope that provides the
> feature.

**Limited Use**

> Relay's use of information received from Google APIs will adhere to the Google API Services User Data Policy,
> including the Limited Use requirements. This statement is on our home page and in our privacy policy.

## What could go wrong

- **Google decides Relay isn't an approved kind of Gmail app.** Receipt and parcel tracking is close to Google's own
  examples, but it's their call. If refused, the reply is to explain which approved use Relay matches
  ([Application Use Cases](https://support.google.com/cloud/answer/13805798)).
- **Google assigns the higher security level.** The cost goes from hundreds to thousands of dollars a year.
- **The reviewer objects to AI being on by default, to picks, or to the kept item names.** Each has a fallback, noted
  above. None needs deciding now.
- **Slow answers.** Google closes requests that go quiet.
- **Changing things mid-review.** Adding a permission, or a new use of email, restarts part of the review. Keep
  Gmail-related changes small until it's through.
- **Every year:** the security assessment again, or Google withdraws the permission.

## Other routes

| Route | What it means | Avoids the security assessment? |
|---|---|---|
| Stay as now | At most 100 people, added by hand. If Google's project is in "Testing", each reconnects weekly. Fine for family and friends, not a launch. | Yes |
| Outlook | Already works, with Microsoft's read-only permission. Microsoft's own rules weren't checked for this document; as far as Relay has seen, there is no paid yearly lab test for it. Only reaches people whose email is with Microsoft. | Yes |
| Forwarding | The member sets a rule in Gmail that forwards order emails to a private Relay address. No Google permission, so no Google review at all. Costs: Relay would need to be built to receive email; setting up a forwarding rule is fiddly and many people won't; Relay sees only what's forwarded, so nothing from before. | Yes |
| Pasting, photos, bank | Already in Relay: paste a receipt, photograph one, or connect a bank to find purchases. No email needed, but far less complete. | Yes |
| Reading email only on the phone | Google requires the assessment when restricted data is stored on or sent through a server. An app that read Gmail entirely on the phone would avoid it, but Relay couldn't read in the background, send reminders, or use AI help. Not realistic for Relay. | Yes, at the cost of most of the product |

A sensible order: buy the domain and move Relay now (needed whatever happens); apply to Google; keep Outlook and the
hundred Gmail places going meanwhile; consider forwarding only if Google refuses or the higher level's cost is too
much.

## What changed in Relay for this

- `about.html`: the public home page Google reads.
- `privacy.html`: "Information from your Google account".
- `worker/gmail.js`: the permission wording, version 6, says how AI helps and no longer says "never shares".
- `account.js`: Google's and Microsoft's marks on the sign-in buttons; the sign-in page's summary and the
  "agree again" messages match the new wording.

Not done, waiting on the domain: moving the app and the server to it (addresses in `account.js`, `index.html`,
`worker/*.js`; the settings `RELAY_APP_URL`, `RELAY_ALLOWED_ORIGINS` and `GOOGLE_REDIRECT_URI` already exist for this).

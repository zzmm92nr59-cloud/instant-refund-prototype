# Instant email: setting up Gmail's notices

Relay reads new receipts the moment Gmail or Outlook says a connected inbox has new mail (`worker/mail-push.js`),
instead of waiting for the 15-minute check. Outlook needs nothing new. Gmail sends its notices through Google Cloud
Pub/Sub, so Relay's Google Cloud project needs a topic for Gmail to post to and a subscription that passes each notice
on to Relay. It takes about 10 minutes, once. Nothing here is a password or key.

Until it's done, everything works as before: Gmail inboxes are read every 15 minutes.

## 1. Pick the right project

In the [Google Cloud console](https://console.cloud.google.com/), choose the project that holds Relay's Gmail sign-in
(the one whose Google Auth Platform / OAuth consent screen says Relay). Note its **project ID** (on the dashboard;
lower-case, for example `relay-app-123456`) and **project number**.

## 2. Turn on Pub/Sub

APIs & Services → Library → search **Cloud Pub/Sub API** → **Enable**.

## 3. Make the topic Gmail posts to

Pub/Sub → Topics → **Create topic**:

- Topic ID: `relay-gmail`
- Untick "Add a default subscription".
- Create.

Then open the topic → **Permissions** (the info panel) → **Add principal**:

- New principal: `gmail-api-push@system.gserviceaccount.com`
- Role: **Pub/Sub Publisher**
- Save.

Without this, Gmail accepts Relay's requests but never sends a notice.

## 4. Make the account the notices are signed for

IAM & Admin → Service accounts → **Create service account**:

- Name: `relay-gmail-push`. No roles are needed. Done.
- Note its email: `relay-gmail-push@<project ID>.iam.gserviceaccount.com`.

Open it → **Permissions** → **Grant access**:

- New principal: `service-<project number>@gcp-sa-pubsub.iam.gserviceaccount.com` (Pub/Sub's own account)
- Role: **Service Account Token Creator**
- Save.

This lets Pub/Sub sign each notice it sends to Relay, so Relay can tell a real one from a fake.

## 5. Make the subscription that passes notices to Relay

Pub/Sub → Subscriptions → **Create subscription**:

- Subscription ID: `relay-gmail-push`
- Topic: `relay-gmail`
- Delivery type: **Push**
- Endpoint URL: `https://relay-square-api2.9pts72cy5j.workers.dev/relay/webhooks/gmail`
- Tick **Enable authentication**. Service account: `relay-gmail-push@…` (step 4).
  Audience: `https://relay-square-api2.9pts72cy5j.workers.dev/relay/webhooks/gmail` (the same as the endpoint).
- Retry policy: **Retry after exponential backoff delay**.
- Leave the rest as it is. Create.

## 6. Tell Relay the two names

These two aren't secret: tell Claude them in the chat and it adds them to `worker/wrangler.toml`, or add them yourself
in Cloudflare → Workers & Pages → `relay-square-api2` → Settings → Variables and Secrets, as **Secret** (plain-text
variables set in the dashboard are wiped by the next automatic deploy):

| Name | Value |
| --- | --- |
| `GMAIL_PUSH_TOPIC` | `projects/<project ID>/topics/relay-gmail` |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | `relay-gmail-push@<project ID>.iam.gserviceaccount.com` |

## Checking it worked

- Within a minute, Relay asks Gmail to watch each connected inbox. Profile → Email connection then says new receipts
  "usually show up in Relay within a minute" instead of "every 15 minutes".
- Send yourself an order email (or buy something): it should appear in Receipts within a minute.
- Pub/Sub → Subscriptions → `relay-gmail-push` → Metrics shows notices delivered. Failed deliveries there usually mean
  the audience or service account in step 5 doesn't match step 6.

## Turning it off

`MAIL_PUSH = "off"` (a Cloudflare secret or a `wrangler.toml` variable) stops Gmail and Outlook notices both. The
15-minute check carries on either way.

## Limits worth knowing

- Google says notices usually arrive within a few seconds, but can occasionally be late or lost. The 15-minute check
  stays as a safety net. Gmail's search can take a few seconds to include a brand-new email, so Relay looks once more
  about 45 seconds after a notice.
- Gmail sends at most one notice a second per inbox. A watch lasts 7 days; Relay renews each one about once a day.
- Pub/Sub's first 10 GiB a month are free. Each notice counts as 1 KB, so that's roughly 10 million notices a month.
- Outlook subscriptions last just under 7 days; Relay renews them about once a day, and remakes one if Microsoft drops it.

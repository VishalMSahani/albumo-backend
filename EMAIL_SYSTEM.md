# Albumo email system

## Current configuration

The local `.env` separates senders by purpose. `mail.elbumo.in` in the request is treated as a typo for `mail.albumo.in`.

| Purpose                                                                       | Sender                 | Reply to                |
| ----------------------------------------------------------------------------- | ---------------------- | ----------------------- |
| Transactional: orders, billing, email OTP, password recovery and admin alerts | noreply@mail.albumo.in | None (Reply-To omitted) |
| Account creation and account updates                                          | account@mail.albumo.in | support@albumo.in       |
| Marketing: newsletter, campaigns and consented cart reminders                 | update@alert.albumo.in | hello@albumo.in         |

Admin notifications go to **vishal.sahani@albumo.in**. Low-stock emails are disabled in the producer, scheduler and delivery worker; old queued alerts are skipped. Existing sent records remain unchanged. Support ticket messages retain signed conversation reply addresses when receiving is enabled.

`USER_SIGNUP` selects the `ACCOUNT` channel automatically. Account-update producers should call `queueRawEmail` with `channel: "ACCOUNT"`; this configuration change does not introduce new account lifecycle triggers. OTP and password-reset events continue using the transactional sender. Each queued email stores its sender and reply address, so configuration changes apply to newly queued mail and retries keep the original provider payload. Admin campaign previews use the marketing sender and reply address without subscribing the admin.

The current Resend key is **sending-only**. Provider inspection returned 401 for both domain and webhook management. Sending-domain verification and real delivery have therefore not been verified by this implementation. No campaign or test message was sent to a real recipient during development.

The additive email database migration has been applied. Existing email records are retained. Website email is now stored in an outbox before a worker delivers it.

## What sends email

| Website event                                     | Customer                                                        | Admin                                          |
| ------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Order created / paid / cancelled / failed payment | Order update, when an email address exists                      | Notification to ADMIN_ALERT_EMAIL              |
| Order shipped / delivered                         | Delivery update, with available tracking details                | Available in delivery history                  |
| Support/contact enquiry                           | Ticket acknowledgement, public agent replies and status changes | New ticket and customer reply notifications    |
| Bulk quotation                                    | Existing quotation and request updates                          | New requests / existing bulk workflow events   |
| Career application                                | Acknowledgement                                                 | New application notice                         |
| Low inventory                                     | No                                                              | Disabled, including previously queued alerts   |
| Email verification / password reset               | Existing authentication flow                                    | Delivery metadata only; code content is hidden |
| Newsletter signup                                 | One welcome per fresh consent period when marketing is enabled  | Audience visible in admin                      |
| Campaign / cart reminder                          | Active newsletter subscribers only                              | Preview tests go only to the admin address     |

WhatsApp-first sign-in stays in place. A phone-only account has no deliverable email until one is added; placeholder addresses are skipped. The code connects existing backend order events; it does not add a new checkout or studio workflow.

## Use the admin

Open **Email & Campaigns** at `/emails`.

- **Delivery history:** filter by recipient, status or type, inspect plain-text messages and retry eligible unsent failures. Authentication content is hidden.
- **Support inbox:** inspect incoming messages, review unauthenticated senders, download attachments or open the linked Customer Support conversation. Reply from Customer Support; internal notes are never emailed.
- **Campaigns:** choose Photo story, Collection launch or Offer. Use starter text if wanted, then edit the subject, inbox preview text, introductory label, heading and message. Customize the Albumo CDN image and description, button label/HTTPS link, accent colour and text alignment. Offer layouts can display an existing coupon code; displaying it does not create a coupon. Save a draft, preview its Albumo layout, send an admin preview, then explicitly confirm a send to active subscribers. Contact/order records are never automatically added to this audience.
- **Setup:** inspect configuration, queue a test to the configured admin, or process a pending batch.
- **Contact & Newsletter:** manage explicit subscription consent and public contact details.

A campaign queues a snapshot for up to 5,000 subscribers. Delivery checks current subscription status, the consent timestamp, suppression and campaign cancellation again. Each message has a signed unsubscribe link and RFC 8058 one-click headers. GET displays confirmation; only POST changes consent. A later re-subscription does not reactivate an old campaign.

Campaign customization is stored in `EmailCampaign.design`. Migration `20261016000002_campaign_design` adds this JSON column with an empty default, so existing campaigns remain readable. Previews, admin test sends and subscriber sends share one HTML/text renderer. Blank image fields produce a text-only email. Images must use the configured Albumo CDN; buttons accept HTTPS links only. Customer content is escaped, and unsubscribe links cannot be removed from subscriber emails.

## Send a support email

Open **Customer Support** and select a ticket. The original **Send reply** box and **Internal note** option remain available. For an additional email, click **Send email** in **Email the customer separately**. The recipient is fixed to the ticket requester. Choose an enquiry acknowledgement, order, shipping, print quality, return/refund or custom-project starter and click **Insert template text**, or write your own message. Edit the subject and message before clicking **Send email to customer**. Messages include Albumo branding and the ticket link, and use the existing support reply routing.

Separate emails use an admin-only endpoint and are recorded in the email outbox and admin audit log. They do not add a public ticket reply, change the ticket status or update response deadlines. A success notice means queued; delivery status is available in **Email & Campaigns → Delivery history**. Repeating the same send request after a network failure does not queue duplicate emails. Switching tickets starts a fresh email composer to avoid sending another customer's draft. Existing ticket replies keep their normal behavior, and internal notes are never emailed.

Cancel stops remaining queued emails; an email already being sent may still arrive. Campaign COMPLETE means processing finished, including failed/skipped messages; use the status counts to assess delivery.

## Required Resend / DNS steps

1. Verify **mail.albumo.in** and **alert.albumo.in** as sending domains in Resend. Add the exact DKIM/SPF and other records shown in your Resend account. Ensure RESEND_API_KEY permits sending from both domains; a key restricted to the old domain must be replaced or updated. These new domains have not been verified by this implementation.
2. Enable receiving for **inbox.albumo.in** in Resend and add its provided receiving MX record.
3. **Keep the root albumo.in Zoho MX records.** Receiving on a subdomain avoids replacing the existing Zoho inboxes.
4. Create a backend-only Resend key with receiving/read access and save it in RESEND_RECEIVING_API_KEY. Keep the sending-only key in RESEND_API_KEY.
5. Create the HTTPS webhook **https://api.albumo.in/api/webhooks/resend**, or your actual deployed API origin. Subscribe to:
   - email.received
   - email.sent, email.delivered
   - email.bounced, email.complained, email.failed, email.suppressed
   - email.opened, email.clicked (optional; these require provider tracking to be enabled)
6. Set RESEND_WEBHOOK_SECRET to the webhook's `whsec_...` signing secret and redeploy/restart the backend. Never expose keys or webhook secrets in frontend variables.
7. After DNS and webhook verification, set EMAIL_INBOUND_ENABLED=true. Keep EMAIL_REPLY_TO empty and ACCOUNT_EMAIL_REPLY_TO set to support@albumo.in. Support ticket messages explicitly use signed per-ticket reply addresses, or SUPPORT_EMAIL when receiving is disabled; you do not create a mailbox for every ticket.
8. Create **support@albumo.in** and **hello@albumo.in** as monitored Zoho mailboxes or aliases. Forward support@albumo.in to **support@inbox.albumo.in** if general enquiries should appear in the admin support inbox. Forwarded messages with unverifiable authentication require manual inbox review. Marketing replies go to hello@albumo.in.
9. Queue **Send setup test to admin**, check Resend and Delivery history, then send a support test from an external mailbox to verify receipt and a round-trip ticket reply.

No separate receiving mailboxes are required for noreply@mail.albumo.in, account@mail.albumo.in or update@alert.albumo.in. Resend sends from these addresses after their domains are verified. Account and marketing replies use the monitored addresses above. Keep **inbox.albumo.in** for support receiving, separate from both sending domains.

Omitting Reply-To does not disable an email client's Reply button: it defaults to the From address. To reject mail addressed to noreply@mail.albumo.in, configure that recipient as rejected in the receiving provider and exclude it from catch-all/forwarding rules. This repository does not configure that provider-side rule. Previously queued messages retain their saved headers for safe retries.

References: [Resend receiving domains](https://resend.com/docs/dashboard/receiving/custom-domains), [sending domains](https://resend.com/docs/dashboard/domains/introduction), [webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests).

## Backend variables

| Variable                     | Purpose                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| RESEND_API_KEY               | Sending key; server only                                                   |
| EMAIL_FROM / EMAIL_FROM_NAME | noreply@mail.albumo.in / Albumo                                            |
| FROM_EMAIL                   | Legacy sender alias; keep equal to EMAIL_FROM                              |
| ADMIN_ALERT_EMAIL            | vishal.sahani@albumo.in                                                    |
| EMAIL_REPLY_TO               | Leave empty: no Reply-To header on automated transactional emails          |
| ACCOUNT_EMAIL_FROM           | account@mail.albumo.in                                                     |
| ACCOUNT_EMAIL_REPLY_TO       | support@albumo.in                                                          |
| SUPPORT_EMAIL                | Public customer support address                                            |
| MARKETING_EMAIL_FROM         | update@alert.albumo.in                                                     |
| MARKETING_EMAIL_REPLY_TO     | hello@albumo.in                                                            |
| EMAIL_SITE_URL               | Public storefront origin, currently https://albumo.in                      |
| EMAIL_ADMIN_URL              | Public admin origin, currently https://admin.albumo.in                     |
| EMAIL_API_URL                | Public API origin used for unsubscribe links and webhook display           |
| EMAIL_MARKETING_ENABLED      | true enables opted-in welcome emails, campaigns and cart reminders         |
| EMAIL_SIGNING_SECRET         | Random secret of at least 32 characters; generated privately in local .env |
| EMAIL_INBOUND_DOMAIN         | inbox.albumo.in                                                            |
| EMAIL_INBOUND_ENABLED        | false until receiving is verified                                          |
| RESEND_RECEIVING_API_KEY     | Key allowed to retrieve received messages and attachments                  |
| RESEND_WEBHOOK_SECRET        | Signature secret from your Resend webhook                                  |
| BULLMQ_PREFIX                | Albumo-specific queue/cron namespace; defaults to albumo                   |

Copy these values into your hosting environment. Confirm all three public URL variables match the actual deployment before sending; localhost URLs do not work in customer inboxes. Keep EMAIL_SIGNING_SECRET stable: changing it invalidates unsubscribe and ticket-reply links.

## Delivery and deployment

Run `npm run prisma:deploy`, `npm run build` and restart the backend. Deploy/restart admin after its build.

The long-running server starts BullMQ and the minute-based database outbox processor automatically. Redis accelerates event delivery; the database processor recovers messages if Redis is unavailable. In serverless deployments, invoke the existing protected **GET /api/internal/jobs** endpoint every minute with `Authorization: Bearer <CRON_SECRET>`; this job endpoint requires REDIS_URL and CRON_SECRET. Deploying a serverless function alone does not schedule a cron trigger.

The database lease prevents polling and BullMQ from sending the same row concurrently. Resend receives a stable idempotency key on retries. Uncertain outcomes older than 23 hours require review instead of an unsafe resend. OTP emails older than ten minutes are skipped. A minute batch sends up to 25 messages; campaigns are intentionally gradual. Provider rate limits/quota can cause retries or failures; monitor the log.

Signed raw-body webhooks update delivery status, suppress bounced/complained addresses and import support mail. Duplicate events and inbox messages are deduplicated in the database. Incoming HTML is reduced to text; unverified senders cannot automatically modify conversations. Individual attachment links are requested only by authenticated admins.

Authentication message bodies are redacted after delivery and never exposed through admin previews. Inbound/support content is personal customer data; keep admin access restricted. The existing email cleanup endpoint deletes old sent non-campaign records only when explicitly invoked; no new automatic deletion of support history is enabled.

## Verification

`npm run test:email` covers the transport and email workspace using mocked Resend and an in-memory database. No real email is sent by these tests. `npm run build` type-checks and builds the backend. Admin browser QA is available via `node scripts/check-admin-email.mjs` from backend and uses isolated fixture data.

Receiving remains pending until the DNS, receiving key and webhook steps above are completed. A configured sending key alone does not prove delivery or domain verification.

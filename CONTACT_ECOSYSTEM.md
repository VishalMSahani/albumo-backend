# Contact and newsletter ecosystem

## Routes and ownership

- Storefront `/contact`: guest or signed-in general enquiries.
- Storefront `/contact?intent=custom-project`: optional project area, budget, timeline, phone and organisation.
- Both create support conversations with a reference number. Admin `/support` filters by Support, Contact or Custom projects. Existing assignment, priority, internal notes, replies and customer tracking remain the source of truth.
- Storefront `/newsletter`: immediate signup with explicit consent and email-based preference management. No signup confirmation email is sent. Footer signup uses the same API.
- `/newsletter/confirm` and `/newsletter/unsubscribe`: explicit POST confirmation; visiting email links never changes consent.
- Admin `/contact`: public contact settings, subscriber counts, search, pagination, active-only CSV export, and unsubscribe. Admin cannot force a subscription active.

## Deploy

1. Apply `20261007000001_contact_ecosystem` using `prisma migrate deploy`; generate the Prisma client and deploy the backend before the frontends.
2. Set `FRONTEND_URL` to the canonical storefront origin. Links use this value; do not use a localhost URL in production.
3. Configure existing Resend or SMTP delivery. Set `SUPPORT_EMAIL` to a monitored inbox, or edit the public inbox in admin. New enquiry alerts use that inbox. The existing email workers handle support notifications; newsletter preferences mail is sent synchronously and reports provider failures.
4. Optionally initialize the contact settings with `node --env-file=.env --import tsx scripts/initialize-contact.mts support@example.com`. This never overwrites existing admin settings.
5. Set real phone, WhatsApp and availability values in admin. Empty channels stay hidden. WhatsApp must contain the country code and digits only; this opens a chat, not an automated WhatsApp integration.

## Consent and safeguards

Signup requires an unchecked consent box and activates immediately, without sending an email. New subscriptions do not claim email ownership verification (`confirmedAt` remains null). Pending and unsubscribed addresses are excluded from exports. Confirmation expires in 24 hours; tokens are random, stored as hashes and carried in URL fragments rather than query strings. The browser removes the fragment after reading it. Unsubscribe links are intentionally reusable and invalidate outstanding confirmations. A fresh signup with explicit consent reactivates an unsubscribed address. Existing pending records are not bulk-activated; they can subscribe again or use their previously issued confirmation link.

Address/IP throttles use the existing database-backed throttle store, shared across server instances. Requests also use honeypot fields and Zod validation. Subscriber lists/exports require an authenticated administrator, omit tokens, and use `no-store`. Settings changes, exports and admin unsubscribes are audited. CSV values are escaped against spreadsheet formula injection. Exports are bounded to 10,000 active rows.

Admin can pause new signup without blocking preference management. Contact permission is separate from newsletter consent. Support and order emails are unaffected by newsletter opt-out.

This feature manages newsletter acquisition and consent, not bulk campaign sending. Use a mailing platform that honours opt-outs before sending campaigns; exported snapshots must not become a permanent list that ignores later withdrawals. Do not upload pending or unsubscribed rows.

## Verification

`node --import tsx --test tests/contact.test.mjs` exercises validation, support routing, immediate signup without email, legacy token replay/expiry, delivery failure, acquisition pause, unsubscribe and export filtering using isolated database/email fixtures. No real emails are sent by these tests.

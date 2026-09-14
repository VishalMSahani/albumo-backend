# Authentication rollout

Status: implemented locally; production has NOT been deployed or migrated by this task.
WhatsApp sending remains disabled in the example configuration pending approval.
No real WhatsApp or email messages were sent during the isolated tests.

## What was wrong

- Live API reported environment "development"; its CSRF cookie did not have Secure.
- Storefront refresh requests omitted CSRF, so production renewal could fail with 403.
- Storefront proxy expected an API-host cookie on the storefront host, causing redirect loops.
- Client storage could claim a user was logged in without checking the API.
- Session/database/cookie lifetimes disagreed. Refresh rotation was not atomic.
- Access-token validation did not consult current session revocation or account state.
- Several logout buttons only cleared local state; admin stored bearer tokens in localStorage.
- OAuth state was not securely bound to the browser; callback URLs could be derived incorrectly.

## Customer experience

1. Enter an Indian mobile number and select Continue.
2. When WhatsApp is available, enter or paste the six-digit code. An existing verified or pending phone signs into its existing account; a pending phone becomes verified.
3. A verified new phone supplies full name, email, password and password confirmation.
4. When WhatsApp is unavailable or provider delivery fails, an existing verified or pending phone continues with its password;
   a new user can create an email/password account and the mobile remains pending for later verification.
5. A verified phone grants account access. Email must be verified separately for email recovery.
6. Settings supports entering/resending email verification codes, phone linking, and backup password.
7. Guest headers show Login / Sign up on mobile and desktop. Authenticated headers show the account menu.
8. Password login requiring email verification returns the email only after validating the password,
   so a user starting with mobile can continue to the email code step directly.

Existing email accounts are NOT automatically linked merely because someone knows their
email address. Sign in/recover the existing account first, then verify a number in Settings.
Unverified legacy email-only customers must verify email before password login. Admin
password access is retained; WhatsApp alone cannot authenticate an ADMIN/SUPER_ADMIN.

New backup passwords require 12–72 characters and at most 72 UTF-8 bytes; existing passwords
continue working. Long passphrases are preferable. An existing password is required to
change it. Adding a first password or linking a phone requires authentication within 10 minutes.

## Session and challenge rules

- Access JWT: 15 minutes; HS256, fixed issuer/audience/purpose, session ID required.
- Refresh: authenticated opaque value, hash stored in DB, rotates under a transaction lock.
- Absolute session duration: 15 days from login, NOT renewed by refreshing.
- Concurrent refresh requests have a 10-second previous-token grace period and receive
  the same current refresh value. Older replay revokes the session family.
- Every protected request checks the current database session, expiry, revocation,
  account activation and current role.
- Production/Vercel cookies: Secure, HttpOnly, SameSite=Lax, API-host only.
  Access path: "/". Refresh path: "/api/auth". No bearer tokens in response JSON or browser storage.
- CSRF is required in production, including refresh and logout. Both clients renew CSRF
  and serialize refresh requests. Login/signup/OTP mutations are not blindly retried.
- OTP: cryptographically random six digits, 5 minutes, 5 guesses, single use, keyed hash
  bound to a challenge ID. Phone verification and signup proofs are separate one-use steps.
- OTP sends: one per phone per minute, five/hour, ten/day; also 20/IP/hour.
  Verification: 60/IP/15 minutes. Limits live in PostgreSQL across API instances.
- Password login: 10/normalized identifier/15 minutes and 40/IP/15 minutes.
- Recovery links: one hour, hashed, atomic consumption, verified email only.
  Successful reset revokes all sessions. Password change revokes other sessions.
- Daily maintenance removes expired sessions, old challenges/throttles and reset links.
- Security-sensitive profile fields (email, phone, role, verification) cannot be changed
  through the general profile update route.

These controls reduce risk; they are not a guarantee against account compromise.
WhatsApp OTP is a single factor, not MFA. Protect business/admin and Meta accounts with MFA.

## Environment: backend only

Configure actual values in the deployment secret store, not in examples or frontend config:

~~~dotenv
NODE_ENV=production
FRONTEND_URL=https://www.roboroot.in
ADMIN_FRONTEND_URL=https://admin.roboroot.in
BACKEND_PUBLIC_URL=https://api.roboroot.in
CORS_ALLOWED_ORIGINS=https://roboroot.in,https://www.roboroot.in,https://admin.roboroot.in
CSRF_ENABLED=true
JWT_SECRET=<independent random secret of at least 32 characters>
JWT_REFRESH_SECRET=<different random secret of at least 32 characters>
AUTH_OTP_SECRET=<third independent random secret of at least 32 characters>

WHATSAPP_OTP_ENABLED=false
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_API_VERSION=v25.0
WHATSAPP_AUTH_TEMPLATE_NAME=
WHATSAPP_AUTH_TEMPLATE_LANGUAGE=en_US
~~~

Durations are enforced in code; legacy JWT_EXPIRES_IN/JWT_REFRESH_EXPIRES_IN do not override them.
Keep storefront/admin/API on same-site custom HTTPS domains. An arbitrary vercel.app
preview or localhost frontend against the live API is cross-site: these Lax cookies are
not intended for that topology. Use local frontend + local API, or same-site staging domains.

Set NEXT_PUBLIC_API_URL to the API origin on BOTH frontends and rebuild them. Keep all
WhatsApp tokens, signing secrets, and email-provider credentials out of admin-frontend/config/env.ts
and all NEXT_PUBLIC_* variables.

Do not set a Domain on new cookies. If an earlier deployment used COOKIE_DOMAIN,
retain that existing value during the transition solely to expire legacy shared cookies.
The new cookie helper never assigns that domain to new session cookies.

OAuth callbacks must match the provider console exactly:
BACKEND_PUBLIC_URL + /api/auth/google/callback or /api/auth/github/callback.
The signed state is cookie-bound, expires in 10 minutes, and only accepts local return paths.
Only verified provider email identities may link to an already verified email account.

## WhatsApp approval checklist

- [ ] Rotate the access token previously shared in chat/screenshots. Do not reuse it.
- [ ] Confirm the connected number's Phone Number ID and WABA belong to the same active account.
      The earlier screenshots showed different WABA IDs; do not copy old IDs blindly.
- [ ] Use a server-side system-user token with WhatsApp messaging access to that WABA.
- [ ] Create and approve an AUTHENTICATION template with a copy-code OTP button.
- [ ] Match the exact approved template name and language in environment variables.
      Sender passes the OTP once in body and once in URL button index 0.
- [ ] Set the template's displayed expiration to 5 minutes.
- [ ] Keep the verified HTTPS webhook and app secret configured for signed callbacks.
- [ ] Check Meta's current publishing/account restrictions for live messaging/webhook delivery.
- [ ] After approval/configuration, set WHATSAPP_OTP_ENABLED=true and redeploy the API.
- [ ] Test with an opted-in test recipient: delivered message, correct code, wrong code,
      expiry, resend, new signup, returning login and existing-account phone linking.

An API message ID means Meta accepted the request, not confirmed delivery.
The current webhook verifies signatures and acknowledges events; it is not an auto-reply
bot or delivery-status dashboard. Do not publish OTPs in logs or return them to clients.
General order/marketing WhatsApp notification templates are outside this authentication unit.

## Email reliability

Resend is the preferred transactional provider. Verify `mail.roboroot.in` in Resend, then
set the server-only `RESEND_API_KEY`, `EMAIL_FROM=noreply@mail.roboroot.in`, and
`EMAIL_FROM_NAME=RoboRoot`. SMTP remains an optional fallback when Resend is unset.
Authentication emails are persisted before delivery. With Redis, BullMQ delivers and the
minute scheduler recovers pending jobs; without Redis, the API attempts immediate delivery
and the scheduler retries pending authentication emails.

Email ownership uses a six-digit code that expires after 10 minutes and locks after five
incorrect attempts. Codes are HMAC-hashed with `AUTH_OTP_SECRET`; delivered authentication
email bodies and metadata are scrubbed from the outbox. Legacy verification links remain
accepted only for previously hashed high-entropy tokens during the migration window;
raw stored digests cannot be used as bearer links. All new verification requests send OTPs.

Verify actual inbox delivery (including spam) in staging before release. Tests use a mocked
provider and never contact a real recipient. Pending email jobs necessarily contain the code
until delivery, so restrict database and admin access.

## Deployment order

- [ ] Back up production database and verify the Resend domain, staging inbox delivery, and queue configuration.
- [ ] Set production environment variables and run "pnpm check:deploy".
- [ ] Apply "pnpm prisma:deploy" to staging, then run the acceptance checks below.
- [ ] Review and deploy the auth database migration before the new API code.
- [ ] Deploy API, storefront and admin together: auth responses are now cookie-only.
- [ ] Expect existing legacy JWT sessions and old verification links to require sign-in/resend.
      Do not bulk-mark legacy accounts verified.
- [ ] Confirm production API reports "production"; cookies have Secure/HttpOnly/no Domain.
- [ ] Check custom domains, CORS and OAuth redirect URIs; refresh/logout must include CSRF.
- [ ] Check scheduler runs and expires sessions/challenges as expected.
- [ ] Perform browser/mobile acceptance tests before considering production fixed.

Migration: prisma/migrations/20260910000001_secure_phone_auth/migration.sql.
It adds nullable phone verification fields, session metadata, challenges and throttles.
No customer/order data is deleted by the migration. Do not reset the database.

Email OTP/pending-phone identity migration:
prisma/migrations/20260913000002_email_otp_and_pending_phone_identity/migration.sql.

## Verification and remaining acceptance tests

Latest follow-up (2026-09-13): the screenshot's local connection failure was reproduced
with the storefront running on port 3000 and no API listening on port 4000. Restarting
the API restored `/api/auth/config` and `/health` (HTTP 200, localhost CORS allowed).
At inspection time, `https://api.roboroot.in/api/auth/config` returned 404: production
still needs the current migrations/API/frontend deployment; local changes alone do not update it.

The latest run passed 33 backend auth tests against a fresh isolated local PostgreSQL
database with all 28 migrations, 20 storefront auth/session tests, 2 email tests, 11
deployment/security tests, and backend/storefront production builds. No real email or
WhatsApp messages were sent by these tests. The HTTP test covers mobile signup, email
OTP, password login, persistence with only the refresh cookie, rotation without extending
the deadline, and expiry. Other tests verify CSRF, concurrent refresh, replay revocation,
logout, password recovery, disabled accounts, and OTP attempt limits.

Session restoration now retries on reconnect/visibility, checks active sessions every
five minutes, preserves login during transient failures, and prevents late responses from
overwriting login/logout. Cross-tab login no longer briefly clears the signed-in state.
Browser visual/OAuth-provider verification remains manual because no browser is connected.

Verified for the initial auth implementation: all 44 automated tests passed, all three production builds
(backend/storefront/admin) passed, and all 26 migrations applied to an isolated
PostgreSQL 16 + pgvector database. Both temporary test databases were removed
after verification; their fixtures are reproducible. Production was not changed.
Builds emitted non-blocking existing browser-mapping/OpenTelemetry warnings.

The mobile-first fallback follow-up passed all 25 backend auth integration tests and
all 13 storefront auth tests, plus both TypeScript checks and production builds.
It adds the phone-start endpoint and pending-phone migration; production was not deployed.

Automated coverage:

- Backend: node --test tests/auth.test.mjs (25 tests against isolated PostgreSQL).
- Storefront: pnpm test:auth (5 transport/redirect tests with a fake network adapter,
  plus 8 phone-flow tests for mobile branching, signup and password confirmation).
- Admin: pnpm test:api (5 cookie/CSRF/refresh/upload transport tests).
- Existing deployment tests: pnpm test:deploy.

Backend test safety: set AUTH_TEST_DATABASE_URL explicitly. Tests reject non-local hosts
and any DB name other than "roboroot_auth_test"; ambient DATABASE_URL is ignored.
Use a fresh disposable PostgreSQL 16 database with pgvector, run repository migrations,
build the backend, then run tests. Meta is mocked; email is queued only into that database.
Never point these tests at a real customer database.

Remaining manual checks (no connected browser was available for this task):

- [ ] Mobile layout, keyboard flow, OTP paste/autofill and password-manager autofill.
- [ ] Signup/verification/password recovery with actual delivered messages in staging.
- [ ] Refresh after access expiry, reload/reopen browser, two simultaneous tabs.
- [ ] Logout prevents access to profile/orders/settings and survives page reload.
- [ ] Return to checkout after login; no API-host cookie redirect loop.
- [ ] New/unverified legacy account, existing verified customer, and admin.
- [ ] Google/GitHub complete real OAuth round trips.
- [ ] No auth secrets in browser storage, API JSON, frontend bundles or telemetry.

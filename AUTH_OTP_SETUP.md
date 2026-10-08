# OTP authentication setup

RoboRoot supports WhatsApp OTP for phone-first login/signup and email OTP for email verification. Password login remains as recovery/backup. Admin accounts cannot use WhatsApp-only login.

## Implemented flow

- `POST /api/auth/phone/start` sends a six-digit WhatsApp authentication-template code when enabled.
- Codes expire after 5 minutes, allow 5 attempts, are stored only as HMAC digests, and are invalidated on resend or delivery failure.
- Existing verified/pending-phone users receive a session after successful OTP verification.
- New numbers receive a one-use, 10-minute registration proof; signup binds the verified phone and separately sends an email verification OTP.
- Email OTPs expire after 10 minutes and lock after 5 incorrect attempts.
- Requests are throttled per IP and phone in PostgreSQL, so limits work across instances.
- Sessions use HttpOnly cookies: 15-minute access and a 15-day absolute refresh session with rotation/replay protection.
- OTP delivery failure does not reveal whether a phone number already has an account.

## Meta setup

1. Rotate any access token that has appeared in a screenshot, log, chat, issue or source file.
2. In WhatsApp Manager, create an **Authentication** template using a **Copy code** OTP button. Enable the security recommendation and set the code expiry notice to **5 minutes** to match the backend.
3. Wait until the exact language variant is approved. Record its lowercase template name and exact locale, such as `en_US`.
4. Use a production system-user/permanent token with the least WhatsApp permissions required for sending. Do not use or commit a temporary dashboard token.
5. Put the registered sender's **Phone number ID** in the environment—not the display phone number or WABA ID.
6. Keep the existing webhook callback configured. The backend verifies the GET token and validates POST signatures with the Meta app secret.
7. Add payment/billing in Meta if required for business-initiated authentication messages in your account/market.

The send payload supplies the same code to the authentication template body and its button parameter. For Meta copy-code authentication templates, the send-time button subtype is `url` even though the template is created with an OTP/Copy Code button.

## Required backend environment

```env
AUTH_OTP_SECRET=<new independent random value, at least 32 characters>
WHATSAPP_OTP_ENABLED=true
WHATSAPP_ACCESS_TOKEN=<rotated production system-user token>
WHATSAPP_PHONE_NUMBER_ID=<numeric phone number ID>
WHATSAPP_API_VERSION=v25.0
WHATSAPP_AUTH_TEMPLATE_NAME=<approved lowercase template name>
WHATSAPP_AUTH_TEMPLATE_LANGUAGE=en_US
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<independent random webhook verification value>
WHATSAPP_APP_SECRET=<Meta app secret>
```

`JWT_SECRET` and `JWT_REFRESH_SECRET` must also be strong, distinct values. `AUTH_OTP_SECRET` must differ from both. Email verification additionally requires `RESEND_API_KEY` and a verified `EMAIL_FROM` sender (or the configured SMTP fallback).

Restart the backend after changing environment variables. `GET /api/auth/config` should then report `whatsappOtp: true`; it never returns credentials.

## Safe verification

- Run backend type checking and the auth test suite against the dedicated local database `roboroot_auth_test` using `AUTH_TEST_DATABASE_URL`. The test suite refuses remote databases and mocks both Meta and Resend.
- Test one new number, one existing customer, resend cooldown, wrong-code lockout, expiry, logout, refresh after browser restart, and email verification.
- Confirm secrets and OTP values are absent from logs and browser storage.

Do not test using a customer production account until the template is approved and the exposed token has been revoked.

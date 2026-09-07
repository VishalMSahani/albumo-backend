# Deploy the backend to a fresh Vercel account

Import `VishalMSahani/roboroot-backend` with root directory `./` and the **Express**
framework. Keep Fluid compute enabled. `vercel.json` already specifies:

```text
Install: pnpm install --frozen-lockfile --config.node-linker=hoisted
Build:   pnpm run build
```

Use Node.js 24.x. Leave Output Directory unset. The application exports Express
from `server.mjs`; packages remain external so Node can load their native modules,
CommonJS dependencies, and runtime assets correctly.

## Environment and migrations

Use `.env.production.example` as the checklist for the new Vercel project's
Production environment variables. The local `.env` is for development and is not
uploaded. Keep the actual database, Redis, Azure, SMTP, and gateway credentials in
Vercel, not in Git. Generate independent JWT and cron secrets of at least 32
characters. Use the real gateway webhook signing secrets from the providers.
The deployment checker rejects Razorpay test keys for production; use live keys
when accepting real payments. Test-mode credentials can still be used locally.

Set `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, and `BACKEND_PUBLIC_URL` to your permanent
HTTPS URLs with no trailing slash. For a standalone backend, do not append
`/_/backend`. Add exact frontend and admin origins to `CORS_ALLOWED_ORIGINS`.
Set `CSRF_ENABLED=true`; leave `COOKIE_DOMAIN` unset. Production auth and CSRF
cookies are Secure with SameSite=None for cross-origin frontends. Using subdomains
of the same site avoids browsers blocking third-party cookies.

Validate the prepared environment file without printing credential values:

```bash
pnpm run check:deploy .env.production
pnpm run build
pnpm run test:deploy
```

The check validates configuration, not whether credentials work. With the target
database selected through `DATABASE_URL`, check and apply pending migrations in
a controlled release step:

```bash
pnpm exec prisma migrate status
pnpm run prisma:deploy
```

`prisma:deploy` changes the target database. The build only generates the Prisma
client; it intentionally does not migrate production automatically. Never use
`prisma migrate dev` against production.

Register Google/GitHub callbacks as
`BACKEND_PUBLIC_URL/api/auth/google/callback` and
`BACKEND_PUBLIC_URL/api/auth/github/callback`. Omit the redirect environment
variables to derive these URLs automatically, or set exactly those values.
Configure payment webhooks at `/api/payments/webhook/razorpay` and/or
`/api/payments/webhook/zoho` on the backend domain.

## Background jobs on Vercel

The protected `GET /api/internal/jobs` endpoint runs due maintenance and drains
queue workers before returning. Redis prevents overlapping batches. Persistent
servers continue to run the existing cron schedules and workers.

The included `.github/workflows/backend-jobs.yml` calls this endpoint every five
minutes. In the **roboroot-backend GitHub repository**, enable Actions and set:

- Repository secret `BACKEND_PUBLIC_URL`: the deployed backend base URL.
- Repository secret `CRON_SECRET`: exactly the same value as Vercel's `CRON_SECRET`.

Merge/push the workflow to the default branch, then run **Process backend jobs**
manually once and confirm success. No database or Azure credentials are needed in
GitHub. The scheduled job endpoint is machine-authenticated with the cron secret;
it does not use browser cookies or a CSRF token.

GitHub schedules can be delayed, and private repositories have Actions minute
quotas. Any HTTPS scheduler can call the same endpoint with
`Authorization: Bearer <CRON_SECRET>`. Queued emails/retries wait until the next
successful invocation. Configure a scheduler before treating background work as
live. If Vercel Deployment Protection covers the production URL, configure its
automation bypass in your scheduler or make that production URL publicly reachable.

## Large uploads

Deploy the accompanying admin and storefront changes too. Bodies over 3 MB go
directly from the browser to a temporary private Azure blob. The API receives a
short signed ticket and streams the blob through the original file filters and
per-file size limits. Tickets are restricted to the issuing user, route, and a
20-minute expiry. Azure grants create-only access to one temporary blob.

Each request can contain up to 128 MB in total, preserving support for a 100 MB
model. Select fewer files if their combined size exceeds that limit. Individual
model, image, and PDF limits still apply. Ordinary smaller uploads keep the
existing multipart path. Private model downloads redirect to a short-lived Azure
URL so their bytes do not pass through Vercel's response limit.

Set `AZURE_PRIVATE_STORAGE_CONTAINER_NAME` to a private container. Configure Azure
Blob CORS for the exact storefront and admin origins. With the production variables
loaded into the terminal, review and apply the provided configuration:

```bash
pnpm run storage:cors
pnpm run storage:cors --apply
```

The first command previews the rule; the second updates Azure while preserving
existing rules. Allow PUT/OPTIONS with `content-type`, `x-ms-blob-type`, and
`x-ms-version`. Temporary blobs are deleted after parsing; scheduled cleanup removes
abandoned staged blobs older than one day. Production uploads fail explicitly if
Azure is unavailable instead of writing to ephemeral local storage.

## Final checks

- Set `NEXT_PUBLIC_API_URL` in both frontend Vercel projects to the new backend
  base URL and rebuild them. Set the admin's `NEXT_PUBLIC_APP_URL` to the storefront.
- Check `/` and `/health`; the latter checks database/Redis connectivity.
- Verify admin login, a product edit, and an image upload.
- Verify a model larger than 4.5 MB, then its preview and authenticated upload.
- Confirm the GitHub job run succeeds and a queued test email is delivered.

The repository includes local regression tests for bundle startup, CSRF, upload
limits, ticket isolation, and temporary blob cleanup. Live Azure CORS, migrations,
gateway delivery, and the new Vercel project still require the checks above.

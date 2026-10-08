# Bulk quotations

Storefront: `/bulk-order` and `/bulk-order/track`. Admin: `/bulk-orders` (Bulk Quotations sidebar).

Requests accept up to 100 editable items or a validated CSV import. Customer contact, delivery PIN/address, optional company/GSTIN, timing and consent are recorded. Target prices are preferences, never final prices. Submission keys prevent duplicate requests on retries.

Guests receive a reference and private access code. Codes are hashed in the request table, stored only in session storage in the browser, and sent in POST bodies rather than query strings. Recovery emails carry the replacement code in a URL fragment, removed by the tracking page. Signed-in request owners can also access their requests. Recovery rotates the previous code; responses do not reveal whether a reference/email exists. Treat access codes as credentials.

Admin prepares immutable, itemised INR quotations with unit prices, tax rates, inclusive shipping, expiry (within 90 days), lead time and terms. The server calculates integer-paise totals and rounds tax per line. Revisions use optimistic versions and PostgreSQL transaction locks; customers may only accept/decline the latest unexpired quote. Accepted quotes cannot be repriced. History, customer messages and private admin notes are retained separately.

Workflow: submitted → reviewing → quoted → customer accepted/declined. Accepted → in fulfilment → completed. Cancellation is allowed before completion. Declined quotes can be revised. Acceptance is **not payment, checkout, inventory reservation or a tax invoice**. Staff coordinate payment and fulfilment separately under the quotation terms.

## Deployment

Run `prisma generate` and `prisma migrate deploy` in backend, then deploy backend, storefront and admin together. Migration `20261008000001_bulk_quotations` is additive and retains existing requests. Legacy CSV URLs remain visible to staff, but new imports are parsed to editable rows and no longer uploaded as public attachments.

Existing route names remain. POST `/api/bulk-orders` now takes structured JSON (not the previous multipart upload). GET returns `{requests,total,pages,page}` inside `data`. PATCH `/:id/status` requires `expectedVersion`. New routes: `/import-csv`, `/recover`, `/:reference/track`, `/:reference/decision`, `/:reference/messages`, admin `/:id`, `/:id/quote`, `/:id/reply`. Deploy dependent clients together.

Set `FRONTEND_URL`, `ADMIN_FRONTEND_URL`, configured email provider credentials and the contact-settings email (or `SUPPORT_EMAIL`). Notifications are written to the DB outbox in the same transaction as the change. The `recoverBulkEmails` scheduled job runs every minute, feeding the existing BullMQ email worker with deterministic job IDs; without Redis it uses the existing delivery retry service. Keep the scheduler and worker enabled; serverless deployments must invoke the scheduled-job endpoint for this job. Do not run a separate all-events polling sender concurrently with BullMQ. Provider failures stay in the existing email notification logs for retry/inspection. No test sends live email.

## Verification

`node --import tsx --test tests/bulk-orders.test.mjs tests/contact.test.mjs`

Opt-in PostgreSQL integration: set `BULK_DATABASE_TEST=1`, then run `node --env-file=.env --import tsx --test tests/bulk-orders.integration.test.mjs`. It runs the service lifecycle in one explicitly rolled-back transaction; requests and outbox messages are never committed.

Run `tsc --noEmit` in all three applications. Browser QA can stub `/api/**` to exercise request, CSV import, tracking and admin publication without sending customer messages.

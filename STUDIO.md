# Albumo Studio backend

The existing API owns saved projects, catalogue configuration snapshots, private photo collection, guest invitations and versioned digital album designs. Studio uses the same account session and the existing Neon database.

## Run the flow

Start the storefront (3000), Studio (3001) and backend (4000). Start the media worker in a separate terminal from `backend`:

```powershell
npm.cmd run studio:worker
```

For a compiled deployment, use `npm.cmd run studio:worker:prod`. This is a persistent worker process, separate from the API/serverless runtime. Deploy it with the same database and private R2 credentials as the API. It processes one photo at a time, limits decoder concurrency/cache, and uses durable database leases so another worker can recover an interrupted job. The Node heap is bounded at 384 MB; allow additional native image-decoder memory in the container budget (start with 768 MB).

Without the worker, uploaded photos remain Processing and cannot unlock design. No Redis service is required for this queue.

On an album product, choose options and select **Design Now**. `/start` verifies the selection with the backend before saving a project. Only catalogue IDs/choices are accepted; price, counts and labels from the URL are never trusted. The selected size, cover, paper (where offered), pages, quantity and personal text are saved as a snapshot. Products without a paper choice explicitly leave it pending. Supplier/print approval remains pending for all digital drafts.

A 20-page album requires 24 selected READY photos; 26 is recommended. The rule is `ceil(pages * 1.2)` minimum and `ceil(pages * 1.3)` recommended. A five-second countdown opens design once the minimum is reached and owner uploads finish; **Keep collecting first** cancels the automatic transition.

## API

Owner paths below start at `/api/studio/projects`. Existing cookie authentication and CSRF protection apply. All IDs and cursors are owner scoped; there is no admin ownership bypass. Responses use `{ success, data }` and `Cache-Control: private, no-store`.

| Method/path | Purpose |
| --- | --- |
| POST `/configuration` | Validate `{ productId, choices, quantity, personalText }` against the active catalogue |
| POST `/` | Create `{ title, occasion, requestId, selection? }`; same owner/request/payload retries return the same project |
| GET `/` | Active/archived projects, bounded cursor pagination |
| GET `/:id` | Saved metadata and configuration snapshot |
| PATCH `/:id` | Rename, occasion, archive/restore with `baseRevision` |
| GET `/:id/photos?after=UUID` | 40 photo summaries/private previews, counts and design eligibility |
| POST `/:id/photos` | Reserve an upload and receive a signed PUT URL |
| POST `/:id/photos/:assetId/complete` | Idempotently enqueue processing |
| PATCH `/:id/photos/:assetId` | Set `{ selected }` for a READY photo |
| POST `/:id/invites` | Create a seven-day invitation; revoke previous links |
| POST `/:id/invites/close` | Revoke all invitations, including their guest sessions |
| GET `/:id/design` | Selected READY photos and saved digital document; requires minimum photos |
| PUT `/:id/design` | Save `{ baseRevision, document }` with ownership, photo-reference and exact page-count validation |

A metadata-only `/new` draft remains supported. Start from a product to create a configured album; old metadata drafts are not silently assigned a format.

Guest routes live under `/api/studio/guest`. They mount before cookie CSRF middleware because they accept only scoped capabilities, never account cookies. `/exchange` validates `{ inviteId, token, displayName }` and issues a twelve-hour upload-only bearer capability. Subsequent calls require `Authorization: StudioGuest <token>` and use `credentials: omit`:

- POST `/uploads`: reserve an upload.
- POST `/uploads/:id/complete`: submit one of this guest session's own uploads.
- GET `/uploads`: only this session's filenames and processing status; no download links or other users' photos.

The invitation secret is a URL fragment, removed from the visible address before entering the upload page. Secrets are hashed in the database, never stored in browser persistence or sent to a third-party QR generator. Guest pages do not bootstrap cookie sessions. Tokens remain in memory: reload requires rescanning the active QR. Rotating/closing an invitation invalidates current guest sessions. Existing signed PUT URLs expire naturally and grant access only to their reserved staging object; completion after revocation is denied.

Owners poll every four seconds while the tab is visible. Photo metadata is paginated, and previews are private signed URLs valid for ten minutes. No customer photo is routed through Next's public image optimizer.

## Upload processing and limits

Each upload declares UUID requestId, filename, byteSize and JPEG/PNG/WebP MIME type. Files travel directly from the browser to the private R2 staging prefix. Signed URLs bind size and overwrite prevention. Matching retries reuse the same reservation; reuse with different metadata is rejected.

Limits: 15 MiB/file, 40 megapixels decoded, 500 active photos or 1 GiB reserved per album, 100 contributors per invitation and 100 lifetime uploads per guest session. A project row lock serializes concurrent reservations. Expired upload reservations are marked failed by the worker; the existing `staging/` bucket lifecycle removes abandoned bodies after one day.

The worker checks stored length, pins the ETag, bounds stream bytes/time, validates decoded format, rejects animated/multi-page inputs, applies orientation, strips EXIF/GPS from WebP previews, and keeps the original in immutable private storage. READY is published only after original and preview writes succeed. Three failed attempts produce a visible retry state. No customer images or signed URLs are logged.

HEIC is deliberately rejected with an export-to-JPEG instruction until a verified HEIC decoder is deployed. Duplicate uploaded photographs are not currently deduplicated; each successful reservation counts as one selected photo.

R2 signatures use the SDK's corrected service-clock offset. This fixes immediately expired links on development machines with clock skew; host time should still be synchronized for application/database timestamps.

## Digital editor contract

Document v1 stores template (`everyday`, `travel`, `celebration`), cover title/photo, an exact ordered page array, one/two-photo layouts, captions and normalized crop focal positions. References must resolve to selected READY assets in the same project. Opening a new design creates a deterministic layout using the available photos; it is not an AI layout.

The UI supports template changes, photo replacement, captions, focal crop, page reordering, bounded undo/redo, autosave and page-by-page preview. Saving uses a project revision check. An exact replay after a lost response returns the saved revision; a different stale change returns 409 and preserves local edits until the user explicitly loads the saved version. No payment, production proof or print-ready claim is made.

## Migrations and deployment

- `20261022150000_studio_projects`: saved-project table (already deployed to the existing Neon database).
- `20261023010000_studio_collection`: additive configuration/document fields and StudioAsset, StudioInvite, StudioGuestSession tables. Applied to the same Neon database on 23 October 2026 after isolated tests. Read-only verification confirmed all four Studio tables and no pending/unresolved migrations. No existing customer rows were rewritten and no test customer rows were inserted.

Review pending migrations before `prisma migrate deploy`: it deploys all pending migrations. Use `node --env-file=.env --import tsx scripts/check-studio-readiness.mts` for a read-only history/catalogue/storage check. Keep exact Studio origins in backend CORS and private R2 CORS. Guest QR links must use a reachable HTTPS Studio origin; localhost links do not work from another person's phone. Deploy the API, Studio and worker together after migration.

Retention/deletion workflows, HEIC, AI assistance, approved print specs, immutable proof export, cart/payment and production handoff remain later roadmap gates. Archive preserves photos and drafts; it is not deletion.

## Verification

`npm.cmd run test:studio` uses a disposable local PostgreSQL 18 cluster, actual migrations/Prisma/routes/CSRF, fixture auth/storage and real Sharp decoding. `PG_BIN` can select PostgreSQL binaries. It never loads the configured database. Tests cover configuration tampering, 24/26 counts, ownership, guest capability revocation/expiry, retry identity, real media processing, image limits, design/photo integrity, concurrent reservations and revision conflicts.

`npm.cmd run test:storage` covers storage isolation and signed URL contracts, including clock skew. `node --env-file=.env --import tsx scripts/verify-studio-storage.mts` uses synthetic pixels under a unique temporary staging prefix, verifies actual R2 CORS/signed PUT/overwrite rejection/preview GET, then removes only its test objects. It writes no database rows.

Studio's `npm.cmd run test:browser` runs fixture APIs and headless Chrome to test configuration handoff, upload transport, QR page isolation, automatic owner refresh, minimum-count redirect, templates, autosave, undo/redo, reload, preview and 320/390/768/1440px layouts.

## Admin integration (24 October 2026)

Admin **Studio Albums** (`/studio`) manages customer albums through `/api/admin/studio` on the existing backend. The existing ADMIN/SUPER_ADMIN session and CSRF checks apply. Owner and QR guest endpoints retain their original scope; an admin cannot impersonate an owner through the owner API.

- Search by album title/UUID or customer name/email; filter active/archived albums and review state. Lists are bounded and paginated.
- Inspect configuration, upload counts, contributors, failed uploads, and private previews. Original downloads require an internal reason, generate ten-minute signed links, and record an activity entry. No originals are copied to the public CDN.
- View the saved cover/pages/captions and crop positions. This is a digital composition preview, not a print proof.
- Record unreviewed, in-review, changes-requested, or reviewed states. A completed review requires a configured, saved design with ready selected photos and a populated cover and every page.
- Close QR invitations, archive/restore albums, and include/exclude ready photos. Photos used by a saved design cannot be excluded by admin. Archive revokes invitations while retaining the album and all photos. Failed uploads must be uploaded again because the worker removes their invalid staging bodies.
- All changes require the current project revision and an internal reason. Customer design/metadata/photo-selection edits invalidate the prior review. The activity tab records admin actions and original-link issuance; it sends no customer messages.
- Attach a reviewed revision to an existing open order item belonging to the same customer, product and quantity. The attachment freezes the title, configuration and document. Order and project row locks plus a unique order-item constraint prevent races and replacements. Replaying the same attachment returns the same link. Existing payment and shipping status are unchanged.
- Orders show a link back to the album; album attachments open the exact order and allow viewing the saved version. Attachments are immutable internal references marked `printApproved: false`. They do not approve production. The customer checkout integration below now handles cart and payment; print specifications, final proof approval and production exports remain pending.

The additive `20261023180000_studio_admin` migration was applied to the existing Neon database on 24 October. It adds review fields, `StudioActivity`, and `StudioOrderLink`; existing customer rows were not rewritten. Read-only verification confirmed both tables and all four review fields.

Admin verification: `npm.cmd run test:studio` from `admin-frontend` runs a fixture API and headless Chrome/Edge on ports 3110/4110, including 1440/390/320px layouts and operational controls. It creates no live orders or customer records. The backend `test:studio` suite now contains 18 isolated PostgreSQL tests, including admin authorization, CSRF, foreign-photo access, review conflicts, archive revocation, immutable order snapshots, and attachment replay.

Final verification on 24 October: all 18 isolated Studio/admin tests, six admin API tests, responsive browser workflow, touched-file lint, and backend/admin production builds passed. The guarded admin build peaked at 716 MiB with at least 2928 MiB free RAM. The running API rejected unauthenticated admin and owner requests with 401.


## Customer cart and checkout (24 October 2026)

Studio's saved **Preview book** now offers **Add to cart** once every photo slot is filled and autosave has completed. It posts the current revision to `/api/checkout/albums/:projectId`, then navigates to the configured storefront `/cart`. The main site provides cart, delivery/coupon checkout, `/orders/:id`, and the hosted-payment return `/checkout/success`.

`StudioCartItem` keeps an immutable digital design snapshot per project; separate albums using the same product remain separate lines. Re-adding a newer revision replaces only that project's cart version. Later edits never silently change an order. Cart quantities, removal and preview reads are owner-scoped. Customer images stay in private storage with short-lived signed previews.

Checkout computes current catalogue sale prices plus selected option charges, delivery and coupon discounts on the server. It requires the reviewed quote hash, delivery address, digital-design acceptance and the existing legal policy version. A cart lock, conditional stock reservation, coupon lock and `CheckoutAttempt` request identity prevent double ordering, overselling and coupon-limit races. Lost-response recovery uses `/api/checkout/attempts/:requestId`. Only consumed cart items are removed, in the same transaction as order creation.

Each album creates an existing `OrderItem` and `StudioOrderLink`, so admin Orders and Studio Albums can inspect the exact purchased version. Checkout address copies cannot be edited through the address book. Attachments record customer digital-design acceptance and `printApproved: false`; this is not supplier or print-proof approval.

Orders use the existing Zoho hosted-payment adapter. A failed initiation can be retried on the same order. The storefront never treats a success URL as payment confirmation. Signed callbacks must match the stored session and amount; duplicate callbacks cannot regress fulfilment status. Late payment after cancellation goes to refund review. The customer manual-payment-confirmation shortcut and public TEST-gateway orders are rejected. Expired gateway sessions retain their references for later reconciliation.

The additive `20261024010000_studio_checkout` migration was applied to the same Neon database after isolated verification. It adds only `StudioCartItem` and `CheckoutAttempt` with their indexes/constraints.

Verification commands: backend `npm.cmd run test:checkout` (disposable local PostgreSQL; optional `CHECKOUT_TEST_DATABASE_URL` must name a dedicated local `albumo_checkout_test...` database); storefront `npm.cmd run test:checkout` (local fixture API/headless browser, no live orders/payment); Studio `npm.cmd run test:browser`. Nine checkout database tests cover permissions, snapshots, prices, stock/coupon concurrency, recovery and signed payment outcomes. A real provider transaction and the print supplier/proof pipeline are separate launch checks.

Final checkout verification: all nine isolated database tests and storefront browser checks passed, including 320/390/1440px cart layouts and lost-response recovery. The full Studio browser suite passed with an intercepted Add-to-cart navigation and saved-revision assertion. Backend, storefront and Studio production builds passed; Studio used the documented public origins for its build. Guarded storefront/Studio builds peaked at 1027/842 MiB, with minimum free RAM of 2427/2573 MiB. The live configured database contains both new tables and the completed migration; unauthenticated checkout API reads return 401 with private/no-store headers. No real payment was charged during these checks.


## Trash and shelf state (24 October 2026)

Migration `20261024180000_studio_trash` adds nullable `trashedAt` and `deletedAt`; it does not reclassify archived albums. `POST /api/studio/projects/:id/lifecycle` accepts `{baseRevision, action: "trash" | "restore" | "delete"}` with existing owner authentication and CSRF. `GET /api/studio/projects?trash=true` returns the retained Trash shelf and deletion deadlines. Album DTOs include design readiness, private cover preview, cart presence/version status and latest order state.

Trash serializes on cart then project, removes cart items and revokes invitations. Restore is allowed only before 15 days, never re-enables invitations/cart items, and permanent deletion requires Trash first. Expired albums are inaccessible before storage cleanup. The media worker claims no new work for trashed/deleted projects and cleanup waits for active leases, tracks output keys before object writes and retries failed object deletion. Unordered projects, assets, guest sessions and activity rows are removed after private objects are deleted. Order-linked projects/assets remain for immutable order previews and fulfilment; owner-facing access is removed. Admin active lists exclude Trash/deleted projects, with explicit labels under All albums. No order is cancelled by these actions.

Production must keep the media worker running; the API alone does not delete storage. Staging upload URLs already issued can remain usable until their short expiry, but cannot be completed into a trashed album; the existing staging bucket lifecycle removes abandoned objects.


## Draft continuation, copy and recovery

- `GET /api/studio/projects/formats`: active supported catalogue albums with option groups.
- `POST /api/studio/projects/:id/configure`: `{baseRevision, selection}` attaches a validated format only to an unconfigured owned draft; matching successful retries replay safely.
- `POST /api/studio/projects/:id/copy`: `{requestId, baseRevision, mode: "duplicate" | "reorder"}` creates an owned draft with independently mapped photo IDs. Reorder reads the frozen latest order snapshot, never the edited source document. No cart, order, review approval or guest capability is inherited.
- Ready immutable originals/previews may have several StudioAsset references. Copy and Trash purge share a PostgreSQL transaction advisory lock. Purge checks all remaining project references, including retained orders, before deleting objects; failed storage deletes retain rows for retry. Deploy the API and media worker together. Do not run the older cleanup worker after enabling copies.
- Owner and admin photo exclusion use the same saved-document/minimum guard while holding the project row lock.
- Upload request IDs survive recovery. An expired reservation renews its existing asset with a fresh staging key after quota checks. Old staged bodies expire through the existing bucket lifecycle. Processing/ready uploads replay without a new asset or body transfer.
- The browser's local recovery queue retains at most 100 files / 200 MB, scoped to account/project or a hash of an upload-only guest credential. It removes successful/discarded entries and prunes expired 24-hour entries on opening. Guest credentials live only in sessionStorage for tab reload recovery, never IndexedDB or URLs. Server expiry and revocation still apply to every request.


## Admin print and storage controls (26 October 2026)

Migration `20261026010000_studio_operations` is additive and has been deployed to the existing approved database. It adds revisioned operation settings/audit, customer proofs, order-print approvals and cleanup diagnostics. It does not enable retention or confirm a supplier profile.

- `GET /api/studio/projects/public-settings?productId=...` exposes only the effective approved print profile and public retention rule. Product pages use this response. Authenticated `GET /:id/quality` computes physical slot DPI and duplicate warnings; `POST /:id/proof` accepts `{baseRevision,reportHash,accepted:true}` and rejects stale or failing checks.
- Admin Studio `/operations`, `/operations/settings`, `/operations/formats` and `/operations/retention-preview?days=...` expose controls and monitoring. `POST /operations/settings` uses `{baseRevision,policy,confirmRetention}`; the database serializes first creation and subsequent changes. A policy contains default/product `profiles`, `retentionEnabled`, nullable `retentionDays`, and `alertMinutes`. Confirmed profiles require a supplier, target/minimum DPI and millimetre bleed/safe margins. Retention is disabled by default and requires explicit Admin acknowledgement when enabled.
- Admin `POST /:id/orders/:linkId/print-approval` requires current `reportHash`, a reason and `supplierProofChecked:true`. Only paid orders awaiting shipment qualify. Approval is tied to the immutable order document and current effective supplier settings. Admin fulfilment transitions validate this approval before production/shipment; completed shipping events are not retroactively blocked by a later policy change. Manual delivery records its timestamp.
- Customer proof hashes include the used photos' dimensions/content identities, document, configuration and layout geometry. Checkout checks current approved settings and allows renewed approval to replace the same cart entry without duplicating it. Unconfigured profiles retain the digital checkout flow, but production approval remains unavailable.
- Layout v2 fixes photo frames at 6% page margins, a 62%-height cover photo, and a 74%-height captioned page photo. Two-photo frames share the available width with a 5% gap. Studio, saved storefront previews and Admin previews use these same proportions. This is a digital preview and validation layer; print-ready PDF generation and supplier integration are not implemented here.
- Retention applies only to deleted, delivered, order-linked albums after the configured number of days from both deletion and latest delivery. Open support cases and active photo leases prevent cleanup. Every order snapshot protects its photo IDs; shared originals/previews are deleted only after the last reference disappears. Storage failure retains rows for automatic retry. Existing 15-day Trash expiry is unchanged.
- Worker heartbeat and per-album cleanup counters/errors feed the Admin monitor, which polls while visible. Alerts stay inside Admin. Keep `npm run studio:worker:prod` running continuously and deploy it with the API after migration. API-only deployments cannot process uploads or perform cleanup. Do not run an older cleanup worker with the new API.

Settings can be edited without redeploying; customers see them on the next product/preview fetch. Tests use disposable PostgreSQL, synthetic photos and mocked payments. No live customer file was deleted or payment submitted.

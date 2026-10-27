import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../../middlewares/validate.middleware.js';
import { StudioProjectError } from './error.js';
import { createInvite, closeInvites, exchangeInvite, exchangeSchema, guestActor, guestProgress, prepareUpload, completeUpload, uploadSchema, assetSummary, selectAsset } from './collection.js';
import { getDesign, saveDesign, saveDesignSchema } from './design.js';
const params = z.object({ id: z.uuid() });
const assetParams = params.extend({ assetId: z.uuid() });
export function studioError(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof StudioProjectError) res.status(error.status).json({ success: false, code: error.code, error: error.message });
  else res.status(503).json({ success: false, code: 'STUDIO_UNAVAILABLE', error: 'Album storage is temporarily unavailable. Please try again shortly.' });
}
export const ownerCollectionRoutes = Router();
ownerCollectionRoutes.post('/:id/invites', validate({ params }), async (req, res) => res.json({ success: true, data: await createInvite(params.parse(req.params).id, req.user!.userId) }));
ownerCollectionRoutes.post('/:id/invites/close', validate({ params }), async (req, res) => res.json({ success: true, data: await closeInvites(params.parse(req.params).id, req.user!.userId) }));
ownerCollectionRoutes.get('/:id/photos', validate({ params, query: z.object({ after: z.uuid().optional() }) }), async (req, res) => res.json({ success: true, data: await assetSummary(params.parse(req.params).id, req.user!.userId, req.query.after as string | undefined) }));
ownerCollectionRoutes.post('/:id/photos', validate({ params, body: uploadSchema }), async (req, res) => res.json({ success: true, data: await prepareUpload(params.parse(req.params).id, { ownerId: req.user!.userId }, req.body) }));
ownerCollectionRoutes.post('/:id/photos/:assetId/complete', validate({ params: assetParams }), async (req, res) => {
  const { id, assetId } = assetParams.parse(req.params);
  res.json({ success: true, data: await completeUpload(id, assetId, { ownerId: req.user!.userId }) });
});
ownerCollectionRoutes.patch('/:id/photos/:assetId', validate({ params: assetParams, body: z.object({ selected: z.boolean() }).strict() }), async (req, res) => {
  const { id, assetId } = assetParams.parse(req.params);
  res.json({ success: true, data: await selectAsset(id, assetId, req.user!.userId, req.body.selected) });
});
ownerCollectionRoutes.get('/:id/design', validate({ params }), async (req, res) => res.json({ success: true, data: await getDesign(params.parse(req.params).id, req.user!.userId) }));
ownerCollectionRoutes.put('/:id/design', validate({ params, body: saveDesignSchema }), async (req, res) => res.json({ success: true, data: await saveDesign(params.parse(req.params).id, req.user!.userId, req.body) }));

// Capability-only routes: no cookie authentication and no access to owner APIs.
export const guestCollectionRoutes = Router();
guestCollectionRoutes.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
guestCollectionRoutes.use(rateLimit({ windowMs: 15 * 60_000, limit: 500, standardHeaders: 'draft-8', legacyHeaders: false }));
guestCollectionRoutes.post('/exchange', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }), validate({ body: exchangeSchema }), async (req, res) => res.json({ success: true, data: await exchangeInvite(exchangeSchema.parse(req.body)) }));
guestCollectionRoutes.use(async (req, res, next) => {
  const token = /^StudioGuest ([a-f0-9]{64})$/.exec(req.get('Authorization') || '')?.[1];
  if (!token) throw new StudioProjectError(401, 'GUEST_REQUIRED', 'Scan the album QR to start an upload session.');
  res.locals.guest = await guestActor(token); next();
});
guestCollectionRoutes.get('/uploads', async (_req, res) => { const { projectId, actor } = res.locals.guest; res.json({ success: true, data: await guestProgress(projectId, actor) }); });
guestCollectionRoutes.post('/uploads', validate({ body: uploadSchema }), async (req, res) => { const { projectId, actor } = res.locals.guest; res.json({ success: true, data: await prepareUpload(projectId, actor, req.body) }); });
guestCollectionRoutes.post('/uploads/:id/complete', validate({ params }), async (req, res) => { const { projectId, actor } = res.locals.guest; res.json({ success: true, data: await completeUpload(projectId, params.parse(req.params).id, actor) }); });
guestCollectionRoutes.use(studioError);

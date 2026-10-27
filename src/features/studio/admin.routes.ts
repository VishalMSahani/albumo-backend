import { operationSettings, saveOperationSettings, policyInput } from './operation-settings.js';
import { operationMonitor, previewRetention } from './maintenance.js';
import { approveOrderPrint } from './print-quality.js';
import { listStudioFormats } from './configuration.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { AuthError } from '../../utils/types.js';
import { z } from 'zod';
import { authenticate, authorize } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { studioError } from './collection.routes.js';
import * as studio from './admin.service.js';

const router = Router();
const params = z.object({ id: z.uuid() });
const assetParams = params.extend({ assetId: z.uuid() });
const note = z.string().trim().min(3).max(1000);
const revision = { baseRevision: z.number().int().min(1), note };
const action = z.discriminatedUnion('action', [
  z.object({ ...revision, action: z.literal('archive'), archived: z.boolean() }).strict(),
  z.object({ ...revision, action: z.literal('close-invites') }).strict(),
  z.object({ ...revision, action: z.literal('review'), status: studio.reviewStatus }).strict(),
  z.object({ ...revision, action: z.literal('select-photo'), assetId: z.uuid(), selected: z.boolean() }).strict(),
]);
const link = z.object({ ...revision, orderItemId: z.string().min(1).max(100) }).strict();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
router.use(authenticate, authorize('ADMIN'));
router.get('/operations',async(_req,res)=>res.json({success:true,data:await operationMonitor()}));
router.get('/operations/formats',async(_req,res)=>res.json({success:true,data:await listStudioFormats()}));
router.get('/operations/settings',async(_req,res)=>res.json({success:true,data:await operationSettings()}));
router.post('/operations/settings',validate({body:policyInput}),async(req,res)=>res.json({success:true,data:await saveOperationSettings(req.user!.userId,policyInput.parse(req.body))}));
router.get('/operations/retention-preview',validate({query:z.object({days:z.coerce.number().int().min(1).max(3650).optional()}).strict()}),async(req,res)=>res.json({success:true,data:await previewRetention(req.query.days ? Number(req.query.days) : undefined)}));
router.post('/:id/orders/:linkId/print-approval',validate({params:params.extend({linkId:z.uuid()}),body:z.object({reportHash:z.string().regex(/^[a-f0-9]{64}$/),note,supplierProofChecked:z.literal(true)}).strict()}),async(req,res)=>res.json({success:true,data:await approveOrderPrint(params.parse(req.params).id,String(req.params.linkId),req.user!.userId,req.body)}));

router.get('/', validate({ query: studio.listSchema }), async (req, res) => res.json({ success: true, data: await studio.listAlbums(studio.listSchema.parse(req.query)) }));
router.get('/:id', validate({ params }), async (req, res) => res.json({ success: true, data: await studio.albumDetail(params.parse(req.params).id) }));
router.get('/:id/photos', validate({ params, query: studio.cursorSchema }), async (req, res) => res.json({ success: true, data: await studio.albumPhotos(params.parse(req.params).id, studio.cursorSchema.parse(req.query).after) }));
router.get('/:id/design', validate({ params }), async (req, res) => res.json({ success: true, data: await studio.albumDesign(params.parse(req.params).id) }));
router.get('/:id/activity', validate({ params, query: studio.cursorSchema }), async (req, res) => res.json({ success: true, data: await studio.albumActivity(params.parse(req.params).id, studio.cursorSchema.parse(req.query).after) }));
router.get('/:id/orders/:linkId', validate({ params: params.extend({ linkId: z.uuid() }) }), async (req, res) => res.json({ success: true, data: await studio.orderSnapshot(params.parse(req.params).id, String(req.params.linkId)) }));
router.get('/:id/orders', validate({ params }), async (req, res) => res.json({ success: true, data: await studio.matchingOrders(params.parse(req.params).id) }));
router.post('/:id/actions', validate({ params, body: action }), async (req, res) => res.json({ success: true, data: await studio.albumAction(params.parse(req.params).id, req.user!.userId, action.parse(req.body)) }));
router.post('/:id/orders', validate({ params, body: link }), async (req, res) => res.json({ success: true, data: await studio.linkOrder(params.parse(req.params).id, req.user!.userId, link.parse(req.body)) }));
router.post('/:id/photos/:assetId/download', validate({ params: assetParams, body: z.object({ note }).strict() }), async (req, res) => {
  const { id, assetId } = assetParams.parse(req.params);
  res.json({ success: true, data: await studio.downloadOriginal(id, assetId, req.user!.userId, req.body.note) });
});
router.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof AuthError) res.status(error.statusCode).json({ success: false, code: error.code, error: error.message });
  else studioError(error, req, res, next);
});
export default router;

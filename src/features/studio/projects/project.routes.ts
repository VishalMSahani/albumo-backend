import { publicStudioSettings } from '../operation-settings.js';
import { z } from 'zod';
import { projectQuality, acceptProjectProof, acceptProofSchema } from '../print-quality.js';
import { changeAlbumLifecycle } from "../trash.js";
import {
  configureProjectSchema,
  copyProjectSchema,
  lifecycleSchema,
} from "./project.schema.js";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import rateLimit from "express-rate-limit";
import { ownerCollectionRoutes } from "../collection.routes.js";
import {
  listStudioFormats,
  selectionSchema,
  validateSelection,
} from "../configuration.js";
import { authenticate } from "../../../middlewares/auth.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  createStudioProjectSchema,
  updateStudioProjectSchema,
  listStudioProjectsSchema,
  studioProjectParams,
} from "./project.schema.js";
import {
  configureStudioProject,
  copyStudioProject,
  createStudioProject,
  getStudioProject,
  listStudioProjects,
  updateStudioProject,
  StudioProjectError,
} from "./project.service.js";

const router: Router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
router.get('/public-settings', validate({ query: z.object({ productId: z.string().max(100).optional() }).strict() }), async (req,res) => res.json({success:true,data:await publicStudioSettings(typeof req.query.productId === 'string' ? req.query.productId : undefined)}));
router.use(authenticate);
router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1200,
    keyGenerator: (req) => req.user!.userId,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      code: "RATE_LIMITED",
      error: "Please wait a moment before trying again.",
    },
  }),
);
router.get(
  "/",
  validate({ query: listStudioProjectsSchema }),
  async (req, res) => {
    res.json({
      success: true,
      data: await listStudioProjects(
        req.user!.userId,
        listStudioProjectsSchema.parse(req.query),
      ),
    });
  },
);
router.post(
  "/configuration",
  validate({ body: selectionSchema }),
  async (req, res) =>
    res.json({
      success: true,
      data: await validateSelection(selectionSchema.parse(req.body)),
    }),
);
router.get("/formats", async (_req, res) => {
  res.json({ success: true, data: await listStudioFormats() });
});
router.post(
  "/:id/configure",
  validate({ params: studioProjectParams, body: configureProjectSchema }),
  async (req, res) => {
    res.json({
      success: true,
      data: await configureStudioProject(
        req.user!.userId,
        studioProjectParams.parse(req.params).id,
        configureProjectSchema.parse(req.body),
      ),
    });
  },
);
router.post(
  "/:id/copy",
  validate({ params: studioProjectParams, body: copyProjectSchema }),
  async (req, res) => {
    res
      .status(201)
      .json({
        success: true,
        data: await copyStudioProject(
          req.user!.userId,
          studioProjectParams.parse(req.params).id,
          copyProjectSchema.parse(req.body),
        ),
      });
  },
);
router.get('/:id/quality', validate({params:studioProjectParams}), async(req,res)=>res.json({success:true,data:await projectQuality(studioProjectParams.parse(req.params).id,req.user!.userId)}));
router.post('/:id/proof', validate({params:studioProjectParams,body:acceptProofSchema}), async(req,res)=>res.json({success:true,data:await acceptProjectProof(studioProjectParams.parse(req.params).id,req.user!.userId,acceptProofSchema.parse(req.body))}));
router.use(ownerCollectionRoutes);
router.post(
  "/",
  validate({ body: createStudioProjectSchema }),
  async (req, res) => {
    res.status(201).json({
      success: true,
      data: await createStudioProject(req.user!.userId, req.body),
    });
  },
);
router.post(
  "/:id/lifecycle",
  validate({ params: studioProjectParams, body: lifecycleSchema }),
  async (req, res) => {
    res.json({
      success: true,
      data: await changeAlbumLifecycle(
        req.user!.userId,
        studioProjectParams.parse(req.params).id,
        req.body,
      ),
    });
  },
);
router.get(
  "/:id",
  validate({ params: studioProjectParams }),
  async (req, res) => {
    res.json({
      success: true,
      data: await getStudioProject(
        req.user!.userId,
        studioProjectParams.parse(req.params).id,
      ),
    });
  },
);
router.patch(
  "/:id",
  validate({ params: studioProjectParams, body: updateStudioProjectSchema }),
  async (req, res) => {
    res.json({
      success: true,
      data: await updateStudioProject(
        req.user!.userId,
        studioProjectParams.parse(req.params).id,
        req.body,
      ),
    });
  },
);
router.use(
  (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof StudioProjectError) {
      res
        .status(error.status)
        .json({ success: false, code: error.code, error: error.message });
    } else {
      // Do not leak Prisma diagnostics (which can contain customer titles).
      res.status(503).json({
        success: false,
        code: "STUDIO_UNAVAILABLE",
        error:
          "Album storage is temporarily unavailable. Please try again shortly.",
      });
    }
  },
);
export default router;

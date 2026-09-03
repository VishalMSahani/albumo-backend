import { Router, type Router as RouterType } from "express";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import {
  uploadThreeDModel,
  uploadThreeDModels,
} from "../../../middlewares/upload.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  adminPrintOrderQuerySchema,
  adminPrintOrderUpdateSchema,
  adminPrintPricingUpdateSchema,
  createPrintOrderBodySchema,
  printIdParamsSchema,
  printQuoteBodySchema,
} from "../validators/three-d-printing.validator.js";
import {
  calculateQuoteHandler,
  calculatePreviewQuoteHandler,
  createPrintOrderHandler,
  downloadModelHandler,
  getAdminPrintOrdersHandler,
  getAdminPrintSettingsHandler,
  getPrintConfigHandler,
  getPrintOrderHandler,
  getUserPrintOrdersHandler,
  updateAdminPrintOrderHandler,
  updateAdminPrintSettingsHandler,
  uploadModelHandler,
  uploadModelsHandler,
} from "../controllers/three-d-printing.controller.js";

const router: RouterType = Router();

router.get("/config", getPrintConfigHandler);
router.post("/preview-quote", uploadThreeDModels, calculatePreviewQuoteHandler);

router.use(authenticate);

router.post("/files", uploadThreeDModel, uploadModelHandler);
router.post("/files/batch", uploadThreeDModels, uploadModelsHandler);
router.get("/files/:id/download", validate({ params: printIdParamsSchema }), downloadModelHandler);
router.post("/quote", validate({ body: printQuoteBodySchema }), calculateQuoteHandler);
router.post("/orders", validate({ body: createPrintOrderBodySchema }), createPrintOrderHandler);
router.get("/orders", getUserPrintOrdersHandler);
router.get("/orders/:id", validate({ params: printIdParamsSchema }), getPrintOrderHandler);

router.get(
  "/admin/orders",
  authorize("ADMIN"),
  validate({ query: adminPrintOrderQuerySchema }),
  getAdminPrintOrdersHandler,
);
router.patch(
  "/admin/orders/:id",
  authorize("ADMIN"),
  validate({ params: printIdParamsSchema, body: adminPrintOrderUpdateSchema }),
  updateAdminPrintOrderHandler,
);
router.get("/admin/settings", authorize("ADMIN"), getAdminPrintSettingsHandler);
router.patch(
  "/admin/settings",
  authorize("ADMIN"),
  validate({ body: adminPrintPricingUpdateSchema }),
  updateAdminPrintSettingsHandler,
);

export default router;

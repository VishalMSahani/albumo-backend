import { Router, type Router as RouterType } from "express";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../../utils/async-handler.js";
import { reindexCatalogItemHandler } from "../controllers/reindex.controller.js";
import { reindexCatalogItemSchema } from "../validators/reindex.validator.js";

const router: RouterType = Router();

router.post(
  "/product",
  authenticate,
  authorize("ADMIN"),
  validate({ body: reindexCatalogItemSchema }),
  asyncHandler(reindexCatalogItemHandler),
);

export default router;

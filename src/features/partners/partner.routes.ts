import { Router, type Router as RouterType } from "express";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/async-handler.js";
import * as controller from "./partner.controller.js";
import {
  createPartnerInquirySchema,
  updatePartnerInquirySchema,
  partnerQuerySchema,
} from "./partner.validator.js";

const router: RouterType = Router();

router.get("/directory", asyncHandler(controller.directory));

// Public: submit a partner inquiry
router.post(
  "/inquiries",
  validate({ body: createPartnerInquirySchema }),
  asyncHandler(controller.submitInquiry),
);

// Admin routes
router.use("/admin", authenticate, authorize("ADMIN", "SUPER_ADMIN"));
router.get(
  "/admin/inquiries",
  validate({ query: partnerQuerySchema }),
  asyncHandler(controller.adminList),
);
router.get("/admin/summary", asyncHandler(controller.adminSummary));
router.get("/admin/inquiries/:id", asyncHandler(controller.adminGet));
router.patch(
  "/admin/inquiries/:id",
  validate({ body: updatePartnerInquirySchema }),
  asyncHandler(controller.adminUpdate),
);

export default router;

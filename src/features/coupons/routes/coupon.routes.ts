import { Router, type Router as RouterType } from "express";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import {
  createCouponHandler,
  deactivateCouponHandler,
  getCouponHandler,
  listCouponsHandler,
  updateCouponHandler,
  validateCouponPublicHandler,
} from "../controllers/coupon.controller.js";

const router: RouterType = Router();

// Public (authenticated users) — validate coupon at checkout
router.post("/validate", authenticate, validateCouponPublicHandler);

// Admin only
router.use(authenticate, authorize("ADMIN"));

router.get("/", listCouponsHandler);
router.post("/", createCouponHandler);
router.get("/:id", getCouponHandler);
router.patch("/:id", updateCouponHandler);
router.delete("/:id", deactivateCouponHandler);

export default router;

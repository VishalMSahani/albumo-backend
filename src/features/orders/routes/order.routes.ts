import { Router, type Router as ExpressRouter } from "express";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import {
  cancelOrderHandler,
  confirmPaymentHandler,
  createOrderHandler,
  getAllOrdersHandler,
  getMyOrdersHandler,
  getOrderHandler,
  updateAdminOrderStatusHandler,
  validateCouponHandler,
} from "../controllers/order.controller.js";
import { generateInvoicePdf } from "../../invoices/invoice.service.js";

const router: ExpressRouter = Router();

router.use(authenticate);

router.post("/", createOrderHandler);
router.post("/coupons/validate", validateCouponHandler);
router.get("/admin/all", authorize("ADMIN"), getAllOrdersHandler);
router.patch("/admin/:id/status", authorize("ADMIN"), updateAdminOrderStatusHandler);
router.get("/my", getMyOrdersHandler);
router.get("/:id", getOrderHandler);
router.post("/:id/payments/confirm", confirmPaymentHandler);
router.post("/:id/cancel", cancelOrderHandler);

router.get("/:id/invoice", async (req, res) => {
  const userId = req.user!.userId;
  const isAdmin = ["ADMIN", "SUPER_ADMIN"].includes(req.user!.role);
  try {
    await generateInvoicePdf(req.params.id, userId, isAdmin, res);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    if (!res.headersSent) {
      res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
    }
  }
});

export default router;

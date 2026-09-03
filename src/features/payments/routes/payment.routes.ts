import express, { Router, type Router as RouterType } from "express";
import { authenticate } from "../../../middlewares/auth.middleware.js";
import {
  initiatePaymentHandler,
  razorpayWebhookHandler,
  verifyPaymentHandler,
  zohoReturnHandler,
  zohoWebhookHandler,
} from "../controllers/payment.controller.js";

const router: RouterType = Router();

// Webhook — raw body required for signature verification, NO auth
router.post(
  "/webhook/razorpay",
  express.raw({ type: "application/json" }),
  razorpayWebhookHandler,
);
router.post(
  "/webhook/zoho",
  express.raw({ type: "application/json" }),
  zohoWebhookHandler,
);

// Hosted checkout return URLs configured during Zoho session creation, NO auth
router.get("/zoho/return/:orderId/:result", zohoReturnHandler);

// Initiate: creates gateway session/order and returns frontend payment details
router.post("/:orderId/initiate", authenticate, initiatePaymentHandler);

// Verify: frontend-side success callback — verify signature and confirm order
router.post("/:orderId/verify", authenticate, verifyPaymentHandler);

export default router;

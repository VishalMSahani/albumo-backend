import { Router, type Router as RouterType } from "express";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import {
  getRatesHandler,
  createShipmentHandler,
  trackShipmentHandler,
  webhookHandler,
} from "../controllers/shipping.controller.js";

const router: RouterType = Router();

// Anyone authenticated can check rates (used in checkout)
router.post("/rates", authenticate, getRatesHandler);

// Admin-only: create shipment (generates AWB)
router.post("/order", authenticate, authorize("ADMIN"), createShipmentHandler);

// Track by AWB — public (customers share tracking links)
router.get("/track/:awb", trackShipmentHandler);

// Webhook from Shiprocket — no auth (Shiprocket doesn't send credentials)
router.post("/webhook", webhookHandler);

export default router;

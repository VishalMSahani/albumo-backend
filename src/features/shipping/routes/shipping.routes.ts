import { Router, type Router as RouterType } from "express";
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import {
  getRatesHandler,
  createShipmentHandler,
  trackShipmentHandler,
  webhookHandler,
  getDeliveryEstimateHandler,
} from "../controllers/shipping.controller.js";
import { validate } from '../../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../../utils/async-handler.js';

const router: RouterType = Router();
const estimateLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });

router.get('/serviceability', estimateLimiter, validate({ query: z.object({ pincode: z.string().regex(/^\d{6}$/) }).strict() }), asyncHandler(getDeliveryEstimateHandler));

// Anyone authenticated can check rates (used in checkout)
router.post("/rates", authenticate, getRatesHandler);

// Admin-only: create shipment (generates AWB)
router.post("/order", authenticate, authorize("ADMIN"), createShipmentHandler);

// Track by AWB — public (customers share tracking links)
router.get("/track/:awb", trackShipmentHandler);

// Webhook from Shiprocket — no auth (Shiprocket doesn't send credentials)
router.post("/webhook", webhookHandler);

export default router;

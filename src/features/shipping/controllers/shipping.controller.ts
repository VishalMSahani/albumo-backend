import type { Request, Response } from "express";
import { redis } from "../../../lib/redis.js";
import * as shiprocketService from "../services/shiprocket.service.js";

export async function getRatesHandler(req: Request, res: Response): Promise<void> {
  const { deliveryPincode, weightKg = 0.5, cod = false } = req.body as {
    deliveryPincode?: string;
    weightKg?: number;
    cod?: boolean;
  };

  if (!deliveryPincode) {
    res.status(400).json({ success: false, error: "deliveryPincode is required" });
    return;
  }

  const pickupPincode = process.env.WAREHOUSE_PINCODE ?? "560001";

  try {
    const rates = await shiprocketService.getShippingRates(pickupPincode, deliveryPincode, weightKg, cod);
    res.json({ success: true, data: rates });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
  }
}

export async function createShipmentHandler(req: Request, res: Response): Promise<void> {
  const { orderId, courierId } = req.body as { orderId?: string; courierId?: number };

  if (!orderId) {
    res.status(400).json({ success: false, error: "orderId is required" });
    return;
  }

  try {
    const result = await shiprocketService.createShipment(orderId, courierId);
    res.json({ success: true, data: result });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
  }
}

export async function trackShipmentHandler(req: Request, res: Response): Promise<void> {
  const awb = req.params.awb as string;
  try {
    const data = await shiprocketService.trackShipment(awb);
    res.json({ success: true, data });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
  }
}

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  // Always respond 200 immediately — Shiprocket retries on non-200
  res.status(200).json({ received: true });

  const body = req.body as { awb?: string; current_status?: string; delivered_at?: string };

  // Idempotency: skip duplicate deliveries from Shiprocket
  if (body.awb && body.current_status && redis) {
    const key = `webhook:shiprocket:${body.awb}:${body.current_status}`;
    const already = await redis.set(key, "1", "EX", 86400, "NX").catch(() => null);
    if (!already) return;
  }

  await shiprocketService.handleShiprocketWebhook(body).catch((err: Error) => {
    console.error("[ShiprocketWebhook] Processing error:", err.message);
  });
}

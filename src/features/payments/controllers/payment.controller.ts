import type { Request, Response } from "express";
import { prisma } from "../../../lib/prisma.js";
import * as razorpayService from "../services/razorpay.service.js";
import * as zohoService from "../services/zoho.service.js";

export async function initiatePaymentHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const orderId = req.params.orderId as string;

  try {
    const idempotencyKey = req.headers["x-idempotency-key"] as string | undefined;
    const payment = await prisma.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      select: { gateway: true },
    });
    const data =
      String(payment?.gateway) === "ZOHO"
        ? await zohoService.initiatePayment(orderId, userId, idempotencyKey)
        : await razorpayService.initiatePayment(orderId, userId, idempotencyKey);
    res.json({ success: true, data });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
  }
}

export async function verifyPaymentHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const orderId = req.params.orderId as string;
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  };

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    res.status(400).json({ success: false, error: "razorpayOrderId, razorpayPaymentId, and razorpaySignature are required" });
    return;
  }

  try {
    await razorpayService.verifyAndConfirmPayment(orderId, userId, razorpayOrderId, razorpayPaymentId, razorpaySignature);
    res.json({ success: true, message: "Payment verified and order confirmed" });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 400).json({ success: false, error: error.message });
  }
}

// Raw-body webhook handler — express.raw() is applied at route level
export async function razorpayWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers["x-razorpay-signature"] as string;

  if (!signature) {
    res.status(400).json({ success: false, error: "Missing signature header" });
    return;
  }

  try {
    await razorpayService.handleWebhook(req.body as Buffer, signature);
    res.status(200).json({ received: true });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 400).json({ success: false, error: error.message });
  }
}

export async function zohoReturnHandler(req: Request, res: Response): Promise<void> {
  const orderId = req.params.orderId as string | undefined;

  if (!orderId) {
    res.status(400).json({ success: false, error: "Order ID is required" });
    return;
  }

  try {
    const redirectUrl = await zohoService.handleHostedCheckoutReturn(orderId, req.query as Record<string, unknown>);
    res.redirect(303, redirectUrl);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 400).json({ success: false, error: error.message });
  }
}

// Raw-body webhook handler - express.raw() is applied at route level
export async function zohoWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers["x-zoho-webhook-signature"] as string;
  const rawBody = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.alloc(0);

  if (!signature) {
    if (rawBody.length === 0) {
      res.status(200).json({ received: true });
      return;
    }

    res.status(400).json({ success: false, error: "Missing signature header" });
    return;
  }

  try {
    await zohoService.handleWebhook(rawBody, signature);
    res.status(200).json({ received: true });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 400).json({ success: false, error: error.message });
  }
}

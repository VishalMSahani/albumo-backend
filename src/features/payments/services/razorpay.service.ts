import Razorpay from "razorpay";
import crypto from "crypto";
import { prisma } from "../../../lib/prisma.js";
import { redis } from "../../../lib/redis.js";
import { EmailEventType } from "../../../generated/prisma/client.js";
import { queueEmailNotification } from "../../../services/email-notification.service.js";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export type InitiatePaymentResult = {
  gateway: "RAZORPAY";
  gatewayOrderId: string;
  keyId: string;
  amount: number;
  currency: string;
  orderId: string;
};

export async function initiatePayment(orderId: string, userId: string, idempotencyKey?: string): Promise<InitiatePaymentResult> {
  // Idempotency: if this key was already used, return the cached response
  if (idempotencyKey && redis) {
    const cacheKey = `idempotency:payment:${userId}:${idempotencyKey}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as InitiatePaymentResult;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, status: true, totalAmountCents: true },
  });

  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (order.userId !== userId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  if (order.status !== "PENDING_PAYMENT") {
    throw Object.assign(new Error(`Order is not awaiting payment (status: ${order.status})`), { statusCode: 409 });
  }

  // Reuse an existing Razorpay order only if it's a real gateway ID (starts with "order_")
  const existingPayment = await prisma.payment.findFirst({ where: { orderId, gateway: "RAZORPAY", status: "CREATED" } });
  let gatewayOrderId: string;

  const existingGatewayId = existingPayment?.gatewayOrderId;
  const isRealGatewayId = typeof existingGatewayId === "string" && existingGatewayId.startsWith("order_");

  if (isRealGatewayId) {
    gatewayOrderId = existingGatewayId!;
  } else {
    const gatewayOrder = await razorpay.orders.create({
      amount: order.totalAmountCents,
      currency: "INR",
      receipt: order.id,
    });
    gatewayOrderId = gatewayOrder.id;

    if (existingPayment) {
      // Update the placeholder payment record with the real Razorpay order ID
      await prisma.payment.update({
        where: { id: existingPayment.id },
        data: { gateway: "RAZORPAY", gatewayOrderId, status: "CREATED" },
      });
    } else {
      await prisma.payment.create({
        data: {
          orderId,
          gateway: "RAZORPAY",
          gatewayOrderId,
          amountCents: order.totalAmountCents,
          status: "CREATED",
        },
      });
    }
  }

  const response = {
    gateway: "RAZORPAY" as const,
    gatewayOrderId,
    keyId: process.env.RAZORPAY_KEY_ID!,
    amount: order.totalAmountCents,
    currency: "INR",
    orderId: order.id,
  };

  // Cache the response for 30 minutes (Razorpay order TTL)
  if (idempotencyKey && redis) {
    const cacheKey = `idempotency:payment:${userId}:${idempotencyKey}`;
    await redis.set(cacheKey, JSON.stringify(response), "EX", 30 * 60);
  }

  return response;
}

export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
  const expectedSig = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest("hex");

  if (signature !== expectedSig) {
    throw Object.assign(new Error("Invalid webhook signature"), { statusCode: 400 });
  }

  const event = JSON.parse(rawBody.toString()) as {
    event: string;
    payload: { payment: { entity: { id: string; order_id: string } } };
  };

  const entity = event.payload?.payment?.entity;
  if (!entity) return;

  // Idempotency: skip if this exact payment event was already processed
  const idempotencyKey = `webhook:razorpay:${event.event}:${entity.id}`;
  if (redis) {
    const already = await redis.set(idempotencyKey, "1", "EX", 86400, "NX");
    if (!already) {
      console.log(`[Webhook] Duplicate event skipped: ${idempotencyKey}`);
      return;
    }
  }

  if (event.event === "payment.captured") {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { gatewayOrderId: entity.order_id },
      });
      if (!payment || payment.status === "SUCCESS") return null;

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "SUCCESS", gatewayPaymentId: entity.id },
      });

      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
        select: { id: true, userId: true, status: true },
      });
      if (!order || order.status === "PAID") return null;

      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: "PAID" },
      });

      return { orderId: payment.orderId, userId: order.userId, totalAmountCents: payment.amountCents };
    });

    if (result) {
      const user = await prisma.user.findUnique({
        where: { id: result.userId },
        select: { email: true, name: true },
      });
      if (user) {
        await queueEmailNotification(
          user.email,
          EmailEventType.ORDER_PAID,
          {
            order: {
              orderId: result.orderId,
              total: result.totalAmountCents / 100,
              paymentMethod: "Razorpay",
            },
            user: { name: user.name ?? user.email },
          },
          result.userId,
        ).catch(() => null);
      }
    }
  }

  if (event.event === "payment.failed") {
    const payment = await prisma.payment.findFirst({
      where: { gatewayOrderId: entity.order_id },
    });
    if (payment && payment.status !== "FAILED") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", gatewayPaymentId: entity.id },
      });
    }
  }
}

export async function verifyAndConfirmPayment(
  orderId: string,
  userId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
): Promise<void> {
  const expectedSig = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (razorpaySignature !== expectedSig) {
    throw Object.assign(new Error("Payment signature verification failed"), { statusCode: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true, status: true },
  });

  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (order.userId !== userId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { orderId, gatewayOrderId: razorpayOrderId } });
    if (!payment) throw new Error("Payment record not found");

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "SUCCESS", gatewayPaymentId: razorpayPaymentId },
    });

    await tx.order.update({
      where: { id: orderId },
      data: { status: "PAID" },
    });
  }).then(async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { totalAmountCents: true },
    });
    if (user && order) {
      await queueEmailNotification(
        user.email,
        EmailEventType.ORDER_PAID,
        {
          order: { orderId, total: order.totalAmountCents / 100, paymentMethod: "Razorpay" },
          user: { name: user.name ?? user.email },
        },
        userId,
      ).catch(() => null);
    }
  });
}

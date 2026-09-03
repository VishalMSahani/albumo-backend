import crypto from "crypto";
import { prisma } from "../../../lib/prisma.js";
import { redis } from "../../../lib/redis.js";
import {
  EmailEventType,
  PrintOrderStatus,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { queueEmailNotification } from "../../../services/email-notification.service.js";

const DEFAULT_API_BASE_URL = "https://payments.zoho.in/api/v1";
const DEFAULT_ACCOUNTS_BASE_URL = "https://accounts.zoho.in";
const DEFAULT_HOSTED_CHECKOUT_BASE_URL = "https://payments.zoho.in/hostedcheckout";

type ZohoTokenCache = {
  token: string;
  expiresAt: number;
};

type ZohoPaymentSessionResponse = {
  code?: number;
  message?: string;
  payments_session?: {
    payments_session_id?: string;
    access_key?: string;
    amount?: string | number;
    currency?: string;
    status?: string;
  };
};

type ZohoStoredPayload = {
  checkoutUrl?: string;
  paymentSessionId?: string;
  accessKey?: string;
  expiresAt?: number;
};

type ZohoWebhookEvent = {
  event_id?: string | number;
  event_type?: string;
  event_object?: {
    payment?: {
      payment_id?: string;
      payments_session_id?: string;
      payment_session_id?: string;
      amount?: string | number;
      currency?: string;
      status?: string;
    };
  };
};

export type ZohoInitiatePaymentResult = {
  gateway: "ZOHO";
  checkoutUrl: string;
  paymentSessionId: string;
  amount: number;
  currency: string;
};

let tokenCache: ZohoTokenCache | null = null;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw Object.assign(new Error(`${name} is required for Zoho Payments`), { statusCode: 500 });
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getBackendPublicUrl(): string {
  return normalizeBaseUrl(
    process.env.BACKEND_PUBLIC_URL ||
      process.env.API_PUBLIC_URL ||
      process.env.PUBLIC_API_URL ||
      `http://localhost:${process.env.PORT || 4000}`,
  );
}

function getFrontendUrl(): string {
  return normalizeBaseUrl(process.env.FRONTEND_URL || "http://localhost:3000");
}

function parseAllowedPaymentMethods(): string[] | undefined {
  const configured = process.env.ZOHO_PAYMENTS_ALLOWED_METHODS || "upi,card";
  const methods = configured
    .split(",")
    .map((method) => method.trim())
    .filter(Boolean);

  return methods.length > 0 ? methods : undefined;
}

function getStringQueryValue(query: Record<string, unknown>, key: string): string {
  const value = query[key];
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function safeCompareHex(actual: string, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

async function getZohoAccessToken(): Promise<string> {
  const staticToken = process.env.ZOHO_PAYMENTS_ACCESS_TOKEN?.trim();
  if (staticToken) return staticToken;

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const accountsBaseUrl = normalizeBaseUrl(process.env.ZOHO_ACCOUNTS_BASE_URL || DEFAULT_ACCOUNTS_BASE_URL);
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: requireEnv("ZOHO_PAYMENTS_CLIENT_ID"),
    client_secret: requireEnv("ZOHO_PAYMENTS_CLIENT_SECRET"),
    refresh_token: requireEnv("ZOHO_PAYMENTS_REFRESH_TOKEN"),
  });

  const response = await fetch(`${accountsBaseUrl}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const data = (await response.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token) {
    throw Object.assign(new Error(data.error || "Failed to refresh Zoho Payments access token"), { statusCode: 502 });
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return tokenCache.token;
}

function getReusableStoredPayload(rawPayload: unknown): ZohoStoredPayload | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const payload = rawPayload as ZohoStoredPayload;
  if (!payload.checkoutUrl || !payload.paymentSessionId || !payload.expiresAt) return null;
  if (payload.expiresAt < Date.now() + 60_000) return null;
  return payload;
}

async function queueOrderPaidEmail(orderId: string, userId: string, totalAmountCents: number): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });

  if (!user) return;

  await queueEmailNotification(
    user.email,
    EmailEventType.ORDER_PAID,
    {
      order: {
        orderId,
        total: totalAmountCents / 100,
        paymentMethod: "Zoho Payments",
      },
      user: { name: user.name ?? user.email },
    },
    userId,
  ).catch(() => null);
}

async function markZohoPaymentSuccessful(input: {
  orderId?: string | undefined;
  paymentSessionId: string;
  paymentId?: string | undefined;
  rawPayload: Prisma.InputJsonValue;
}): Promise<void> {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: {
        gateway: "ZOHO",
        OR: [
          { gatewayOrderId: input.paymentSessionId },
          ...(input.orderId ? [{ orderId: input.orderId }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (!payment || payment.status === "SUCCESS") return null;

    const paymentUpdateData: Prisma.PaymentUpdateInput = {
      status: "SUCCESS",
      gatewayOrderId: input.paymentSessionId,
      rawPayload: input.rawPayload,
    };
    if (input.paymentId) paymentUpdateData.gatewayPaymentId = input.paymentId;

    await tx.payment.update({
      where: { id: payment.id },
      data: paymentUpdateData,
    });

    const order = await tx.order.findUnique({
      where: { id: payment.orderId },
      select: { id: true, userId: true, status: true, totalAmountCents: true },
    });

    if (!order) return null;

    if (order.status !== "PAID") {
      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID" },
      });
    }

    const printOrder = await tx.threeDPrintOrder.findUnique({
      where: { commerceOrderId: order.id },
      select: { id: true, status: true },
    });
    if (printOrder && printOrder.status === PrintOrderStatus.PAYMENT_PENDING) {
      await tx.threeDPrintOrder.update({
        where: { id: printOrder.id },
        data: { status: PrintOrderStatus.PAID },
      });
      await tx.threeDPrintStatusEvent.create({
        data: {
          printOrderId: printOrder.id,
          status: PrintOrderStatus.PAID,
          note: "Payment confirmed",
          actorLabel: "Zoho Payments",
        },
      });
    }

    return order;
  });

  if (result) {
    await queueOrderPaidEmail(result.id, result.userId, result.totalAmountCents);
  }
}

async function markZohoPaymentFailed(input: {
  orderId?: string | undefined;
  paymentSessionId: string;
  paymentId?: string | undefined;
  rawPayload: Prisma.InputJsonValue;
}): Promise<void> {
  const paymentUpdateData: Prisma.PaymentUpdateManyMutationInput = {
    status: "FAILED",
    gatewayOrderId: input.paymentSessionId,
    rawPayload: input.rawPayload,
  };
  if (input.paymentId) paymentUpdateData.gatewayPaymentId = input.paymentId;

  await prisma.payment.updateMany({
    where: {
      gateway: "ZOHO",
      status: "CREATED",
      OR: [
        { gatewayOrderId: input.paymentSessionId },
        ...(input.orderId ? [{ orderId: input.orderId }] : []),
      ],
    },
    data: paymentUpdateData,
  });
}

export async function initiatePayment(
  orderId: string,
  userId: string,
  idempotencyKey?: string,
): Promise<ZohoInitiatePaymentResult> {
  if (idempotencyKey && redis) {
    const cacheKey = `idempotency:payment:zoho:${userId}:${idempotencyKey}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as ZohoInitiatePaymentResult;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      status: true,
      totalAmountCents: true,
      user: { select: { email: true, name: true } },
      address: { select: { name: true, phone: true } },
      payments: {
        where: { gateway: "ZOHO", status: "CREATED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (order.userId !== userId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  if (order.status !== "PENDING_PAYMENT") {
    throw Object.assign(new Error(`Order is not awaiting payment (status: ${order.status})`), { statusCode: 409 });
  }

  const existingPayment = order.payments[0];
  const storedPayload = getReusableStoredPayload(existingPayment?.rawPayload);
  if (storedPayload?.checkoutUrl && storedPayload.paymentSessionId) {
    return {
      gateway: "ZOHO",
      checkoutUrl: storedPayload.checkoutUrl,
      paymentSessionId: storedPayload.paymentSessionId,
      amount: order.totalAmountCents,
      currency: "INR",
    };
  }

  const apiBaseUrl = normalizeBaseUrl(process.env.ZOHO_PAYMENTS_API_BASE_URL || DEFAULT_API_BASE_URL);
  const hostedCheckoutBaseUrl = normalizeBaseUrl(
    process.env.ZOHO_PAYMENTS_HOSTED_CHECKOUT_BASE_URL || DEFAULT_HOSTED_CHECKOUT_BASE_URL,
  );
  const accountId = requireEnv("ZOHO_PAYMENTS_ACCOUNT_ID");
  const token = await getZohoAccessToken();
  const checkoutTtlSeconds = Number(process.env.ZOHO_PAYMENTS_SESSION_TTL_SECONDS || 900);
  const customerPhone = order.address.phone.replace(/\D/g, "").slice(-10);
  const customerName = order.address.name || order.user.name || "RoboRoot Customer";

  const response = await fetch(`${apiBaseUrl}/paymentsessions?account_id=${encodeURIComponent(accountId)}`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Number((order.totalAmountCents / 100).toFixed(2)),
      currency: "INR",
      expires_in: checkoutTtlSeconds,
      description: `Payment for RoboRoot order ${order.id}`,
      reference_number: order.id,
      invoice_number: order.id,
      max_retry_count: 3,
      configurations: {
        allowed_payment_methods: parseAllowedPaymentMethods(),
        hosted_checkout_parameters: {
          name: customerName,
          email: order.user.email,
          phone_country_code: "IN",
          phone: customerPhone,
          description: `RoboRoot order ${order.id}`,
          success_url: `${getBackendPublicUrl()}/api/payments/zoho/return/${order.id}/success`,
          failure_url: `${getBackendPublicUrl()}/api/payments/zoho/return/${order.id}/failure`,
          udf1: order.id,
          udf2: userId,
        },
      },
    }),
  });

  const data = (await response.json()) as ZohoPaymentSessionResponse;
  const session = data.payments_session;
  if (!response.ok || !session?.payments_session_id || !session.access_key) {
    throw Object.assign(new Error(data.message || "Failed to create Zoho Payments session"), { statusCode: 502 });
  }

  const checkoutUrl = `${hostedCheckoutBaseUrl}/${encodeURIComponent(session.access_key)}`;
  const payload = {
    mode: "zoho_hosted_checkout",
    paymentSessionId: session.payments_session_id,
    accessKey: session.access_key,
    checkoutUrl,
    expiresAt: Date.now() + checkoutTtlSeconds * 1000,
    zohoResponse: data,
  };

  if (existingPayment) {
    await prisma.payment.update({
      where: { id: existingPayment.id },
      data: {
        gatewayOrderId: session.payments_session_id,
        rawPayload: payload,
      },
    });
  } else {
    await prisma.payment.create({
      data: {
        orderId,
        gateway: "ZOHO",
        gatewayOrderId: session.payments_session_id,
        amountCents: order.totalAmountCents,
        status: "CREATED",
        rawPayload: payload,
      },
    });
  }

  const result: ZohoInitiatePaymentResult = {
    gateway: "ZOHO",
    checkoutUrl,
    paymentSessionId: session.payments_session_id,
    amount: order.totalAmountCents,
    currency: "INR",
  };

  if (idempotencyKey && redis) {
    const cacheKey = `idempotency:payment:zoho:${userId}:${idempotencyKey}`;
    await redis.set(cacheKey, JSON.stringify(result), "EX", 30 * 60);
  }

  return result;
}

export function verifyReturnSignature(query: Record<string, unknown>): boolean {
  const signature = getStringQueryValue(query, "signature");
  const fields = [
    "payments_session_id",
    "payment_session_status",
    "payment_id",
    "payment_status",
    "amount",
    "mandate_id",
    "udf1",
    "udf2",
    "udf3",
    "udf4",
    "udf5",
  ];
  const message = fields.map((field) => getStringQueryValue(query, field)).join(".");
  const expected = crypto.createHmac("sha256", requireEnv("ZOHO_PAYMENTS_SIGNING_KEY")).update(message).digest("hex");

  return safeCompareHex(signature, expected);
}

export async function handleHostedCheckoutReturn(
  orderId: string,
  query: Record<string, unknown>,
): Promise<string> {
  if (!verifyReturnSignature(query)) {
    throw Object.assign(new Error("Invalid Zoho Payments return signature"), { statusCode: 400 });
  }

  const paymentSessionId = getStringQueryValue(query, "payments_session_id");
  const paymentSessionStatus = getStringQueryValue(query, "payment_session_status").toLowerCase();
  const paymentStatus = getStringQueryValue(query, "payment_status").toLowerCase();
  const paymentId = getStringQueryValue(query, "payment_id");
  const orderIdFromUdf = getStringQueryValue(query, "udf1");
  const queryPayload = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "")]),
  );

  if (orderIdFromUdf && orderIdFromUdf !== orderId) {
    throw Object.assign(new Error("Zoho Payments return order mismatch"), { statusCode: 400 });
  }

  if (paymentSessionStatus === "succeeded" || paymentStatus === "succeeded" || paymentStatus === "success") {
    await markZohoPaymentSuccessful({
      orderId,
      paymentSessionId,
      paymentId: paymentId || undefined,
      rawPayload: { source: "zoho_return", query: queryPayload },
    });
    return `${getFrontendUrl()}/checkout/success?orderId=${encodeURIComponent(orderId)}`;
  }

  if (paymentSessionStatus === "failed" || paymentStatus === "failed") {
    await markZohoPaymentFailed({
      orderId,
      paymentSessionId,
      paymentId: paymentId || undefined,
      rawPayload: { source: "zoho_return", query: queryPayload },
    });
  }

  return `${getFrontendUrl()}/orders/${encodeURIComponent(orderId)}?payment=failed`;
}

export async function handleWebhook(rawBody: Buffer, signatureHeader: string): Promise<void> {
  const match = signatureHeader.match(/(?:^|,)t=([^,]+),v=([a-fA-F0-9]+)/);
  if (!match?.[1] || !match[2]) {
    throw Object.assign(new Error("Invalid Zoho Payments webhook signature header"), { statusCode: 400 });
  }

  const [, timestamp, signature] = match;
  const expected = crypto
    .createHmac("sha256", requireEnv("ZOHO_PAYMENTS_WEBHOOK_SIGNING_KEY"))
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest("hex");

  if (!safeCompareHex(signature, expected)) {
    throw Object.assign(new Error("Invalid Zoho Payments webhook signature"), { statusCode: 400 });
  }

  const event = JSON.parse(rawBody.toString()) as ZohoWebhookEvent;
  const payment = event.event_object?.payment;
  if (!event.event_type || !payment) return;

  const paymentSessionId = payment.payments_session_id || payment.payment_session_id;
  if (!paymentSessionId) return;

  const idempotencyKey = `webhook:zoho:${event.event_id || event.event_type}:${payment.payment_id || paymentSessionId}`;
  if (redis) {
    const already = await redis.set(idempotencyKey, "1", "EX", 86400, "NX");
    if (!already) return;
  }

  if (event.event_type === "payment.succeeded") {
    await markZohoPaymentSuccessful({
      paymentSessionId,
      paymentId: payment.payment_id || undefined,
      rawPayload: { source: "zoho_webhook", event },
    });
  }

  if (event.event_type === "payment.failed") {
    await markZohoPaymentFailed({
      paymentSessionId,
      paymentId: payment.payment_id || undefined,
      rawPayload: { source: "zoho_webhook", event },
    });
  }
}

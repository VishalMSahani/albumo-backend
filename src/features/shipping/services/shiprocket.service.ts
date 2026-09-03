import { prisma } from "../../../lib/prisma.js";
import { EmailEventType, OrderStatus } from "../../../generated/prisma/client.js";
import { queueEmailNotification } from "../../../services/email-notification.service.js";

const SHIPROCKET_API = "https://apiv2.shiprocket.in/v1/external";

// In-memory token cache — TTL 23 hours (Shiprocket tokens last 24 hours)
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const res = await fetch(`${SHIPROCKET_API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }),
  });

  if (!res.ok) throw Object.assign(new Error("Shiprocket authentication failed"), { statusCode: 502 });

  const data = await res.json() as { token: string };
  if (!data.token) throw Object.assign(new Error("No token from Shiprocket"), { statusCode: 502 });

  cachedToken = { value: data.token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  return data.token;
}

async function shiprocketGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${SHIPROCKET_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw Object.assign(new Error(`Shiprocket error: ${res.status}`), { statusCode: 502 });
  return res.json() as Promise<T>;
}

async function shiprocketPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${SHIPROCKET_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw Object.assign(new Error(err.message ?? `Shiprocket error: ${res.status}`), { statusCode: 502 });
  }
  return res.json() as Promise<T>;
}

// ─── Public functions ─────────────────────────────────────────────────────────

export interface ShippingRate {
  courier_name: string;
  courier_id: number;
  rate: number;
  estimated_delivery_days: number;
}

export async function getShippingRates(
  pickupPincode: string,
  deliveryPincode: string,
  weightKg: number,
  cod: boolean,
): Promise<ShippingRate[]> {
  const path = `/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weightKg}&cod=${cod ? 1 : 0}`;
  const data = await shiprocketGet<{ data?: { available_courier_companies?: ShippingRate[] } }>(path);
  return data.data?.available_courier_companies ?? [];
}

export async function createShipment(orderId: string, courierId?: number): Promise<{ awb: string; trackingUrl: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      address: true,
      items: {
        include: { component: true },
      },
      user: { select: { email: true, name: true } },
    },
  });

  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });

  // Already has AWB — return existing tracking info
  if (order.trackingAwb) {
    return { awb: order.trackingAwb, trackingUrl: order.trackingUrl ?? `https://shiprocket.co/tracking/${order.trackingAwb}` };
  }

  const shipmentReadyStatuses: OrderStatus[] = [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.PACKED];
  if (!shipmentReadyStatuses.includes(order.status)) {
    throw Object.assign(new Error(`Order must be PAID/PROCESSING/PACKED before creating shipment (current: ${order.status})`), { statusCode: 409 });
  }

  const orderItems = order.items.map((item, i) => ({
    name: item.description,
    sku: item.component?.sku ?? `ITEM-${i}`,
    units: item.quantity,
    selling_price: (item.unitPriceCents / 100).toFixed(2),
  }));

  const shipmentPayload = {
    order_id: order.id,
    order_date: order.createdAt.toISOString().split("T")[0],
    pickup_location: "Primary",
    billing_customer_name: order.address.name,
    billing_last_name: "",
    billing_address: order.address.line1,
    billing_address_2: order.address.line2 ?? "",
    billing_city: order.address.city,
    billing_pincode: order.address.pincode,
    billing_state: order.address.state,
    billing_country: order.address.country,
    billing_email: "",
    billing_phone: order.address.phone,
    shipping_is_billing: 1,
    order_items: orderItems,
    payment_method: "Prepaid",
    sub_total: (order.totalAmountCents / 100).toFixed(2),
    length: 20,
    breadth: 15,
    height: 10,
    weight: Math.max(0.5, orderItems.length * 0.3),
  };

  const created = await shiprocketPost<{ shipment_id?: number; order_id?: string }>("/orders/create/adhoc", shipmentPayload);

  if (!created.shipment_id) throw Object.assign(new Error("Failed to create Shiprocket shipment"), { statusCode: 502 });

  // Assign courier (pick cheapest if not specified)
  const awbPayload: Record<string, unknown> = { shipment_id: created.shipment_id };
  if (courierId) awbPayload.courier_id = courierId;

  const awbRes = await shiprocketPost<{ response?: { data?: { awb_code?: string } } }>("/courier/assign/awb", awbPayload);
  const awb = awbRes.response?.data?.awb_code;

  if (!awb) throw Object.assign(new Error("Failed to get AWB from Shiprocket"), { statusCode: 502 });

  const trackingUrl = `https://shiprocket.co/tracking/${awb}`;

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.SHIPPED,
      trackingAwb: awb,
      trackingUrl,
      shippedAt: new Date(),
    },
  });

  if (order.user?.email) {
    await queueEmailNotification(
      order.user.email,
      EmailEventType.ORDER_SHIPPED,
      {
        order: {
          orderId,
          trackingNumber: awb,
          carrier: "Shiprocket",
          trackingUrl,
        },
        user: { name: order.user.name ?? order.user.email },
      },
      order.userId,
    ).catch(() => null);
  }

  return { awb, trackingUrl };
}

export async function getShipmentStatus(orderId: string): Promise<{ awb: string | null; trackingUrl: string | null; status: OrderStatus }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { trackingAwb: true, trackingUrl: true, status: true },
  });
  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  return { awb: order.trackingAwb, trackingUrl: order.trackingUrl, status: order.status };
}

export async function trackShipment(awb: string): Promise<unknown> {
  return shiprocketGet(`/courier/track/awb/${awb}`);
}

export async function handleShiprocketWebhook(payload: {
  awb?: string;
  current_status?: string;
  delivered_at?: string;
}): Promise<void> {
  if (!payload.awb) return;

  const statusRaw = (payload.current_status ?? "").toLowerCase();

  const order = await prisma.order.findFirst({
    where: { trackingAwb: payload.awb },
    select: { id: true, userId: true, status: true, user: { select: { email: true, name: true } } },
  });
  if (!order) return;

  const terminalStatuses: string[] = [OrderStatus.DELIVERED, OrderStatus.CANCELLED];
  if (terminalStatuses.includes(order.status)) return;

  // OUT_FOR_DELIVERY transition
  if (
    (statusRaw.includes("out for delivery") || statusRaw === "out_for_delivery") &&
    order.status === OrderStatus.SHIPPED
  ) {
    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.OUT_FOR_DELIVERY },
    });
    return;
  }

  // DELIVERED transition
  if (statusRaw.includes("delivered") && !terminalStatuses.includes(order.status)) {
    const deliveredAt = payload.delivered_at ? new Date(payload.delivered_at) : new Date();

    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.DELIVERED, deliveredAt },
    });

    if (order.user?.email) {
      await queueEmailNotification(
        order.user.email,
        EmailEventType.ORDER_DELIVERED,
        { order: { orderId: order.id }, user: { name: order.user.name ?? order.user.email } },
        order.userId,
      ).catch(() => null);
    }

    // Queue review request email 2 days after delivery
    const reviewDelay = 2 * 24 * 60 * 60 * 1000;
    setTimeout(async () => {
      const stillDelivered = await prisma.order.findUnique({
        where: { id: order.id },
        select: { status: true, userId: true, user: { select: { email: true, name: true } } },
      });
      if (stillDelivered?.status === OrderStatus.DELIVERED && stillDelivered.user?.email) {
        await queueEmailNotification(
          stillDelivered.user.email,
          EmailEventType.ORDER_DELIVERED,
          { order: { orderId: order.id, reviewRequest: true }, user: { name: stillDelivered.user.name ?? stillDelivered.user.email } },
          stillDelivered.userId,
        ).catch(() => null);
      }
    }, reviewDelay);
  }
}

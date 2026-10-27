import type { EmailTemplate } from "./base.js";
import { wrapTemplate } from "./base.js";
import {
  emailConfig,
  escapeEmail,
  plainEmailHtml,
} from "../../services/email-config.js";

type OrderData = {
  order?: {
    orderId?: string;
    total?: number;
    items?: { name: string; quantity: number; price: number }[];
    trackingNumber?: string;
    carrier?: string;
    trackingUrl?: string;
    paymentMethod?: string;
  };
  user?: { name?: string };
};
export function albumoOrderTemplate(
  event: string,
  data: OrderData,
): EmailTemplate {
  const order = data.order ?? {};
  const titles: Record<string, string> = {
    ORDER_CREATED: "We've received your order",
    ORDER_PAID: "Payment received",
    ORDER_SHIPPED: "Your order is on its way",
    ORDER_DELIVERED: "Your order has arrived",
    ORDER_CANCELLED: "Your order was cancelled",
    PAYMENT_FAILED: "Your payment was not completed",
  };
  const title = titles[event] || "An update on your order";
  const lines = [
    title,
    "Hi " + (data.user?.name || "there") + ",",
    "Order: " + (order.orderId || "See your account"),
    ...(Number.isFinite(order.total)
      ? ["Total: INR " + Number(order.total).toFixed(2)]
      : []),
    ...(order.items ?? []).map(
      (item) =>
        item.quantity +
        " x " +
        item.name +
        " - INR " +
        Number(item.price).toFixed(2),
    ),
    ...(order.trackingNumber ? ["Tracking: " + order.trackingNumber] : []),
    ...(order.carrier ? ["Carrier: " + order.carrier] : []),
    "For help with this order, reply to this email or contact " +
      emailConfig().support,
  ];
  let tracking = "";
  if (order.trackingUrl) {
    try {
      const url = new URL(order.trackingUrl);
      if (url.protocol === "https:")
        tracking =
          '<p><a href="' + escapeEmail(url.href) + '">Track delivery</a></p>';
    } catch {
      /* Invalid tracking links are omitted. */
    }
  }
  return {
    subject: title + " | Albumo" + (order.orderId ? " | " + order.orderId : ""),
    html: wrapTemplate(plainEmailHtml(lines.join("\n\n")) + tracking),
    text: lines.join("\n\n"),
  };
}
export function albumoMessage(subject: string, body: string): EmailTemplate {
  return {
    subject,
    html: wrapTemplate(
      '<h1 style="font-size:24px;line-height:1.3">' +
        escapeEmail(subject) +
        "</h1>" +
        plainEmailHtml(body),
    ),
    text: body,
  };
}

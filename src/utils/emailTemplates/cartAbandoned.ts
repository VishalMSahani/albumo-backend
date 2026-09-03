import { wrapTemplate, type EmailTemplate } from "./base.js";

interface CartAbandonedItem {
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  slug?: string;
}

interface CartAbandonedData {
  user?: {
    name: string;
    email: string;
  };
  cart: {
    items: CartAbandonedItem[];
    total: number;
    cartUrl?: string;
  };
}

export function cartAbandonedTemplate(data: CartAbandonedData): EmailTemplate {
  const frontendUrl = process.env.FRONTEND_URL || "https://roboroot.in";
  const cartUrl = data.cart.cartUrl || `${frontendUrl}/cart`;

  const itemsHtml = data.cart.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e0e0e0;">
        <div style="display: flex; align-items: center; gap: 12px;">
          ${
            item.imageUrl
              ? `<img src="${item.imageUrl}" alt="${item.name}" style="width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 1px solid #e0e0e0;" />`
              : `<div style="width: 56px; height: 56px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 24px;">📦</div>`
          }
          <div>
            <strong style="color: #333;">${item.name}</strong>
            <br />
            <span style="color: #999; font-size: 13px;">Qty: ${item.quantity}</span>
          </div>
        </div>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #e0e0e0; text-align: right; vertical-align: middle;">
        <strong style="color: #333;">₹${(item.price * item.quantity).toLocaleString("en-IN")}</strong>
      </td>
    </tr>
  `
    )
    .join("");

  const content = `
    <h1>You left something behind! 🛒</h1>
    <p>Hi ${data.user?.name || "there"},</p>
    <p>
      We noticed you added some great items to your cart but didn't complete your order.
      Your items are still waiting for you!
    </p>

    <div style="background: #fafafa; border-radius: 12px; padding: 4px; margin: 24px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e0e0e0; color: #667eea; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Item</th>
            <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e0e0e0; color: #667eea; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td style="padding: 16px 12px; font-size: 16px;">
              <strong>Cart Total</strong>
            </td>
            <td style="padding: 16px 12px; text-align: right; font-size: 18px; color: #667eea;">
              <strong>₹${data.cart.total.toLocaleString("en-IN")}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <p class="text-center" style="margin: 30px 0;">
      <a href="${cartUrl}" class="button" style="font-size: 16px; padding: 14px 40px;">
        Complete Your Order →
      </a>
    </p>

    <div class="info-box" style="margin: 24px 0;">
      <p style="margin: 0; font-size: 14px;">
        <strong>💡 Why complete your order now?</strong>
      </p>
      <ul style="margin: 8px 0 0 0; padding-left: 18px; color: #555; font-size: 14px;">
        <li>Stock is limited — popular items sell out fast</li>
        <li>Free shipping on orders above ₹999</li>
        <li>Secure checkout with Razorpay</li>
      </ul>
    </div>

    <p style="color: #999; font-size: 13px;">
      If you have any questions about these products, our team is here to help at
      <a href="mailto:support@roboroot.in" style="color: #667eea;">support@roboroot.in</a>
    </p>

    <p>
      Happy building! 🚀<br />
      The RoboRoot Team
    </p>
  `;

  const itemCount = data.cart.items.length;
  const itemLabel = itemCount === 1 ? "item" : "items";

  return {
    subject: `🛒 You left ${itemCount} ${itemLabel} in your cart — complete your order!`,
    html: wrapTemplate(content),
    text: `You left something behind! 🛒

Hi ${data.user?.name || "there"},

We noticed you added some great items to your cart but didn't complete your order.

Your Cart:
${data.cart.items
  .map(
    (item) =>
      `• ${item.name} — Qty: ${item.quantity} — ₹${(item.price * item.quantity).toLocaleString("en-IN")}`
  )
  .join("\n")}

Cart Total: ₹${data.cart.total.toLocaleString("en-IN")}

Complete your order: ${cartUrl}

Why order now?
• Stock is limited — popular items sell out fast
• Free shipping on orders above ₹999
• Secure checkout with Razorpay

Questions? Contact us at support@roboroot.in

Happy building! 🚀
The RoboRoot Team`,
  };
}

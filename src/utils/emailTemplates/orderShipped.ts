import { wrapTemplate, type EmailTemplate } from "./base.js";

export function orderShippedTemplate(data: {
  order: {
    orderId: string;
    trackingNumber: string;
    carrier: string;
    trackingUrl?: string;
    estimatedDelivery?: string;
  };
  user?: {
    name: string;
  };
}): EmailTemplate {
  const content = `
    <h1>Your Order Has Shipped! 📦</h1>
    <p>Hi ${data.user?.name || "there"},</p>
    <p>
      Exciting news! Your order has been shipped and is on its way to you.
    </p>

    <div class="info-box">
      <p><strong>Order ID:</strong> ${data.order.orderId}</p>
      <p><strong>Carrier:</strong> ${data.order.carrier}</p>
      <p><strong>Tracking Number:</strong> ${data.order.trackingNumber}</p>
      ${data.order.estimatedDelivery ? `<p><strong>Estimated Delivery:</strong> ${data.order.estimatedDelivery}</p>` : ""}
    </div>

    <p class="text-center">
      ${
        data.order.trackingUrl
          ? `<a href="${data.order.trackingUrl}" class="button">Track Your Package</a>`
          : `<a href="https://roboroot.in/orders/${data.order.orderId}" class="button">View Order Details</a>`
      }
    </p>

    <h2>What's Next?</h2>
    <ul>
      <li>📍 <strong>Track your package:</strong> Use the tracking number to monitor your delivery</li>
      <li>📅 <strong>Prepare for delivery:</strong> Make sure someone is available to receive the package</li>
      <li>📧 <strong>Stay updated:</strong> We'll notify you when your package is delivered</li>
    </ul>

    ${
      !data.order.trackingUrl
        ? `
    <p>
      You can track your package using the tracking number: <strong>${data.order.trackingNumber}</strong><br>
      Visit ${data.order.carrier}'s website and enter this tracking number.
    </p>
    `
        : ""
    }

    <p>
      Questions about your delivery? Contact us at 
      <a href="mailto:orders@roboroot.in">orders@roboroot.in</a>
    </p>

    <p>
      Happy Building! 🔧⚡<br>
      The RoboRoot Team
    </p>
  `;

  return {
    subject: `Your Order Has Shipped - ${data.order.orderId}`,
    html: wrapTemplate(content),
    text: `Your Order Has Shipped! 📦

Hi ${data.user?.name || "there"},

Exciting news! Your order has been shipped and is on its way to you.

Order ID: ${data.order.orderId}
Carrier: ${data.order.carrier}
Tracking Number: ${data.order.trackingNumber}
${data.order.estimatedDelivery ? `Estimated Delivery: ${data.order.estimatedDelivery}` : ""}

${data.order.trackingUrl ? `Track your package: ${data.order.trackingUrl}` : `Track at ${data.order.carrier}'s website using: ${data.order.trackingNumber}`}

What's Next?
📍 Track your package using the tracking number
📅 Make sure someone is available to receive the package
📧 We'll notify you when your package is delivered

Questions about your delivery? Contact us at orders@roboroot.in

Happy Building! 🔧⚡
The RoboRoot Team`,
  };
}

import { wrapTemplate, type EmailTemplate } from "./base.js";

export function orderPaidTemplate(data: {
  order: {
    orderId: string;
    total: number;
    paymentMethod: string;
    transactionId?: string;
  };
  user?: {
    name: string;
  };
}): EmailTemplate {
  const content = `
    <h1>Payment Confirmed! ✅</h1>
    <p>Hi ${data.user?.name || "there"},</p>
    <p>
      Great news! We've received your payment and it has been successfully processed.
      Your order is now being prepared for shipment.
    </p>

    <div class="info-box">
      <p><strong>Order ID:</strong> ${data.order.orderId}</p>
      <p><strong>Amount Paid:</strong> ₹${data.order.total.toLocaleString()}</p>
      <p><strong>Payment Method:</strong> ${data.order.paymentMethod}</p>
      ${data.order.transactionId ? `<p><strong>Transaction ID:</strong> ${data.order.transactionId}</p>` : ""}
      <p><strong>Payment Status:</strong> <span style="color: #28a745;">Successful</span></p>
    </div>

    <p>
      You'll receive a shipping confirmation email with tracking details once your order is dispatched.
    </p>

    <p class="text-center">
      <a href="https://roboroot.in/orders/${data.order.orderId}" class="button">View Order Details</a>
    </p>

    <p>
      Need an invoice? You can download it from your 
      <a href="https://roboroot.in/orders/${data.order.orderId}">order page</a>.
    </p>

    <p>
      Thank you for your purchase! 🎉<br>
      The RoboRoot Team
    </p>
  `;

  return {
    subject: `Payment Confirmed - Order ${data.order.orderId}`,
    html: wrapTemplate(content),
    text: `Payment Confirmed! ✅

Hi ${data.user?.name || "there"},

Great news! We've received your payment and it has been successfully processed. Your order is now being prepared for shipment.

Order ID: ${data.order.orderId}
Amount Paid: ₹${data.order.total.toLocaleString()}
Payment Method: ${data.order.paymentMethod}
${data.order.transactionId ? `Transaction ID: ${data.order.transactionId}` : ""}
Payment Status: Successful

You'll receive a shipping confirmation email with tracking details once your order is dispatched.

View order details: https://roboroot.in/orders/${data.order.orderId}

Need an invoice? You can download it from your order page.

Thank you for your purchase! 🎉
The RoboRoot Team`,
  };
}

import PDFDocument from "pdfkit";
import type { Response } from "express";
import { prisma } from "../../lib/prisma.js";

const BRAND_DARK = "#222222";
const BRAND_BLUE = "#1CA2D1";

function formatCurrency(cents: number): string {
  return `₹${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
}

export async function generateInvoicePdf(orderId: string, userId: string, isAdmin: boolean, res: Response): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { name: true, email: true } },
      address: true,
      items: { include: { component: { select: { name: true, sku: true } } } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      coupon: { select: { code: true, label: true, discountType: true, discountValue: true } },
    },
  });

  if (!order) throw Object.assign(new Error("Order not found"), { statusCode: 404 });
  if (!isAdmin && order.userId !== userId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });

  const doc = new PDFDocument({ margin: 50, size: "A4" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-${orderId.slice(-8).toUpperCase()}.pdf"`);
  doc.pipe(res);

  // ── Header ────────────────────────────────────────────────────────────────
  doc.fillColor(BRAND_DARK).fontSize(22).font("Helvetica-Bold").text("RoboRoot", 50, 50);
  doc.fillColor(BRAND_BLUE).fontSize(10).font("Helvetica").text("roboroot.in", 50, 77);
  doc
    .fillColor("#666666")
    .fontSize(8)
    .text("Bangalore, Karnataka, India · GST: 29XXXXXXXXXXXXX", 50, 90);

  doc
    .fillColor(BRAND_DARK)
    .fontSize(18)
    .font("Helvetica-Bold")
    .text("TAX INVOICE", 350, 50, { align: "right", width: 200 });

  doc
    .fillColor("#444444")
    .fontSize(9)
    .font("Helvetica")
    .text(`Invoice No: INV-${orderId.slice(-8).toUpperCase()}`, 350, 75, { align: "right", width: 200 })
    .text(`Order Date: ${formatDate(order.createdAt)}`, 350, 88, { align: "right", width: 200 })
    .text(`Order ID: ${order.id}`, 350, 101, { align: "right", width: 200 });

  // ── Divider ───────────────────────────────────────────────────────────────
  doc.moveTo(50, 120).lineTo(545, 120).strokeColor(BRAND_BLUE).lineWidth(1).stroke();

  // ── Bill To ───────────────────────────────────────────────────────────────
  doc.fillColor(BRAND_DARK).fontSize(10).font("Helvetica-Bold").text("Bill To", 50, 135);
  doc
    .fillColor("#444444")
    .fontSize(9)
    .font("Helvetica")
    .text(order.address.name, 50, 152)
    .text(order.address.line1, 50, 165)
    .text(order.address.line2 ?? "", 50, 178)
    .text(`${order.address.city}, ${order.address.state} – ${order.address.pincode}`, 50, 191)
    .text(order.address.country, 50, 204)
    .text(`Ph: ${order.address.phone}`, 50, 217);

  doc.fillColor(BRAND_DARK).fontSize(10).font("Helvetica-Bold").text("Customer", 350, 135, { width: 200 });
  doc
    .fillColor("#444444")
    .fontSize(9)
    .font("Helvetica")
    .text(order.user.name ?? "—", 350, 152, { width: 200 })
    .text(order.user.email, 350, 165, { width: 200 });

  // ── Items table ───────────────────────────────────────────────────────────
  const tableTop = 250;
  const col = { item: 50, qty: 320, unitPrice: 390, subtotal: 475 };

  // Table header
  doc.rect(50, tableTop, 495, 20).fill(BRAND_DARK);
  doc
    .fillColor("#ffffff")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text("ITEM / SKU", col.item + 4, tableTop + 6, { width: 260 })
    .text("QTY", col.qty + 4, tableTop + 6, { width: 60, align: "center" })
    .text("UNIT PRICE", col.unitPrice, tableTop + 6, { width: 75, align: "right" })
    .text("SUBTOTAL", col.subtotal, tableTop + 6, { width: 65, align: "right" });

  let y = tableTop + 20;
  let rowAlt = false;
  for (const item of order.items) {
    if (rowAlt) doc.rect(50, y, 495, 24).fill("#F7F7F0");
    rowAlt = !rowAlt;

    doc
      .fillColor(BRAND_DARK)
      .fontSize(8)
      .font("Helvetica-Bold")
      .text(item.description, col.item + 4, y + 4, { width: 265 });
    if (item.component?.sku) {
      doc.fillColor("#888888").fontSize(7).font("Helvetica").text(`SKU: ${item.component.sku}`, col.item + 4, y + 14, { width: 265 });
    }

    doc
      .fillColor(BRAND_DARK)
      .fontSize(8)
      .font("Helvetica")
      .text(String(item.quantity), col.qty + 4, y + 8, { width: 60, align: "center" })
      .text(formatCurrency(item.unitPriceCents), col.unitPrice, y + 8, { width: 75, align: "right" })
      .text(formatCurrency(item.subtotalCents), col.subtotal, y + 8, { width: 65, align: "right" });

    y += 24;
  }

  // Bottom border of table
  doc.moveTo(50, y).lineTo(545, y).strokeColor("#D0D0C0").lineWidth(0.5).stroke();

  // ── Totals ────────────────────────────────────────────────────────────────
  y += 12;
  const subtotal = order.items.reduce((s, i) => s + i.subtotalCents, 0);
  const shippingCents = order.totalAmountCents - subtotal - (order.coupon ? 0 : 0); // approximate

  const line = (label: string, value: string, bold = false) => {
    doc
      .fillColor(BRAND_DARK)
      .fontSize(9)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .text(label, 350, y, { width: 130, align: "right" })
      .text(value, 490, y, { width: 55, align: "right" });
    y += 16;
  };

  line("Subtotal", formatCurrency(subtotal));
  line("Shipping", formatCurrency(Math.max(0, order.totalAmountCents - subtotal)));
  if (order.coupon) {
    line(`Coupon (${order.coupon.code})`, "—");
  }
  doc.moveTo(350, y).lineTo(545, y).strokeColor(BRAND_BLUE).lineWidth(0.75).stroke();
  y += 6;
  line("Total Paid", formatCurrency(order.totalAmountCents), true);

  // Payment info
  const payment = order.payments[0];
  if (payment) {
    y += 8;
    doc
      .fillColor("#888888")
      .fontSize(8)
      .font("Helvetica")
      .text(`Payment: ${payment.gateway} · ${payment.status}`, 350, y, { width: 195, align: "right" });
    if (payment.gatewayPaymentId) {
      y += 12;
      doc.text(`Txn: ${payment.gatewayPaymentId}`, 350, y, { width: 195, align: "right" });
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  doc
    .fillColor("#888888")
    .fontSize(8)
    .font("Helvetica")
    .text("Thank you for shopping with RoboRoot! For queries: support@roboroot.in", 50, 760, {
      align: "center",
      width: 495,
    });
  doc.moveTo(50, 752).lineTo(545, 752).strokeColor(BRAND_BLUE).lineWidth(0.5).stroke();

  doc.end();
}

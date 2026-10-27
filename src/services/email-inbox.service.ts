import { randomBytes } from "node:crypto";
import { albumoMessage } from "../utils/emailTemplates/albumo.js";
import { prisma } from "../lib/prisma.js";
import { emailConfig } from "./email-config.js";
import { supportReplyAddress, ticketFromReplyAddress } from "./email-tokens.js";
import {
  queueAdminNotice,
  queueRawEmail,
} from "./email-notification.service.js";

function emailAddress(value: string) {
  const match = value.match(/<([^<>]+)>/);
  const address = (match?.[1] || value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : "";
}
export async function resendRead(path: string) {
  const key =
    process.env.RESEND_RECEIVING_API_KEY || process.env.RESEND_API_KEY;
  if (!key) throw new Error("Resend is not configured");
  const response = await fetch("https://api.resend.com" + path, {
    headers: { Authorization: "Bearer " + key },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? "A Resend key with receiving access is required. Set RESEND_RECEIVING_API_KEY."
        : "Resend could not retrieve the email (" + response.status + ")",
    );
  return response.json();
}
export async function receiveEmail(providerId: string) {
  const previous = await prisma.inboundEmail.findUnique({
    where: { providerId },
  });
  if (previous?.status === "IGNORED") return previous;
  if (previous?.ticketId) return linkInbound(previous.id);
  const remote = (await resendRead(
    "/emails/receiving/" + encodeURIComponent(providerId),
  )) as {
    from: string;
    to: string[];
    subject: string;
    text?: string;
    html?: string;
    message_id?: string;
    headers?: Record<string, string>;
    authentication?: { dmarc?: string };
    attachments?: {
      id: string;
      filename: string;
      content_type: string;
      size: number;
    }[];
  };
  const config = emailConfig();
  const recipients = (remote.to || []).map(emailAddress).filter(Boolean);
  const allowed = recipients.some(
    (address) =>
      ([config.from, config.support, config.replyTo].includes(address) &&
        address.endsWith("@" + config.inboundDomain)) ||
      address === "support@" + config.inboundDomain ||
      (address.startsWith("reply+") &&
        address.endsWith("@" + config.inboundDomain)),
  );
  if (!allowed)
    throw new Error(
      "Email recipient is outside the configured Albumo support inbox",
    );
  const from = emailAddress(remote.from || "");
  if (!from) throw new Error("Received email has an invalid sender");
  const plain =
    remote.text ||
    (remote.html || "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  const headers = Object.fromEntries(
    Object.entries(remote.headers || {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
  const automated = Boolean(
    (headers["auto-submitted"] && headers["auto-submitted"] !== "no") ||
    headers["list-id"] ||
    headers["x-autoreply"],
  );
  let record = await prisma.inboundEmail.upsert({
    where: { providerId },
    update: {},
    create: {
      providerId,
      fromEmail: from,
      fromName: (remote.from || "")
        .replace(/<[^>]+>/, "")
        .replace(/"/g, "")
        .trim()
        .slice(0, 100),
      recipients,
      subject: (remote.subject || "Support email").slice(0, 160),
      text: plain.slice(0, 50000),
      messageId: remote.message_id?.slice(0, 300) ?? null,
      attachments: (remote.attachments || []).slice(0, 30).map((item) => ({
        id: item.id,
        filename: item.filename,
        contentType: item.content_type,
        size: item.size,
      })),
      authenticated: remote.authentication?.dmarc === "pass",
      status: automated
        ? "IGNORED"
        : remote.authentication?.dmarc === "pass"
          ? "NEW"
          : "NEEDS_REVIEW",
    },
  });
  if (record.status === "IGNORED") return record;
  const ticketId = recipients.map(ticketFromReplyAddress).find(Boolean);
  if (record.authenticated) {
    const linked = await linkInbound(record.id, ticketId || undefined, false);
    if (linked.status !== "NEEDS_REVIEW") return linked;
    record = linked;
  }
  await queueAdminNotice(
    "Support email needs review",
    record.subject +
      "\nFrom: " +
      from +
      "\nSender authentication or conversation matching needs review. Open the email inbox.\n" +
      config.adminUrl +
      "/emails",
    "inbound-review:" + record.id,
  );
  return record;
}
export async function linkInbound(
  id: string,
  ticketId?: string,
  manual = true,
) {
  const linked = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"inbound:" + id}))`;
    const row = await tx.inboundEmail.findUnique({ where: { id } });
    if (!row) throw new Error("Email not found");
    if (row.ticketId) return row;
    if (!manual && !row.authenticated)
      throw new Error("Review this sender before creating a support ticket");
    let ticket = ticketId
      ? await tx.supportTicket.findUnique({ where: { id: ticketId } })
      : null;
    if (ticket && ticket.requesterEmail.toLowerCase() !== row.fromEmail) {
      return tx.inboundEmail.update({
        where: { id },
        data: { status: "NEEDS_REVIEW" },
      });
    }
    if (ticket) {
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status: "IN_PROGRESS",
          resolvedAt: null,
          lastActivityAt: new Date(),
          messages: {
            create: {
              sender: "CUSTOMER",
              authorName: row.fromName || row.fromEmail,
              body: row.text.slice(0, 10000) || "(No text body)",
            },
          },
        },
      });
    } else {
      ticket = await tx.supportTicket.create({
        data: {
          ticketNumber:
            "AL-" +
            new Date().getUTCFullYear() +
            "-" +
            randomBytes(6).toString("hex").toUpperCase(),
          requesterName: row.fromName || row.fromEmail,
          requesterEmail: row.fromEmail,
          subject: row.subject,
          description: row.text.slice(0, 5000) || "(No text body)",
          category: "OTHER",
          priority: "MEDIUM",
          source: "EMAIL",
          enquiry: { inboundEmailId: id },
          firstResponseDueAt: new Date(Date.now() + 86400000),
          resolutionDueAt: new Date(Date.now() + 3 * 86400000),
          messages: {
            create: {
              sender: "CUSTOMER",
              authorName: row.fromName || row.fromEmail,
              body: row.text.slice(0, 10000) || "(No text body)",
            },
          },
        },
      });
    }
    return tx.inboundEmail.update({
      where: { id },
      data: { status: "LINKED", ticketId: ticket.id },
    });
  });
  if (linked.ticketId)
    await queueAdminNotice(
      "New customer support email",
      linked.subject +
        "\nFrom: " +
        linked.fromEmail +
        "\n" +
        emailConfig().adminUrl +
        "/support",
      "inbound:" + id,
    );
  if (linked.ticketId) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: linked.ticketId },
      select: { ticketNumber: true, enquiry: true },
    });
    if (
      (ticket?.enquiry as { inboundEmailId?: string } | null)
        ?.inboundEmailId === id
    ) {
      const template = albumoMessage(
        "We received your request | " + ticket!.ticketNumber,
        "Hi " +
          (linked.fromName || "there") +
          ",\n\nYour email is now with Albumo Support. Your ticket reference is " +
          ticket!.ticketNumber +
          ". We'll reply as soon as we can.\n\n" +
          emailConfig().siteUrl +
          "/support/tickets/" +
          encodeURIComponent(ticket!.ticketNumber),
      );
      await queueRawEmail({
        email: linked.fromEmail,
        eventType: "SUPPORT_TICKET_CREATED",
        subject: template.subject,
        html: template.html,
        text: template.text || "",
        ticketId: linked.ticketId,
        replyTo: supportReplyAddress(linked.ticketId),
        headers: { "Auto-Submitted": "auto-generated" },
        dedupeKey: "inbound-ack:" + id,
      });
    }
  }
  return linked;
}
export async function attachmentLink(id: string, attachmentId: string) {
  const row = await prisma.inboundEmail.findUnique({ where: { id } });
  if (!row) throw new Error("Email not found");
  const items = row.attachments as { id: string }[];
  if (!items.some((item) => item.id === attachmentId))
    throw new Error("Attachment not found");
  const remote = (await resendRead(
    "/emails/receiving/" +
      encodeURIComponent(row.providerId) +
      "/attachments/" +
      encodeURIComponent(attachmentId),
  )) as { download_url: string };
  const url = new URL(remote.download_url);
  if (url.protocol !== "https:") throw new Error("Invalid attachment URL");
  return { url: url.href };
}

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { sendEmail, emailDeliveryConfigured } from "../../services/email.service.js";
import { createSupportTicket } from "../support/support.service.js";
import type { EnquiryInput, contactSettingsSchema, subscriberQuerySchema } from "./contact.validator.js";
import type { z } from "zod";
import { acquireNewsletterLock } from "./newsletter-lock.js";

export const NEWSLETTER_CONSENT_VERSION = "newsletter-single-opt-in-2026-10-08";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function getContactSettings() {
  const setting = await prisma.contactSetting.findUnique({ where: { id: 1 } });
  return {
    email: setting ? setting.email : process.env.SUPPORT_EMAIL || "",
    phone: setting?.phone || "", whatsapp: setting?.whatsapp || "", hours: setting?.hours || "",
    newsletterEnabled: setting?.newsletterEnabled ?? true,
  };
}

export async function updateContactSettings(input: z.infer<typeof contactSettingsSchema>) {
  return prisma.contactSetting.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: input });
}

export async function createEnquiry(input: EnquiryInput, userId?: string) {
  const details = [
    input.message,
    input.phone && `Phone: ${input.phone}`,
    input.organization && `Organisation: ${input.organization}`,
    input.intent === "CUSTOM_PROJECT" && `Project type: ${input.projectType || "Not sure yet"}\nBudget: ${input.budget || "To discuss"}\nTimeline: ${input.timeline || "Flexible"}`,
    "Contact permission: granted for this enquiry (not newsletter marketing).",
  ].filter(Boolean).join("\n\n");
  return createSupportTicket({
    name: input.name, email: input.email, priority: "MEDIUM",
    category: input.intent === "CUSTOM_PROJECT" ? "TECHNICAL" : "OTHER",
    subject: `${input.intent === "CUSTOM_PROJECT" ? "[Custom project]" : "[Contact]"} ${input.subject}`,
    description: details,
  }, userId, { source: input.intent, enquiry: {
    phone: input.phone, organization: input.organization, projectType: input.projectType,
    budget: input.budget, timeline: input.timeline, consentAt: new Date().toISOString(),
  } });
}

/** Signup records explicit form consent immediately; only preference requests send email. */
export async function requestNewsletterEmail(email: string, mode: "subscribe" | "manage", source = "NEWSLETTER") {
  const settings = await getContactSettings();
  if (mode === "subscribe") {
    if (!settings.newsletterEnabled) return { available: false, delivered: false };
    await prisma.$transaction(async tx => {
      await acquireNewsletterLock(tx, email);
      const current = await tx.newsletterSubscriber.findUnique({ where: { email } });
      if (current?.status === "ACTIVE") return;
      const data = {
        status: "ACTIVE", source, consentVersion: NEWSLETTER_CONSENT_VERSION,
        consentAt: new Date(), confirmedAt: null, unsubscribedAt: null,
        confirmTokenHash: null, confirmExpiresAt: null, deliveryError: false, lastEmailAt: null,
      };
      await tx.newsletterSubscriber.upsert({ where: { email }, create: { email, ...data }, update: data });
    });
    return { available: true, delivered: true };
  }
  if (!emailDeliveryConfigured()) return { available: false, delivered: false };
  const base = process.env.FRONTEND_URL;
  if (!base || !/^https?:\/\//.test(base)) return { available: false, delivered: false };
  const token = randomBytes(32).toString("hex");
  const tokenHash = hash(token);
  const now = new Date();
  const subscriber = await prisma.$transaction(async tx => {
    await acquireNewsletterLock(tx, email);
    const current = await tx.newsletterSubscriber.findUnique({ where: { email } });
    if (current?.lastEmailAt && now.getTime() - current.lastEmailAt.getTime() < 60_000) return null;
    if (!current || current.status === "UNSUBSCRIBED") return null;
    return tx.newsletterSubscriber.update({ where: { email }, data: { unsubscribeTokenHash: tokenHash, lastEmailAt: now, deliveryError: false } });
  });
  if (!subscriber) return { available: true, delivered: true };
  // Fragment tokens stay out of server/access logs and referrer URLs. GET never changes consent.
  const url = `${base.replace(/\/$/, "")}/newsletter/unsubscribe#token=${token}`;
  const title = "Manage your RoboRoot newsletter subscription";
  const copy = "Use this link to unsubscribe. Opening it does not change your preferences until you confirm.";
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const result = await sendEmail(email, title,
    `<h1>${title}</h1><p>${copy}</p><p><a href="${escape(url)}">Unsubscribe</a></p><p>You can request an unsubscribe link at ${escape(base)}/newsletter at any time.</p>`,
    `${title}\n\n${copy}\n\n${url}\n\nManage preferences: ${base}/newsletter`);
  await prisma.newsletterSubscriber.updateMany({ where: { id: subscriber.id, unsubscribeTokenHash: tokenHash }, data: { deliveryError: !result.success, ...(!result.success ? { lastEmailAt: null } : {}) } });
  return { available: true, delivered: result.success };
}

export async function confirmNewsletter(token: string) {
  const changed = await prisma.newsletterSubscriber.updateMany({
    where: { confirmTokenHash: hash(token), confirmExpiresAt: { gt: new Date() } },
    data: { status: "ACTIVE", confirmedAt: new Date(), unsubscribedAt: null, confirmTokenHash: null, confirmExpiresAt: null },
  });
  return changed.count > 0;
}

export async function unsubscribeNewsletter(token: string) {
  const changed = await prisma.newsletterSubscriber.updateMany({
    where: { unsubscribeTokenHash: hash(token) },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), confirmTokenHash: null, confirmExpiresAt: null },
  });
  return changed.count > 0;
}

const subscriberSelect = { id: true, email: true, status: true, source: true, consentVersion: true, consentAt: true, confirmedAt: true, unsubscribedAt: true, createdAt: true, deliveryError: true } as const;
export async function listSubscribers(input: z.infer<typeof subscriberQuerySchema>) {
  const where = { ...(input.status ? { status: input.status } : {}), ...(input.search ? { email: { contains: input.search, mode: "insensitive" as const } } : {}) };
  const [subscribers, total, active, pending, unsubscribed] = await prisma.$transaction([
    prisma.newsletterSubscriber.findMany({ where, select: subscriberSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * 30, take: 30 }),
    prisma.newsletterSubscriber.count({ where }),
    prisma.newsletterSubscriber.count({ where: { status: "ACTIVE" } }),
    prisma.newsletterSubscriber.count({ where: { status: "PENDING" } }),
    prisma.newsletterSubscriber.count({ where: { status: "UNSUBSCRIBED" } }),
  ]);
  return { subscribers, total, pages: Math.max(1, Math.ceil(total / 30)), summary: { active, pending, unsubscribed } };
}

export async function adminUnsubscribe(id: string) {
  const result = await prisma.newsletterSubscriber.updateMany({ where: { id }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), confirmTokenHash: null, confirmExpiresAt: null } });
  return result.count > 0;
}

export function csvCell(value: string) {
  const safe = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
export async function exportSubscribers() {
  // Bound exports to avoid exhausting a serverless function.
  const rows = await prisma.newsletterSubscriber.findMany({ where: { status: "ACTIVE" }, select: subscriberSelect, orderBy: { id: "asc" }, take: 10001 });
  if (rows.length > 10000) return null;
  return ["Email,Consent at,Consent version,Source", ...rows.map(row => [row.email, row.consentAt.toISOString(), row.consentVersion, row.source].map(csvCell).join(","))].join("\r\n");
}

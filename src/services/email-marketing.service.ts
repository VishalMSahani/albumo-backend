import { prisma } from "../lib/prisma.js";
import { emailConfig } from "./email-config.js";
import { renderCampaign } from "./campaign-design.js";
import { newsletterToken, readNewsletterToken } from "./email-tokens.js";
import { queueRawEmail } from "./email-notification.service.js";
import type { Prisma } from "../generated/prisma/client.js";

export function marketingContent(
  subject: string,
  body: string,
  subscriber: { id: string; email: string; consentAt: Date },
  design: unknown = {},
) {
  const url =
    emailConfig().apiUrl +
    "/api/email-preferences/unsubscribe?token=" +
    encodeURIComponent(newsletterToken(subscriber));
  return {
    ...renderCampaign(subject, body, design, url),
    headers: {
      "List-Unsubscribe": "<" + url + ">",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
export async function queueNewsletterWelcome(subscriber: {
  id: string;
  email: string;
  consentAt: Date;
}) {
  const subject = "Welcome to Albumo stories";
  const content = marketingContent(
    subject,
    "Thanks for joining Albumo. We'll share photo book inspiration, new collections and occasional offers. Your memories deserve a place beyond your phone.",
    subscriber,
  );
  return queueRawEmail({
    email: subscriber.email,
    eventType: "NEWSLETTER_WELCOME",
    subject,
    ...content,
    channel: "MARKETING",
    subscriberId: subscriber.id,
    metadata: { consentAt: subscriber.consentAt.toISOString() },
    dedupeKey:
      "welcome:" + subscriber.id + ":" + subscriber.consentAt.toISOString(),
  });
}
export async function applyEmailUnsubscribe(token: string) {
  const value = readNewsletterToken(token);
  const subscriber = await prisma.newsletterSubscriber.findFirst({
    where: { id: value.id, consentAt: new Date(value.consent) },
  });
  if (!subscriber) return false;
  const changed = await prisma.newsletterSubscriber.updateMany({
    where: { id: subscriber.id, consentAt: new Date(value.consent) },
    data: {
      status: "UNSUBSCRIBED",
      unsubscribedAt: new Date(),
      confirmTokenHash: null,
      confirmExpiresAt: null,
    },
  });
  if (!changed.count) return false;
  await prisma.emailNotification.updateMany({
    where: {
      metadata: { path: ["consentAt"], equals: value.consent },
      subscriberId: subscriber.id,
      channel: "MARKETING",
      status: "QUEUED",
    },
    data: { status: "CANCELLED", error: "Recipient unsubscribed" },
  });
  return true;
}
export async function queueCampaign(id: string) {
  if (!emailConfig().marketingEnabled)
    throw new Error(
      "Marketing delivery is disabled. Enable EMAIL_MARKETING_ENABLED after reviewing your sender.",
    );
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"campaign:" + id}))`;
      const campaign = await tx.emailCampaign.findUnique({ where: { id } });
      if (!campaign) throw new Error("Campaign not found");
      if (campaign.status !== "DRAFT") return campaign;
      const subscribers = await tx.newsletterSubscriber.findMany({
        where: { status: "ACTIVE" },
        take: 5001,
        orderBy: { id: "asc" },
      });
      if (subscribers.length > 5000)
        throw new Error(
          "This campaign exceeds the 5,000-recipient limit. Contact the site administrator to configure larger batches.",
        );
      const suppressed = new Set(
        (
          await tx.emailSuppression.findMany({
            where: { email: { in: subscribers.map((row) => row.email) } },
            select: { email: true },
          })
        ).map((row) => row.email),
      );
      const recipients = subscribers.filter(
        (row) => !suppressed.has(row.email),
      );
      if (!recipients.length)
        throw new Error(
          "There are no active, deliverable newsletter subscribers",
        );
      const config = emailConfig();
      const data: Prisma.EmailNotificationCreateManyInput[] = recipients.map(
        (subscriber) => {
          const content = marketingContent(
            campaign.subject,
            campaign.body,
            subscriber,
            campaign.design,
          );
          return {
            email: subscriber.email,
            eventType: "MARKETING_CAMPAIGN",
            subject: campaign.subject,
            body: content.html,
            text: content.text,
            headers: content.headers,
            metadata: { consentAt: subscriber.consentAt.toISOString() },
            channel: "MARKETING",
            fromAddress: config.name + " <" + config.marketingFrom + ">",
            replyTo: config.marketingReplyTo,
            status: "QUEUED",
            campaignId: id,
            subscriberId: subscriber.id,
            dedupeKey: "campaign:" + id + ":" + subscriber.id,
          };
        },
      );
      await tx.emailNotification.createMany({ data, skipDuplicates: true });
      return tx.emailCampaign.update({
        where: { id },
        data: {
          status: "QUEUED",
          queuedAt: new Date(),
          recipientCount: recipients.length,
        },
      });
    },
    { timeout: 30000 },
  );
}
export async function cancelCampaign(id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"campaign:" + id}))`;
    await tx.emailNotification.updateMany({
      where: { campaignId: id, status: "QUEUED" },
      data: { status: "CANCELLED", error: "Campaign cancelled" },
    });
    return tx.emailCampaign.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  });
}
export async function refreshCampaignStatuses() {
  const campaigns = await prisma.emailCampaign.findMany({
    where: { status: "QUEUED" },
    select: { id: true },
    take: 100,
  });
  for (const campaign of campaigns) {
    const pending = await prisma.emailNotification.count({
      where: {
        campaignId: campaign.id,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
    });
    if (!pending)
      await prisma.emailCampaign.updateMany({
        where: { id: campaign.id, status: "QUEUED" },
        data: { status: "COMPLETE" },
      });
  }
}

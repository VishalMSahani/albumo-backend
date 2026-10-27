import { prisma } from "../lib/prisma.js";
import { receiveEmail } from "./email-inbox.service.js";
import type { Prisma } from "../generated/prisma/client.js";
const deliveryStates: Record<string, string> = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.failed": "FAILED",
  "email.suppressed": "SKIPPED",
};
export async function processEmailWebhook(id: string) {
  const event = await prisma.emailWebhookEvent.findUnique({ where: { id } });
  if (!event || event.processedAt) return;
  const payload = event.payload as {
    type: string;
    created_at?: string;
    data: {
      email_id?: string;
      bounce?: { type?: string };
      failed?: { reason?: string };
    };
  };
  const providerId = payload.data.email_id;
  if (!providerId || !/^[a-zA-Z0-9_-]{1,100}$/.test(providerId))
    throw new Error("Invalid Resend email ID");
  try {
    if (payload.type === "email.received") await receiveEmail(providerId);
    else {
      const notification = await prisma.emailNotification.findUnique({
        where: { providerMessageId: providerId },
      });
      if (!notification)
        throw new Error("Delivery record is not available yet");
      const eventTime = new Date(payload.created_at || event.createdAt);
      if (!Number.isFinite(eventTime.getTime()))
        throw new Error("Invalid event time");
      const bad =
        payload.type === "email.bounced" || payload.type === "email.complained";
      if (bad) {
        await prisma.emailSuppression.upsert({
          where: { email: notification.email },
          create: { email: notification.email, reason: payload.type },
          update: { reason: payload.type },
        });
        await prisma.newsletterSubscriber.updateMany({
          where: { email: notification.email },
          data: {
            status: "UNSUBSCRIBED",
            unsubscribedAt: new Date(),
            deliveryError: true,
          },
        });
      }
      const status = deliveryStates[payload.type];
      const engagement =
        payload.type === "email.opened"
          ? { openedAt: eventTime }
          : payload.type === "email.clicked"
            ? { clickedAt: eventTime }
            : {};
      const terminal = ["BOUNCED", "COMPLAINED"].includes(notification.status);
      if (Object.keys(engagement).length)
        await prisma.emailNotification.update({
          where: { id: notification.id },
          data: engagement,
        });
      if (status && (!terminal || bad))
        await prisma.emailNotification.updateMany({
          where: {
            id: notification.id,
            ...(bad
              ? {}
              : {
                  status: { notIn: ["BOUNCED", "COMPLAINED"] },
                  OR: [
                    { providerEventAt: null },
                    { providerEventAt: { lte: eventTime } },
                  ],
                }),
          },
          data: {
            status,
            providerEventAt: eventTime,
            ...(status === "DELIVERED"
              ? { deliveredAt: eventTime, isSent: true }
              : {}),
            ...(bad || status === "FAILED" || status === "SKIPPED"
              ? { error: payload.type }
              : {}),
          },
        });
    }
    await prisma.emailWebhookEvent.update({
      where: { id },
      data: { processedAt: new Date(), error: null },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Webhook processing failed";
    await prisma.emailWebhookEvent.update({
      where: { id },
      data: { error: message.slice(0, 500) },
    });
    throw error;
  }
}
export async function saveEmailWebhook(
  id: string,
  payload: { type: string; created_at?: string; data: Record<string, unknown> },
) {
  const supported = [
    ...Object.keys(deliveryStates),
    "email.opened",
    "email.clicked",
    "email.received",
  ];
  if (!supported.includes(payload.type)) return;
  await prisma.emailWebhookEvent.upsert({
    where: { id },
    create: {
      id,
      type: payload.type,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
    },
    update: {},
  });
  await processEmailWebhook(id);
}
export async function recoverEmailWebhooks() {
  const events = await prisma.emailWebhookEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true },
  });
  let processed = 0;
  for (const event of events) {
    try {
      await processEmailWebhook(event.id);
      processed++;
    } catch {
      /* Remains visible for retry in admin. */
    }
  }
  return { processed, pending: events.length - processed };
}

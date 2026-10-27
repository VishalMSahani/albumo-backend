import { prisma } from "../lib/prisma.js";
import { sendEmail, emailDeliveryConfigured } from "./email.service.js";
import {
  getEmailTemplate,
  type EmailTemplateData,
} from "../utils/email-templates.js";
import { EmailEventType, type Prisma } from "../generated/prisma/client.js";
import { getEmailQueue } from "../lib/queue.js";
import { emailConfig, emailIdentity } from "./email-config.js";
import { supportReplyAddress } from "./email-tokens.js";

type RawEmail = {
  email: string;
  eventType: EmailEventType;
  subject: string;
  html: string;
  text: string;
  userId?: string;
  channel?: string;
  dedupeKey?: string;
  fromAddress?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  metadata?: Prisma.InputJsonValue;
  campaignId?: string;
  subscriberId?: string;
  ticketId?: string;
};
const isAuth = (event: string) =>
  event === "USER_EMAIL_VERIFICATION" || event === "PASSWORD_RESET";
const recipientAllowed = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith(".invalid");
export async function queueRawEmail(
  input: RawEmail,
  client: Pick<Prisma.TransactionClient, "emailNotification"> = prisma,
) {
  const identity = emailIdentity(input.eventType, input.channel);
  const email = input.email.trim().toLowerCase();
  const skipReason =
    input.eventType === "LOW_STOCK_ALERT"
      ? "Low-stock emails are disabled"
      : recipientAllowed(email)
        ? null
        : "No deliverable customer email address";
  const data = {
    email,
    eventType: input.eventType,
    subject: input.subject,
    body: input.html,
    text: input.text,
    channel: identity.channel,
    fromAddress: input.fromAddress || identity.fromAddress,
    replyTo: input.replyTo ?? identity.replyTo,
    headers: input.headers || {},
    metadata: input.metadata || {},
    userId: input.userId ?? null,
    dedupeKey: input.dedupeKey ?? null,
    campaignId: input.campaignId ?? null,
    subscriberId: input.subscriberId ?? null,
    ticketId: input.ticketId ?? null,
    status: skipReason ? "SKIPPED" : "QUEUED",
    error: skipReason,
  };
  const notification = input.dedupeKey
    ? await client.emailNotification.upsert({
        where: { dedupeKey: input.dedupeKey },
        create: data,
        update: {},
      })
    : await client.emailNotification.create({ data });
  return { id: notification.id, success: true };
}
export async function createEmailNotification(
  email: string,
  eventType: EmailEventType,
  templateData: EmailTemplateData,
  userId?: string,
) {
  if (eventType === "CART_ABANDONED") {
    const subscriber = await prisma.newsletterSubscriber.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!subscriber || subscriber.status !== "ACTIVE")
      throw new Error("Cart reminders require newsletter consent");
    const { marketingContent } = await import("./email-marketing.service.js");
    const subject = "Your Albumo memories are waiting";
    const content = marketingContent(
      subject,
      "You left something in your Albumo cart. Continue creating your keepsake whenever you're ready.\n\n" +
        emailConfig().siteUrl +
        "/cart",
      subscriber,
    );
    return queueRawEmail({
      email,
      eventType,
      subject,
      ...content,
      channel: "MARKETING",
      subscriberId: subscriber.id,
      metadata: { consentAt: subscriber.consentAt.toISOString() },
      ...(userId ? { userId } : {}),
    });
  }
  const template = getEmailTemplate(eventType, templateData);
  const ticket = templateData?.ticket?.ticketNumber
    ? await prisma.supportTicket.findUnique({
        where: { ticketNumber: templateData.ticket.ticketNumber },
        select: { id: true },
      })
    : null;
  const orderKey =
    eventType.startsWith("ORDER_") || eventType === "PAYMENT_FAILED"
      ? templateData?.order?.orderId
      : null;
  return queueRawEmail({
    email,
    eventType,
    subject: template.subject,
    html: template.html,
    text: template.text || "",
    ...(userId ? { userId } : {}),
    ...(ticket
      ? {
          ticketId: ticket.id,
          replyTo:
            templateData.audience === "SUPPORT"
              ? emailConfig().replyTo
              : supportReplyAddress(ticket.id),
        }
      : {}),
    ...(orderKey
      ? {
          dedupeKey:
            "event:" +
            eventType +
            ":" +
            orderKey +
            ":" +
            email.trim().toLowerCase(),
        }
      : {}),
    channel:
      templateData?.audience === "SUPPORT" || eventType === "LOW_STOCK_ALERT"
        ? "ADMIN"
        : "TRANSACTIONAL",
    metadata: JSON.parse(JSON.stringify(templateData ?? {})),
  });
}
async function enqueue(
  id: string,
  email: string,
  eventType: EmailEventType,
  templateData: EmailTemplateData,
) {
  const queue = getEmailQueue();
  if (!queue) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      queue.add(
        "send-email",
        { notificationId: id, email, eventType, templateData },
        { jobId: "email-" + id, removeOnComplete: true },
      ),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Queue unavailable")), 2000);
      }),
    ]);
  } catch {
    /* The database outbox is recovered by the scheduled processor. */
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export async function queueAdminNotice(
  subject: string,
  message: string,
  key?: string,
) {
  const template = getEmailTemplate(EmailEventType.ADMIN_NOTIFICATION, {
    subject,
    message,
  });
  return queueRawEmail({
    email: emailConfig().admin,
    eventType: EmailEventType.ADMIN_NOTIFICATION,
    subject: template.subject,
    html: template.html,
    text: template.text || "",
    channel: "ADMIN",
    ...(key ? { dedupeKey: key } : {}),
  });
}
export async function queueEmailNotification(
  email: string,
  eventType: EmailEventType,
  templateData: EmailTemplateData,
  userId?: string,
) {
  const row = await createEmailNotification(
    email,
    eventType,
    templateData,
    userId,
  );
  if (
    [
      "ORDER_CREATED",
      "ORDER_PAID",
      "ORDER_CANCELLED",
      "PAYMENT_FAILED",
    ].includes(eventType) &&
    templateData?.order?.orderId
  ) {
    const template = getEmailTemplate(eventType, templateData);
    await queueAdminNotice(
      "Albumo: " +
        eventType.toLowerCase().replaceAll("_", " ") +
        " | " +
        templateData.order.orderId,
      (template.text || template.subject) +
        "\n\nCustomer: " +
        email +
        "\nManage orders: " +
        emailConfig().adminUrl +
        "/orders",
      "admin:" + eventType + ":" + templateData.order.orderId,
    );
  }
  if (eventType !== "LOW_STOCK_ALERT") {
    await enqueue(row.id, email, eventType, templateData);
  }
  return { id: row.id };
}
const readyWhere = () => ({
  isSent: false,
  status: { in: ["QUEUED", "PROCESSING"] },
  nextAttemptAt: { lte: new Date() },
  retryCount: { lt: prisma.emailNotification.fields.maxRetries },
  OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
});
export async function retryEmailNotification(
  notificationId: string,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const before = await prisma.emailNotification.findUnique({
    where: { id: notificationId },
  });
  if (!before) return { success: false, error: "Notification not found" };
  if (before.isSent)
    return {
      success: true,
      ...(before.providerMessageId
        ? { messageId: before.providerMessageId }
        : {}),
    };
  if (before.eventType === "LOW_STOCK_ALERT") {
    await prisma.emailNotification.updateMany({
      where: { id: notificationId, isSent: false },
      data: {
        status: "SKIPPED",
        error: "Low-stock emails are disabled",
        lockedUntil: null,
      },
    });
    return { success: false, error: "Low-stock emails are disabled" };
  }
  if (!emailDeliveryConfigured())
    return { success: false, error: "Email provider is not configured" };
  const claimed = await prisma.emailNotification.updateMany({
    where: { id: notificationId, ...readyWhere() },
    data: {
      status: "PROCESSING",
      lockedUntil: new Date(Date.now() + 120000),
      firstAttemptAt: before.firstAttemptAt || new Date(),
      retryCount: { increment: 1 },
    },
  });
  if (!claimed.count)
    return {
      success: false,
      error: "Email is not ready or is already being processed",
    };
  const finish = async (status: string, error: string) => {
    await prisma.emailNotification.update({
      where: { id: notificationId },
      data: { status, error, lockedUntil: null },
    });
    return { success: false, error };
  };
  try {
    if (
      before.firstAttemptAt &&
      Date.now() - before.firstAttemptAt.getTime() > 23 * 60 * 60 * 1000
    )
      return finish(
        "FAILED",
        "Delivery outcome needs review: the provider idempotency window has expired.",
      );
    if (
      isAuth(before.eventType) &&
      Date.now() - before.createdAt.getTime() > 10 * 60000
    )
      return finish(
        "SKIPPED",
        "Authentication email expired; request a fresh code",
      );
    const suppression = await prisma.emailSuppression.findUnique({
      where: { email: before.email },
    });
    if (suppression)
      return finish("SKIPPED", "Recipient suppressed: " + suppression.reason);
    if (before.eventType === "CART_ABANDONED" && before.channel !== "MARKETING")
      return finish(
        "SKIPPED",
        "Legacy cart reminder has no recorded marketing consent",
      );
    if (before.channel === "MARKETING") {
      if (!emailConfig().marketingEnabled)
        return finish("SKIPPED", "Marketing delivery is disabled");
      const subscriber = before.subscriberId
        ? await prisma.newsletterSubscriber.findUnique({
            where: { id: before.subscriberId },
          })
        : null;
      if (!subscriber || subscriber.status !== "ACTIVE")
        return finish("SKIPPED", "Recipient is no longer subscribed");
      const consent = (before.metadata as { consentAt?: string } | null)
        ?.consentAt;
      if (consent !== subscriber.consentAt.toISOString())
        return finish(
          "SKIPPED",
          "Subscriber consent changed after this email was queued",
        );
      if (
        !(before.headers as Record<string, string> | null)?.["List-Unsubscribe"]
      )
        return finish(
          "SKIPPED",
          "Marketing email is missing an unsubscribe link",
        );
      const campaign = before.campaignId
        ? await prisma.emailCampaign.findUnique({
            where: { id: before.campaignId },
          })
        : null;
      if (before.campaignId && (!campaign || campaign.status === "CANCELLED"))
        return finish("CANCELLED", "Campaign cancelled");
    }
    // Legacy outbox records did not store text or sender fields.
    const legacy =
      before.text === null
        ? getEmailTemplate(before.eventType, before.metadata)
        : null;
    const identity = emailIdentity(before.eventType, before.channel);
    const result = await sendEmail(
      before.email,
      before.subject,
      legacy?.html || before.body,
      before.text ?? legacy?.text ?? "",
      undefined,
      {
        from: before.fromAddress || identity.fromAddress,
        replyTo: before.replyTo ?? identity.replyTo,
        headers: (before.headers as Record<string, string> | null) || {},
        idempotencyKey: "albumo-email/" + before.id,
      },
    );
    if (result.success) {
      await prisma.emailNotification.updateMany({
        where: { id: notificationId },
        data: {
          isSent: true,
          sentAt: new Date(),
          providerMessageId: result.messageId ?? null,
          lockedUntil: null,
          error: null,
          ...(isAuth(before.eventType)
            ? {
                subject: "Authentication email",
                body: "Authentication email delivered.",
                text: "Authentication email delivered.",
                metadata: {},
              }
            : {}),
        },
      });
      // A fast delivery webhook can arrive before the API response; never downgrade its status.
      await prisma.emailNotification.updateMany({
        where: { id: notificationId, status: { in: ["PROCESSING", "QUEUED"] } },
        data: { status: "SENT" },
      });
      return {
        success: true,
        ...(result.messageId ? { messageId: result.messageId } : {}),
      };
    }
    const attempts = before.retryCount + 1;
    await prisma.emailNotification.update({
      where: { id: notificationId },
      data: {
        status: attempts >= before.maxRetries ? "FAILED" : "QUEUED",
        error: result.error ?? "Delivery failed",
        lockedUntil: null,
        nextAttemptAt: new Date(
          Date.now() + Math.min(60, 2 ** attempts) * 60000,
        ),
      },
    });
    return { success: false, error: result.error || "Delivery failed" };
  } catch {
    await prisma.emailNotification.update({
      where: { id: notificationId },
      data: {
        status:
          before.retryCount + 1 >= before.maxRetries ? "FAILED" : "QUEUED",
        error: "Email processing failed; retry scheduled",
        lockedUntil: null,
        nextAttemptAt: new Date(Date.now() + 120000),
      },
    });
    return { success: false, error: "Email processing failed" };
  }
}
export async function processPendingEmails(limit = 25) {
  if (!emailDeliveryConfigured())
    return { processed: 0, successful: 0, failed: 0 };
  await prisma.emailNotification.updateMany({
    where: {
      isSent: false,
      status: "PROCESSING",
      lockedUntil: { lt: new Date() },
      retryCount: { gte: prisma.emailNotification.fields.maxRetries },
    },
    data: {
      status: "FAILED",
      lockedUntil: null,
      error:
        "Worker stopped during the final attempt. Review delivery before retrying.",
    },
  });
  const pending = await prisma.emailNotification.findMany({
    where: readyWhere(),
    orderBy: { createdAt: "asc" },
    take: Math.min(50, Math.max(1, limit)),
    select: { id: true },
  });
  let successful = 0,
    failed = 0;
  for (const row of pending) {
    const result = await retryEmailNotification(row.id);
    if (result.success) successful++;
    else failed++;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { processed: pending.length, successful, failed };
}
export async function sendEmailNotification(
  email: string,
  eventType: EmailEventType,
  templateData: EmailTemplateData,
  userId?: string,
) {
  const row = await createEmailNotification(
    email,
    eventType,
    templateData,
    userId,
  );
  return { notificationId: row.id, ...(await retryEmailNotification(row.id)) };
}
export async function getEmailStats() {
  const grouped = await prisma.emailNotification.groupBy({
    by: ["status"],
    _count: true,
  });
  const counts = Object.fromEntries(
    grouped.map((row) => [row.status, row._count]),
  );
  return {
    total: grouped.reduce((sum, row) => sum + row._count, 0),
    sent: (counts.SENT || 0) + (counts.DELIVERED || 0),
    pending: (counts.QUEUED || 0) + (counts.PROCESSING || 0),
    failed: counts.FAILED || 0,
    counts,
  };
}
export async function cleanupOldEmails(daysOld = 90) {
  return (
    await prisma.emailNotification.deleteMany({
      where: {
        isSent: true,
        sentAt: { lt: new Date(Date.now() - daysOld * 86400000) },
        campaignId: null,
      },
    })
  ).count;
}

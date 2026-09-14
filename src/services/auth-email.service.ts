import { prisma } from "../lib/prisma.js";
import { getEmailQueue } from "../lib/queue.js";
import type { EmailTemplateData } from "../utils/email-templates.js";
import { createEmailNotification, retryEmailNotification } from "./email-notification.service.js";
import { emailDeliveryConfigured } from "./email.service.js";
import { logger } from "../lib/logger.js";

type AuthEmailEvent = "USER_EMAIL_VERIFICATION" | "PASSWORD_RESET";
async function enqueue(id: string, email: string, eventType: AuthEmailEvent, templateData: EmailTemplateData) {
  const queue = getEmailQueue();
  if (!queue) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      queue.add("send-email", { notificationId: id, email, eventType, templateData },
        { jobId: "auth-" + id, removeOnComplete: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Queue timeout")), 3000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Persist first, then enqueue. A queue outage must not hang signup or lose recovery emails. */
export async function queueAuthEmail(email: string, eventType: AuthEmailEvent, templateData: EmailTemplateData, userId: string) {
  const notification = await createEmailNotification(email, eventType, templateData, userId);
  if (!getEmailQueue()) {
    if (emailDeliveryConfigured()) {
      const result = await retryEmailNotification(notification.id);
      if (!result.success) {
        logger.warn("Authentication email saved for delivery retry", { eventType });
        throw new Error("Email provider delivery failed");
      }
    }
    return;
  }
  try {
    await enqueue(notification.id, email, eventType, templateData);
  }
  catch { logger.warn("Authentication email saved for queue recovery", { eventType }); }
}

/** Called by the existing scheduler; deterministic job IDs prevent duplicate active jobs. */
export async function recoverAuthEmails() {
  const queue = getEmailQueue();
  if (!queue && !emailDeliveryConfigured()) return;
  const pending = await prisma.emailNotification.findMany({
    where: { eventType: { in: ["USER_EMAIL_VERIFICATION", "PASSWORD_RESET"] }, isSent: false,
      retryCount: { lt: prisma.emailNotification.fields.maxRetries }, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
    orderBy: { createdAt: "asc" }, take: 50,
  });
  for (const notification of pending) {
    if (queue) {
      await enqueue(notification.id, notification.email, notification.eventType as AuthEmailEvent, notification.metadata as EmailTemplateData);
    } else {
      await retryEmailNotification(notification.id);
    }
  }
}

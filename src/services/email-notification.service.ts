import { prisma } from "../lib/prisma.js";
import { sendTemplateEmail } from "./email.service.js";
import {
  getEmailTemplate,
  type EmailTemplateData,
} from "../utils/email-templates.js";
import { EmailEventType } from "../generated/prisma/client.js";
import { getEmailQueue } from "../lib/queue.js";

/**
 * Create an email notification record in database
 */
export async function createEmailNotification(
  email: string,
  eventType: EmailEventType,
  templateData: EmailTemplateData,
  userId?: string
): Promise<{ id: string; success: boolean }> {
  try {
    // Generate email content from template
    const template = getEmailTemplate(eventType, templateData);

    // Create notification in database
    const notification = await prisma.emailNotification.create({
      data: {
        userId: userId ?? null,
        email,
        eventType,
        subject: template.subject,
        body: template.html,
        metadata: templateData as any, // Store template data as JSON
        isSent: false,
        retryCount: 0,
      },
    });

    console.log(`📧 Email notification created: ${notification.id} (${eventType})`);

    return {
      id: notification.id,
      success: true,
    };
  } catch (error) {
    console.error("❌ Failed to create email notification:", error);
    throw error;
  }
}

/**
 * Send an email notification immediately (synchronous)
 */
export async function sendEmailNotification(
  email: string,
  eventType: EmailEventType,
  templateData: EmailTemplateData,
  userId?: string
): Promise<{
  success: boolean;
  notificationId: string;
  messageId?: string;
  error?: string;
}> {
  try {
    // Generate email content from template
    const template = getEmailTemplate(eventType, templateData);

    // Send email
    const result = await sendTemplateEmail(email, template);

    // Create notification record in database
    const notification = await prisma.emailNotification.create({
      data: {
        userId: userId ?? null,
        email,
        eventType,
        subject: template.subject,
        body: template.html,
        metadata: templateData as any,
        isSent: result.success,
        sentAt: result.success ? new Date() : null,
        error: result.error ?? null,
        retryCount: 0,
      },
    });

    if (result.success) {
      console.log(
        `✅ Email sent successfully: ${notification.id} (${eventType}) to ${email}`
      );
    } else {
      console.error(
        `❌ Failed to send email: ${notification.id} (${eventType}) - ${result.error}`
      );
    }

    const response: {
      success: boolean;
      notificationId: string;
      messageId?: string;
      error?: string;
    } = {
      success: result.success,
      notificationId: notification.id,
    };

    if (result.messageId) {
      response.messageId = result.messageId;
    }

    if (result.error) {
      response.error = result.error;
    }

    return response;
  } catch (error) {
    console.error("❌ Error in sendEmailNotification:", error);
    return {
      success: false,
      notificationId: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Queue an email notification via BullMQ (falls back to DB-poll if Redis unavailable).
 */
export async function queueEmailNotification(
  email: string,
  eventType: EmailEventType,
  templateData: EmailTemplateData,
  userId?: string
): Promise<{ id: string }> {
  const notification = await createEmailNotification(email, eventType, templateData, userId);

  const queue = getEmailQueue();
  if (queue) {
    await queue.add("send-email", {
      notificationId: notification.id,
      email,
      eventType,
      templateData,
    });
    console.log(`[EmailQueue] Job queued: ${eventType} → ${email}`);
  } else {
    // BullMQ unavailable — notification stays in DB for polling worker
    console.log(`[EmailQueue] Fallback (no Redis): ${eventType} → ${email} saved to DB`);
  }

  return { id: notification.id };
}

/**
 * Process pending email notifications (for background workers)
 */
export async function processPendingEmails(limit: number = 50): Promise<{
  processed: number;
  successful: number;
  failed: number;
}> {
  // Get pending emails that haven't exceeded max retries
  const pendingEmails = await prisma.emailNotification.findMany({
    where: {
      isSent: false,
      retryCount: {
        lt: prisma.emailNotification.fields.maxRetries,
      },
    },
    take: limit,
    orderBy: {
      createdAt: "asc",
    },
  });

  let successful = 0;
  let failed = 0;

  for (const notification of pendingEmails) {
    try {
      // Regenerate template from metadata
      const templateData = notification.metadata as EmailTemplateData;
      const template = getEmailTemplate(notification.eventType, templateData);

      // Attempt to send
      const result = await sendTemplateEmail(notification.email, template);

      if (result.success) {
        // Mark as sent
        await prisma.emailNotification.update({
          where: { id: notification.id },
          data: {
            isSent: true,
            sentAt: new Date(),
            error: null,
          },
        });
        successful++;
        console.log(`✅ Processed email: ${notification.id}`);
      } else {
        // Increment retry count
        await prisma.emailNotification.update({
          where: { id: notification.id },
          data: {
            retryCount: {
              increment: 1,
            },
            error: result.error ?? null,
          },
        });
        failed++;
        console.error(`❌ Failed to send email: ${notification.id} - ${result.error}`);
      }
    } catch (error) {
      // Increment retry count on error
      await prisma.emailNotification.update({
        where: { id: notification.id },
        data: {
          retryCount: {
            increment: 1,
          },
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      failed++;
      console.error(`❌ Error processing email: ${notification.id}`, error);
    }
  }

  console.log(
    `📊 Email processing complete: ${successful} sent, ${failed} failed out of ${pendingEmails.length} total`
  );

  return {
    processed: pendingEmails.length,
    successful,
    failed,
  };
}

/**
 * Retry failed email notification
 */
export async function retryEmailNotification(notificationId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const notification = await prisma.emailNotification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      return { success: false, error: "Notification not found" };
    }

    if (notification.isSent) {
      return { success: false, error: "Email already sent" };
    }

    if (notification.retryCount >= notification.maxRetries) {
      return { success: false, error: "Max retries exceeded" };
    }

    // Regenerate template from metadata
    const templateData = notification.metadata as EmailTemplateData;
    const template = getEmailTemplate(notification.eventType, templateData);

    // Attempt to send
    const result = await sendTemplateEmail(notification.email, template);

    if (result.success) {
      // Mark as sent
      await prisma.emailNotification.update({
        where: { id: notificationId },
        data: {
          isSent: true,
          sentAt: new Date(),
          error: null,
        },
      });
      return { success: true };
    } else {
      // Increment retry count
      await prisma.emailNotification.update({
        where: { id: notificationId },
        data: {
          retryCount: {
            increment: 1,
          },
          error: result.error ?? null,
        },
      });
      return { success: false, error: result.error || "Failed to send email" };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get email notification statistics
 */
export async function getEmailStats(): Promise<{
  total: number;
  sent: number;
  pending: number;
  failed: number;
  byEventType: Record<string, { total: number; sent: number }>;
}> {
  const [total, sent, pending, byEventType] = await Promise.all([
    prisma.emailNotification.count(),
    prisma.emailNotification.count({ where: { isSent: true } }),
    prisma.emailNotification.count({ where: { isSent: false } }),
    prisma.emailNotification.groupBy({
      by: ["eventType", "isSent"],
      _count: true,
    }),
  ]);

  // Process by event type
  const eventTypeStats: Record<string, { total: number; sent: number }> = {};
  for (const stat of byEventType) {
    if (!eventTypeStats[stat.eventType]) {
      eventTypeStats[stat.eventType] = { total: 0, sent: 0 };
    }
    const stats = eventTypeStats[stat.eventType];
    if (stats) {
      stats.total += stat._count;
      if (stat.isSent) {
        stats.sent += stat._count;
      }
    }
  }

  const failed = await prisma.emailNotification.count({
    where: {
      isSent: false,
      retryCount: {
        gte: prisma.emailNotification.fields.maxRetries,
      },
    },
  });

  return {
    total,
    sent,
    pending,
    failed,
    byEventType: eventTypeStats,
  };
}

/**
 * Clean up old sent emails (optional - for maintenance)
 */
export async function cleanupOldEmails(daysOld: number = 90): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await prisma.emailNotification.deleteMany({
    where: {
      isSent: true,
      sentAt: {
        lt: cutoffDate,
      },
    },
  });

  console.log(`🧹 Cleaned up ${result.count} old emails`);
  return result.count;
}

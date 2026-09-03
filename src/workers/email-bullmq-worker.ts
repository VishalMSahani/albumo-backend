import { Worker, type Job } from "bullmq";
import { createBullMQConnection } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";
import { sendTemplateEmail } from "../services/email.service.js";
import { getEmailTemplate } from "../utils/email-templates.js";
import type { EmailJobData } from "../lib/queue.js";

let worker: Worker<EmailJobData> | null = null;

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { notificationId, email, eventType, templateData } = job.data;

  // Generate HTML from template
  const template = getEmailTemplate(eventType, templateData);

  // Send the email
  const result = await sendTemplateEmail(email, template);

  if (result.success) {
    await prisma.emailNotification.update({
      where: { id: notificationId },
      data: { isSent: true, sentAt: new Date(), error: null },
    }).catch(() => null);
  } else {
    const msg = result.error ?? "Email send failed";
    // Config errors (bad credentials, no SMTP) are not worth retrying
    const isConfigError = /not configured|EAUTH|credentials/i.test(msg);
    if (isConfigError) {
      await prisma.emailNotification.update({
        where: { id: notificationId },
        data: { error: msg },
      }).catch(() => null);
      console.warn(`[EmailWorker] Skipping retry — SMTP config error: ${msg}`);
      return; // resolve the job without retrying
    }
    throw new Error(msg); // transient errors (network, timeout) → retry
  }
}

export function startEmailWorker(): Worker<EmailJobData> | null {
  if (!process.env.REDIS_URL) {
    console.warn("[EmailWorker] REDIS_URL not set — BullMQ email worker disabled, falling back to polling");
    return null;
  }

  if (worker) return worker;

  worker = new Worker<EmailJobData>("emails", processEmailJob, {
    connection: createBullMQConnection(),
    concurrency: 5,
    limiter: { max: 10, duration: 1_000 }, // max 10 emails/sec
  });

  worker.on("completed", (job: Job<EmailJobData>) => {
    console.log(`[EmailWorker] Sent: ${job.data.eventType} → ${job.data.email}`);
  });

  worker.on("failed", (job: Job<EmailJobData> | undefined, err: Error) => {
    const attempts = job?.attemptsMade ?? 0;
    const max = job?.opts?.attempts ?? 3;
    if (attempts >= max) {
      // Final failure — mark DB record with error
      if (job?.data.notificationId) {
        prisma.emailNotification.update({
          where: { id: job.data.notificationId },
          data: { error: err.message, retryCount: attempts },
        }).catch(() => null);
      }
      console.error(`[EmailWorker] Permanently failed: ${job?.data?.eventType} → ${job?.data?.email} — ${err.message}`);
    } else {
      console.warn(`[EmailWorker] Attempt ${attempts}/${max} failed: ${err.message} — retrying`);
    }
  });

  worker.on("error", (err: Error) => {
    console.error("[EmailWorker] Worker error:", err.message);
  });

  console.log("[EmailWorker] BullMQ email worker started (concurrency=5)");
  return worker;
}

export async function stopEmailWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log("[EmailWorker] Email worker stopped");
  }
}

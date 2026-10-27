import { queuePrefix } from "../lib/queue-config.js";
import { Worker } from "bullmq";
import { createBullMQConnection } from "../lib/redis.js";
import { retryEmailNotification } from "../services/email-notification.service.js";
import type { EmailJobData } from "../lib/queue.js";
let worker: Worker<EmailJobData> | null = null;
export function startEmailWorker() {
  if (!process.env.REDIS_URL) return null;
  if (worker) return worker;
  worker = new Worker<EmailJobData>(
    "emails",
    async (job) => {
      // The database lease is shared with polling/cron, preventing duplicate concurrent sends.
      // Backoff and retry exhaustion live in the outbox, not a second competing retry system.
      await retryEmailNotification(job.data.notificationId);
    },
    {
      connection: createBullMQConnection(),
      prefix: queuePrefix,
      concurrency: 1,
      limiter: { max: 1, duration: 650 },
    },
  );
  worker.on("error", () =>
    console.error(
      "[EmailWorker] Queue connection failed; database recovery remains available.",
    ),
  );
  return worker;
}
export async function stopEmailWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

import { Worker, type Job } from "bullmq";
import { createBullMQConnection } from "../lib/redis.js";
import type { WebhookRetryJobData } from "../lib/queue.js";

let worker: Worker<WebhookRetryJobData> | null = null;

async function processWebhookJob(job: Job<WebhookRetryJobData>): Promise<void> {
  const { url, payload, headers = {} } = job.data;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Webhook delivery failed: HTTP ${res.status} from ${url}`);
  }

  console.log(`[WebhookWorker] Delivered to ${url} (job ${job.id})`);
}

export function startWebhookRetryWorker(): Worker<WebhookRetryJobData> | null {
  if (!process.env.REDIS_URL) {
    console.warn("[WebhookWorker] REDIS_URL not set — webhook retry worker disabled");
    return null;
  }

  if (worker) return worker;

  worker = new Worker<WebhookRetryJobData>("webhook-retry", processWebhookJob, {
    connection: createBullMQConnection(),
    concurrency: 5,
  });

  worker.on("completed", (job: Job<WebhookRetryJobData>) => {
    console.log(`[WebhookWorker] Job ${job.id} completed — delivered to ${job.data.url}`);
  });

  worker.on("failed", (job: Job<WebhookRetryJobData> | undefined, err: Error) => {
    const attempts = job?.attemptsMade ?? 0;
    const max = job?.opts?.attempts ?? 5;
    if (attempts >= max) {
      console.error(`[WebhookWorker] Permanently failed (${attempts}/${max}): ${err.message}`);
    } else {
      console.warn(`[WebhookWorker] Attempt ${attempts}/${max} failed — retrying: ${err.message}`);
    }
  });

  worker.on("error", (err: Error) => {
    console.error("[WebhookWorker] Worker error:", err.message);
  });

  console.log("[WebhookWorker] Webhook retry worker started");
  return worker;
}

export async function stopWebhookRetryWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log("[WebhookWorker] Stopped");
  }
}

import { Queue } from "bullmq";
import { createBullMQConnection } from "./redis.js";
import type { EmailEventType } from "../generated/prisma/client.js";
import type { EmailTemplateData } from "../utils/email-templates.js";

// ─── Email Queue ──────────────────────────────────────────────────────────────

export type EmailJobData = {
  notificationId: string;
  email: string;
  eventType: EmailEventType;
  templateData: EmailTemplateData;
};

let _emailQueue: Queue<EmailJobData> | null = null;

export function getEmailQueue(): Queue<EmailJobData> | null {
  if (!process.env.REDIS_URL) return null;

  if (!_emailQueue) {
    _emailQueue = new Queue<EmailJobData>("emails", {
      connection: createBullMQConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });

    _emailQueue.on("error", (err: Error) => {
      console.error("[EmailQueue] Error:", err.message);
    });
  }

  return _emailQueue;
}

// ─── Webhook Retry Queue ──────────────────────────────────────────────────────

export type WebhookRetryJobData = {
  url: string;
  payload: unknown;
  headers?: Record<string, string>;
  orderId?: string;
  attempt: number;
};

let _webhookQueue: Queue<WebhookRetryJobData> | null = null;

export function getWebhookQueue(): Queue<WebhookRetryJobData> | null {
  if (!process.env.REDIS_URL) return null;

  if (!_webhookQueue) {
    _webhookQueue = new Queue<WebhookRetryJobData>("webhook-retry", {
      connection: createBullMQConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });

    _webhookQueue.on("error", (err: Error) => {
      console.error("[WebhookQueue] Error:", err.message);
    });
  }

  return _webhookQueue;
}

// ─── Stock Sync Queue ─────────────────────────────────────────────────────────

export type StockSyncJobData = {
  componentId?: string; // undefined = sync all low-stock items
};

let _stockQueue: Queue<StockSyncJobData> | null = null;

export function getStockQueue(): Queue<StockSyncJobData> | null {
  if (!process.env.REDIS_URL) return null;

  if (!_stockQueue) {
    _stockQueue = new Queue<StockSyncJobData>("stock-sync", {
      connection: createBullMQConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "fixed", delay: 30_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });

    _stockQueue.on("error", (err: Error) => {
      console.error("[StockQueue] Error:", err.message);
    });
  }

  return _stockQueue;
}

// ─── Tracking Poll Queue ──────────────────────────────────────────────────────

export type TrackingPollJobData = {
  orderId: string;
  awb: string;
};

let _trackingQueue: Queue<TrackingPollJobData> | null = null;

export function getTrackingQueue(): Queue<TrackingPollJobData> | null {
  if (!process.env.REDIS_URL) return null;

  if (!_trackingQueue) {
    _trackingQueue = new Queue<TrackingPollJobData>("tracking-poll", {
      connection: createBullMQConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    });

    _trackingQueue.on("error", (err: Error) => {
      console.error("[TrackingQueue] Error:", err.message);
    });
  }

  return _trackingQueue;
}

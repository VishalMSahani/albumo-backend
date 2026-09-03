import { Worker, type Job } from "bullmq";
import { createBullMQConnection } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";
import { OrderStatus } from "../generated/prisma/client.js";
import { queueEmailNotification } from "../services/email-notification.service.js";
import type { TrackingPollJobData } from "../lib/queue.js";

let worker: Worker<TrackingPollJobData> | null = null;

const SHIPROCKET_API = "https://apiv2.shiprocket.in/v1/external";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getShiprocketToken(): Promise<string | null> {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) return null;
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const res = await fetch(`${SHIPROCKET_API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { token?: string };
  if (!data.token) return null;

  cachedToken = { value: data.token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  return cachedToken.value;
}

async function processTrackingJob(job: Job<TrackingPollJobData>): Promise<void> {
  const { orderId, awb } = job.data;

  const token = await getShiprocketToken();
  if (!token) {
    console.warn("[TrackingWorker] Shiprocket credentials not configured — skipping poll");
    return;
  }

  const res = await fetch(`${SHIPROCKET_API}/courier/track/awb/${awb}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Shiprocket tracking API error: HTTP ${res.status}`);
  }

  const data = await res.json() as {
    tracking_data?: {
      shipment_status?: number;
      shipment_track?: Array<{ current_status?: string }>;
    };
  };

  const currentStatus = data.tracking_data?.shipment_track?.[0]?.current_status?.toLowerCase() ?? "";

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, status: true },
  });

  const terminalStatuses: string[] = [OrderStatus.DELIVERED, OrderStatus.CANCELLED];
  if (!order || terminalStatuses.includes(order.status)) return;

  if (currentStatus.includes("out for delivery") && order.status === OrderStatus.SHIPPED) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.OUT_FOR_DELIVERY },
    });
    console.log(`[TrackingWorker] Order ${orderId} → OUT_FOR_DELIVERY`);
  }

  if (currentStatus.includes("delivered") && !terminalStatuses.includes(order.status)) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DELIVERED, deliveredAt: new Date() },
    });
    await queueEmailNotification(
      order.userId,
      "ORDER_DELIVERED",
      { orderId },
    ).catch(() => null);
    console.log(`[TrackingWorker] Order ${orderId} → DELIVERED`);
  }
}

export function startTrackingPollWorker(): Worker<TrackingPollJobData> | null {
  if (!process.env.REDIS_URL) {
    console.warn("[TrackingWorker] REDIS_URL not set — tracking poll worker disabled");
    return null;
  }

  if (worker) return worker;

  worker = new Worker<TrackingPollJobData>("tracking-poll", processTrackingJob, {
    connection: createBullMQConnection(),
    concurrency: 3,
  });

  worker.on("completed", (job: Job<TrackingPollJobData>) => {
    console.log(`[TrackingWorker] Polled order ${job.data.orderId} (AWB: ${job.data.awb})`);
  });

  worker.on("failed", (job: Job<TrackingPollJobData> | undefined, err: Error) => {
    console.error(`[TrackingWorker] Failed for order ${job?.data.orderId}: ${err.message}`);
  });

  worker.on("error", (err: Error) => {
    console.error("[TrackingWorker] Worker error:", err.message);
  });

  console.log("[TrackingWorker] Tracking poll worker started");
  return worker;
}

export async function stopTrackingPollWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log("[TrackingWorker] Stopped");
  }
}

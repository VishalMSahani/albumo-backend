import { queuePrefix } from "../lib/queue-config.js";
import { Worker, type Job } from "bullmq";
import { createBullMQConnection } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";
import type { StockSyncJobData } from "../lib/queue.js";

const LOW_STOCK_THRESHOLD = 5;

let worker: Worker<StockSyncJobData> | null = null;

async function processStockSyncJob(job: Job<StockSyncJobData>): Promise<void> {
  const { componentId } = job.data;

  const where = componentId
    ? { id: componentId, isActive: true }
    : { isActive: true, stockQuantity: { lte: LOW_STOCK_THRESHOLD } };

  const components = await prisma.component.findMany({
    where,
    select: { id: true, name: true, stockQuantity: true, sku: true },
  });

  const lowStock = componentId
    ? components.filter((c) => c.stockQuantity <= LOW_STOCK_THRESHOLD)
    : components;

  if (lowStock.length === 0) return;

  console.log(
    `[StockWorker] ${lowStock.length} low-stock component(s) detected`,
  );
}

export function startStockSyncWorker(): Worker<StockSyncJobData> | null {
  if (!process.env.REDIS_URL) {
    console.warn(
      "[StockWorker] REDIS_URL not set — stock sync worker disabled",
    );
    return null;
  }

  if (worker) return worker;

  worker = new Worker<StockSyncJobData>("stock-sync", processStockSyncJob, {
    connection: createBullMQConnection(),
    prefix: queuePrefix,
    concurrency: 2,
  });

  worker.on("completed", (job: Job<StockSyncJobData>) => {
    const target = job.data.componentId ?? "all";
    console.log(`[StockWorker] Stock check done for: ${target}`);
  });

  worker.on("failed", (job: Job<StockSyncJobData> | undefined, err: Error) => {
    console.error(`[StockWorker] Job failed: ${err.message}`);
  });

  worker.on("error", (err: Error) => {
    console.error("[StockWorker] Worker error:", err.message);
  });

  console.log("[StockWorker] Stock sync worker started");
  return worker;
}

export async function stopStockSyncWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log("[StockWorker] Stopped");
  }
}

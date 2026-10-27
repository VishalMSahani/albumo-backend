import { randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Worker } from "bullmq";
import { z } from "zod";
import { queuePrefix } from "../lib/queue-config.js";
import { redis } from "../lib/redis.js";
import { validate } from "../middlewares/validate.middleware.js";
import { scheduledJobs } from "../services/scheduled-jobs.service.js";
import {
  startEmailWorker,
  stopEmailWorker,
} from "../workers/email-bullmq-worker.js";
import {
  startWebhookRetryWorker,
  stopWebhookRetryWorker,
} from "../workers/webhook-retry-worker.js";
import {
  startStockSyncWorker,
  stopStockSyncWorker,
} from "../workers/stock-sync-worker.js";
import {
  startTrackingPollWorker,
  stopTrackingPollWorker,
} from "../workers/tracking-poll-worker.js";

// Stop accepting new jobs after the queue drains or the batch budget expires.
// close() waits for active work before the function returns.
async function drainWorker(worker: Worker | null) {
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, 20_000);
    function cleanup() {
      clearTimeout(timer);
      worker!.off("drained", done);
      worker!.off("error", failed);
    }
    function done() {
      cleanup();
      resolve();
    }
    function failed(error: Error) {
      cleanup();
      reject(error);
    }
    worker.once("drained", done);
    worker.once("error", failed);
  });
}

const router: Router = Router();
router.get(
  "/jobs",
  validate({ query: z.object({}).strict() }),
  async (req, res, next) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || !redis) {
      res.status(503).json({
        success: false,
        error: "CRON_SECRET and REDIS_URL are required for job processing",
      });
      return;
    }
    const expected = Buffer.from(`Bearer ${secret}`);
    const actual = Buffer.from(req.get("authorization") ?? "");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const lock = randomUUID();
    const lockKey = `${queuePrefix}:scheduled-jobs:lock`;
    try {
      if (!(await redis.set(lockKey, lock, "EX", 300, "NX"))) {
        res
          .status(202)
          .json({ success: true, message: "A job batch is already running" });
        return;
      }
      try {
        const completed: string[] = [];
        const failed: string[] = [];
        for (const job of scheduledJobs) {
          const lastRunKey = `${queuePrefix}:scheduled-jobs:${job.name}:last-run`;
          const lastRun = Number((await redis.get(lastRunKey)) ?? 0);
          if (Date.now() - lastRun < job.interval) continue;
          try {
            await job.run();
            await redis.set(lastRunKey, String(Date.now()));
            completed.push(job.name);
          } catch {
            // A storage/maintenance failure must not prevent queued emails from being sent.
            failed.push(job.name);
          }
        }
        try {
          // Stock checks can enqueue emails, so drain their queues before the email queue.
          await Promise.all([
            drainWorker(startStockSyncWorker()),
            drainWorker(startTrackingPollWorker()),
            drainWorker(startWebhookRetryWorker()),
          ]);
          await Promise.all([
            stopStockSyncWorker(),
            stopTrackingPollWorker(),
            stopWebhookRetryWorker(),
          ]);
          await drainWorker(startEmailWorker());
        } finally {
          await Promise.all([
            stopEmailWorker(),
            stopStockSyncWorker(),
            stopTrackingPollWorker(),
            stopWebhookRetryWorker(),
          ]);
        }
        res
          .status(failed.length ? 503 : 200)
          .json({ success: failed.length === 0, data: { completed, failed } });
      } finally {
        await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lockKey,
          lock,
        );
      }
    } catch (error) {
      next(error);
    }
  },
);
export default router;

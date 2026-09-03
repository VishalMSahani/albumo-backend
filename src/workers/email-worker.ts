/**
 * Legacy polling email worker — superseded by BullMQ inline worker in server.ts.
 *
 * The BullMQ worker (email-bullmq-worker.ts) starts automatically when the API
 * server boots. This file is kept as a fallback for environments without Redis:
 *   node dist/workers/email-worker.js
 *
 * It polls the EmailNotification table for unsent records and processes them.
 */

import "dotenv/config";
import { processPendingEmails } from "../services/email-notification.service.js";

async function runOnce() {
  try {
    console.log(`[LegacyEmailWorker] Starting at ${new Date().toISOString()}`);
    const result = await processPendingEmails(50);
    console.log(`[LegacyEmailWorker] Done — processed:${result.processed} ok:${result.successful} failed:${result.failed}`);
  } catch (err) {
    console.error("[LegacyEmailWorker] Fatal:", err);
    process.exit(1);
  }
}

async function runContinuous(intervalMinutes = 2) {
  console.log(`[LegacyEmailWorker] Continuous mode (every ${intervalMinutes}m)`);
  await runOnce();
  setInterval(() => void runOnce(), intervalMinutes * 60 * 1000);
}

const [mode = "once", interval = "2"] = process.argv.slice(2);

if (mode === "continuous") {
  void runContinuous(parseInt(interval, 10));
} else {
  void runOnce().then(() => process.exit(0));
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

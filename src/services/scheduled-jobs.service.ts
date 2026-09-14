import cron from "node-cron";
import { recoverAuthEmails } from "./auth-email.service.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getStockQueue, getTrackingQueue } from "../lib/queue.js";
import { processAbandonedCarts } from "./abandoned-cart.service.js";
import { getPrivateContainerClient } from "./azure-storage.service.js";

export async function cancelStaleOrders() {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const stale = await prisma.order.findMany({
      where: { status: "PENDING_PAYMENT", createdAt: { lt: cutoff } },
      include: { items: { select: { componentId: true, quantity: true } } },
    });

    for (const order of stale) {
      await prisma.$transaction(async (tx) => {
        // Claim the transition while holding the row lock; retries cannot restore stock twice.
        const claimed = await tx.order.updateMany({
          where: { id: order.id, status: "PENDING_PAYMENT" },
          data: { status: "CANCELLED", notes: "Auto-cancelled: payment not completed within 30 minutes" },
        });
        if (claimed.count === 0) return;
        // Restore stock
        await Promise.all(
          order.items
            .filter((i) => i.componentId)
            .map((i) =>
              tx.component.update({
                where: { id: i.componentId! },
                data: { stockQuantity: { increment: i.quantity } },
              })
            )
        );
        await tx.payment.updateMany({
          where: { orderId: order.id, status: "CREATED" },
          data: { status: "FAILED" },
        });
        const printOrder = await tx.threeDPrintOrder.findUnique({
          where: { commerceOrderId: order.id },
          select: { id: true },
        });
        if (printOrder) {
          await tx.threeDPrintOrder.update({
            where: { id: printOrder.id },
            data: { status: "CANCELLED" },
          });
          await tx.threeDPrintStatusEvent.create({
            data: {
              printOrderId: printOrder.id,
              status: "CANCELLED",
              note: "Payment was not completed within 30 minutes",
              actorLabel: "System",
            },
          });
        }
      });
      logger.info("stale order auto-cancelled", { orderId: order.id });
    }
  } catch (err) {
    logger.error("stale order cancellation failed", { error: err });
    throw err;
  }
}

export async function cleanupSessions() {
  try {
    const [result] = await prisma.$transaction([
      prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } }),
      prisma.authThrottle.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    ]);
    logger.info("expired sessions deleted", { count: result.count });
  } catch (err) {
    logger.error("session cleanup failed", { error: err });
    throw err;
  }
}

export async function queueStockChecks() {
  const stockQueue = getStockQueue();
  if (stockQueue) {
    await stockQueue.add("check-all", {});
  }
}

export async function queueTrackingUpdates() {
  const trackingQueue = getTrackingQueue();
  if (!trackingQueue) return;

  const shippedOrders = await prisma.order.findMany({
    where: { status: { in: ["SHIPPED", "OUT_FOR_DELIVERY"] }, trackingAwb: { not: null } },
    select: { id: true, trackingAwb: true },
  });

  for (const order of shippedOrders) {
    if (!order.trackingAwb) continue;
    await trackingQueue.add(`poll-${order.id}`, { orderId: order.id, awb: order.trackingAwb }, {
      jobId: `track-${order.id}`, // deduplicate — one poll per order at a time
    });
  }
  if (shippedOrders.length > 0) {
    logger.info("tracking poll queued", { count: shippedOrders.length });
  }
}

export async function remindAbandonedCarts() {
  try {
    await processAbandonedCarts();
  } catch (err) {
    logger.error("abandoned cart cron failed", { error: err });
    throw err;
  }
}

export async function cleanupStagedUploads() {
  if (!process.env.AZURE_STORAGE_CONNECTION_STRING) return;
  const container = await getPrivateContainerClient();
  const cutoff = Date.now() - 24 * 60 * 60_000;
  let removed = 0;
  for await (const blob of container.listBlobsFlat({ prefix: "staging/" })) {
    if (blob.properties.createdOn && blob.properties.createdOn.getTime() < cutoff) {
      await container.deleteBlob(blob.name);
      if (++removed >= 100) break;
    }
  }
}

export const scheduledJobs = [
  { name: "recoverAuthEmails", schedule: "* * * * *", interval: 60000, run: recoverAuthEmails },
  { name: "cleanupStagedUploads", schedule: "17 3 * * *", interval: 86400000, run: cleanupStagedUploads },
  { name: "cancelStaleOrders", schedule: "*/5 * * * *", interval: 300000, run: cancelStaleOrders },
  { name: "cleanupSessions", schedule: "7 3 * * *", interval: 86400000, run: cleanupSessions },
  { name: "queueStockChecks", schedule: "13 * * * *", interval: 3600000, run: queueStockChecks },
  { name: "queueTrackingUpdates", schedule: "*/30 * * * *", interval: 1800000, run: queueTrackingUpdates },
  { name: "remindAbandonedCarts", schedule: "*/30 * * * *", interval: 1800000, run: remindAbandonedCarts },
] as const;

export function registerScheduledJobs() {
  return scheduledJobs.map(job => cron.schedule(job.schedule, job.run));
}

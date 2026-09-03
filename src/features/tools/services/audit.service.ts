import { logger } from "../../../lib/logger.js";

export async function logAction(
  userId: string | null,
  actionType: "checkout" | "bulk_order" | "track_order",
  outcome: "success" | "error",
  details?: Record<string, unknown>
): Promise<void> {
  const timestamp = new Date();
  
  // Safe filtering of card / payment credentials to keep PCI scope out of logs
  const safeDetails = details ? { ...details } : {};
  delete safeDetails.card;
  delete safeDetails.payment;
  delete safeDetails.cvv;
  delete safeDetails.otp;
  delete safeDetails.pin;
  delete safeDetails.cardNumber;
  delete safeDetails.cardExpiry;

  logger.info(`[Action Audit Log]`, {
    userId,
    actionType,
    outcome,
    timestamp: timestamp.toISOString(),
    details: safeDetails,
  });
}

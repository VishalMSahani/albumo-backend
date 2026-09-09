import crypto from "crypto";
import type { Request, Response } from "express";
import { logger } from "../../lib/logger.js";

function constantTimeMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);

  return receivedBytes.length === expectedBytes.length
    && crypto.timingSafeEqual(receivedBytes, expectedBytes);
}

function isValidSignature(payload: Buffer, signature: string, appSecret: string): boolean {
  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(payload)
    .digest("hex")}`;

  return constantTimeMatch(signature, expectedSignature);
}

function getSingleQueryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Meta calls this endpoint before saving the callback URL. The challenge must
 * be returned verbatim as plain text when the configured verify token matches.
 */
export async function verifyWhatsAppWebhook(req: Request, res: Response): Promise<void> {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!verifyToken) {
    logger.error("WhatsApp webhook verification attempted without a configured verify token");
    res.status(503).json({ success: false, error: "WhatsApp webhook is not configured" });
    return;
  }

  const receivedToken = getSingleQueryValue(req.query["hub.verify_token"]);
  const challenge = getSingleQueryValue(req.query["hub.challenge"]);

  if (!receivedToken || !challenge) {
    res.status(400).json({ success: false, error: "Invalid WhatsApp webhook verification request" });
    return;
  }

  if (!constantTimeMatch(receivedToken, verifyToken)) {
    logger.warn("WhatsApp webhook verification rejected");
    res.sendStatus(403);
    return;
  }

  res.status(200).type("text/plain").send(challenge);
}

/**
 * This verifies that an incoming request was signed by Meta, then acknowledges
 * it. Event processing is deliberately not enabled until the messaging phase.
 */
export async function acknowledgeWhatsAppWebhook(req: Request, res: Response): Promise<void> {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const signature = req.get("x-hub-signature-256");
  const payload = Buffer.isBuffer(req.body) ? req.body : undefined;

  if (!appSecret) {
    logger.error("WhatsApp webhook received without an app secret configured");
    res.status(503).json({ success: false, error: "WhatsApp webhook is not configured" });
    return;
  }

  if (!payload || !signature || !isValidSignature(payload, signature, appSecret)) {
    logger.warn("WhatsApp webhook signature validation failed");
    res.sendStatus(401);
    return;
  }

  let entryCount = 0;
  try {
    const webhookPayload: unknown = JSON.parse(payload.toString("utf8"));
    if (isRecord(webhookPayload) && Array.isArray(webhookPayload.entry)) {
      entryCount = webhookPayload.entry.length;
    }
  } catch {
    logger.warn("WhatsApp webhook payload was not valid JSON");
    res.status(400).json({ success: false, error: "Invalid WhatsApp webhook payload" });
    return;
  }

  // Do not log phone numbers, message bodies, or other customer data here.
  logger.info("WhatsApp webhook acknowledged", { entryCount });
  res.status(200).json({ success: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

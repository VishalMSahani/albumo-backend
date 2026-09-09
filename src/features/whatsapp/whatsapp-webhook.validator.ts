import { z } from "zod";

/** The query parameters Meta supplies while verifying a WhatsApp webhook. */
export const whatsappWebhookVerificationQuerySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1).max(512),
  "hub.challenge": z.string().min(1).max(2_048),
}).passthrough();

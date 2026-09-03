import { z } from "zod";

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  sessionId: z.string().trim().min(6).max(160),
});

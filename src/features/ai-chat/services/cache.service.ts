import { createHash } from "node:crypto";
import { cacheGet, cacheSet } from "../../../lib/redis.js";
import type { ChatClassification } from "../types/chat.types.js";

const STATIC_CHAT_CACHE_TTL_SECONDS = 86_400;
const STATIC_HINTS = [
  "faq",
  "policy",
  "policies",
  "privacy",
  "terms",
  "refund",
  "return policy",
  "shipping policy",
  "warranty",
];
const USER_SPECIFIC_HINTS = ["order", "track", "payment", "invoice", "cancel", "history", "stock", "price", "buy"];

interface CachedChatAnswer {
  answer: string;
  createdAt: string;
}

export function isStaticChatCacheCandidate(message: string, intent: ChatClassification["intent"]): boolean {
  if (intent !== "knowledge") return false;

  const normalized = message.toLowerCase();
  const hasStaticHint = STATIC_HINTS.some((hint) => normalized.includes(hint));
  const hasUserSpecificHint = USER_SPECIFIC_HINTS.some((hint) => normalized.includes(hint));
  return hasStaticHint && !hasUserSpecificHint;
}

export async function getCachedStaticChatAnswer(message: string): Promise<string | null> {
  const cached = await cacheGet<CachedChatAnswer>(chatCacheKey(message));
  return cached?.answer ?? null;
}

export async function setCachedStaticChatAnswer(message: string, answer: string): Promise<void> {
  await cacheSet(chatCacheKey(message), {
    answer,
    createdAt: new Date().toISOString(),
  }, STATIC_CHAT_CACHE_TTL_SECONDS);
}

function chatCacheKey(message: string): string {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, " ");
  const digest = createHash("sha256").update(normalized).digest("hex");
  return `chat:${digest}`;
}

import { redis } from "../../../lib/redis.js";
import type { ChatSessionTurn } from "../types/chat.types.js";

const DEFAULT_SESSION_TTL_SECONDS = 3600;
const MAX_SESSION_ITEMS = 8;

function sessionKey(userId: string, sessionId: string): string {
  return `session:${userId}:${sessionId}`;
}

export async function loadSessionHistory(userId: string, sessionId: string): Promise<ChatSessionTurn[]> {
  if (!redis) return [];

  const items = await redis.lrange(sessionKey(userId, sessionId), -MAX_SESSION_ITEMS, -1);
  return items.flatMap((item) => {
    try {
      return [JSON.parse(item) as ChatSessionTurn];
    } catch {
      return [];
    }
  });
}

export async function saveSessionTurn(userId: string, sessionId: string, userMessage: string, assistantMessage: string): Promise<void> {
  if (!redis) return;

  const key = sessionKey(userId, sessionId);
  const now = new Date().toISOString();
  const turns: ChatSessionTurn[] = [
    { role: "user", content: userMessage, createdAt: now },
    { role: "assistant", content: assistantMessage, createdAt: now },
  ];

  await redis.rpush(key, ...turns.map((turn) => JSON.stringify(turn)));
  await redis.ltrim(key, -MAX_SESSION_ITEMS, -1);
  await redis.expire(key, Number(process.env.CHAT_SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL_SECONDS));
}

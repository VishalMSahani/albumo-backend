import { Redis } from "ioredis";
import { logger } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL;

function createRedisClient(): Redis | null {
  if (!REDIS_URL) {
    logger.warn("redis disabled", { reason: "REDIS_URL not set" });
    return null;
  }

  const isLocal = REDIS_URL.includes("localhost") || REDIS_URL.includes("127.0.0.1");
  
  const client = new Redis(REDIS_URL, {
    ...(isLocal ? {} : { tls: {} }),
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 2000)),
    enableOfflineQueue: true,
  });

  client.on("error", (err: Error) => {
    logger.error("redis connection error", { error: err });
  });

  client.on("connect", () => {
    logger.info("redis connected");
  });

  return client;
}

export const redis = createRedisClient();

/**
 * Creates a dedicated ioredis connection for BullMQ.
 * BullMQ requires maxRetriesPerRequest: null and its own separate connection.
 * Throws if REDIS_URL is not set (BullMQ is not optional).
 */
export function createBullMQConnection(): Redis {
  if (!REDIS_URL) throw new Error("REDIS_URL is required for BullMQ email queue");
  const isLocal = REDIS_URL.includes("localhost") || REDIS_URL.includes("127.0.0.1");
  
  return new Redis(REDIS_URL, {
    ...(isLocal ? {} : { tls: {} }),
    maxRetriesPerRequest: null, // required by BullMQ
    retryStrategy: (times: number) => Math.min(times * 500, 10_000),
    enableOfflineQueue: true,
  });
}

const DEFAULT_TTL = 60; // seconds

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = DEFAULT_TTL): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // cache miss is non-fatal
  }
}

export async function cacheInvalidate(...patterns: string[]): Promise<void> {
  if (!redis) return;
  try {
    const pipeline = redis.pipeline();
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      for (const key of keys) pipeline.del(key);
    }
    await pipeline.exec();
  } catch {
    // invalidation failure is non-fatal
  }
}

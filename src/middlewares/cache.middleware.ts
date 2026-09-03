import type { Request, Response, NextFunction } from "express";
import { cacheGet, cacheSet } from "../lib/redis.js";

/**
 * HTTP response caching middleware.
 * Caches GET responses by URL (including query string) for `ttlSeconds`.
 * If Redis is unavailable, the request passes through with no caching.
 */
export function cacheResponse(ttlSeconds = 60) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cacheKey = `http:${req.originalUrl}`;
    res.setHeader(
      "Cache-Control",
      `public, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 6}`,
    );
    const cached = await cacheGet<{ status: number; body: unknown }>(cacheKey);

    if (cached) {
      res.status(cached.status).json(cached.body);
      return;
    }

    const originalJson = res.json.bind(res);

    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void cacheSet(cacheKey, { status: res.statusCode, body }, ttlSeconds);
      }
      return originalJson(body);
    };

    next();
  };
}

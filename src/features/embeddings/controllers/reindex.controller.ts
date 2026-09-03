import type { Request, Response } from "express";
import { logger } from "../../../lib/logger.js";
import { reindexCatalogItem } from "../services/catalog-item-indexer.service.js";
import { reindexCatalogItemSchema } from "../validators/reindex.validator.js";

export async function reindexCatalogItemHandler(req: Request, res: Response): Promise<void> {
  const parsed = reindexCatalogItemSchema.parse(req.body);
  const startedAt = Date.now();

  const result = await reindexCatalogItem(parsed.sourceType, parsed.sourceId, parsed.action);
  logger.info("catalog item reindexed", {
    sourceType: parsed.sourceType,
    sourceId: parsed.sourceId,
    action: parsed.action,
    storedChunks: result.storedChunks,
    deletedChunks: result.deletedChunks,
    durationMs: Date.now() - startedAt,
    adminUserId: req.user?.userId,
  });

  res.json({
    success: true,
    data: result,
    message: "Catalog index updated",
  });
}

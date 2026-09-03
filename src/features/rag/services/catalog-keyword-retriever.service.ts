import { prisma } from "../../../lib/prisma.js";
import type { CatalogRetrievalHit } from "../types/rag.types.js";

interface KeywordHitRow {
  id: string;
  sourceType: string;
  sourceId: string;
  chunkText: string;
  metadata: unknown;
  keywordScore: number;
}

export async function keywordSearchCatalog(
  query: string,
  limit = 20,
  filters?: { category?: string; brand?: string; sourceType?: string }
): Promise<CatalogRetrievalHit[]> {
  const categoryFilter = filters?.category ? filters.category : null;
  const brandFilter = filters?.brand ? filters.brand : null;
  const sourceTypeFilter = filters?.sourceType ? filters.sourceType : null;

  const rows = await prisma.$queryRaw<KeywordHitRow[]>`
    SELECT
      "id",
      "sourceType"::text AS "sourceType",
      "sourceId",
      "chunkText",
      "metadata",
      similarity("chunkText", ${query}) AS "keywordScore"
    FROM "RagChunk"
    WHERE similarity("chunkText", ${query}) > 0.2
      AND (${categoryFilter}::text IS NULL OR "metadata"->>'category' = ${categoryFilter})
      AND (${brandFilter}::text IS NULL OR "metadata"->>'brand' = ${brandFilter})
      AND (${sourceTypeFilter}::text IS NULL OR "sourceType"::text = ${sourceTypeFilter})
    ORDER BY similarity("chunkText", ${query}) DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    kind: "catalog",
    id: row.id,
    sourceType: normalizeSourceType(row.sourceType),
    sourceId: row.sourceId,
    title: titleFromMetadata(row.metadata, row.sourceId),
    text: row.chunkText,
    keywordScore: Number(row.keywordScore),
    catalogScore: Number(row.keywordScore),
    metadata: metadataRecord(row.metadata),
  }));
}

function normalizeSourceType(sourceType: string): CatalogRetrievalHit["sourceType"] {
  const normalized = sourceType.toLowerCase();
  if (normalized === "component" || normalized === "project" || normalized === "faq" || normalized === "short_policy") {
    return normalized;
  }

  return "component";
}

function titleFromMetadata(metadata: unknown, fallback: string): string {
  const record = metadataRecord(metadata);
  const title = record.title ?? record.name ?? record.sku;
  return typeof title === "string" ? title : fallback;
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
}

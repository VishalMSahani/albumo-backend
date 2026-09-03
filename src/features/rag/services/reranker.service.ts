import type { CatalogRetrievalHit, DocumentTreeRetrievalHit } from "../types/rag.types.js";

export function mergeAndRerankCatalog(
  vectorHits: CatalogRetrievalHit[],
  keywordHits: CatalogRetrievalHit[],
  limit = 8,
): CatalogRetrievalHit[] {
  const merged = new Map<string, CatalogRetrievalHit>();
  const k = 60; // RRF constant

  const vectorRanks = new Map<string, number>();
  vectorHits.forEach((hit, idx) => {
    vectorRanks.set(hit.id, idx + 1);
  });

  const keywordRanks = new Map<string, number>();
  keywordHits.forEach((hit, idx) => {
    keywordRanks.set(hit.id, idx + 1);
  });

  for (const hit of vectorHits) {
    merged.set(hit.id, { ...hit });
  }

  for (const hit of keywordHits) {
    const existing = merged.get(hit.id);
    if (existing) {
      if (hit.keywordScore !== undefined) existing.keywordScore = hit.keywordScore;
    } else {
      merged.set(hit.id, { ...hit });
    }
  }

  for (const [id, hit] of merged.entries()) {
    const vectorRank = vectorRanks.get(id);
    const keywordRank = keywordRanks.get(id);

    const rrfVectorScore = vectorRank ? 1 / (k + vectorRank) : 0;
    const rrfKeywordScore = keywordRank ? 1 / (k + keywordRank) : 0;

    hit.catalogScore = rrfVectorScore + rrfKeywordScore;
  }

  return Array.from(merged.values())
    .sort((a, b) => b.catalogScore - a.catalogScore)
    .slice(0, limit);
}

export function rerankDocumentHits(documentHits: DocumentTreeRetrievalHit[], limit = 4): DocumentTreeRetrievalHit[] {
  return [...documentHits]
    .sort((a, b) => b.reasoningScore - a.reasoningScore)
    .slice(0, limit);
}

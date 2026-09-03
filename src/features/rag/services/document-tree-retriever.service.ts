import { prisma } from "../../../lib/prisma.js";
import type { DocumentTreeRetrievalHit } from "../types/rag.types.js";

interface DocumentNodeRow {
  id: string;
  documentId: string;
  nodeId: string;
  title: string;
  summary: string;
  fullText: string | null;
  startPage: number | null;
  endPage: number | null;
  metadata: unknown;
  reasoningScore: number;
}

export async function retrieveDocumentTree(query: string, limit = 8): Promise<DocumentTreeRetrievalHit[]> {
  const rows = await prisma.$queryRaw<DocumentNodeRow[]>`
    SELECT
      "DocumentNode"."id",
      "DocumentNode"."documentId",
      "DocumentNode"."nodeId",
      "DocumentNode"."title",
      "DocumentNode"."summary",
      "DocumentNode"."fullText",
      "DocumentNode"."startPage",
      "DocumentNode"."endPage",
      "DocumentNode"."metadata",
      GREATEST(
        similarity("DocumentNode"."title", ${query}),
        similarity("DocumentNode"."summary", ${query})
      ) AS "reasoningScore"
    FROM "DocumentNode"
    WHERE GREATEST(
      similarity("DocumentNode"."title", ${query}),
      similarity("DocumentNode"."summary", ${query})
    ) > 0.04
    ORDER BY "reasoningScore" DESC, "DocumentNode"."sortOrder" ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => {
    const hit: DocumentTreeRetrievalHit = {
      kind: "document",
      id: row.id,
      documentId: row.documentId,
      nodeId: row.nodeId,
      title: row.title,
      summary: row.summary,
      reasoningScore: Number(row.reasoningScore),
      metadata: metadataRecord(row.metadata),
    };

    const excerpt = buildExcerpt(row.fullText);
    if (excerpt !== undefined) hit.excerpt = excerpt;
    if (row.startPage !== null) hit.startPage = row.startPage;
    if (row.endPage !== null) hit.endPage = row.endPage;

    return hit;
  });
}

function buildExcerpt(fullText: string | null): string | undefined {
  if (!fullText) return undefined;
  const text = fullText.replace(/\s+/g, " ").trim();
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
}

import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import type { EmbeddedChunk, EmbeddingChunk, EmbeddingSourceType } from "../types/embeddings.types.js";
import { embedTexts } from "./embedder.service.js";

const DB_SOURCE_TYPE: Record<EmbeddingSourceType, string> = {
  component: "COMPONENT",
  project: "PROJECT",
  faq: "FAQ",
  short_policy: "SHORT_POLICY",
};

export interface EmbedAndStoreOptions {
  batchSize?: number;
}

export async function embedAndStore(chunks: EmbeddingChunk[], options: EmbedAndStoreOptions = {}): Promise<number> {
  const batchSize = options.batchSize ?? 100;
  let stored = 0;

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    // Indexed corpus must be embedded as "passage" for asymmetric models.
    const embeddings = await embedTexts(batch.map((chunk) => chunk.chunkText), { inputType: "passage" });
    const embedded = batch.map<EmbeddedChunk>((chunk, index) => ({
      ...chunk,
      embedding: getEmbeddingAt(embeddings, index),
    }));

    await storeEmbeddedChunks(embedded);
    stored += embedded.length;
  }

  return stored;
}

function getEmbeddingAt(embeddings: number[][], index: number): number[] {
  const embedding = embeddings[index];
  if (!embedding) {
    throw new Error(`Missing embedding at index ${index}`);
  }

  return embedding;
}

export async function storeEmbeddedChunks(chunks: EmbeddedChunk[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const chunk of chunks) {
      const sourceType = DB_SOURCE_TYPE[chunk.sourceType];
      const vector = toVectorLiteral(chunk.embedding);
      const metadata = JSON.stringify(chunk.metadata);

      await tx.$executeRaw`
        DELETE FROM "RagChunk"
        WHERE "sourceType" = ${sourceType}::"RagChunkSourceType"
          AND "sourceId" = ${chunk.sourceId}
      `;

      await tx.$executeRaw`
        INSERT INTO "RagChunk" ("id", "sourceType", "sourceId", "chunkText", "metadata", "embedding")
        VALUES (
          ${randomUUID()},
          ${sourceType}::"RagChunkSourceType",
          ${chunk.sourceId},
          ${chunk.chunkText},
          ${metadata}::jsonb,
          ${vector}::vector
        )
      `;
    }
  }, {
    maxWait: 10_000,
    timeout: 60_000,
  });
}

export async function deleteSourceChunks(sourceType: EmbeddingSourceType, sourceId: string): Promise<number> {
  const dbSourceType = DB_SOURCE_TYPE[sourceType];
  const deleted = await prisma.$executeRaw`
    DELETE FROM "RagChunk"
    WHERE "sourceType" = ${dbSourceType}::"RagChunkSourceType"
      AND "sourceId" = ${sourceId}
  `;

  return Number(deleted);
}

function toVectorLiteral(values: number[]): string {
  const expectedDimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1024);
  if (values.length !== expectedDimensions) {
    throw new Error(`Expected ${expectedDimensions}-dimensional embedding, received ${values.length}`);
  }

  return `[${values.map(formatVectorNumber).join(",")}]`;
}

function formatVectorNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Embedding contains a non-finite value");
  }

  return Number(value).toFixed(8);
}

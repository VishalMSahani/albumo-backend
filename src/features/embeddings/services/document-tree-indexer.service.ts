import { randomUUID } from "node:crypto";
import { prisma } from "../../../lib/prisma.js";
import type { DocumentSourceType, DocumentTreeInput, DocumentTreeNodeInput } from "../types/embeddings.types.js";

const DB_DOCUMENT_SOURCE_TYPE: Record<DocumentSourceType, string> = {
  manual: "MANUAL",
  datasheet: "DATASHEET",
  policy: "POLICY",
  tutorial: "TUTORIAL",
  project_report: "PROJECT_REPORT",
  course_material: "COURSE_MATERIAL",
};

export async function storeDocumentTree(document: DocumentTreeInput): Promise<string> {
  const documentId = randomUUID();
  const sourceType = DB_DOCUMENT_SOURCE_TYPE[document.sourceType];
  const metadata = JSON.stringify(document.metadata);

  if (document.sourceId) {
    await prisma.$executeRaw`
      DELETE FROM "Document"
      WHERE "sourceType" = ${sourceType}::"RagDocumentSourceType"
        AND "sourceId" = ${document.sourceId}
    `;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "Document" ("id", "title", "sourceType", "sourceId", "fileUrl", "metadata", "updatedAt")
      VALUES (
        ${documentId},
        ${document.title},
        ${sourceType}::"RagDocumentSourceType",
        ${document.sourceId ?? null},
        ${document.fileUrl ?? null},
        ${metadata}::jsonb,
        CURRENT_TIMESTAMP
      )
    `;

    for (let index = 0; index < document.nodes.length; index += 1) {
      const node = document.nodes[index];
      if (node) {
        await insertNode(tx, documentId, null, node, index);
      }
    }
  }, {
    maxWait: 10_000,
    timeout: 60_000,
  });

  return documentId;
}

async function insertNode(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
  documentId: string,
  parentId: string | null,
  node: DocumentTreeNodeInput,
  sortOrder: number,
): Promise<void> {
  const nodeDbId = randomUUID();
  const metadata = JSON.stringify({});

  await tx.$executeRaw`
    INSERT INTO "DocumentNode" (
      "id",
      "documentId",
      "parentId",
      "nodeId",
      "title",
      "summary",
      "fullText",
      "startPage",
      "endPage",
      "startIndex",
      "endIndex",
      "sortOrder",
      "metadata"
    )
    VALUES (
      ${nodeDbId},
      ${documentId},
      ${parentId},
      ${node.nodeId},
      ${node.title},
      ${node.summary},
      ${node.fullText ?? null},
      ${node.startPage ?? null},
      ${node.endPage ?? null},
      ${node.startIndex ?? null},
      ${node.endIndex ?? null},
      ${sortOrder},
      ${metadata}::jsonb
    )
  `;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (child) {
      await insertNode(tx, documentId, nodeDbId, child, index);
    }
  }
}

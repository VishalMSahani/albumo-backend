import { prisma } from "../../../lib/prisma.js";
import type { GraphRetrievalHit } from "../types/rag.types.js";

interface GraphRow {
  sourceComponentId: string;
  targetComponentId: string;
  relationType: GraphRetrievalHit["relationType"];
}

export async function getRelated(componentIds: string[], maxHops = 2): Promise<GraphRetrievalHit[]> {
  if (componentIds.length === 0) return [];

  const rows = await prisma.$queryRaw<GraphRow[]>`
    WITH RECURSIVE relation_tree AS (
      SELECT
        "sourceComponentId",
        "targetComponentId",
        LOWER("type"::text) AS "relationType",
        1 AS depth
      FROM "ComponentRelation"
      WHERE "sourceComponentId" = ANY(${componentIds}::text[])

      UNION ALL

      SELECT
        relation."sourceComponentId",
        relation."targetComponentId",
        LOWER(relation."type"::text) AS "relationType",
        relation_tree.depth + 1 AS depth
      FROM "ComponentRelation" relation
      INNER JOIN relation_tree
        ON relation."sourceComponentId" = relation_tree."targetComponentId"
      WHERE relation_tree.depth < ${maxHops}
    )
    SELECT DISTINCT "sourceComponentId", "targetComponentId", "relationType"
    FROM relation_tree
    LIMIT 24
  `;

  return rows.map((row) => ({
    kind: "graph",
    sourceComponentId: row.sourceComponentId,
    targetComponentId: row.targetComponentId,
    relationType: row.relationType,
  }));
}

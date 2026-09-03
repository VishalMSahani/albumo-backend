import type { CatalogRetrievalHit, DocumentTreeRetrievalHit, GraphRetrievalHit } from "../types/rag.types.js";
import { prisma } from "../../../lib/prisma.js";

export interface BuildContextInput {
  catalogHits: CatalogRetrievalHit[];
  documentHits: DocumentTreeRetrievalHit[];
  graphHits: GraphRetrievalHit[];
  tokenBudget?: number;
}

export async function buildContext(input: BuildContextInput): Promise<string> {
  const tokenBudget = input.tokenBudget ?? Number(process.env.RAG_CONTEXT_TOKEN_BUDGET ?? 700);

  // Batch query all catalog product details at once to avoid N+1 queries
  const componentIds = input.catalogHits
    .filter((h) => h.sourceType === "component")
    .map((h) => h.sourceId);

  const components = componentIds.length > 0
    ? await prisma.component.findMany({
        where: { id: { in: componentIds } },
        select: {
          id: true,
          unitPriceCents: true,
          discountedPriceCents: true,
          stockQuantity: true,
          isActive: true,
        },
      })
    : [];

  const componentMap = new Map(components.map((c) => [c.id, c]));

  const sections = [
    ...input.catalogHits.map((hit) => formatCatalogHit(hit, componentMap)),
    ...input.documentHits.map(formatDocumentHit),
    ...input.graphHits.map(formatGraphHit),
  ];

  return trimByApproxTokens(sections.join("\n"), tokenBudget);
}

function formatCatalogHit(hit: CatalogRetrievalHit, componentMap: Map<string, any>): string {
  const comp = componentMap.get(hit.sourceId);
  let liveDetails = "";
  if (comp) {
    const price = comp.discountedPriceCents ? comp.discountedPriceCents / 100 : comp.unitPriceCents / 100;
    liveDetails = `\nLive Price: ₹${price.toFixed(2)}, Live Stock: ${comp.stockQuantity} units, Active: ${comp.isActive ? "Yes" : "No"}`;
  }
  return `Product: ${hit.title} (${hit.sourceType}:${hit.sourceId})\n${firstWords(hit.text, 60)}${liveDetails}`;
}

function formatDocumentHit(hit: DocumentTreeRetrievalHit): string {
  const page = hit.startPage === undefined ? "page unknown" : `pages ${hit.startPage}${hit.endPage ? `-${hit.endPage}` : ""}`;
  return `Document: ${hit.title} (${page}, node ${hit.nodeId})\nSummary: ${hit.summary}\nExcerpt: ${hit.excerpt ?? ""}`;
}

function formatGraphHit(hit: GraphRetrievalHit): string {
  return `Related product: ${hit.sourceComponentId} ${hit.relationType} ${hit.targetComponentId}`;
}

function firstWords(text: string, maxWords: number): string {
  return text.split(/\s+/).slice(0, maxWords).join(" ");
}

function trimByApproxTokens(text: string, tokenBudget: number): string {
  const maxWords = Math.max(50, Math.floor(tokenBudget * 0.75));
  return firstWords(text, maxWords);
}

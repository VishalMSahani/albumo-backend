export type RetrievalMode = "catalog" | "document" | "graph" | "combined";

export interface CatalogRetrievalHit {
  kind: "catalog";
  id: string;
  sourceType: "component" | "project" | "faq" | "short_policy";
  sourceId: string;
  title: string;
  text: string;
  vectorScore?: number;
  keywordScore?: number;
  catalogScore: number;
  metadata: Record<string, unknown>;
}

export interface DocumentTreeRetrievalHit {
  kind: "document";
  id: string;
  documentId: string;
  nodeId: string;
  title: string;
  summary: string;
  excerpt?: string;
  startPage?: number;
  endPage?: number;
  reasoningScore: number;
  metadata: Record<string, unknown>;
}

export interface GraphRetrievalHit {
  kind: "graph";
  sourceComponentId: string;
  targetComponentId: string;
  relationType: "compatible_with" | "includes" | "upgrade_of" | "frequently_bought_with" | "requires";
  explanation?: string;
}

export type RagRetrievalHit = CatalogRetrievalHit | DocumentTreeRetrievalHit | GraphRetrievalHit;

export interface RetrievalPlan {
  mode: RetrievalMode;
  expandedQuery: string;
  filters: Record<string, unknown>;
}

export interface HybridRetrievalResult {
  plan: RetrievalPlan;
  catalogHits: CatalogRetrievalHit[];
  documentHits: DocumentTreeRetrievalHit[];
  graphHits: GraphRetrievalHit[];
  context: string;
}

export interface ChatPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

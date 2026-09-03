export type EmbeddingSourceType = "component" | "project" | "faq" | "short_policy";
export type DocumentSourceType = "manual" | "datasheet" | "policy" | "tutorial" | "project_report" | "course_material";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface EmbeddingChunk {
  sourceType: EmbeddingSourceType;
  sourceId: string;
  chunkText: string;
  metadata: Record<string, JsonValue>;
}

export interface EmbeddedChunk extends EmbeddingChunk {
  embedding: number[];
}

export interface DocumentTreeNodeInput {
  nodeId: string;
  title: string;
  summary: string;
  fullText?: string;
  startPage?: number;
  endPage?: number;
  startIndex?: number;
  endIndex?: number;
  children: DocumentTreeNodeInput[];
}

export interface DocumentTreeInput {
  title: string;
  sourceType: DocumentSourceType;
  sourceId?: string;
  fileUrl?: string;
  metadata: Record<string, JsonValue>;
  nodes: DocumentTreeNodeInput[];
}

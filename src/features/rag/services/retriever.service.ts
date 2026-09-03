import { keywordSearchCatalog } from "./catalog-keyword-retriever.service.js";
import { vectorSearchCatalog } from "./catalog-vector-retriever.service.js";
import { buildContext } from "./context-builder.service.js";
import { expandQuery } from "./expander.service.js";
import { getRelated } from "./graph.service.js";
import { retrieveDocumentTree } from "./document-tree-retriever.service.js";
import { mergeAndRerankCatalog, rerankDocumentHits } from "./reranker.service.js";
import type { HybridRetrievalResult, RetrievalMode } from "../types/rag.types.js";

const ACTION_HINTS = ["order", "buy", "purchase", "pay", "payment", "invoice", "track", "cancel", "history"];
const DOCUMENT_HINTS = ["wire", "wiring", "manual", "datasheet", "policy", "tutorial", "guide", "explain", "steps", "how"];
const CATALOG_HINTS = ["show", "price", "stock", "sku", "sensor", "board", "motor", "kit", "component", "under"];

export async function hybridRetrieve(query: string, incomingFilters: Record<string, unknown> = {}): Promise<HybridRetrievalResult> {
  const expandedQuery = await expandQuery(query);
  const mode = classifyRetrievalMode(query);
  const extractedFilters = extractFiltersFromQuery(query);
  const filters = { ...extractedFilters, ...incomingFilters };

  const shouldUseCatalog = mode === "catalog" || mode === "combined" || mode === "graph";
  const shouldUseDocuments = mode === "document" || mode === "combined";

  const [vectorHits, keywordHits, documentHits] = await Promise.all([
    shouldUseCatalog ? vectorSearchCatalog(expandedQuery, 20, filters) : Promise.resolve([]),
    shouldUseCatalog ? keywordSearchCatalog(expandedQuery, 20, filters) : Promise.resolve([]),
    shouldUseDocuments ? retrieveDocumentTree(expandedQuery) : Promise.resolve([]),
  ]);

  const catalogHits = mergeAndRerankCatalog(vectorHits, keywordHits);
  const componentIds = catalogHits
    .filter((hit) => hit.sourceType === "component")
    .map((hit) => hit.sourceId);

  const [graphHits, rankedDocuments] = await Promise.all([
    componentIds.length > 0 ? getRelated(componentIds) : Promise.resolve([]),
    Promise.resolve(rerankDocumentHits(documentHits)),
  ]);

  const context = await buildContext({
    catalogHits,
    documentHits: rankedDocuments,
    graphHits,
  });

  return {
    plan: {
      mode,
      expandedQuery,
      filters,
    },
    catalogHits,
    documentHits: rankedDocuments,
    graphHits,
    context,
  };
}

function extractFiltersFromQuery(query: string): { category?: string; brand?: string; sourceType?: string } {
  const normalized = query.toLowerCase();
  const filters: { category?: string; brand?: string; sourceType?: string } = {};

  // Extract sourceType filter
  if (normalized.includes("faq") || normalized.includes("policy") || normalized.includes("shipping") || normalized.includes("return")) {
    filters.sourceType = "FAQ";
  } else if (normalized.includes("project") || normalized.includes("build") || normalized.includes("tutorial")) {
    filters.sourceType = "PROJECT";
  } else {
    filters.sourceType = "COMPONENT"; // Default to components
  }

  // Extract category
  if (/\b(ble|bluetooth|wifi|esp8266|rf|nrf|transmitter|receiver|wireless|communication)\b/.test(normalized)) {
    filters.category = "Wireless & Communication";
  } else if (/\b(sensor|detect|gyro|temp|humidity|ultrasonic|ldr|dht|mpu6050|sonar|proximity)\b/.test(normalized)) {
    filters.category = "Sensors";
  } else if (/\b(motor|servo|stepper|driver|h-bridge|actuator|l298n|sg90|mg996r)\b/.test(normalized)) {
    filters.category = "Motors & Drivers";
  } else if (/\b(board|microcontroller|development|arduino|esp32|raspberry|pi|pico|uno|nano|mega)\b/.test(normalized)) {
    filters.category = "Development Boards";
  }

  return filters;
}

export function classifyRetrievalMode(query: string): RetrievalMode {
  const normalized = query.toLowerCase();
  const hasAction = ACTION_HINTS.some((hint) => normalized.includes(hint));
  const hasDocument = DOCUMENT_HINTS.some((hint) => normalized.includes(hint));
  const hasCatalog = CATALOG_HINTS.some((hint) => normalized.includes(hint));

  if (hasDocument && (hasCatalog || hasAction)) return "combined";
  if (hasDocument) return "document";
  // Default to catalog for product queries and general requests
  return "catalog";
}

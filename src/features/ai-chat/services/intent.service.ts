import type { ChatClassification, ChatIntent } from "../types/chat.types.js";
import type { RetrievalMode } from "../../rag/types/rag.types.js";

const ACTION_KEYWORDS = ["order", "buy", "purchase", "pay", "payment", "upi", "invoice", "bill", "track", "cancel", "history", "return"];
const KNOWLEDGE_KEYWORDS = ["what", "which", "how", "does", "compatible", "difference", "specs", "price", "stock", "recommend", "wire", "manual", "datasheet"];
const DOCUMENT_KEYWORDS = ["how", "wire", "manual", "datasheet", "guide", "policy", "tutorial", "steps", "explain"];

export function classifyChatMessage(message: string): ChatClassification {
  const normalized = message.toLowerCase();
  const hasAction = ACTION_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasKnowledge = KNOWLEDGE_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasDocumentNeed = DOCUMENT_KEYWORDS.some((keyword) => normalized.includes(keyword));

  const intent: ChatIntent = hasAction && hasKnowledge ? "mixed" : hasAction ? "action" : "knowledge";
  const retrievalMode: RetrievalMode = hasDocumentNeed && hasKnowledge
    ? "combined"
    : hasKnowledge
      ? "catalog"
      : "graph";

  return {
    intent,
    retrievalMode,
    reasons: [
      hasAction ? "action keyword matched" : "no action keyword",
      hasKnowledge ? "knowledge keyword matched" : "no knowledge keyword",
      hasDocumentNeed ? "document reasoning keyword matched" : "no document keyword",
    ],
  };
}

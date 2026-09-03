import type { RetrievalMode } from "../../rag/types/rag.types.js";
import type { ToolName } from "../../tools/types.js";

export type ChatIntent = "knowledge" | "action" | "mixed";
export type ChatRole = "user" | "assistant" | "tool";

export interface ChatRequestBody {
  message: string;
  sessionId: string;
}

export interface ChatSessionTurn {
  role: ChatRole;
  content: string;
  createdAt: string;
  toolName?: ToolName;
}

export interface ChatClassification {
  intent: ChatIntent;
  retrievalMode: RetrievalMode;
  reasons: string[];
}

// ─── Structured SSE event payloads ───────────────────────────────────────────

export type StockStatus = "inStock" | "lowStock" | "outOfStock";

export interface ProductSsePayload {
  id: string;
  name: string;
  priceCents: number;
  imageUrl?: string;
  href: string;
  stockStatus?: StockStatus;
  category?: string;
  brand?: string;
  compatibility?: string[];
  sku?: string;
  description?: string;
  specs?: Record<string, string>;
}

export type OrderSseStatus =
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface OrderSseItem {
  name: string;
  qty: number;
  priceCents: number;
}

export interface OrderSsePayload {
  orderId: string;
  status: OrderSseStatus;
  items: OrderSseItem[];
  totalCents: number;
  estimatedDelivery?: string;
  trackingUrl?: string;
  /** True when the order is still awaiting payment (PENDING_PAYMENT) and can be paid in-chat. */
  payable?: boolean;
}

export interface PaymentSsePayload {
  orderId: string;
  amountCents: number;
  razorpayOrderId?: string;
  currency?: string;
}

export interface InvoiceSsePayload {
  orderId: string;
  invoiceId?: string;
  issuedAt?: string;
  totalCents: number;
  downloadUrl?: string;
  previewUrl?: string;
}

export interface CitationSsePayload {
  sourceType: "product" | "document" | "project";
  title: string;
  pageLabel?: string;
  href?: string;
}

// Union of all structured events the controller may stream before the text delta
export type ChatSseEvent =
  | { type: "product"; product: ProductSsePayload }
  | { type: "order"; order: OrderSsePayload }
  | { type: "payment"; payment: PaymentSsePayload }
  | { type: "invoice"; invoice: InvoiceSsePayload }
  | { type: "citation"; citation: CitationSsePayload }
  | { type: "address_required" };

// Return type of runClaudeToolLoop — text answer + any structured events to stream
export interface ToolLoopResult {
  text: string;
  events: ChatSseEvent[];
}

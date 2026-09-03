import { executeTool } from "../../tools/handlers.js";
import { toolRegistry } from "../../tools/registry.js";
import type { ToolContext, ToolName } from "../../tools/types.js";
import type { ChatPromptMessage } from "../../rag/types/rag.types.js";
import type {
  ChatSseEvent,
  InvoiceSsePayload,
  OrderSseItem,
  OrderSsePayload,
  OrderSseStatus,
  PaymentSsePayload,
  ProductSsePayload,
  StockStatus,
  ToolLoopResult,
} from "../types/chat.types.js";

const getAnthropicMessagesUrl = (): string => {
  const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const cleanBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${cleanBase}v1/messages`;
};

const ANTHROPIC_MESSAGES_URL = getAnthropicMessagesUrl();
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022";
const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_NVIDIA_MODEL = "mistralai/mistral-large-3-675b-instruct-2512";

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

interface ClaudeResponse {
  content: ClaudeContentBlock[];
}

interface OpenAIChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAIChatToolCall[];
}

interface OpenAIChatResponse {
  choices: Array<{
    message: OpenAIChatMessage;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runClaudeToolLoop(
  prompt: ChatPromptMessage[],
  ctx: ToolContext,
  onDelta?: (text: string) => void,
  options: { includeTools?: boolean } = {}
): Promise<ToolLoopResult> {
  const includeTools = options.includeTools ?? true;

  if (shouldUseNvidiaProvider()) {
    return await runOpenAICompatibleToolLoop(prompt, ctx, onDelta, includeTools);
  }

  // The system prompt + retrieved RAG context live in the "system" role message.
  // Anthropic requires this as a top-level `system` parameter — it is NOT a
  // member of the messages array. Extract it here so the model actually receives
  // the retrieval context and relevance instructions.
  const system = systemFromPrompt(prompt);
  const messages = toClaudeMessages(prompt);
  const first = await createMessage(messages, includeTools, onDelta, system);
  const toolUses = first.content.filter(isToolUseBlock);

  if (toolUses.length === 0) {
    return { text: textFromContent(first.content), events: [] };
  }

  const toolResults: ClaudeContentBlock[] = [];
  const collectedEvents: ChatSseEvent[] = [];

  for (const toolUse of toolUses) {
    if (!isToolName(toolUse.name)) {
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }),
      });
      continue;
    }

    const result = await executeTool(toolUse.name, toolUse.input, ctx);
    const resultJson = JSON.stringify(result);

    toolResults.push({
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: resultJson,
    });

    // Extract structured SSE events from this tool result
    if ("data" in result && result.data !== undefined) {
      const events = extractSseEvents(toolUse.name, result.data);
      collectedEvents.push(...events);
    }
  }

  const second = await createMessage([
    ...messages,
    { role: "assistant", content: first.content },
    { role: "user", content: toolResults },
  ], false, onDelta, system);

  return { text: textFromContent(second.content), events: collectedEvents };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event extraction — map raw tool result data → typed SSE events
// ─────────────────────────────────────────────────────────────────────────────

function extractSseEvents(toolName: ToolName, data: unknown): ChatSseEvent[] {
  if (!data || typeof data !== "object") return [];

  switch (toolName) {
    case "place_order":
      return extractOrderEvents(data as Record<string, unknown>);

    case "initiate_payment":
      return extractPaymentEvents(data as Record<string, unknown>);

    case "get_invoice":
      return extractInvoiceEvents(data as Record<string, unknown>);

    case "track_order":
      return extractTrackingEvents(data as Record<string, unknown>);

    case "get_order_history":
      return extractOrderHistoryEvents(data);

    case "search_products":
      return extractProductEvents(data as Record<string, unknown>);

    case "get_product_details":
      return extractProductDetailEvents(data as Record<string, unknown>);

    case "checkout_cart": {
      const obj = data as Record<string, unknown>;
      if (obj["addressRequired"] === true) {
        return [{ type: "address_required" }];
      }
      const events: ChatSseEvent[] = [];
      const orderData = obj["order"] as Record<string, unknown>;
      if (orderData) {
        events.push(...extractOrderEvents(orderData));
      }
      const p = obj["payment"] as Record<string, unknown>;
      if (p) {
        events.push(...extractPaymentEvents(p));
      }
      return events;
    }

    default:
      return [];
  }
}

function extractOrderEvents(data: Record<string, unknown>): ChatSseEvent[] {
  // place_order returns { order, paymentUrl } — unwrap to the order entity.
  const order =
    data["order"] && typeof data["order"] === "object" && !Array.isArray(data["order"])
      ? (data["order"] as Record<string, unknown>)
      : data;

  const orderId = stringField(order, "id") ?? stringField(order, "orderId");
  if (!orderId) return [];

  const rawStatus = stringField(order, "status") ?? "confirmed";
  const status = mapOrderStatus(rawStatus);
  const payable = rawStatus.toUpperCase() === "PENDING_PAYMENT";

  const rawItems = order["items"];
  const items: OrderSseItem[] = Array.isArray(rawItems)
    ? rawItems.map((item) => {
        const i = item as Record<string, unknown>;
        const component = (i["component"] ?? {}) as Record<string, unknown>;
        return {
          name: stringField(component, "name") ?? stringField(i, "name") ?? stringField(i, "description") ?? "Item",
          qty: numberField(i, "quantity") ?? 1,
          priceCents: numberField(i, "unitPriceCents") ?? numberField(component, "priceCents") ?? 0,
        };
      })
    : [];

  const totalCents = numberField(order, "totalAmountCents") ?? 0;
  const trackingUrl = stringField(order, "trackingUrl");

  const payload: OrderSsePayload = {
    orderId,
    status,
    items,
    totalCents,
    ...(trackingUrl && { trackingUrl }),
    ...(payable && { payable: true }),
    estimatedDelivery: estimatedDeliveryDate(),
  };

  return [{ type: "order", order: payload }];
}

function extractPaymentEvents(data: Record<string, unknown>): ChatSseEvent[] {
  const orderId = stringField(data, "orderId");
  const amountCents = numberField(data, "amount");
  const razorpayOrderId = stringField(data, "gatewayOrderId");

  if (!orderId || amountCents === undefined) return [];

  const payload: PaymentSsePayload = {
    orderId,
    amountCents,
    currency: stringField(data, "currency") ?? "INR",
    ...(razorpayOrderId && { razorpayOrderId }),
  };

  return [{ type: "payment", payment: payload }];
}

function extractInvoiceEvents(data: Record<string, unknown>): ChatSseEvent[] {
  const orderId = stringField(data, "orderId");
  if (!orderId) return [];

  // We need the order to get totalCents — we use 0 as a placeholder here
  // The controller enriches this with a DB lookup if needed
  const payload: InvoiceSsePayload = {
    orderId,
    downloadUrl: stringField(data, "invoiceUrl") ?? `/api/orders/${orderId}/invoice`,
    totalCents: 0,
  };

  return [{ type: "invoice", invoice: payload }];
}

function extractTrackingEvents(data: Record<string, unknown>): ChatSseEvent[] {
  const orderId = stringField(data, "orderId");
  if (!orderId) return [];

  const rawStatus = stringField(data, "status") ?? "confirmed";
  const status = mapOrderStatus(rawStatus);
  const trackingUrl = stringField(data, "trackingUrl");

  const payload: OrderSsePayload = {
    orderId,
    status,
    items: [],       // tracking view doesn't need item breakdown
    totalCents: 0,
    ...(trackingUrl && { trackingUrl }),
  };

  return [{ type: "order", order: payload }];
}

function extractOrderHistoryEvents(data: unknown): ChatSseEvent[] {
  if (!Array.isArray(data)) return [];

  return data.slice(0, 5).flatMap((order) => {
    const o = order as Record<string, unknown>;
    const orderId = stringField(o, "id");
    if (!orderId) return [];

    const rawStatus = stringField(o, "status") ?? "confirmed";
    const rawItems = o["items"];
    const items: OrderSseItem[] = Array.isArray(rawItems)
      ? rawItems.map((item) => {
          const i = item as Record<string, unknown>;
          const component = (i["component"] ?? {}) as Record<string, unknown>;
          return {
            name: stringField(component, "name") ?? "Item",
            qty: numberField(i, "quantity") ?? 1,
            priceCents: numberField(i, "unitPriceCents") ?? 0,
          };
        })
      : [];

    const payload: OrderSsePayload = {
      orderId,
      status: mapOrderStatus(rawStatus),
      items,
      totalCents: numberField(o, "totalAmountCents") ?? 0,
    };

    return [{ type: "order" as const, order: payload }];
  });
}

function extractProductEvents(data: Record<string, unknown>): ChatSseEvent[] {
  // data is HybridRetrievalResult — extract catalogHits that are components
  const catalogHits = data["catalogHits"];
  if (!Array.isArray(catalogHits)) return [];

  return catalogHits
    .filter((hit) => {
      const h = hit as Record<string, unknown>;
      return h["sourceType"] === "component";
    })
    .slice(0, 5)
    .map((hit) => {
      const h = hit as Record<string, unknown>;
      const meta = (h["metadata"] ?? {}) as Record<string, unknown>;

      const imageUrl = stringField(meta, "imageUrl");
      const stockStatus = mapStockStatus(meta);
      const category = stringField(meta, "category");
      const brand = stringField(meta, "brand");
      const sku = stringField(meta, "sku");
      const compatibility = arrayField(meta, "compatibility");

      const payload: ProductSsePayload = {
        id: stringField(h, "sourceId") ?? stringField(h, "id") ?? "",
        name: stringField(h, "title") ?? "Product",
        priceCents: numberField(meta, "priceCents") ?? 0,
        href: `/products/${stringField(meta, "slug") ?? stringField(h, "sourceId") ?? ""}`,
        ...(imageUrl !== undefined && { imageUrl }),
        ...(stockStatus !== undefined && { stockStatus }),
        ...(category !== undefined && { category }),
        ...(brand !== undefined && { brand }),
        ...(sku !== undefined && { sku }),
        ...(compatibility !== undefined && { compatibility }),
      };

      return { type: "product" as const, product: payload };
    });
}

function extractProductDetailEvents(data: Record<string, unknown>): ChatSseEvent[] {
  const component = data["component"];
  if (!component || typeof component !== "object") return [];

  const c = component as Record<string, unknown>;
  const media = c["media"];
  const firstImage = Array.isArray(media) && media.length > 0
    ? (media[0] as Record<string, unknown>)
    : null;

  const imageUrl = firstImage ? stringField(firstImage, "url") : undefined;
  const stock = numberField(c, "stock");
  const stockStatus = stock !== undefined ? mapStockStatusFromCount(stock) : undefined;
  const category = stringField(c, "categoryName");
  const brand = stringField(c, "brand");
  const sku = stringField(c, "sku");
  const description = stringField(c, "description");

  const payload: ProductSsePayload = {
    id: stringField(c, "id") ?? "",
    name: stringField(c, "name") ?? "Product",
    priceCents: numberField(c, "priceCents") ?? 0,
    href: `/products/${stringField(c, "slug") ?? stringField(c, "id") ?? ""}`,
    ...(imageUrl !== undefined && { imageUrl }),
    ...(stockStatus !== undefined && { stockStatus }),
    ...(category !== undefined && { category }),
    ...(brand !== undefined && { brand }),
    ...(sku !== undefined && { sku }),
    ...(description !== undefined && { description }),
  };

  return [{ type: "product", product: payload }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────────────────────────────────────

function mapOrderStatus(raw: string): OrderSseStatus {
  const upper = raw.toUpperCase();
  if (upper === "PENDING_PAYMENT" || upper === "PAID" || upper.includes("CONFIRM")) return "confirmed";
  if (upper === "PROCESSING" || upper === "PACKED") return "processing";
  if (upper === "SHIPPED" || upper === "IN_TRANSIT") return "shipped";
  if (upper === "DELIVERED") return "delivered";
  if (upper === "CANCELLED" || upper === "REFUNDED") return "cancelled";
  return "confirmed";
}

function mapStockStatus(meta: Record<string, unknown>): StockStatus | undefined {
  const stock = meta["stock"];
  if (typeof stock === "number") return mapStockStatusFromCount(stock);
  const rawStatus = meta["stockStatus"];
  if (typeof rawStatus === "string") {
    if (rawStatus === "inStock" || rawStatus === "lowStock" || rawStatus === "outOfStock") {
      return rawStatus as StockStatus;
    }
  }
  return undefined;
}

function mapStockStatusFromCount(count: number): StockStatus {
  if (count <= 0) return "outOfStock";
  if (count <= 5) return "lowStock";
  return "inStock";
}

function estimatedDeliveryDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

function numberField(obj: Record<string, unknown>, key: string): number | undefined {
  const val = obj[key];
  return typeof val === "number" ? val : undefined;
}

function arrayField(obj: Record<string, unknown>, key: string): string[] | undefined {
  const val = obj[key];
  if (!Array.isArray(val)) return undefined;
  const strings = val.filter((v): v is string => typeof v === "string");
  return strings.length > 0 ? strings : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic Claude API
// ─────────────────────────────────────────────────────────────────────────────

async function createMessage(
  messages: ClaudeMessage[],
  includeTools: boolean,
  onDelta?: (text: string) => void,
  system?: string
): Promise<ClaudeResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for chat responses");
  }

  if (onDelta) {
    const bodyParams = {
      model: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 900,
      ...(system ? { system } : {}),
      messages,
      tools: includeTools ? toolRegistry : undefined,
      stream: true,
    };

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(bodyParams),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic request failed: ${response.status} ${body}`);
    }

    if (!response.body) {
      throw new Error("Anthropic response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const finalContent: ClaudeContentBlock[] = [];
    const toolUseBlocksMap = new Map<number, { id: string; name: string; index: number }>();
    const toolInputMap = new Map<number, string>();
    let currentText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split("\n");
        const dataLine = lines.find((l) => l.startsWith("data:"));
        if (!dataLine) continue;

        const rawData = dataLine.replace("data:", "").trim();
        try {
          const parsed = JSON.parse(rawData);
          if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") {
            const index = parsed.index;
            toolUseBlocksMap.set(index, {
              id: parsed.content_block.id,
              name: parsed.content_block.name,
              index,
            });
            toolInputMap.set(index, "");
          } else if (parsed.type === "content_block_delta" && parsed.delta?.type === "input_json_delta") {
            const index = parsed.index;
            const deltaJson = parsed.delta.partial_json;
            const currentVal = toolInputMap.get(index) ?? "";
            toolInputMap.set(index, currentVal + deltaJson);
          } else if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
            const text = parsed.delta.text;
            currentText += text;
            onDelta(text);
          }
        } catch {}
      }
    }

    // Convert tool uses to final content
    for (const [index, block] of toolUseBlocksMap.entries()) {
      const inputStr = toolInputMap.get(index) ?? "";
      let input = {};
      try {
        input = JSON.parse(inputStr);
      } catch {}
      finalContent.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input,
      });
    }

    if (currentText) {
      finalContent.push({ type: "text", text: currentText });
    }

    return { content: finalContent };
  }

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 900,
      ...(system ? { system } : {}),
      messages,
      tools: includeTools ? toolRegistry : undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic request failed: ${response.status} ${body}`);
  }

  return await response.json() as ClaudeResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// NVIDIA / OpenAI-compatible provider
// ─────────────────────────────────────────────────────────────────────────────

async function runOpenAICompatibleToolLoop(
  prompt: ChatPromptMessage[],
  ctx: ToolContext,
  onDelta?: (text: string) => void,
  includeTools = true
): Promise<ToolLoopResult> {
  const messages = toOpenAICompatibleMessages(prompt);
  const first = await createOpenAICompatibleMessage(messages, includeTools, onDelta);
  const firstMessage = getFirstOpenAIMessage(first);
  const toolCalls = firstMessage.tool_calls ?? [];

  if (toolCalls.length === 0) {
    return { text: firstMessage.content ?? "", events: [] };
  }

  const toolResultMessages: OpenAIChatMessage[] = [];
  const collectedEvents: ChatSseEvent[] = [];

  for (const toolCall of toolCalls) {
    const result = await executeOpenAICompatibleToolCall(toolCall, ctx);
    toolResultMessages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(result),
    });

    if (isToolName(toolCall.function.name) && "data" in (result as object)) {
      const events = extractSseEvents(toolCall.function.name as ToolName, (result as { data: unknown }).data);
      collectedEvents.push(...events);
    }
  }

  const second = await createOpenAICompatibleMessage([
    ...messages,
    {
      role: "assistant",
      content: firstMessage.content ?? "",
      tool_calls: toolCalls,
    },
    ...toolResultMessages,
  ], false, onDelta);

  return { text: getFirstOpenAIMessage(second).content ?? "", events: collectedEvents };
}

async function createOpenAICompatibleMessage(
  messages: OpenAIChatMessage[],
  includeTools: boolean,
  onDelta?: (text: string) => void
): Promise<OpenAIChatResponse> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is required when CHAT_LLM_PROVIDER=nvidia");
  }

  const baseUrl = process.env.NVIDIA_BASE_URL ?? DEFAULT_NVIDIA_BASE_URL;

  if (onDelta) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_CHAT_MODEL ?? DEFAULT_NVIDIA_MODEL,
        messages,
        temperature: Number(process.env.NVIDIA_CHAT_TEMPERATURE ?? 1),
        top_p: Number(process.env.NVIDIA_CHAT_TOP_P ?? 0.95),
        max_tokens: Number(process.env.NVIDIA_CHAT_MAX_TOKENS ?? 4096),
        tools: includeTools ? toOpenAICompatibleTools() : undefined,
        tool_choice: includeTools ? "auto" : undefined,
        stream: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`NVIDIA chat request failed: ${response.status} ${body}`);
    }

    if (!response.body) {
      throw new Error("NVIDIA response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let content = "";
    const toolCallsMap = new Map<string, { id: string; name: string; arguments: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const cleaned = block.trim();
        if (!cleaned || !cleaned.startsWith("data:")) continue;
        const rawData = cleaned.replace("data:", "").trim();
        if (rawData === "[DONE]") continue;

        try {
          const parsed = JSON.parse(rawData);
          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          if (delta.content) {
            content += delta.content;
            onDelta(delta.content);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              let existing = toolCallsMap.get(index.toString());
              if (!existing) {
                existing = { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" };
                toolCallsMap.set(index.toString(), existing);
              }
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            }
          }
        } catch {}
      }
    }

    const toolCalls = Array.from(toolCallsMap.values()).map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    }));

    return {
      choices: [
        {
          message: {
            role: "assistant",
            content,
            ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
          },
        },
      ],
    };
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.NVIDIA_CHAT_MODEL ?? DEFAULT_NVIDIA_MODEL,
      messages,
      temperature: Number(process.env.NVIDIA_CHAT_TEMPERATURE ?? 1),
      top_p: Number(process.env.NVIDIA_CHAT_TOP_P ?? 0.95),
      max_tokens: Number(process.env.NVIDIA_CHAT_MAX_TOKENS ?? 4096),
      tools: includeTools ? toOpenAICompatibleTools() : undefined,
      tool_choice: includeTools ? "auto" : undefined,
      stream: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`NVIDIA chat request failed: ${response.status} ${body}`);
  }

  return await response.json() as OpenAIChatResponse;
}

async function executeOpenAICompatibleToolCall(toolCall: OpenAIChatToolCall, ctx: ToolContext): Promise<unknown> {
  if (!isToolName(toolCall.function.name)) {
    return { error: `Unknown tool: ${toolCall.function.name}` };
  }

  const parsedArgs = parseToolArguments(toolCall.function.arguments);
  return await executeTool(toolCall.function.name, parsedArgs, ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// Message conversion helpers
// ─────────────────────────────────────────────────────────────────────────────

function toClaudeMessages(prompt: ChatPromptMessage[]): ClaudeMessage[] {
  return prompt
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
}

/**
 * Anthropic's API takes the system prompt as a top-level `system` string, not as
 * a message. Collapse any system-role entries from the prompt into that string.
 */
function systemFromPrompt(prompt: ChatPromptMessage[]): string | undefined {
  const parts = prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function toOpenAICompatibleMessages(prompt: ChatPromptMessage[]): OpenAIChatMessage[] {
  return prompt.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function toOpenAICompatibleTools(): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}> {
  return toolRegistry.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function isToolUseBlock(block: ClaudeContentBlock): block is Extract<ClaudeContentBlock, { type: "tool_use" }> {
  return block.type === "tool_use";
}

function isToolName(name: string): name is ToolName {
  return toolRegistry.some((tool) => tool.name === name);
}

function textFromContent(content: ClaudeContentBlock[]): string {
  return content
    .filter((block): block is Extract<ClaudeContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function shouldUseNvidiaProvider(): boolean {
  return process.env.CHAT_LLM_PROVIDER === "nvidia";
}

function getFirstOpenAIMessage(response: OpenAIChatResponse): OpenAIChatMessage {
  const message = response.choices[0]?.message;
  if (!message) {
    throw new Error("NVIDIA chat response did not include a message");
  }

  return message;
}

function parseToolArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

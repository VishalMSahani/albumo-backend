import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "../../../lib/logger.js";
import { buildPrompt, hybridRetrieve } from "../../rag/index.js";
import type { UserProfileContext } from "../../rag/services/prompt-builder.service.js";
import { classifyChatMessage } from "../services/intent.service.js";
import { classifyIntent } from "../services/router.service.js";
import { runClaudeToolLoop } from "../services/anthropic.service.js";
import {
  getCachedStaticChatAnswer,
  isStaticChatCacheCandidate,
  setCachedStaticChatAnswer,
} from "../services/cache.service.js";
import { loadSessionHistory, saveSessionTurn } from "../services/session.service.js";
import { chatRequestSchema } from "../validators/chat.validator.js";
import * as cartService from "../../cart/services/cart.service.js";
import { prisma } from "../../../lib/prisma.js";
import type { ChatPromptMessage } from "../../rag/types/rag.types.js";
import type { ToolActorRole, ToolContext } from "../../tools/types.js";
import type { ChatSseEvent } from "../types/chat.types.js";

export async function chatHandler(req: Request, res: Response): Promise<void> {
  setSseHeaders(res);
  const requestId = randomUUID();
  const startedAt = Date.now();

  try {
    const parsed = chatRequestSchema.parse(req.body);
    const user = req.user;
    if (!user?.userId) {
      sendSse(res, "error", { error: "Authentication required" });
      res.end();
      return;
    }

    sendSse(res, "status", { status: "classifying" });
    
    // Fetch cart and user profile first to verify intents and active states
    const [cart, userRecord] = await Promise.all([
      cartService.getCart(user.userId),
      prisma.user.findUnique({
        where: { id: user.userId },
        select: {
          name: true,
          email: true,
          addresses: {
            where: { isDefault: true },
            take: 1,
          },
        },
      }),
    ]);

    const routerResult = classifyIntent(parsed.message, true, cart.items.length === 0);
    const classification = classifyChatMessage(parsed.message);
    if (routerResult.intent === "action") {
      classification.intent = "action";
    }

    const cacheCandidate = isStaticChatCacheCandidate(parsed.message, classification.intent);
    const history = await loadSessionHistory(user.userId, parsed.sessionId);
    const promptHistory = history
      .filter((turn) => turn.role === "user" || turn.role === "assistant")
      .map<ChatPromptMessage>((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: turn.content,
      }));

    // Cache hit path (knowledge-only, no structured events)
    if (cacheCandidate) {
      const cachedAnswer = await getCachedStaticChatAnswer(parsed.message);
      if (cachedAnswer) {
        logger.info("chat cache hit", {
          requestId,
          userId: user.userId,
          sessionId: parsed.sessionId,
          durationMs: Date.now() - startedAt,
        });
        sendSse(res, "status", { status: "cache_hit" });
        sendSse(res, "delta", { text: cachedAnswer });
        sendSse(res, "done", {
          sessionId: parsed.sessionId,
          retrievalPlan: null,
          cached: true,
        });
        await saveSessionTurn(user.userId, parsed.sessionId, parsed.message, cachedAnswer);
        return;
      }
    }

    const isGreeting = isGreetingQuery(parsed.message);
    if (!isGreeting) {
      sendSse(res, "status", { status: "retrieving", intent: classification.intent });
    }

    const retrieval = classification.intent === "action" || isGreeting
      ? null
      : await hybridRetrieve(parsed.message);

    const userProfile: UserProfileContext | undefined = userRecord
      ? {
          name: userRecord.name,
          email: userRecord.email,
          defaultAddress: userRecord.addresses[0]
            ? {
                name: userRecord.addresses[0].name,
                phone: userRecord.addresses[0].phone,
                line1: userRecord.addresses[0].line1,
                line2: userRecord.addresses[0].line2,
                city: userRecord.addresses[0].city,
                state: userRecord.addresses[0].state,
                pincode: userRecord.addresses[0].pincode,
                country: userRecord.addresses[0].country,
              }
            : null,
          totalAddresses: userRecord.addresses.length,
        }
      : undefined;

    const prompt = buildPrompt(retrieval?.context ?? "", promptHistory, parsed.message, cart, userProfile);
    const toolContext: ToolContext = {
      userId: user.userId,
      role: mapRole(user.role),
      email: user.email,
    };

    sendSse(res, "status", { status: "thinking" });
    let deltaSent = false;
    // Only expose commerce tools when the user is trying to DO something
    // (order/pay/track/cancel...). Pure knowledge/product queries already have
    // their RAG context injected into the system prompt, so the model can answer
    // in a single streamed call instead of paying for a second round-trip that
    // just re-runs retrieval via the search_products tool.
    const includeTools =
      classification.intent === "action" || classification.intent === "mixed";
    const { text: answer, events } = await runClaudeToolLoop(
      prompt,
      toolContext,
      (textDelta) => {
        sendSse(res, "delta", { text: textDelta });
        deltaSent = true;
      },
      { includeTools }
    );

    // ── Stream structured action/product events first ────────────────────────
    // These arrive before the text delta so the frontend can render cards
    // while the text is still being "typed" in.
    const streamedProductIds = new Set<string>();
    for (const event of events) {
      if (event.type === "product" && event.product?.id) {
        streamedProductIds.add(event.product.id);
      }
      streamSseEvent(res, event);
    }

    // Stream catalog product cards from RAG hits (knowledge path)
    if (retrieval && retrieval.catalogHits.length > 0) {
      const uniqueCatalogHits = retrieval.catalogHits.filter(
        (hit) => !streamedProductIds.has(hit.id)
      );
      if (uniqueCatalogHits.length > 0) {
        const productEvents = buildProductEventsFromRagHits(uniqueCatalogHits);
        for (const event of productEvents) {
          streamSseEvent(res, event);
        }
      }
    }

    // Stream citation events from document hits
    if (retrieval && retrieval.documentHits.length > 0) {
      for (const hit of retrieval.documentHits.slice(0, 3)) {
        sendSse(res, "citation", {
          citation: {
            sourceType: "document",
            title: hit.title,
            pageLabel: hit.startPage !== undefined ? `p.${hit.startPage}` : undefined,
          },
        });
      }
    }

    // ── Stream the text delta ────────────────────────────────────────────────
    if (!deltaSent && answer) {
      sendSse(res, "delta", { text: answer });
    }

    sendSse(res, "done", {
      sessionId: parsed.sessionId,
      retrievalPlan: retrieval?.plan ?? null,
    });

    // Update static cache only for knowledge-only answers with no DB hits
    if (
      cacheCandidate &&
      answer &&
      events.length === 0 &&
      retrieval &&
      retrieval.catalogHits.length === 0 &&
      retrieval.graphHits.length === 0
    ) {
      await setCachedStaticChatAnswer(parsed.message, answer);
    }

    await saveSessionTurn(user.userId, parsed.sessionId, parsed.message, answer);

    logger.info("chat completed", {
      requestId,
      userId: user.userId,
      sessionId: parsed.sessionId,
      intent: classification.intent,
      retrievalMode: retrieval?.plan.mode ?? null,
      structuredEvents: events.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error("chat request failed", {
      requestId,
      error,
      durationMs: Date.now() - startedAt,
    });

    const status = (error as { statusCode?: number }).statusCode;

    if (status === 429) {
      sendSse(res, "error", { error: "429: Too many requests" });
    } else {
      sendSse(res, "error", {
        error: error instanceof Error ? error.message : "Chat request failed",
      });
    }
  } finally {
    res.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE helpers
// ─────────────────────────────────────────────────────────────────────────────

function setSseHeaders(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Stream a typed ChatSseEvent — maps each union member to its SSE event name
 * and the correct data wrapper the frontend expects.
 */
function streamSseEvent(res: Response, event: ChatSseEvent): void {
  switch (event.type) {
    case "product":
      sendSse(res, "product", { product: event.product });
      break;
    case "order":
      sendSse(res, "order", { order: event.order });
      break;
    case "payment":
      sendSse(res, "payment", { payment: event.payment });
      break;
    case "invoice":
      sendSse(res, "invoice", { invoice: event.invoice });
      break;
    case "citation":
      sendSse(res, "citation", { citation: event.citation });
      break;
    case "address_required":
      sendSse(res, "address_required", {});
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG → product card conversion
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogRetrievalHit } from "../../rag/types/rag.types.js";
import type { ProductSsePayload, StockStatus } from "../types/chat.types.js";

function buildProductEventsFromRagHits(hits: CatalogRetrievalHit[]): ChatSseEvent[] {
  return hits
    .filter((h) => h.sourceType === "component")
    .slice(0, 5)
    .map((h) => {
      const meta = h.metadata;
      const stockCount = typeof meta["stock"] === "number" ? meta["stock"] : undefined;
      let stockStatus: StockStatus | undefined;
      if (stockCount !== undefined) {
        stockStatus = stockCount <= 0 ? "outOfStock" : stockCount <= 5 ? "lowStock" : "inStock";
      }

      const imageUrl = typeof meta["imageUrl"] === "string" ? meta["imageUrl"] : undefined;
      const category = typeof meta["category"] === "string" ? meta["category"] : undefined;
      const brand = typeof meta["brand"] === "string" ? meta["brand"] : undefined;
      const sku = typeof meta["sku"] === "string" ? meta["sku"] : undefined;
      const rawCompat = meta["compatibility"];
      const compatibility = Array.isArray(rawCompat)
        ? (rawCompat as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined;

      const payload: ProductSsePayload = {
        id: h.sourceId,
        name: h.title,
        priceCents: typeof meta["priceCents"] === "number" ? meta["priceCents"] : 0,
        href: `/products/${typeof meta["slug"] === "string" ? meta["slug"] : h.sourceId}`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapRole(role: string): ToolActorRole {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return "admin";
  return "user";
}

function isGreetingQuery(message: string): boolean {
  const normalized = message.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
  const GREETING_KEYWORDS = [
    "hi",
    "hii",
    "hello",
    "hey",
    "yo",
    "hola",
    "sup",
    "greetings",
    "good morning",
    "good afternoon",
    "good evening",
  ];
  return GREETING_KEYWORDS.includes(normalized);
}

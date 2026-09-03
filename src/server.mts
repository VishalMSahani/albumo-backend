import { initSentry, Sentry } from "./lib/sentry.js";
initSentry(); // Must be first

import { createRequire } from "node:module";
import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import cors, { type CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import cron from "node-cron";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { startEmailWorker, stopEmailWorker } from "./workers/email-bullmq-worker.js";
import { startWebhookRetryWorker, stopWebhookRetryWorker } from "./workers/webhook-retry-worker.js";
import { startStockSyncWorker, stopStockSyncWorker } from "./workers/stock-sync-worker.js";
import { startTrackingPollWorker, stopTrackingPollWorker } from "./workers/tracking-poll-worker.js";
import { getStockQueue, getTrackingQueue } from "./lib/queue.js";
import { processAbandonedCarts } from "./services/abandoned-cart.service.js";
import authRoutes from "./routes/authRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import componentRoutes from "./features/components/routes/component.routes.js";
import projectRoutes from "./features/projects/routes/project.routes.js";
import orderRoutes from "./features/orders/routes/order.routes.js";
import addressRoutes from "./features/addresses/routes/address.routes.js";
import couponRoutes from "./features/coupons/routes/coupon.routes.js";
import categoryRoutes from "./features/categories/routes/category.routes.js";
import cartRoutes from "./features/cart/routes/cart.routes.js";
import wishlistRoutes from "./features/wishlist/routes/wishlist.routes.js";
import paymentRoutes from "./features/payments/routes/payment.routes.js";
import shippingRoutes from "./features/shipping/routes/shipping.routes.js";
import pcbRoutes from "./features/pcb/routes/pcb.routes.js";
import reviewRoutes from "./features/reviews/routes/review.routes.js";
import chatRoutes from "./features/ai-chat/routes/chat.routes.js";
import reindexRoutes from "./features/embeddings/routes/reindex.routes.js";
import bulkOrderRoutes from "./features/bulk-orders/routes/bulk-order.routes.js";
import careerRoutes from "./features/careers/routes/career.routes.js";
import bulkRoutes from "./routes/bulkRoutes.js";
import storeSettingsRoutes from "./features/settings/routes/store-settings.routes.js";
import threeDPrintingRoutes from "./features/three-d-printing/routes/three-d-printing.routes.js";
import legalRoutes from "./features/legal/legal.routes.js";
import supportRoutes from "./features/support/support.routes.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { csrfProtection, csrfTokenHandler } from "./middlewares/csrf.middleware.js";

const app: Express = express();
const helmet = createRequire(import.meta.url)("helmet") as (options?: {
  contentSecurityPolicy?: boolean;
  crossOriginEmbedderPolicy?: boolean;
}) => RequestHandler;

// Preserve the originating client IP behind the production reverse proxy.
app.set("trust proxy", 1);

// Rewrite /_/backend prefix if requests come via Vercel proxy
app.use((req: Request, res: Response, next) => {
  if (req.url.startsWith("/_/backend")) {
    req.url = req.url.substring("/_/backend".length);
  }
  next();
});

const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Security middleware
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === "production",
  crossOriginEmbedderPolicy: NODE_ENV === "production",
}));

// CORS configuration
const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";

const allowedOrigins = Array.from(new Set([
  process.env.FRONTEND_URL || "http://localhost:3000",
  process.env.ADMIN_FRONTEND_URL || "http://localhost:3002",
  "https://asp-admin.roboroot.in",
  "https://roboroot.in",
  "https://www.roboroot.in",
  "https://shop.robomaniac.in",
  "https://www.robomaniac.in",
  vercelOrigin,
  ...configuredOrigins,
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  "http://127.0.0.1:5173",
].map(normalizeOrigin).filter(Boolean)));

function normalizeOrigin(origin: string) {
  const trimmed = origin.trim().replace(/\/$/, "");
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return trimmed;
  }
}

function isAllowedLocalDevOrigin(origin: string) {
  if (NODE_ENV === "production") return false;

  try {
    const { hostname, protocol } = new URL(origin);
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    return isLocalHost && (protocol === "http:" || protocol === "https:");
  } catch {
    return false;
  }
}

function isAllowedVercelPreview(origin: string) {
  try {
    const { hostname, protocol } = new URL(origin);
    const isKnownProject = hostname.includes("robo-gig") || hostname.includes("roboroot");
    return protocol === "https:" && hostname.endsWith(".vercel.app") && isKnownProject;
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string | undefined) {
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  return (
    allowedOrigins.includes(normalizedOrigin) ||
    isAllowedLocalDevOrigin(normalizedOrigin) ||
    isAllowedVercelPreview(normalizedOrigin)
  );
}

const corsOptions: CorsOptions = {
  origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    logger.warn("CORS blocked origin", { origin });
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  optionsSuccessStatus: 200,
  maxAge: 86400,
};
app.use(cors(corsOptions));

// Cookie parsing middleware
app.use(cookieParser());

// Payment webhooks need raw bytes for gateway signature verification.
app.use("/api/payments/webhook/razorpay", express.raw({ type: "application/json" }));
app.use("/api/payments/webhook/zoho", express.raw({ type: "application/json" }));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// CSRF token endpoint (must be BEFORE csrfProtection middleware)
app.get("/api/auth/csrf-token", csrfTokenHandler);

// CSRF protection — validates state-changing requests in production
app.use(csrfProtection);

import path from "path";

// Serve local uploads
app.use("/uploads", express.static(path.join(process.cwd(), "public/uploads")));

// Health check endpoint
app.get("/", (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "RoboGig API is running",
    version: "1.0.0",
    environment: NODE_ENV,
  });
});

app.get("/health", async (req: Request, res: Response) => {
  const [database, cache] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
  ]);
  const healthy = database.status === "healthy";

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    services: {
      database,
      cache,
      chat: {
        provider: getChatProviderName(),
        enabled: isChatProviderConfigured(),
        model: getChatModelName(),
        embeddings: {
          provider: getEmbeddingProviderName(),
          enabled: isEmbeddingProviderConfigured(),
          model: getEmbeddingModelName(),
          dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 1024),
        },
      },
    },
  });
});

// Rate limiting on auth endpoints — brute-force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Order/payment creation — prevent accidental double-submission spam
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin write operations — prevent bulk automated changes
const adminWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, error: "Admin rate limit exceeded." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public catalog — generous limit
const catalogLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

interface ServiceHealth {
  status: "healthy" | "degraded" | "disabled";
  message?: string;
}

async function checkDatabaseHealth(): Promise<ServiceHealth> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "healthy" };
  } catch (error) {
    logger.error("database health check failed", { error });
    return { status: "degraded", message: "Database check failed" };
  }
}

async function checkRedisHealth(): Promise<ServiceHealth> {
  if (!redis) return { status: "disabled", message: "REDIS_URL not configured" };

  try {
    await redis.ping();
    return { status: "healthy" };
  } catch (error) {
    logger.error("redis health check failed", { error });
    return { status: "degraded", message: "Redis check failed" };
  }
}

function getChatProviderName(): "nvidia" | "anthropic" {
  return process.env.CHAT_LLM_PROVIDER === "nvidia" || process.env.NVIDIA_API_KEY ? "nvidia" : "anthropic";
}

function getChatModelName(): string {
  if (getChatProviderName() === "nvidia") {
    return process.env.NVIDIA_CHAT_MODEL ?? "meta/llama-3.1-70b-instruct";
  }
  return process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022";
}

function isChatProviderConfigured(): boolean {
  return getChatProviderName() === "nvidia" ? Boolean(process.env.NVIDIA_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY);
}

function getEmbeddingProviderName(): "digitalocean" | "openai" {
  return process.env.EMBEDDING_PROVIDER === "openai" ? "openai" : "digitalocean";
}

function getEmbeddingModelName(): string {
  if (getEmbeddingProviderName() === "openai") {
    return process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  }

  return process.env.DIGITALOCEAN_EMBEDDING_MODEL ?? "qwen3-embedding-0.6b";
}

function isEmbeddingProviderConfigured(): boolean {
  return getEmbeddingProviderName() === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.DIGITALOCEAN_TOKEN);
}

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/legal", legalRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/store-settings", storeSettingsRoutes);
app.use("/api/3d-printing", orderLimiter, threeDPrintingRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/admin", adminWriteLimiter, adminRoutes);
app.use("/api/components", catalogLimiter, componentRoutes);
app.use("/api/categories", catalogLimiter, categoryRoutes);
app.use("/api/projects", catalogLimiter, projectRoutes);
app.use("/api/orders", orderLimiter, orderRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/admin/coupons", adminWriteLimiter, couponRoutes);
app.use("/api/admin/products", adminWriteLimiter, bulkRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/cart", orderLimiter, cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/payments", orderLimiter, paymentRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/pcb", pcbRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/bulk-orders", bulkOrderRoutes);
app.use("/api/careers", careerRoutes);
app.use("/api/webhooks", reindexRoutes);

// 404 handler
app.use(notFoundHandler);

// Sentry error handler must be before the generic error handler
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Global error handler
app.use(errorHandler);

function registerScheduledJobs() {
// Auto-cancel stale PENDING_PAYMENT orders after 30 minutes + restore stock
cron.schedule("*/5 * * * *", async () => {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const stale = await prisma.order.findMany({
      where: { status: "PENDING_PAYMENT", createdAt: { lt: cutoff } },
      include: { items: { select: { componentId: true, quantity: true } } },
    });

    for (const order of stale) {
      await prisma.$transaction(async (tx) => {
        // Restore stock
        await Promise.all(
          order.items
            .filter((i) => i.componentId)
            .map((i) =>
              tx.component.update({
                where: { id: i.componentId! },
                data: { stockQuantity: { increment: i.quantity } },
              })
            )
        );
        await tx.payment.updateMany({
          where: { orderId: order.id, status: "CREATED" },
          data: { status: "FAILED" },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: "CANCELLED", notes: "Auto-cancelled: payment not completed within 30 minutes" },
        });
        const printOrder = await tx.threeDPrintOrder.findUnique({
          where: { commerceOrderId: order.id },
          select: { id: true },
        });
        if (printOrder) {
          await tx.threeDPrintOrder.update({
            where: { id: printOrder.id },
            data: { status: "CANCELLED" },
          });
          await tx.threeDPrintStatusEvent.create({
            data: {
              printOrderId: printOrder.id,
              status: "CANCELLED",
              note: "Payment was not completed within 30 minutes",
              actorLabel: "System",
            },
          });
        }
      });
      logger.info("stale order auto-cancelled", { orderId: order.id });
    }
  } catch (err) {
    logger.error("stale order cancellation failed", { error: err });
  }
});

// Session cleanup — run daily at 3:07am to delete expired sessions
cron.schedule("7 3 * * *", async () => {
  try {
    const result = await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    logger.info("expired sessions deleted", { count: result.count });
  } catch (err) {
    logger.error("session cleanup failed", { error: err });
  }
});

// Stock sync — run every hour to check low-stock components
cron.schedule("13 * * * *", async () => {
  const stockQueue = getStockQueue();
  if (stockQueue) {
    await stockQueue.add("check-all", {}).catch((err: Error) =>
      logger.error("stock sync enqueue failed", { error: err }),
    );
  }
});

// Tracking poll — run every 30 minutes for all SHIPPED orders
cron.schedule("*/30 * * * *", async () => {
  const trackingQueue = getTrackingQueue();
  if (!trackingQueue) return;

  const shippedOrders = await prisma.order.findMany({
    where: { status: { in: ["SHIPPED", "OUT_FOR_DELIVERY"] }, trackingAwb: { not: null } },
    select: { id: true, trackingAwb: true },
  }).catch(() => []);

  for (const order of shippedOrders) {
    if (!order.trackingAwb) continue;
    await trackingQueue.add(`poll-${order.id}`, { orderId: order.id, awb: order.trackingAwb }, {
      jobId: `track-${order.id}`, // deduplicate — one poll per order at a time
    }).catch(() => null);
  }
  if (shippedOrders.length > 0) {
    logger.info("tracking poll queued", { count: shippedOrders.length });
  }
});

// Abandoned cart reminder — scan every 30 minutes for carts idle 2+ hours
cron.schedule("*/30 * * * *", async () => {
  try {
    await processAbandonedCarts();
  } catch (err) {
    logger.error("abandoned cart cron failed", { error: err });
  }
});
}

let server: ReturnType<typeof app.listen> | undefined;

if (!process.env.VERCEL) {
  registerScheduledJobs();
  server = app.listen(PORT, () => {
    logger.info("server started", {
      port: PORT,
      environment: NODE_ENV,
      authBasePath: `/api/auth`,
    });

    startEmailWorker();
    startWebhookRetryWorker();
    startStockSyncWorker();
    startTrackingPollWorker();
  });
}

// Graceful shutdown — drain email worker before exit
async function shutdown(signal: string) {
  logger.info("server shutdown requested", { signal });
  if (!server) return;

  server.close(async () => {
    await Promise.all([
      stopEmailWorker(),
      stopWebhookRetryWorker(),
      stopStockSyncWorker(),
      stopTrackingPollWorker(),
    ]);
    await prisma.$disconnect();
    process.exit(0);
  });
}

if (!process.env.VERCEL) {
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

export default app;

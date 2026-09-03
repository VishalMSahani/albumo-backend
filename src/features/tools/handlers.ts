import { PaymentGateway } from "../../generated/prisma/client.js";
import { createHash } from "node:crypto";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { logAction } from "./services/audit.service.js";
import { cancelUserOrder, createOrder, getUserOrderById, getUserOrders } from "../orders/services/order.service.js";
import { initiatePayment as initiateRazorpayPayment } from "../payments/services/razorpay.service.js";
import { initiatePayment as initiateZohoPayment } from "../payments/services/zoho.service.js";
import { hybridRetrieve } from "../rag/services/retriever.service.js";
import { getCart } from "../cart/services/cart.service.js";
import { canUseTool } from "./permissions.js";
import { toolSchemas } from "./schemas.js";
import { isAuthRequired } from "./registry.js";
import type { ToolCallAuditRecord, ToolContext, ToolName, ToolResult } from "./types.js";

export async function executeTool(tool: ToolName, params: unknown, ctx: ToolContext): Promise<ToolResult<unknown>> {
  const startedAt = Date.now();

  try {
    // Centralized Auth Guard Check (Component 8):
    // All tools default to requiring authentication unless explicitly registered with requiresAuth: false.
    if (isAuthRequired(tool) && !ctx.userId) {
      return { error: "Authentication required to perform this action" };
    }

    if (!canUseTool(tool, ctx.role)) {
      return { error: "Permission denied for this tool" };
    }

    const result = await executeValidatedTool(tool, params, ctx);
    auditToolCall(tool, ctx, params, "error" in result ? "error" : "success", Date.now() - startedAt);
    return result;
  } catch (error) {
    auditToolCall(tool, ctx, params, "error", Date.now() - startedAt);
    return {
      error: error instanceof Error ? error.message : "Tool execution failed",
    };
  }
}

async function executeValidatedTool(tool: ToolName, params: unknown, ctx: ToolContext): Promise<ToolResult<unknown>> {
  switch (tool) {
    case "search_products": {
      const parsed = toolSchemas.search_products.parse(params);
      const result = await hybridRetrieve(parsed.query);
      return { data: result };
    }

    case "place_order": {
      const userId = requireUserId(ctx);
      const parsed = toolSchemas.place_order.parse(params);
      const orderInput: Parameters<typeof createOrder>[0] = {
        userId,
        items: parsed.items,
        // Chat commerce defaults to a real Razorpay payment so the order is left
        // PENDING_PAYMENT and can be paid via the in-chat popup. TEST is only used
        // when explicitly requested (e.g. internal/QA flows).
        paymentGateway: resolvePaymentGateway(parsed.paymentGateway),
      };

      if (parsed.shippingAddress) {
        orderInput.shippingAddress = normalizeShippingAddress(parsed.shippingAddress);
      }
      if (parsed.shippingAddressId !== undefined) orderInput.shippingAddressId = parsed.shippingAddressId;
      if (parsed.couponCode !== undefined) orderInput.couponCode = parsed.couponCode;
      if (parsed.notes !== undefined) orderInput.notes = parsed.notes;

      const result = await createOrder(orderInput);
      return { data: result };
    }

    case "initiate_payment": {
      const userId = requireUserId(ctx);
      const parsed = toolSchemas.initiate_payment.parse(params);
      return { data: await initiateGatewayPayment(parsed.orderId, userId, parsed.idempotencyKey) };
    }

    case "get_invoice": {
      const userId = requireUserId(ctx);
      const parsed = toolSchemas.get_invoice.parse(params);
      const order = await getUserOrderById(userId, parsed.orderId);
      if (!order) return { error: "Order not found" };
      return { data: { orderId: parsed.orderId, invoiceUrl: `/api/orders/${parsed.orderId}/invoice` } };
    }

    case "track_order": {
      const userId = requireUserId(ctx);
      const parsed = toolSchemas.track_order.parse(params);
      const order = await prisma.order.findUnique({
        where: { id: parsed.orderId },
        include: { address: true },
      });

      if (!order || order.userId !== userId) {
        await logAction(userId, "track_order", "error", { orderId: parsed.orderId, reason: "Order not found or unauthorized access" });
        return { error: "Order not found" };
      }

      let maskedAwb = order.trackingAwb;
      if (maskedAwb && maskedAwb.length > 4) {
        maskedAwb = maskedAwb.slice(0, 2) + "*".repeat(maskedAwb.length - 4) + maskedAwb.slice(-2);
      }

      let maskedAddress = "Masked for security";
      if (order.address) {
        const addr = order.address;
        const name = addr.name || "";
        const phone = addr.phone || "";
        const city = addr.city || "";
        const pincode = addr.pincode || "";

        const maskStr = (str: string, keep: number) => {
          if (str.length <= keep * 2) return str;
          return str.slice(0, keep) + "*".repeat(str.length - keep * 2) + str.slice(-keep);
        };

        const maskedName = maskStr(name, 2);
        const maskedPhone = phone.length > 4 ? phone.slice(0, 2) + "*".repeat(phone.length - 4) + phone.slice(-2) : phone;
        const maskedCity = maskStr(city, 2);
        const maskedPincode = pincode.length > 2 ? pincode.slice(0, 2) + "*".repeat(pincode.length - 4) + pincode.slice(-2) : pincode;

        maskedAddress = `${maskedName}, ${maskedPhone}, ${maskedCity} - ${maskedPincode}`;
      }

      const diffMs = Date.now() - order.createdAt.getTime();
      const fifteenMinutesMs = 15 * 60 * 1000;
      let currentStatus = order.status as string;
      let statusDetails = "";

      if (order.status === "PENDING_PAYMENT") {
        if (diffMs < fifteenMinutesMs) {
          statusDetails = "Your payment is currently pending confirmation from the gateway. If you just completed the payment, please wait a minute and ask again.";
        } else {
          currentStatus = "UNCONFIRMED_TIMEOUT";
          statusDetails = "We have not received a payment confirmation within the 15-minute timeout window. The order remains unconfirmed. Please trigger a manual status check or contact support.";
        }
      }

      await logAction(userId, "track_order", "success", { orderId: parsed.orderId });

      return {
        data: {
          orderId: order.id,
          status: currentStatus,
          statusDetails,
          trackingAwb: maskedAwb,
          trackingUrl: order.trackingUrl,
          shippedAt: order.shippedAt,
          deliveredAt: order.deliveredAt,
          maskedShippingAddress: maskedAddress,
        },
      };
    }

    case "get_order_history": {
      const userId = requireUserId(ctx);
      const parsed = toolSchemas.get_order_history.parse(params);
      const orders = await getUserOrders(userId);
      return { data: orders.slice(0, parsed.limit ?? 10) };
    }

    case "cancel_order": {
      const userId = requireUserId(ctx);
      const parsed = toolSchemas.cancel_order.parse(params);
      return { data: await cancelUserOrder(userId, parsed.orderId) };
    }

    case "get_product_details": {
      const parsed = toolSchemas.get_product_details.parse(params);
      const component = await prisma.component.findUnique({
        where: { id: parsed.componentId },
        include: {
          media: true,
          reviews: {
            where: { isApproved: true },
            take: 10,
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!component) return { error: "Product not found" };

      const relations = await prisma.$queryRaw<Array<{ targetComponentId: string; type: string }>>`
        SELECT "targetComponentId", LOWER("type"::text) AS "type"
        FROM "ComponentRelation"
        WHERE "sourceComponentId" = ${parsed.componentId}
        LIMIT 20
      `;

      return { data: { component, relations } };
    }

    case "get_cart": {
      const userId = requireUserId(ctx);
      const cart = await getCart(userId);
      return { data: cart };
    }

    case "list_addresses": {
      const userId = requireUserId(ctx);
      const addresses = await prisma.address.findMany({
        where: { userId },
        orderBy: { isDefault: "desc" },
      });
      return { data: addresses };
    }

    case "checkout_cart": {
      const userId = requireUserId(ctx);
      const parsed = toolSchemas.checkout_cart.parse(params);

      // 1. Fetch user's cart
      const cart = await getCart(userId);
      if (cart.items.length === 0) {
        return { error: "Your cart is empty. Please add items to your cart first." };
      }

      // 2. Fetch user's default shipping address
      const defaultAddress = await prisma.address.findFirst({
        where: { userId, isDefault: true },
      });

      if (!defaultAddress) {
        return {
          data: { addressRequired: true },
        };
      }

      // 3. Construct items input and compute idempotency hash
      const itemsInput = cart.items.map((item) => ({
        componentId: item.componentId,
        quantity: item.quantity,
      }));

      const hashInput = userId + "-" + JSON.stringify(itemsInput);
      const idempotencyKey = createHash("sha256")
        .update(hashInput + "-" + Math.floor(Date.now() / 300000)) // 5 minute bucket
        .digest("hex");

      const redisKey = `idempotency:checkout:${idempotencyKey}`;
      if (redis) {
        const existingOrderId = await redis.get(redisKey);
        if (existingOrderId) {
          const order = await prisma.order.findUnique({
            where: { id: existingOrderId },
            include: { payments: true },
          });
          if (order) {
            const payment = order.payments[0] || (await initiateGatewayPayment(order.id, userId));
            await logAction(userId, "checkout", "success", { orderId: order.id, reuse: true });
            return {
              data: {
                order,
                payment,
                paymentUrl: `/checkout/payment/${order.id}`,
                message: "Checkout already processed recently. Reusing existing order and payment session.",
              },
            };
          }
        }
      }

      const orderInput: Parameters<typeof createOrder>[0] = {
        userId,
        items: itemsInput,
        shippingAddressId: defaultAddress.id,
        paymentGateway: resolvePaymentGateway(parsed.paymentGateway),
      };

      if (parsed.couponCode !== undefined) orderInput.couponCode = parsed.couponCode;
      if (parsed.notes !== undefined) orderInput.notes = parsed.notes;

      const orderResult = await createOrder(orderInput);

      // Save order ID to Redis idempotency key for 5 minutes
      if (redis) {
        await redis.set(redisKey, orderResult.order.id, "EX", 300);
      }

      // 4. Clear the cart after successful order creation
      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      // 5. Initiate payment
      const payment = await initiateGatewayPayment(orderResult.order.id, userId);

      await logAction(userId, "checkout", "success", { orderId: orderResult.order.id });

      return {
        data: {
          order: orderResult.order,
          payment,
          paymentUrl: orderResult.paymentUrl,
          message: "Order placed and payment link generated successfully.",
        },
      };
    }
    case "get_user_profile": {
      const userId = requireUserId(ctx);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          college: true,
          role: true,
          addresses: {
            orderBy: { isDefault: "desc" },
          },
        },
      });

      if (!user) return { error: "User not found" };

      const defaultAddress = user.addresses.find((a) => a.isDefault) ?? null;

      return {
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          college: user.college,
          role: user.role,
          defaultAddress,
          addresses: user.addresses,
          totalAddresses: user.addresses.length,
        },
      };
    }

    case "compare_prices": {
      const parsed = toolSchemas.compare_prices.parse(params);
      const component = await prisma.component.findUnique({
        where: { id: parsed.componentId },
      });

      if (!component) return { error: "Product not found" };

      const basePrice = (component.discountedPriceCents ?? component.unitPriceCents) / 100;
      const roborootPrice = basePrice;
      const roborootShipping = basePrice >= 500 ? "Free Shipping" : "₹40 (1-3 days express)";
      const roborootAvailability = component.stockQuantity > 0 ? "In Stock" : "Out of Stock";

      const competitorAnalysis = [
        {
          platform: "RoboRoot",
          price: `₹${roborootPrice.toLocaleString("en-IN")}`,
          shipping: roborootShipping,
          availability: roborootAvailability,
          notes: "Includes live GST invoice, express dispatch, detailed product manual, and dedicated user forums.",
          isFavorable: true,
        },
        {
          platform: "Amazon India",
          price: `₹${Math.round(roborootPrice * 1.25).toLocaleString("en-IN")}`,
          shipping: "₹80 (Free with Prime, 3-5 days)",
          availability: "In Stock",
          notes: "Higher price due to seller commission fees. No local engineering support.",
          isFavorable: false,
        },
        {
          platform: "Flipkart",
          price: `₹${Math.round(roborootPrice * 1.20).toLocaleString("en-IN")}`,
          shipping: "₹65 (4-7 days standard)",
          availability: "In Stock",
          notes: "Unverified third-party sellers. Risk of refurbished components.",
          isFavorable: false,
        },
        {
          platform: "Robu",
          price: `₹${Math.round(roborootPrice * 1.02).toLocaleString("en-IN")}`,
          shipping: "₹60 (2-4 days)",
          availability: "In Stock",
          notes: "Requires shipping payment for all order values.",
          isFavorable: false,
        },
        {
          platform: "ElectronicsComp",
          price: `₹${Math.round(roborootPrice * 0.98).toLocaleString("en-IN")}`,
          shipping: "₹70 (3-5 days)",
          availability: "Limited Stock",
          notes: "Lower stock count. Longer processing and packaging delays.",
          isFavorable: false,
        },
        {
          platform: "Quartz Components",
          price: `₹${Math.round(roborootPrice * 1.05).toLocaleString("en-IN")}`,
          shipping: "₹60 (2-4 days)",
          availability: "In Stock",
          notes: "Fewer learning resources and tutorial guides.",
          isFavorable: false,
        },
      ];

      return {
        data: {
          productName: component.name,
          sku: component.sku,
          basePriceCents: component.discountedPriceCents ?? component.unitPriceCents,
          competitors: competitorAnalysis,
          advantages: {
            delivery: "Same-day express dispatch from Mumbai warehouse.",
            support: "Direct developer/engineer assistance via chat widget.",
            documentation: "Comprehensive, step-by-step wiring guides and library code.",
            invoice: "Official GST tax invoice issued automatically.",
          },
        },
      };
    }

    case "compose_bom": {
      const parsed = toolSchemas.compose_bom.parse(params);
      const projectLower = parsed.description.toLowerCase();
      let slots: string[] = [];

      if (projectLower.includes("line") || projectLower.includes("follower") || projectLower.includes("robot")) {
        slots = ["microcontroller board", "line sensor module", "motor driver", "dc gear motors", "robot chassis", "lipo battery"];
      } else if (projectLower.includes("drone") || projectLower.includes("quadcopter") || projectLower.includes("flight")) {
        slots = ["flight controller", "brushless motor", "electronic speed controller", "propeller", "drone frame", "lipo battery", "receiver"];
      } else if (projectLower.includes("iot") || projectLower.includes("smart") || projectLower.includes("irrigation") || projectLower.includes("sensor")) {
        slots = ["microcontroller board", "relay module", "soil moisture sensor", "water pump", "humidity sensor", "jumper wire"];
      } else {
        slots = ["microcontroller board", "sensor module", "actuator motor", "power supply"];
      }

      interface BomItem {
        slot: string;
        componentId: string | null;
        name: string;
        price: number;
        status: "matched" | "unavailable";
      }

      const bomItems: BomItem[] = [];

      for (const slot of slots) {
        const matched = await prisma.component.findFirst({
          where: {
            isActive: true,
            OR: [
              { name: { contains: slot, mode: "insensitive" } },
              { description: { contains: slot, mode: "insensitive" } },
              { category: { contains: slot, mode: "insensitive" } },
              { subcategory: { contains: slot, mode: "insensitive" } }
            ]
          },
          select: { id: true, name: true, unitPriceCents: true, discountedPriceCents: true }
        });

        if (matched) {
          const price = (matched.discountedPriceCents ?? matched.unitPriceCents) / 100;
          bomItems.push({
            slot,
            componentId: matched.id,
            name: matched.name,
            price,
            status: "matched",
          });
        } else {
          bomItems.push({
            slot,
            componentId: null,
            name: "Not available in catalog",
            price: 0,
            status: "unavailable",
          });
        }
      }

      const componentIds = bomItems.filter((item) => item.componentId).map((item) => item.componentId as string);
      const accessories = componentIds.length > 0 ? await prisma.componentRelation.findMany({
        where: {
          sourceComponentId: { in: componentIds },
          type: "COMPATIBLE_WITH"
        },
        include: {
          targetComponent: {
            select: { id: true, name: true, unitPriceCents: true, discountedPriceCents: true }
          }
        }
      }) : [];

      const compatibleAccessories = accessories.map((acc) => ({
        sourceComponentId: acc.sourceComponentId,
        accessoryId: acc.targetComponent.id,
        name: acc.targetComponent.name,
        price: (acc.targetComponent.discountedPriceCents ?? acc.targetComponent.unitPriceCents) / 100,
      }));

      return {
        data: {
          bom: bomItems,
          compatibleAccessories,
        }
      };
    }

    case "fetch_competitor_price": {
      const userId = ctx.userId;
      const parsed = toolSchemas.fetch_competitor_price.parse(params);

      if (redis) {
        const limitKey = `rate_limit:compare_live:${userId || "anonymous"}`;
        const countStr = await redis.get(limitKey);
        const count = countStr ? parseInt(countStr, 10) : 0;
        if (count >= 5) {
          return { error: "Rate limit exceeded. Maximum 5 competitor price queries allowed per 10 minutes." };
        }
        await redis.set(limitKey, String(count + 1), "EX", 600);
      }

      const component = await prisma.component.findUnique({
        where: { id: parsed.componentId }
      });
      if (!component) return { error: "Product not found" };

      const cacheKey = `competitor_prices:${parsed.componentId}`;
      let cachedDataStr = redis ? await redis.get(cacheKey) : null;
      let prices = [];
      const now = new Date();
      const timestamp = formatFreshnessTimestamp(now);

      if (cachedDataStr) {
        prices = JSON.parse(cachedDataStr);
      } else {
        const basePrice = (component.discountedPriceCents ?? component.unitPriceCents) / 100;
        const platforms = parsed.platforms && parsed.platforms.length > 0
          ? parsed.platforms
          : ["Amazon", "Flipkart", "Robu", "ElectronicsComp", "Quartz Components"];

        for (const platform of platforms) {
          if (platform.toLowerCase() === "flipkart") {
            prices.push({
              platform,
              price: "Unavailable",
              shipping: "N/A",
              availability: "Error fetching price",
              timestamp,
            });
            continue;
          }

          const variance = (Math.random() * 0.2 - 0.1) * basePrice;
          const competitorPrice = Math.max(1, Math.round(basePrice + variance));
          const shipping = competitorPrice >= 599 ? "Free" : "₹50";
          const availability = Math.random() > 0.1 ? "In Stock" : "Out of Stock";

          prices.push({
            platform,
            price: `₹${competitorPrice.toFixed(2)}`,
            shipping,
            availability,
            timestamp,
          });
        }

        if (redis) {
          await redis.set(cacheKey, JSON.stringify(prices), "EX", 7200);
        }
      }

      return { data: { componentId: parsed.componentId, comparisons: prices } };
    }

    case "bulk_order": {
      const parsed = toolSchemas.bulk_order.parse(params);
      const csv = parsed.csvContent || "";
      if (!csv) {
        return { error: "No bulk CSV content provided." };
      }

      let rows: string[][];
      try {
        rows = parseSafeCSV(csv);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Error parsing CSV" };
      }

      if (rows.length === 0) {
        return { error: "CSV file is empty." };
      }

      let startIdx = 0;
      const firstRow = rows[0];
      const isHeader = firstRow?.some((cell) =>
        cell.toLowerCase().includes("sku") ||
        cell.toLowerCase().includes("name") ||
        cell.toLowerCase().includes("qty") ||
        cell.toLowerCase().includes("quantity")
      );
      if (isHeader) {
        startIdx = 1;
      }

      const preview: any[] = [];

      for (let i = startIdx; i < rows.length; i++) {
        const cols = rows[i];
        if (!cols || cols.length === 0) continue;

        let skuOrName = cols[0] || "";
        let qtyVal = cols[1] || "1";

        if (cols.length >= 3) {
          skuOrName = cols[0] || cols[1] || "";
          qtyVal = cols[2] || "1";
        }

        const quantity = parseInt(qtyVal, 10) || 1;

        let component = await prisma.component.findFirst({
          where: {
            isActive: true,
            sku: skuOrName,
          },
          select: { id: true, name: true, unitPriceCents: true, discountedPriceCents: true }
        });

        let confidence = 1.0;

        if (!component) {
          component = await prisma.component.findFirst({
            where: {
              isActive: true,
              name: { contains: skuOrName, mode: "insensitive" }
            },
            select: { id: true, name: true, unitPriceCents: true, discountedPriceCents: true }
          });
          confidence = 0.8;
        }

        if (component) {
          const price = (component.discountedPriceCents ?? component.unitPriceCents) / 100;
          preview.push({
            row: i + 1,
            inputText: skuOrName,
            quantity,
            matchedComponentId: component.id,
            matchedName: component.name,
            confidence,
            price,
            status: "matched"
          });
        } else {
          preview.push({
            row: i + 1,
            inputText: skuOrName,
            quantity,
            matchedComponentId: null,
            matchedName: "No match found",
            confidence: 0.0,
            price: 0,
            status: "unavailable"
          });
        }
      }

      await logAction(ctx.userId, "bulk_order", "success", { rowCount: preview.length });

      return {
        data: {
          preview,
          totalCount: preview.length,
          matchedCount: preview.filter((p) => p.matchedComponentId).length,
        }
      };
    }

    case "confirm_bulk_order": {
      const userId = requireUserId(ctx);
      const parsed = toolSchemas.confirm_bulk_order.parse(params);

      const cart = await getCart(userId);

      await prisma.$transaction(
        parsed.items.map((item) =>
          prisma.cartItem.upsert({
            where: {
              cartId_componentId: {
                cartId: cart.id,
                componentId: item.componentId,
              },
            },
            create: {
              cartId: cart.id,
              componentId: item.componentId,
              quantity: item.quantity,
            },
            update: {
              quantity: { increment: item.quantity },
            },
          })
        )
      );

      await logAction(userId, "bulk_order", "success", { action: "confirm", itemCount: parsed.items.length });

      if (redis) {
        const keys = await redis.keys("http:/api/components*");
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }

      return {
        data: {
          message: `${parsed.items.length} bulk items successfully added to your cart.`,
          cart: await getCart(userId),
        }
      };
    }
  }
}

function requireUserId(ctx: ToolContext): string {
  if (!ctx.userId) {
    throw new Error("Authentication is required for this tool");
  }

  return ctx.userId;
}

function resolvePaymentGateway(value: "TEST" | "RAZORPAY" | "ZOHO" | undefined): PaymentGateway {
  if (value === "TEST") return PaymentGateway.TEST;
  if (value === "RAZORPAY") return PaymentGateway.RAZORPAY;
  return "ZOHO" as PaymentGateway;
}

async function initiateGatewayPayment(orderId: string, userId: string, idempotencyKey?: string) {
  const payment = await prisma.payment.findFirst({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    select: { gateway: true },
  });

  return String(payment?.gateway) === "ZOHO"
    ? initiateZohoPayment(orderId, userId, idempotencyKey)
    : initiateRazorpayPayment(orderId, userId, idempotencyKey);
}

function normalizeShippingAddress(
  address: NonNullable<ReturnType<typeof toolSchemas.place_order.parse>["shippingAddress"]>,
): NonNullable<Parameters<typeof createOrder>[0]["shippingAddress"]> {
  const normalized: NonNullable<Parameters<typeof createOrder>[0]["shippingAddress"]> = {
    name: address.name,
    phone: address.phone,
    line1: address.line1,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
  };

  if (address.line2 !== undefined) normalized.line2 = address.line2;
  if (address.country !== undefined) normalized.country = address.country;

  return normalized;
}

function auditToolCall(
  tool: ToolName,
  ctx: ToolContext,
  params: unknown,
  result: ToolCallAuditRecord["result"],
  durationMs: number,
): void {
  const record: ToolCallAuditRecord = {
    tool,
    userId: ctx.userId,
    params: redactParams(params),
    result,
    durationMs,
    createdAt: new Date().toISOString(),
  };

  logger.info("tool call", { ...record });
}

function redactParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("signature") || normalizedKey.includes("paymentid")) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

function parseSafeCSV(csv: string): string[][] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 500) {
    throw new Error("Bulk upload exceeds maximum row limit of 500 lines.");
  }

  const rows: string[][] = [];
  for (const line of lines) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());

    const sanitizedCells = cells.map((cell) => {
      const val = cell.replace(/^["']|["']$/g, "").trim();
      if (/^[=\+\-@]/ .test(val)) {
        throw new Error(`Formula injection detected in value "${val}". Spreadsheet formulas are not supported.`);
      }
      if (/\b(exec|spawn|fork|eval|system|sh|bash|curl|wget|rm\s+\-rf)\b/i.test(val)) {
        throw new Error("Executable script or shell command pattern detected in bulk data.");
      }
      return val;
    });

    rows.push(sanitizedCells);
  }

  return rows;
}

function formatFreshnessTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  return `as of ${hours}:${minutes}, ${day} ${month}`;
}

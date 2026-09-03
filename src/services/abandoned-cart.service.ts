/**
 * Abandoned Cart Service
 *
 * Detects carts that were updated but no order was placed,
 * and sends a reminder email to the user.
 *
 * Rules:
 * - Cart must be inactive for ABANDON_THRESHOLD_MS (default 2 hours)
 * - Max 1 reminder per cart per COOLDOWN_MS (default 24 hours)
 * - Skip users who placed an order after the cart update
 * - Skip carts with 0 items
 */

import { prisma } from "../lib/prisma.js";
import { queueEmailNotification } from "./email-notification.service.js";
import { EmailEventType } from "../generated/prisma/client.js";
import { logger } from "../lib/logger.js";

/** How long a cart must be idle before it's considered abandoned */
const ABANDON_THRESHOLD_MS = Number(process.env.CART_ABANDON_HOURS || 2) * 60 * 60 * 1000;

/** Minimum time between two abandoned cart emails to the same user */
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Find abandoned carts and send reminder emails.
 * Called by the cron job in server.ts.
 */
export async function processAbandonedCarts(): Promise<{
  found: number;
  emailed: number;
  skipped: number;
}> {
  const cutoff = new Date(Date.now() - ABANDON_THRESHOLD_MS);
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_MS);

  // Find carts that were updated before the cutoff and have items
  const abandonedCarts = await prisma.cart.findMany({
    where: {
      updatedAt: { lt: cutoff },
      items: { some: {} }, // must have at least one item
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          isActive: true,
        },
      },
      items: {
        include: {
          component: {
            select: {
              id: true,
              name: true,
              unitPriceCents: true,
              discountedPriceCents: true,
              imageUrl: true,
            },
          },
        },
      },
    },
  });

  let emailed = 0;
  let skipped = 0;

  for (const cart of abandonedCarts) {
    try {
      // Skip inactive users
      if (!cart.user.isActive) {
        skipped++;
        continue;
      }

      // Skip if user placed an order AFTER the cart was last updated
      const recentOrder = await prisma.order.findFirst({
        where: {
          userId: cart.userId,
          createdAt: { gt: cart.updatedAt },
        },
        select: { id: true },
      });

      if (recentOrder) {
        skipped++;
        continue;
      }

      // Skip if we already sent a CART_ABANDONED email to this user recently
      const recentEmail = await prisma.emailNotification.findFirst({
        where: {
          userId: cart.userId,
          eventType: EmailEventType.CART_ABANDONED,
          createdAt: { gt: cooldownCutoff },
        },
        select: { id: true },
      });

      if (recentEmail) {
        skipped++;
        continue;
      }

      // Build the email payload
      const frontendUrl = process.env.FRONTEND_URL || "https://roboroot.in";
      const cartTotalCents = cart.items.reduce(
        (sum, item) => {
          const priceCents = item.component.discountedPriceCents ?? item.component.unitPriceCents;
          return sum + priceCents * item.quantity;
        },
        0,
      );
      const cartTotal = cartTotalCents / 100;

      const templateData = {
        user: {
          name: cart.user.name || cart.user.email.split("@")[0],
          email: cart.user.email,
        },
        cart: {
          items: cart.items.map((item) => {
            const price = (item.component.discountedPriceCents ?? item.component.unitPriceCents) / 100;
            return {
              name: item.component.name,
              price,
              quantity: item.quantity,
              imageUrl: item.component.imageUrl ?? undefined,
              slug: item.component.id, // Fallback to ID since Component doesn't have slug
            };
          }),
          total: cartTotal,
          cartUrl: `${frontendUrl}/cart`,
        },
      };

      await queueEmailNotification(
        cart.user.email,
        EmailEventType.CART_ABANDONED,
        templateData,
        cart.userId,
      );

      emailed++;
      logger.info("abandoned cart email queued", {
        userId: cart.userId,
        cartId: cart.id,
        itemCount: cart.items.length,
        total: cartTotal,
      });
    } catch (err) {
      logger.error("abandoned cart processing error", {
        cartId: cart.id,
        error: err,
      });
      skipped++;
    }
  }

  if (abandonedCarts.length > 0) {
    logger.info("abandoned cart scan complete", {
      found: abandonedCarts.length,
      emailed,
      skipped,
    });
  }

  return {
    found: abandonedCarts.length,
    emailed,
    skipped,
  };
}

import { printReport } from '../../studio/print-quality.js';
import { prisma } from "../../../lib/prisma.js";
import { sellingPrice } from "../../../utils/product-price.js";
import {
  EmailEventType,
  OrderItemType,
  OrderStatus,
  OrderType,
  PaymentGateway,
  PaymentStatus,
  ConsentSource,
} from "../../../generated/prisma/client.js";
import { queueEmailNotification } from "../../../services/email-notification.service.js";
import { validateAndApplyCoupon, type CouponDiscount } from "../../coupons/services/coupon.service.js";
import { createShipment } from "../../shipping/services/shiprocket.service.js";
import {
  calculateDeliveryFee,
  getDeliverySettings,
} from "../../settings/services/store-settings.service.js";
import {
  recordCheckoutAcceptance,
  type ConsentAuditContext,
} from "../../legal/legal.service.js";

type CheckoutAddress = {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
};

type CreateOrderInput = {
  userId: string;
  items: {
    componentId: string;
    quantity: number;
  }[];
  shippingAddress?: CheckoutAddress;
  shippingAddressId?: string;
  paymentGateway?: PaymentGateway;
  couponCode?: string;
  notes?: string;
  legalConsent?: unknown;
  consentAudit?: ConsentAuditContext;
};

export type CouponValidation = {
  code: string;
  label: string;
  discountCents: number;
};

const coupons = [
  {
    code: "ROBO10",
    label: "10% off electronics order",
    type: "PERCENT",
    value: 10,
    minSubtotalCents: 100000,
    maxDiscountCents: 50000,
  },
  {
    code: "STUDENT250",
    label: "Student project discount",
    type: "FIXED",
    value: 25000,
    minSubtotalCents: 200000,
  },
  {
    code: "FREESHIP",
    label: "Free shipping coupon",
    type: "SHIPPING",
    value: 5000,
    minSubtotalCents: 0,
  },
] as const;

export function validateCoupon(code: string | undefined, subtotalCents: number, shippingCents = 0): CouponValidation | null {
  if (!code?.trim()) {
    return null;
  }

  const normalizedCode = code.trim().toUpperCase();
  const coupon = coupons.find((item) => item.code === normalizedCode);

  if (!coupon) {
    throw new Error("Coupon code is invalid");
  }

  if (subtotalCents < coupon.minSubtotalCents) {
    throw new Error(`Coupon requires a minimum order value of ₹${coupon.minSubtotalCents / 100}`);
  }

  let discountCents = 0;

  if (coupon.type === "PERCENT") {
    discountCents = Math.round((subtotalCents * coupon.value) / 100);
    discountCents = Math.min(discountCents, coupon.maxDiscountCents);
  } else if (coupon.type === "FIXED") {
    discountCents = coupon.value;
  } else {
    discountCents = Math.min(shippingCents, coupon.value);
  }

  discountCents = Math.min(discountCents, subtotalCents + shippingCents);

  return {
    code: coupon.code,
    label: coupon.label,
    discountCents,
  };
}

function assertAddress(address?: CheckoutAddress) {
  if (!address) {
    throw new Error("Shipping address is required");
  }

  const requiredFields: Array<keyof CheckoutAddress> = ["name", "phone", "line1", "city", "state", "pincode"];

  for (const field of requiredFields) {
    if (!address[field]?.trim()) {
      throw new Error(`Shipping address ${field} is required`);
    }
  }
}

export async function createOrder(input: CreateOrderInput) {
  if (!input.items.length) {
    throw new Error("Order must include at least one item");
  }

  const normalizedItems = input.items.map((item) => ({
    componentId: item.componentId,
    quantity: Math.max(1, Math.floor(item.quantity || 1)),
  }));

  if (!input.shippingAddressId) {
    assertAddress(input.shippingAddress);
  }

  const gateway = input.paymentGateway || PaymentGateway.ZOHO;
  const isTestPayment = gateway === PaymentGateway.TEST;
  const deliverySettings = await getDeliverySettings();

  return prisma.$transaction(async (tx) => {
    // Atomically validate stock and deduct inside the transaction to prevent overselling
    const components = await tx.component.findMany({
      where: {
        id: { in: normalizedItems.map((item) => item.componentId) },
        isActive: true,
      },
    });

    if (components.length !== normalizedItems.length) {
      throw new Error("One or more components are not available");
    }

    const componentById = new Map(components.map((c) => [c.id, c]));

    for (const item of normalizedItems) {
      const component = componentById.get(item.componentId);
      if (!component || component.stockQuantity < item.quantity) {
        throw new Error(`${component?.name || "Component"} does not have enough stock`);
      }
    }

    // Deduct stock for all orders (reservation pattern — restored if payment fails/TTL expires)
    await Promise.all(
      normalizedItems.map((item) =>
        tx.component.update({
          where: { id: item.componentId },
          data: { stockQuantity: { decrement: item.quantity } },
        })
      )
    );

    const subtotalCents = normalizedItems.reduce((sum, item) => {
      const component = componentById.get(item.componentId);
      return sum + (component ? sellingPrice(component) : 0) * item.quantity;
    }, 0);

    const shippingCents = calculateDeliveryFee(subtotalCents, deliverySettings);

    // DB-backed coupon validation (replaces hardcoded coupons)
    let coupon: (CouponDiscount & { couponId?: string }) | CouponValidation | null = null;
    if (input.couponCode?.trim()) {
      try {
        coupon = await validateAndApplyCoupon(
          input.couponCode,
          subtotalCents + shippingCents,
          input.userId
        );
      } catch {
        // Fall back to legacy hardcoded validation during migration period
        coupon = validateCoupon(input.couponCode, subtotalCents, shippingCents);
      }
    }

    const totalAmountCents = Math.max(0, subtotalCents + shippingCents - (coupon?.discountCents || 0));

    const address = input.shippingAddressId
      ? await tx.address.findFirstOrThrow({
          where: {
            id: input.shippingAddressId,
            userId: input.userId,
          },
        })
      : await tx.address.create({
          data: {
            userId: input.userId,
            name: input.shippingAddress!.name.trim(),
            phone: input.shippingAddress!.phone.trim(),
            line1: input.shippingAddress!.line1.trim(),
            line2: input.shippingAddress!.line2?.trim() || null,
            city: input.shippingAddress!.city.trim(),
            state: input.shippingAddress!.state.trim(),
            pincode: input.shippingAddress!.pincode.trim(),
            country: input.shippingAddress!.country?.trim() || "India",
          },
        });

    const order = await tx.order.create({
      data: {
        userId: input.userId,
        addressId: address.id,
        orderType: OrderType.COMPONENTS_ONLY,
        status: isTestPayment ? OrderStatus.PAID : OrderStatus.PENDING_PAYMENT,
        totalAmountCents,
        couponId: (coupon as CouponDiscount | null)?.couponId ?? null,
        notes: [
          input.notes,
          coupon ? `Coupon ${coupon.code}: -₹${coupon.discountCents / 100}` : null,
        ]
          .filter(Boolean)
          .join("\n") || null,
        items: {
          create: normalizedItems.map((item) => {
            const component = componentById.get(item.componentId)!;

            return {
              itemType: OrderItemType.COMPONENT,
              componentId: component.id,
              description: component.name,
              quantity: item.quantity,
              unitPriceCents: sellingPrice(component),
              subtotalCents: sellingPrice(component) * item.quantity,
            };
          }),
        },
        payments: {
          create: {
            gateway,
            amountCents: totalAmountCents,
            status: isTestPayment ? PaymentStatus.SUCCESS : PaymentStatus.CREATED,
            gatewayOrderId: `rr_${Date.now()}`,
            rawPayload: {
              mode: isTestPayment ? "test" : "gateway_pending",
              subtotalCents,
              shippingCents,
              coupon,
              discountCents: coupon?.discountCents || 0,
            },
          },
        },
      },
      include: {
        address: true,
        items: {
          include: {
            component: true,
          },
        },
        payments: true,
      },
    });

    if (input.legalConsent) {
      await recordCheckoutAcceptance({
        userId: input.userId,
        orderId: order.id,
        source: ConsentSource.CHECKOUT,
        payload: input.legalConsent,
        ...(input.consentAudit ? { audit: input.consentAudit } : {}),
        client: tx,
      });
    }

    return {
      order,
      paymentUrl: isTestPayment ? undefined : `/checkout/payment/${order.id}`,
    };
  }).then(async (result) => {
    // Queue order confirmation email after the transaction commits
    try {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true, name: true },
      });
      if (user) {
        await queueEmailNotification(
          user.email,
          EmailEventType.ORDER_CREATED,
          {
            order: {
              orderId: result.order.id,
              total: result.order.totalAmountCents / 100,
              items: result.order.items.map((item) => ({
                name: item.description,
                quantity: item.quantity,
                price: item.unitPriceCents / 100,
              })),
            },
            user: { name: user.name || user.email },
          },
          input.userId
        );
      }
    } catch {
      // Never fail order creation because of email failure
    }
    return result;
  });
}

export async function getUserOrders(userId: string) {
  return prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      address: true,
      items: {
        include: {
          component: true,
        },
      },
      payments: true,
    },
  });
}

export async function getAllOrders() {
  return prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      address: true,
      items: {
        include: {
          component: true,
          studioAlbum: { select: { projectId: true, revision: true, createdAt: true } },
        },
      },
      payments: true,
    },
  });
}

export async function updateAdminOrderStatus(orderId: string, status: OrderStatus, adminNote?: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            component: true,
          },
        },
        payments: true,
      },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new Error("Cancelled orders cannot be changed");
    }

    if (order.status === OrderStatus.DELIVERED) {
      throw new Error("Delivered orders cannot be changed");
    }

    // Physical fulfilment must use the approved frozen order design, not a later draft.
    if (['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'PACKED'].includes(order.status) &&
        ['PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(status)) {
      const albums = await tx.studioOrderLink.findMany({ where: { orderItem: { orderId } } });
      for (const album of albums) {
        const saved = album.snapshot as { document?: unknown; configuration?: unknown };
        const quality = await printReport(tx, album.projectId, saved.document, saved.configuration);
        const approval = album.printApproval as { reportHash?: string } | null;
        if (!quality.profile || !quality.canApprove || approval?.reportHash !== quality.reportHash)
          throw new Error('Approve the saved album for print in Studio administration before fulfilment.');
      }
    }

    // Stock is deducted at order creation — all statuses except CANCELLED/RETURNED/REFUNDED have stock held
    const stockHeldStatuses: OrderStatus[] = [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
      OrderStatus.PACKED,
      OrderStatus.SHIPPED,
      OrderStatus.OUT_FOR_DELIVERY,
    ];
    const wasStockReserved = stockHeldStatuses.includes(order.status);
    // Never double-deduct — stock is always reserved from order creation
    const shouldReserveStock = false;
    const shouldRestoreStock =
      wasStockReserved &&
      (status === OrderStatus.CANCELLED ||
        status === OrderStatus.RETURNED ||
        status === OrderStatus.REFUNDED);

    if (shouldReserveStock) {
      for (const item of order.items) {
        if (!item.componentId || !item.component) {
          continue;
        }

        if (item.component.stockQuantity < item.quantity) {
          throw new Error(`${item.description} does not have enough stock`);
        }
      }

      const componentItems = order.items.flatMap((item) =>
        item.componentId ? [{ componentId: item.componentId, quantity: item.quantity }] : []
      );

      await Promise.all(
        componentItems.map((item) =>
          tx.component.update({
            where: { id: item.componentId },
            data: { stockQuantity: { decrement: item.quantity } },
          })
        )
      );
    }

    if (shouldRestoreStock) {
      const componentItems = order.items.flatMap((item) =>
        item.componentId ? [{ componentId: item.componentId, quantity: item.quantity }] : []
      );

      await Promise.all(
        componentItems.map((item) =>
          tx.component.update({
            where: { id: item.componentId },
            data: { stockQuantity: { increment: item.quantity } },
          })
        )
      );
    }

    const confirmedStatuses: OrderStatus[] = [
      OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.PACKED,
      OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED,
    ];
    if (confirmedStatuses.includes(status)) {
      await tx.payment.updateMany({
        where: { orderId },
        data: { status: PaymentStatus.SUCCESS },
      });
    }

    if (status === OrderStatus.CANCELLED) {
      await tx.payment.updateMany({
        where: {
          orderId,
          status: PaymentStatus.CREATED,
        },
        data: { status: PaymentStatus.FAILED },
      });
    }

    const statusNote = `Admin status update: ${order.status} -> ${status}`;
    const nextNotes = [order.notes, adminNote?.trim() || statusNote].filter(Boolean).join("\n");

    return tx.order.update({
      where: { id: orderId },
      data: {
        status,
        notes: nextNotes || null,
        ...(status === OrderStatus.DELIVERED ? { deliveredAt: order.deliveredAt || new Date() } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        address: true,
        items: {
          include: {
            component: true,
          },
        },
        payments: true,
      },
    });
  }).then(async (updatedOrder) => {
    // Auto-create Shiprocket shipment when admin packs the order
    if (status === OrderStatus.PACKED && !updatedOrder.trackingAwb) {
      createShipment(updatedOrder.id).catch((err: Error) =>
        console.error(`[OrderService] Auto-shipment failed for ${updatedOrder.id}: ${err.message}`)
      );
    }

    // Queue customer email after the transaction commits
    try {
      const userEmail = updatedOrder.user?.email;
      if (userEmail) {
        const emailEventMap: Partial<Record<OrderStatus, EmailEventType>> = {
          [OrderStatus.PAID]: EmailEventType.ORDER_PAID,
          [OrderStatus.SHIPPED]: EmailEventType.ORDER_SHIPPED,
          [OrderStatus.DELIVERED]: EmailEventType.ORDER_DELIVERED,
          [OrderStatus.CANCELLED]: EmailEventType.ORDER_CANCELLED,
        };
        const eventType = emailEventMap[status];
        if (eventType) {
          await queueEmailNotification(
            userEmail,
            eventType,
            {
              order: {
                orderId: updatedOrder.id,
                total: updatedOrder.totalAmountCents / 100,
              },
              user: { name: updatedOrder.user?.name || userEmail },
            },
            updatedOrder.userId
          );
        }
      }
    } catch {
      // Never fail admin action because of email failure
    }
    return updatedOrder;
  });
}

export async function confirmUserOrderPayment(_userId: string, _orderId: string): Promise<never> {
  throw Object.assign(new Error("Payment is confirmed only by the payment provider. Refresh your order to check its status."), { statusCode: 409 });
}

export async function getUserOrderById(userId: string, orderId: string) {
  return prisma.order.findFirst({
    where: {
      id: orderId,
      userId,
    },
    include: {
      address: true,
      items: {
        include: {
          component: true,
        },
      },
      payments: true,
    },
  });
}

export async function cancelUserOrder(userId: string, orderId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} AND "userId" = ${userId} FOR UPDATE`;
    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        userId,
      },
      include: {
        items: true,
      },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT && await tx.checkoutAttempt.findUnique({ where: { orderId }, select: { id: true } })) {
      throw new Error("Contact Albumo to cancel a paid album order and arrange its refund.");
    }

    const cancellableStatuses: OrderStatus[] = [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
      OrderStatus.PACKED,
    ];

    if (!cancellableStatuses.includes(order.status)) {
      throw new Error("This order can no longer be cancelled");
    }

    // Stock is deducted at order creation time for ALL orders (including PENDING_PAYMENT)
    const stockReservedStatuses: OrderStatus[] = [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
      OrderStatus.PACKED,
    ];
    const shouldRestoreStock = stockReservedStatuses.includes(order.status);

    if (shouldRestoreStock) {
      const componentItems = order.items.flatMap((item) =>
        item.componentId ? [{ componentId: item.componentId, quantity: item.quantity }] : []
      );

      await Promise.all(
        componentItems.map((item) =>
          tx.component.update({
            where: { id: item.componentId },
            data: { stockQuantity: { increment: item.quantity } },
          })
        )
      );
    }

    await tx.payment.updateMany({
      where: {
        orderId,
        status: PaymentStatus.CREATED,
      },
      data: { status: PaymentStatus.FAILED },
    });

    return tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
      },
      include: {
        address: true,
        items: {
          include: {
            component: true,
          },
        },
        payments: true,
      },
    });
  });
}

import type { Request, Response } from "express";
import { OrderStatus, PaymentGateway } from "../../../generated/prisma/client.js";
import { logAdminAction } from "../../../services/admin-action-log.service.js";
import { initiatePayment as initiateZohoPayment } from "../../payments/services/zoho.service.js";
import { getConsentAuditContext } from "../../legal/legal.controller.js";
import { validateLegalAcceptance } from "../../legal/legal.service.js";
import {
  cancelUserOrder,
  confirmUserOrderPayment,
  createOrder,
  getAllOrders,
  getUserOrderById,
  getUserOrders,
  updateAdminOrderStatus,
  validateCoupon,
} from "../services/order.service.js";

function userIdFromRequest(req: Request) {
  const userId = req.user?.userId;

  if (!userId) {
    throw new Error("User is not authenticated");
  }

  return userId;
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && Object.values(OrderStatus).includes(value as OrderStatus);
}

export async function createOrderHandler(req: Request, res: Response) {
  try {
    const userId = userIdFromRequest(req);
    validateLegalAcceptance(req.body.legalConsent);
    const paymentGateway = req.body.paymentGateway || PaymentGateway.ZOHO;
    const payload = await createOrder({
      userId,
      items: Array.isArray(req.body.items) ? req.body.items : [],
      shippingAddress: req.body.shippingAddress,
      shippingAddressId: req.body.shippingAddressId,
      paymentGateway,
      couponCode: req.body.couponCode,
      notes: req.body.notes,
      legalConsent: req.body.legalConsent,
      consentAudit: getConsentAuditContext(req),
    });

    let paymentUrl = payload.paymentUrl;
    let paymentError: string | undefined;

    if (paymentGateway === PaymentGateway.ZOHO) {
      try {
        const idempotencyKey = req.headers["x-idempotency-key"] as string | undefined;
        const payment = await initiateZohoPayment(payload.order.id, userId, idempotencyKey);
        paymentUrl = payment.checkoutUrl;
      } catch (error) {
        console.error("[checkout] Zoho payment initiation failed", error);
        paymentUrl = undefined;
        paymentError = "Zoho Payments is temporarily unavailable. Please retry from your order details.";
      }
    }

    res.status(201).json({
      success: true,
      data: {
        ...payload,
        paymentUrl,
        paymentError,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create order",
    });
  }
}

export async function validateCouponHandler(req: Request, res: Response) {
  try {
    const subtotalCents = Number(req.body.subtotalCents || 0);
    const shippingCents = Number(req.body.shippingCents || 0);
    const coupon = validateCoupon(req.body.code, subtotalCents, shippingCents);

    res.json({
      success: true,
      data: coupon,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Coupon validation failed",
    });
  }
}

export async function getAllOrdersHandler(_req: Request, res: Response) {
  const orders = await getAllOrders();

  res.json({
    success: true,
    data: orders,
  });
}

export async function updateAdminOrderStatusHandler(req: Request, res: Response) {
  try {
    const orderId = req.params.id;

    if (!orderId) {
      res.status(400).json({
        success: false,
        error: "Order ID is required",
      });
      return;
    }

    if (!isOrderStatus(req.body.status)) {
      res.status(400).json({
        success: false,
        error: "A valid order status is required",
      });
      return;
    }

    const order = await updateAdminOrderStatus(orderId, req.body.status, req.body.note);
    void logAdminAction(req.user!.userId, "UPDATE_ORDER_STATUS", "ORDER", orderId, { status: req.body.status });

    res.json({
      success: true,
      data: order,
      message: "Order status updated",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update order status",
    });
  }
}

export async function getMyOrdersHandler(req: Request, res: Response) {
  const orders = await getUserOrders(userIdFromRequest(req));

  res.json({
    success: true,
    data: orders,
  });
}

export async function getOrderHandler(req: Request, res: Response) {
  const orderId = req.params.id;

  if (!orderId) {
    res.status(400).json({
      success: false,
      error: "Order ID is required",
    });
    return;
  }

  const order = await getUserOrderById(userIdFromRequest(req), orderId);

  if (!order) {
    res.status(404).json({
      success: false,
      error: "Order not found",
    });
    return;
  }

  res.json({
    success: true,
    data: order,
  });
}

export async function confirmPaymentHandler(req: Request, res: Response) {
  try {
    const orderId = req.params.id;

    if (!orderId) {
      res.status(400).json({
        success: false,
        error: "Order ID is required",
      });
      return;
    }

    const order = await confirmUserOrderPayment(userIdFromRequest(req), orderId);

    res.json({
      success: true,
      data: order,
      message: "Payment confirmed",
    });
  } catch (error) {
    const statusCode =
      (error as Error & { statusCode?: number }).statusCode ?? 400;
    res.status(statusCode).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to confirm payment",
    });
  }
}

export async function cancelOrderHandler(req: Request, res: Response) {
  try {
    const orderId = req.params.id;

    if (!orderId) {
      res.status(400).json({
        success: false,
        error: "Order ID is required",
      });
      return;
    }

    const order = await cancelUserOrder(userIdFromRequest(req), orderId);

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to cancel order",
    });
  }
}

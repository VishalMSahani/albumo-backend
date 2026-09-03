import type { Request, Response } from "express";
import {
  createCoupon,
  deactivateCoupon,
  getCouponById,
  listCoupons,
  updateCoupon,
  validateAndApplyCoupon,
} from "../services/coupon.service.js";

export async function createCouponHandler(req: Request, res: Response) {
  try {
    const coupon = await createCoupon(req.body);
    res.status(201).json({ success: true, data: coupon });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create coupon",
    });
  }
}

export async function listCouponsHandler(_req: Request, res: Response) {
  try {
    const coupons = await listCoupons();
    res.json({ success: true, data: coupons });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to list coupons" });
  }
}

export async function getCouponHandler(req: Request, res: Response) {
  try {
    const coupon = await getCouponById(req.params.id!);
    if (!coupon) {
      res.status(404).json({ success: false, error: "Coupon not found" });
      return;
    }
    res.json({ success: true, data: coupon });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to get coupon" });
  }
}

export async function updateCouponHandler(req: Request, res: Response) {
  try {
    const coupon = await updateCoupon(req.params.id!, req.body);
    res.json({ success: true, data: coupon });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update coupon",
    });
  }
}

export async function deactivateCouponHandler(req: Request, res: Response) {
  try {
    const coupon = await deactivateCoupon(req.params.id!);
    res.json({ success: true, data: coupon, message: "Coupon deactivated" });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to deactivate coupon",
    });
  }
}

export async function validateCouponPublicHandler(req: Request, res: Response) {
  try {
    const { code, orderTotalCents } = req.body as { code: string; orderTotalCents: number };
    const userId = req.user!.userId;
    const result = await validateAndApplyCoupon(code, orderTotalCents, userId);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Invalid coupon",
    });
  }
}

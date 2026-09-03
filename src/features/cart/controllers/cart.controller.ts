import type { Request, Response } from "express";
import * as cartService from "../services/cart.service.js";

export async function getCartHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const cart = await cartService.getCart(userId);
  res.json({ success: true, data: cart });
}

export async function upsertItemHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { componentId, quantity } = req.body as { componentId: string; quantity: number };

  if (!componentId || typeof quantity !== "number") {
    res.status(400).json({ success: false, error: "componentId and quantity are required" });
    return;
  }

  try {
    const cart = await cartService.upsertCartItem(userId, componentId, quantity);
    res.json({ success: true, data: cart });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 400).json({ success: false, error: error.message });
  }
}

export async function removeItemHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const componentId = req.params.componentId as string;
  const cart = await cartService.removeCartItem(userId, componentId);
  res.json({ success: true, data: cart });
}

export async function clearCartHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  await cartService.clearCart(userId);
  res.json({ success: true, message: "Cart cleared" });
}

export async function syncCartHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { items } = req.body as {
    items: Array<{ componentId: string; quantity: number }>;
  };

  if (!Array.isArray(items)) {
    res.status(400).json({ success: false, error: "items must be an array" });
    return;
  }

  const cart = await cartService.syncCart(userId, items);
  res.json({ success: true, data: cart });
}

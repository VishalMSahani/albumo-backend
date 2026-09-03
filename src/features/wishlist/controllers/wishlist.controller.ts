import type { Request, Response } from "express";
import * as wishlistService from "../services/wishlist.service.js";

export async function getWishlistHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const items = await wishlistService.getWishlist(userId);
  res.json({ success: true, data: items });
}

export async function addItemHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { componentId } = req.body as { componentId: string };

  if (!componentId) {
    res.status(400).json({ success: false, error: "componentId is required" });
    return;
  }

  try {
    const item = await wishlistService.addToWishlist(userId, componentId);
    res.json({ success: true, data: item });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 400).json({ success: false, error: error.message });
  }
}

export async function removeItemHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const componentId = req.params.componentId as string;
  await wishlistService.removeFromWishlist(userId, componentId);
  res.json({ success: true, message: "Removed from wishlist" });
}

export async function clearWishlistHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  await wishlistService.clearWishlist(userId);
  res.json({ success: true, message: "Wishlist cleared" });
}

export async function checkItemHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const componentId = req.params.componentId as string;
  const inWishlist = await wishlistService.isInWishlist(userId, componentId);
  res.json({ success: true, data: { inWishlist } });
}

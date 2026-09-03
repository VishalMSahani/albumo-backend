import type { Request, Response, NextFunction } from "express";
import * as reviewService from "../services/review.service.js";
import { uploadFileToAzure, FileType } from "../../../services/azure-storage.service.js";

export async function createReviewHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { componentId, rating, title, body, imageUrl } = req.body as {
    componentId?: string; rating?: number; title?: string; body?: string; imageUrl?: string;
  };

  if (!componentId || !rating) {
    res.status(400).json({ success: false, error: "componentId and rating are required" });
    return;
  }

  try {
    const review = await reviewService.createReview(userId, componentId, Number(rating), title, body, imageUrl);
    res.status(201).json({ success: true, data: review });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 400).json({ success: false, error: error.message });
  }
}

export async function getComponentReviewsHandler(req: Request, res: Response): Promise<void> {
  const componentId = req.params.id as string;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const data = await reviewService.getComponentReviews(componentId, page, limit);
  res.json({ success: true, data });
}

export async function deleteReviewHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const isAdmin = ["ADMIN", "SUPER_ADMIN"].includes(req.user!.role);
  const reviewId = req.params.id as string;
  try {
    await reviewService.deleteReview(reviewId, userId, isAdmin);
    res.json({ success: true, message: "Review deleted" });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 400).json({ success: false, error: error.message });
  }
}

export async function moderateReviewHandler(req: Request, res: Response): Promise<void> {
  const { isApproved } = req.body as { isApproved?: boolean };
  if (typeof isApproved !== "boolean") {
    res.status(400).json({ success: false, error: "isApproved (boolean) is required" });
    return;
  }
  try {
    const review = await reviewService.moderateReview(req.params.id as string, isApproved);
    res.json({ success: true, data: review });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 400).json({ success: false, error: error.message });
  }
}

/**
 * Handle uploading an image for a review (authenticated users)
 * POST /api/reviews/upload
 */
export async function uploadReviewImageHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: "No image file provided" });
      return;
    }

    const result = await uploadFileToAzure(
      file.buffer,
      file.originalname,
      file.mimetype,
      FileType.COMPONENT_IMAGE
    );

    if ("error" in result) {
      res.status(500).json({ success: false, error: result.error });
      return;
    }

    res.status(200).json({ success: true, url: result.url });
  } catch (error) {
    next(error);
  }
}


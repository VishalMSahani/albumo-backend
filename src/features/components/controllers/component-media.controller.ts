/**
 * Product Media Controller
 * Manages multiple images and video for a component/product.
 * Max 10 media items per product (images + 1 video).
 * Videos are added via URL; images can be uploaded as files.
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../../lib/prisma.js";
import { uploadFileToAzure, FileType } from "../../../services/azure-storage.service.js";
import { cacheInvalidate } from "../../../lib/redis.js";
import { MediaType } from "../../../generated/prisma/client.js";

const MAX_MEDIA = 10;

async function bustCache() {
  await cacheInvalidate("http:/api/components*");
}

/** GET /api/components/:id/media */
export async function getProductMediaHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const media = await prisma.productMedia.findMany({
      where: { componentId: id! },
      orderBy: { sortOrder: "asc" },
    });
    res.json({ success: true, data: media });
  } catch (err) {
    next(err);
  }
}

/** POST /api/components/:id/media — multipart image upload */
export async function addProductMediaHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const existing = await prisma.productMedia.count({ where: { componentId: id! } });
    if (existing >= MAX_MEDIA) {
      res.status(400).json({ success: false, error: `Maximum ${MAX_MEDIA} media items allowed per product.` });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: "No file provided." });
      return;
    }

    const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (!isImage) {
      res.status(400).json({ success: false, error: "Only JPEG, PNG, or WebP images can be uploaded. Add videos via URL." });
      return;
    }

    const nextOrder = await prisma.productMedia.count({ where: { componentId: id! } });

    const uploadResult = await uploadFileToAzure(
      file.buffer,
      file.originalname,
      file.mimetype,
      FileType.COMPONENT_IMAGE
    );

    if ("error" in uploadResult) {
      res.status(500).json({ success: false, error: uploadResult.error });
      return;
    }

    const media = await prisma.productMedia.create({
      data: {
        componentId: id!,
        type: MediaType.IMAGE,
        url: uploadResult.url,
        sortOrder: nextOrder,
      },
    });

    void bustCache();
    res.status(201).json({ success: true, data: media });
  } catch (err) {
    next(err);
  }
}

/** POST /api/components/:id/media/url — add media by URL (images or video embed) */
export async function addProductMediaByUrlHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { url, type } = req.body as { url?: string; type?: string };

    if (!url || typeof url !== "string") {
      res.status(400).json({ success: false, error: "url is required." });
      return;
    }

    const mediaType: MediaType = type === "VIDEO" ? MediaType.VIDEO : MediaType.IMAGE;

    const existing = await prisma.productMedia.count({ where: { componentId: id! } });
    if (existing >= MAX_MEDIA) {
      res.status(400).json({ success: false, error: `Maximum ${MAX_MEDIA} media items allowed.` });
      return;
    }

    if (mediaType === MediaType.VIDEO) {
      const existingVideo = await prisma.productMedia.findFirst({
        where: { componentId: id!, type: MediaType.VIDEO },
      });
      if (existingVideo) {
        res.status(400).json({ success: false, error: "Only one video per product is allowed. Delete the existing video first." });
        return;
      }
    }

    const media = await prisma.productMedia.create({
      data: { componentId: id!, type: mediaType, url, sortOrder: existing },
    });

    void bustCache();
    res.status(201).json({ success: true, data: media });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/components/:id/media/:mediaId */
export async function deleteProductMediaHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id, mediaId } = req.params;

    const media = await prisma.productMedia.findFirst({ where: { id: mediaId!, componentId: id! } });
    if (!media) {
      res.status(404).json({ success: false, error: "Media not found." });
      return;
    }

    await prisma.productMedia.delete({ where: { id: mediaId! } });
    void bustCache();
    res.json({ success: true, message: "Media deleted." });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/components/:id/media/reorder */
export async function reorderProductMediaHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { order } = req.body as { order?: string[] };

    if (!Array.isArray(order)) {
      res.status(400).json({ success: false, error: "order must be an array of media IDs." });
      return;
    }

    await prisma.$transaction(
      order.map((mediaId, index) =>
        prisma.productMedia.updateMany({
          where: { id: mediaId, componentId: id! },
          data: { sortOrder: index },
        })
      )
    );

    void bustCache();
    res.json({ success: true, message: "Media order updated." });
  } catch (err) {
    next(err);
  }
}

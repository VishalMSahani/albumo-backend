/**
 * Component Routes
 * API routes for component management
 */

import { Router, type Router as RouterType } from "express";
import * as componentController from "../controllers/component.controller.js";
import { handleCreateComponentWithUploads, handleSingleImageUpload } from "../controllers/component-upload.controller.js";
import {
  getProductMediaHandler,
  addProductMediaHandler,
  addProductMediaByUrlHandler,
  deleteProductMediaHandler,
  reorderProductMediaHandler,
} from "../controllers/component-media.controller.js";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import { uploadComponentImages, uploadProductMedia, uploadSingleImage } from "../../../middlewares/upload.middleware.js";
import { getComponentReviewsHandler } from "../../reviews/controllers/review.controller.js";
import { cacheResponse } from "../../../middlewares/cache.middleware.js";

const router: RouterType = Router();

// Public routes — cached for 60s (products) and 120s (category tree)
router.get("/", cacheResponse(60), componentController.getComponentsHandler);
router.get("/categories/summary", cacheResponse(600), componentController.getCategorySummaryHandler);
router.get("/categories/tree", cacheResponse(120), componentController.getCategoryTreeHandler);

// Admin analytics routes — MUST be before /:id to avoid Express matching "analytics" as an id param
router.get(
  "/analytics/low-stock",
  authenticate,
  authorize("ADMIN", "SUPER_ADMIN"),
  componentController.getLowStockHandler
);

router.get(
  "/analytics/out-of-stock",
  authenticate,
  authorize("ADMIN", "SUPER_ADMIN"),
  componentController.getOutOfStockHandler
);

// Slug lookup — MUST be before /:id wildcard
router.get("/slug/:slug", cacheResponse(60), componentController.getComponentBySlugHandler);

// Dynamic param route — must come after all static paths
router.get("/:id", componentController.getComponentByIdHandler);
router.get("/:id/reviews", getComponentReviewsHandler);

// Product media — public read, admin write
router.post("/upload/image", authenticate, authorize("ADMIN", "SUPER_ADMIN"), uploadSingleImage, handleSingleImageUpload);
router.get("/:id/media", getProductMediaHandler);
router.post("/:id/media", authenticate, authorize("ADMIN", "SUPER_ADMIN"), uploadProductMedia, addProductMediaHandler);
router.post("/:id/media/url", authenticate, authorize("ADMIN", "SUPER_ADMIN"), addProductMediaByUrlHandler);
router.delete("/:id/media/:mediaId", authenticate, authorize("ADMIN", "SUPER_ADMIN"), deleteProductMediaHandler);
router.put("/:id/media/reorder", authenticate, authorize("ADMIN", "SUPER_ADMIN"), reorderProductMediaHandler);

// Admin routes (authentication + admin role required)

/**
 * Create component with image uploads
 * POST /api/components/upload
 * Access: Admin only
 * Content-Type: multipart/form-data
 * 
 * Form Fields:
 * - images: File[] (max 5, JPEG/PNG/WebP, max 5MB each)
 * - thumbnail: File (optional, JPEG/PNG/WebP, max 5MB)
 * - name: string (required)
 * - sku: string (optional, unique)
 * - description: string (optional)
 * - typicalUseCase: string (optional)
 * - vendorLink: string (optional)
 * - unitPriceCents: number (required, price in cents)
 * - stockQuantity: number (optional, default: 0)
 * - isActive: boolean (optional, default: true)
 */
router.post(
  "/upload",
  authenticate,
  authorize("ADMIN"),
  uploadComponentImages,
  handleCreateComponentWithUploads
);

router.post(
  "/",
  authenticate,
  authorize("ADMIN"),
  componentController.createComponentHandler
);

router.patch(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  componentController.updateComponentHandler
);

router.delete(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  componentController.deleteComponentHandler
);

router.patch(
  "/:id/stock",
  authenticate,
  authorize("ADMIN"),
  componentController.updateStockHandler
);

export default router;

import { Router, type Router as RouterType } from "express";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import { uploadSingleImage } from "../../../middlewares/upload.middleware.js";
import {
  createReviewHandler,
  deleteReviewHandler,
  moderateReviewHandler,
  uploadReviewImageHandler,
} from "../controllers/review.controller.js";

const router: RouterType = Router();

// Authenticated users can submit, delete their own reviews, and upload a review image
router.post("/", authenticate, createReviewHandler);
router.post("/upload", authenticate, uploadSingleImage, uploadReviewImageHandler);
router.delete("/:id", authenticate, deleteReviewHandler);

// Admin moderation
router.patch("/admin/:id/moderate", authenticate, authorize("ADMIN"), moderateReviewHandler);

export default router;


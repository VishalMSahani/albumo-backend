import { Router, type Router as RouterType } from "express";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import { uploadSingleImage } from "../../../middlewares/upload.middleware.js";
import { validate } from '../../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../../utils/async-handler.js';
import { assertReviewsEnabled } from '../services/review.service.js';
import { createReviewSchema } from '../validators/review.validator.js';
import {
  createReviewHandler,
  deleteReviewHandler,
  moderateReviewHandler,
  uploadReviewImageHandler,
} from "../controllers/review.controller.js";

const router: RouterType = Router();

// Authenticated users can submit, delete their own reviews, and upload a review image
router.post("/", authenticate, validate({ body: createReviewSchema }), asyncHandler(createReviewHandler));
router.post("/upload", authenticate, asyncHandler(async (_req, _res, next) => { await assertReviewsEnabled(); next(); }), uploadSingleImage, uploadReviewImageHandler);
router.delete("/:id", authenticate, deleteReviewHandler);

// Admin moderation
router.patch("/admin/:id/moderate", authenticate, authorize("ADMIN"), moderateReviewHandler);

export default router;


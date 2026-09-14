import { Router } from "express";
import multer from "../middlewares/upload-transport.middleware.js";
import {
  bulkImportController,
  bulkExportController,
  productTemplateController,
  aiGenerateProductController,
  bulkUploadMediaController,
  getMediaLibraryController,
  deleteMediaLibraryController,
} from "../controller/bulk.js";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

// All bulk operations require admin/super_admin privileges
const adminGuard = [authenticate, authorize("ADMIN", "SUPER_ADMIN")];

// Bulk Import CSV
router.post("/bulk-import", ...adminGuard, csvUpload.single("file"), bulkImportController);
router.get("/template", ...adminGuard, productTemplateController);

// Export Catalog CSV
router.get("/export", ...adminGuard, bulkExportController);

// AI Product Generation
router.post("/ai-generate", ...adminGuard, aiGenerateProductController);

// Media Library bulk-upload (multiple images)
router.post("/media/bulk-upload", ...adminGuard, upload.array("images", 50), bulkUploadMediaController);

// Get Media Library items
router.get("/media", ...adminGuard, getMediaLibraryController);

// Delete Media Library item
router.delete("/media/:id", ...adminGuard, deleteMediaLibraryController);

export default router;

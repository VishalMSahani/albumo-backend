import { Router } from "express";
import multer from "multer";
import { createBulkOrder, getBulkOrders, updateBulkOrderStatus } from "../controllers/bulk-order.controller.js";
import { authenticate, optionalAuthenticate, authorize } from "../../../middlewares/auth.middleware.js";

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public submission route (authenticated optionally)
router.post("/", optionalAuthenticate, upload.single("csvFile"), createBulkOrder);

// Admin-only routes
router.get("/", authenticate, authorize("ADMIN", "SUPER_ADMIN"), getBulkOrders);
router.patch("/:id/status", authenticate, authorize("ADMIN", "SUPER_ADMIN"), updateBulkOrderStatus);

export default router;

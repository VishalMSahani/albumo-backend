import { Router } from "express";
import {
  createCareerApplication,
  getCareerApplications,
  updateCareerApplicationStatus,
} from "../controllers/career.controller.js";
import { authenticate, optionalAuthenticate, authorize } from "../../../middlewares/auth.middleware.js";

const router: Router = Router();

// Public submission route (authenticated optionally if user is logged in)
router.post("/apply", optionalAuthenticate, createCareerApplication);

// Admin-only management routes
router.get("/applications", authenticate, authorize("ADMIN", "SUPER_ADMIN"), getCareerApplications);
router.patch("/applications/:id", authenticate, authorize("ADMIN", "SUPER_ADMIN"), updateCareerApplicationStatus);

export default router;

import { Router, type Router as RouterType } from "express";
import { authenticate, authorize } from "../../../middlewares/auth.middleware.js";
import {
  createQuoteHandler,
  getUserQuotesHandler,
  getQuoteByIdHandler,
  getAllQuotesHandler,
  updateQuoteHandler,
} from "../controllers/pcb.controller.js";

const router: RouterType = Router();

// Customer routes
router.post("/quote", authenticate, createQuoteHandler);
router.get("/quotes", authenticate, getUserQuotesHandler);
router.get("/quotes/:id", authenticate, getQuoteByIdHandler);

// Admin routes
router.get("/admin/quotes", authenticate, authorize("ADMIN"), getAllQuotesHandler);
router.patch("/admin/quotes/:id", authenticate, authorize("ADMIN"), updateQuoteHandler);

export default router;

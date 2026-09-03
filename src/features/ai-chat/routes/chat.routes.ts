import { Router, type Router as RouterType } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../../utils/async-handler.js";
import { chatHandler } from "../controllers/chat.controller.js";

const router: RouterType = Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId ?? "anonymous-chat-user",
  message: { success: false, error: "Too many chat messages. Please slow down." },
});

router.post("/", authenticate, chatLimiter, asyncHandler(chatHandler));

export default router;

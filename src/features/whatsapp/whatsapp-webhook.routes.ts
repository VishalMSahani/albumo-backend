import { Router, type Router as RouterType } from "express";
import { asyncHandler } from "../../utils/async-handler.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  acknowledgeWhatsAppWebhook,
  verifyWhatsAppWebhook,
} from "./whatsapp-webhook.controller.js";
import { whatsappWebhookVerificationQuerySchema } from "./whatsapp-webhook.validator.js";

const router: RouterType = Router();

router.get(
  "/",
  validate({ query: whatsappWebhookVerificationQuerySchema }),
  asyncHandler(verifyWhatsAppWebhook),
);
router.post("/", asyncHandler(acknowledgeWhatsAppWebhook));

export default router;

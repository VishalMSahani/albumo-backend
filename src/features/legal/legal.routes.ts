import { Router, type Router as RouterType } from "express";
import { authenticate, authorize, optionalAuthenticate } from "../../middlewares/auth.middleware.js";
import {
  claimConsentHandler,
  exportAdminConsentsHandler,
  getAdminConsentsHandler,
  getLegalConfigHandler,
  recordCookieConsentHandler,
  recordOAuthConsentHandler,
} from "./legal.controller.js";

const router: RouterType = Router();

router.get("/config", getLegalConfigHandler);
router.post("/consents/cookies", optionalAuthenticate, recordCookieConsentHandler);
router.post("/consents/oauth", optionalAuthenticate, recordOAuthConsentHandler);
router.post("/consents/claim", authenticate, claimConsentHandler);
router.get("/admin/consents/export", authenticate, authorize("ADMIN"), exportAdminConsentsHandler);
router.get("/admin/consents", authenticate, authorize("ADMIN"), getAdminConsentsHandler);

export default router;

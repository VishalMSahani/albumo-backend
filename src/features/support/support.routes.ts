import { Router, type Router as RouterType } from "express";
import { authenticate, authorize, optionalAuthenticate } from "../../middlewares/auth.middleware.js";
import {
  addAdminReplyHandler,
  createAdminArticleHandler,
  createTicketHandler,
  customerReplyHandler,
  deleteAdminArticleHandler,
  getAdminArticlesHandler,
  getAdminTicketHandler,
  getAdminTicketsHandler,
  getKnowledgeArticleHandler,
  getMyTicketsHandler,
  getSupportAgentsHandler,
  listKnowledgeBaseHandler,
  trackTicketHandler,
  updateAdminArticleHandler,
  updateAdminTicketHandler,
} from "./support.controller.js";

const router: RouterType = Router();

router.get("/knowledge-base", listKnowledgeBaseHandler);
router.get("/knowledge-base/:slug", getKnowledgeArticleHandler);

router.post("/tickets", optionalAuthenticate, createTicketHandler);
router.get("/tickets/my", authenticate, getMyTicketsHandler);
router.post("/tickets/:ticketNumber/track", optionalAuthenticate, trackTicketHandler);
router.post("/tickets/:ticketNumber/messages", optionalAuthenticate, customerReplyHandler);

router.use("/admin", authenticate, authorize("ADMIN", "SUPER_ADMIN"));
router.get("/admin/tickets", getAdminTicketsHandler);
router.get("/admin/tickets/:id", getAdminTicketHandler);
router.patch("/admin/tickets/:id", updateAdminTicketHandler);
router.post("/admin/tickets/:id/messages", addAdminReplyHandler);
router.get("/admin/agents", getSupportAgentsHandler);
router.get("/admin/knowledge-base", getAdminArticlesHandler);
router.post("/admin/knowledge-base", createAdminArticleHandler);
router.patch("/admin/knowledge-base/:id", updateAdminArticleHandler);
router.delete("/admin/knowledge-base/:id", deleteAdminArticleHandler);

export default router;

import type { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler.js";
import { limitAuth } from "../../../services/auth-throttle.service.js";
import { emailDeliveryConfigured } from "../../../services/email.service.js";
import { logAdminAction } from "../../../services/admin-action-log.service.js";
import * as service from "../bulk-order.service.js";
import { BulkWorkflowError, parseBulkCsv } from "../bulk-order.logic.js";
import { listSchema } from "../validators/bulk-order.validator.js";

type Handler = (req: Request, res: Response) => Promise<void>;
export function bulkHandler(handler: Handler) {
  return asyncHandler(async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (!(error instanceof BulkWorkflowError)) throw error;
      res.status(error.kind === "NOT_FOUND" ? 404 : error.kind === "CONFLICT" ? 409 : 400).json({ success: false, error: error.message });
    }
  });
}
const access = (req: Request) => ({ ...(req.body.accessKey ? { accessKey: String(req.body.accessKey) } : {}), ...(req.user?.userId ? { userId: req.user.userId } : {}) });
export const createBulkOrder = bulkHandler(async (req, res) => {
  await limitAuth("bulk-create-ip", req.ip || "unknown", 10, 3600);
  const input = { ...req.body, email: req.user?.email || req.body.email };
  await limitAuth("bulk-create-email", input.email, 5, 3600);
  const data = await service.createRequest(input, req.user?.userId);
  res.status(201).json({ success: true, data });
});
export const importCsv = bulkHandler(async (req, res) => {
  await limitAuth("bulk-csv", req.ip || "unknown", 30, 900);
  res.json({ success: true, data: parseBulkCsv(req.body.csv) });
});
export const track = bulkHandler(async (req, res) => {
  await limitAuth("bulk-access", req.ip || "unknown", 60, 900);
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, data: await service.trackRequest(String(req.params.reference), access(req)) });
});
export const recover = bulkHandler(async (req, res) => {
  await limitAuth("bulk-recover-ip", req.ip || "unknown", 8, 3600);
  await limitAuth("bulk-recover-email", req.body.email, 3, 3600);
  if (!emailDeliveryConfigured() || !process.env.FRONTEND_URL) { res.status(503).json({ success: false, error: "Access email is unavailable. Contact support for help." }); return; }
  await service.recoverAccess(req.body.reference, req.body.email);
  res.json({ success: true, message: "If these details match a request, a private access email will be sent. Check your inbox and spam folder." });
});
export const decision = bulkHandler(async (req, res) => {
  await limitAuth("bulk-decision", req.ip || "unknown", 20, 900);
  res.json({ success: true, data: await service.decideQuote(String(req.params.reference), access(req), req.body.quoteId, req.body.decision) });
});
export const customerMessage = bulkHandler(async (req, res) => {
  await limitAuth("bulk-message", req.ip || "unknown", 20, 3600);
  res.json({ success: true, data: await service.addMessage(String(req.params.reference), req.body.message, access(req)) });
});
export const getBulkOrders = bulkHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, data: await service.listRequests(listSchema.parse(req.query)) });
});
export const getBulkOrder = bulkHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, data: await service.adminRequest(String(req.params.id)) });
});
export const publish = bulkHandler(async (req, res) => {
  const data = await service.publishQuote(String(req.params.id), req.body, req.user!.userId);
  await logAdminAction(req.user!.userId, "UPDATE_BULK_ORDER", "BULK_ORDER", data.id, { action: "PUBLISH_QUOTE", version: data.version });
  res.json({ success: true, data });
});
export const updateBulkOrderStatus = bulkHandler(async (req, res) => {
  const data = await service.updateRequest(String(req.params.id), req.body);
  await logAdminAction(req.user!.userId, "UPDATE_BULK_ORDER", "BULK_ORDER", data.id, { status: data.status });
  res.json({ success: true, data });
});
export const adminMessage = bulkHandler(async (req, res) => {
  const data = await service.addMessage(String(req.params.id), req.body.message, null);
  await logAdminAction(req.user!.userId, "UPDATE_BULK_ORDER", "BULK_ORDER", data.id, { action: "REPLY" });
  res.json({ success: true, data });
});

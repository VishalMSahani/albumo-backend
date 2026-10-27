import type { Request, Response } from "express";
import { ValidationError } from "../../utils/types.js";
import { limitAuth } from "../../services/auth-throttle.service.js";
import { logAdminAction } from "../../services/admin-action-log.service.js";
import {
  createPartnerInquirySchema,
  updatePartnerInquirySchema,
  partnerQuerySchema,
  partnerDirectoryQuerySchema,
} from "./partner.validator.js";
import * as service from "./partner.service.js";

export async function submitInquiry(req: Request, res: Response) {
  await limitAuth("partner-ip", req.ip || "unknown", 10, 3600);
  await limitAuth("partner-email", req.body.email, 5, 3600);

  const input = createPartnerInquirySchema.parse(req.body);
  const inquiry = await service.createPartnerInquiry(input);

  res.status(201).json({
    success: true,
    data: { id: inquiry.id, email: inquiry.email },
    message:
      "Your enquiry is with our partnerships team. We will contact you to discuss the next steps.",
  });
}

export async function adminList(req: Request, res: Response) {
  const query = partnerQuerySchema.parse(req.query);
  const data = await service.listPartnerInquiries(query);
  res.json({ success: true, data });
}

export async function directory(req: Request, res: Response) {
  const query = partnerDirectoryQuerySchema.parse(req.query);
  res.json({ success: true, data: await service.listPartnerDirectory(query) });
}

export async function adminGet(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) throw new ValidationError("Missing partner enquiry ID");
  const inquiry = await service.getPartnerInquiry(id);
  res.json({ success: true, data: inquiry });
}

export async function adminUpdate(req: Request, res: Response) {
  const input = updatePartnerInquirySchema.parse(req.body);
  const id = req.params.id;
  if (!id) throw new ValidationError("Missing partner enquiry ID");
  const inquiry = await service.updatePartnerInquiry(id, input);
  await logAdminAction(
    req.user!.userId,
    "UPDATE_PARTNER_INQUIRY",
    "PARTNER_INQUIRY",
    inquiry.id,
    input,
  );
  res.json({ success: true, data: inquiry });
}

export async function adminSummary(_req: Request, res: Response) {
  const summary = await service.getPartnerSummary();
  res.json({ success: true, data: summary });
}

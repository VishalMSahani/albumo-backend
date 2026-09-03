import type { Request, Response } from "express";
import * as customerService from "../services/customer.service.js";

export async function listCustomersHandler(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const search = typeof req.query.search === "string" ? req.query.search : undefined;

  const result = await customerService.listCustomers(page, limit, search);
  res.json({ success: true, data: result });
}

export async function getCustomerDetailHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  try {
    const data = await customerService.getCustomerDetail(id);
    res.json({ success: true, data });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
  }
}

export async function updateCustomerStatusHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { isActive } = req.body as { isActive?: boolean };
  if (typeof isActive !== "boolean") {
    res.status(400).json({ success: false, error: "isActive (boolean) is required" });
    return;
  }
  try {
    await customerService.updateCustomerStatus(id, isActive);
    res.json({ success: true, message: isActive ? "Account reactivated" : "Account suspended" });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
  }
}

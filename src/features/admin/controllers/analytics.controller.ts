import type { Request, Response } from "express";
import * as analyticsService from "../services/analytics.service.js";

export async function revenueHandler(req: Request, res: Response): Promise<void> {
  const period = (req.query.period as string | undefined) ?? "7d";
  const data = await analyticsService.getRevenueAnalytics(period);
  res.json({ success: true, data });
}

export async function ordersHandler(req: Request, res: Response): Promise<void> {
  const period = (req.query.period as string | undefined) ?? "7d";
  const data = await analyticsService.getOrderAnalytics(period);
  res.json({ success: true, data });
}

export async function topProductsHandler(req: Request, res: Response): Promise<void> {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const data = await analyticsService.getTopProducts(limit);
  res.json({ success: true, data });
}

export async function lowStockHandler(req: Request, res: Response): Promise<void> {
  const threshold = Math.max(0, Number(req.query.threshold) || 10);
  const data = await analyticsService.getLowStockAlerts(threshold);
  res.json({ success: true, data });
}

export async function dashboardKpisHandler(req: Request, res: Response): Promise<void> {
  const data = await analyticsService.getDashboardKpis();
  res.json({ success: true, data });
}

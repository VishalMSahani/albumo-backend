import type { Request, Response } from "express";
import * as pcbService from "../services/pcb.service.js";
import type { PcbQuoteStatus } from "../../../generated/prisma/client.js";

export async function createQuoteHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const {
    boardLayers, boardSizeX, boardSizeY, quantity,
    surfaceFinish, copperWeight, gerberFileUrl, notes,
  } = req.body as {
    boardLayers?: number; boardSizeX?: number; boardSizeY?: number;
    quantity?: number; surfaceFinish?: string; copperWeight?: string;
    gerberFileUrl?: string; notes?: string;
  };

  if (!boardLayers || !boardSizeX || !boardSizeY || !quantity || !surfaceFinish || !copperWeight) {
    res.status(400).json({ success: false, error: "boardLayers, boardSizeX, boardSizeY, quantity, surfaceFinish, copperWeight are required" });
    return;
  }

  const quote = await pcbService.createPcbQuote({
    userId,
    boardLayers: Number(boardLayers),
    boardSizeX: Number(boardSizeX),
    boardSizeY: Number(boardSizeY),
    quantity: Number(quantity),
    surfaceFinish: surfaceFinish as string,
    copperWeight: copperWeight as string,
    ...(gerberFileUrl ? { gerberFileUrl } : {}),
    ...(notes ? { notes } : {}),
  });
  res.status(201).json({ success: true, data: quote });
}

export async function getUserQuotesHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const quotes = await pcbService.getUserPcbQuotes(userId);
  res.json({ success: true, data: quotes });
}

export async function getQuoteByIdHandler(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const isAdmin = ["ADMIN", "SUPER_ADMIN"].includes(req.user!.role);
  try {
    const quote = await pcbService.getPcbQuoteById(req.params.id as string, userId, isAdmin);
    res.json({ success: true, data: quote });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
  }
}

export async function getAllQuotesHandler(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const status = typeof req.query.status === "string" ? (req.query.status as PcbQuoteStatus) : undefined;
  const data = await pcbService.getAllPcbQuotes(page, limit, status);
  res.json({ success: true, data });
}

export async function updateQuoteHandler(req: Request, res: Response): Promise<void> {
  const { status, quotedPricePaise, adminNotes } = req.body as {
    status?: PcbQuoteStatus; quotedPricePaise?: number; adminNotes?: string;
  };
  try {
    const update: { status?: PcbQuoteStatus; quotedPricePaise?: number; adminNotes?: string } = {};
    if (status !== undefined) update.status = status;
    if (quotedPricePaise !== undefined) update.quotedPricePaise = quotedPricePaise;
    if (adminNotes !== undefined) update.adminNotes = adminNotes;
    const quote = await pcbService.updatePcbQuote(req.params.id as string, update);
    res.json({ success: true, data: quote });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ success: false, error: error.message });
  }
}

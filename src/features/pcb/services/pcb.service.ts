import { prisma } from "../../../lib/prisma.js";
import type { PcbQuoteStatus } from "../../../generated/prisma/client.js";

interface CreatePcbQuoteInput {
  userId: string;
  boardLayers: number;
  boardSizeX: number;
  boardSizeY: number;
  quantity: number;
  surfaceFinish: string;
  copperWeight: string;
  gerberFileUrl?: string;
  notes?: string;
}

export async function createPcbQuote(input: CreatePcbQuoteInput) {
  return prisma.pcbQuoteRequest.create({
    data: {
      userId: input.userId,
      boardLayers: input.boardLayers,
      boardSizeX: input.boardSizeX,
      boardSizeY: input.boardSizeY,
      quantity: input.quantity,
      surfaceFinish: input.surfaceFinish,
      copperWeight: input.copperWeight,
      gerberFileUrl: input.gerberFileUrl ?? null,
      notes: input.notes ?? null,
    },
  });
}

export async function getUserPcbQuotes(userId: string) {
  return prisma.pcbQuoteRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPcbQuoteById(id: string, userId: string, isAdmin: boolean) {
  const quote = await prisma.pcbQuoteRequest.findUnique({ where: { id } });
  if (!quote) throw Object.assign(new Error("Quote not found"), { statusCode: 404 });
  if (!isAdmin && quote.userId !== userId) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  return quote;
}

export async function getAllPcbQuotes(page: number, limit: number, status?: PcbQuoteStatus) {
  const where = status ? { status } : {};
  const [quotes, total] = await Promise.all([
    prisma.pcbQuoteRequest.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.pcbQuoteRequest.count({ where }),
  ]);
  return { quotes, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function updatePcbQuote(
  id: string,
  data: { status?: PcbQuoteStatus; quotedPricePaise?: number; adminNotes?: string },
) {
  const quote = await prisma.pcbQuoteRequest.findUnique({ where: { id } });
  if (!quote) throw Object.assign(new Error("Quote not found"), { statusCode: 404 });

  const updateData: Record<string, unknown> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.quotedPricePaise !== undefined) updateData.quotedPricePaise = data.quotedPricePaise;
  if (data.adminNotes !== undefined) updateData.adminNotes = data.adminNotes;

  return prisma.pcbQuoteRequest.update({ where: { id }, data: updateData });
}

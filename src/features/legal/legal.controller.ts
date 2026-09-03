import crypto from "crypto";
import type { Request, Response } from "express";
import {
  ConsentAction,
  ConsentSource,
  ConsentType,
} from "../../generated/prisma/client.js";
import {
  claimAnonymousConsents,
  getAdminConsentRecords,
  getConsentRecordsForExport,
  legalConfig,
  recordCookiePreferences,
  recordTermsAndPrivacyAcceptance,
  type ConsentAuditContext,
} from "./legal.service.js";

export const CONSENT_ID_COOKIE = "roboroot_consent_id";

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function getConsentAuditContext(req: Request): ConsentAuditContext {
  const forwarded = firstHeaderValue(req.headers["x-forwarded-for"]);
  const ipAddress = (forwarded?.split(",")[0]?.trim() || req.ip || "").slice(0, 120);
  const userAgent = (req.get("user-agent") || "").slice(0, 600);
  const anonymousId = (req.cookies as Record<string, string> | undefined)?.[CONSENT_ID_COOKIE];
  return {
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(anonymousId ? { anonymousId } : {}),
  };
}

function setConsentIdCookie(res: Response, anonymousId: string) {
  const isProd = process.env.NODE_ENV === "production";
  const domain = process.env.COOKIE_DOMAIN?.trim();
  res.cookie(CONSENT_ID_COOKIE, anonymousId, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "strict" : "lax",
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: "/",
    ...(isProd && domain ? { domain } : {}),
  });
}

function ensureConsentId(req: Request, res: Response) {
  const existing = (req.cookies as Record<string, string> | undefined)?.[CONSENT_ID_COOKIE];
  if (existing && /^[a-f0-9-]{20,64}$/i.test(existing)) return existing;
  const anonymousId = crypto.randomUUID();
  setConsentIdCookie(res, anonymousId);
  return anonymousId;
}

function enumValue<T extends Record<string, string>>(values: T, value: unknown): T[keyof T] | undefined {
  return typeof value === "string" && Object.values(values).includes(value)
    ? (value as T[keyof T])
    : undefined;
}

function parseDate(value: unknown, endOfDay = false) {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function adminQuery(req: Request) {
  return {
    page: Math.max(1, Number(req.query.page) || 1),
    limit: Math.min(100, Math.max(1, Number(req.query.limit) || 25)),
    ...(typeof req.query.search === "string" && req.query.search.trim()
      ? { search: req.query.search.trim().slice(0, 160) }
      : {}),
    ...(enumValue(ConsentType, req.query.type) ? { type: enumValue(ConsentType, req.query.type)! } : {}),
    ...(enumValue(ConsentSource, req.query.source) ? { source: enumValue(ConsentSource, req.query.source)! } : {}),
    ...(enumValue(ConsentAction, req.query.action) ? { action: enumValue(ConsentAction, req.query.action)! } : {}),
    ...(parseDate(req.query.from) ? { from: parseDate(req.query.from)! } : {}),
    ...(parseDate(req.query.to, true) ? { to: parseDate(req.query.to, true)! } : {}),
  };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function getLegalConfigHandler(_req: Request, res: Response) {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({ success: true, data: legalConfig });
}

export async function recordCookieConsentHandler(req: Request, res: Response) {
  try {
    const anonymousId = ensureConsentId(req, res);
    const source = req.body.source === ConsentSource.COOKIE_SETTINGS
      ? ConsentSource.COOKIE_SETTINGS
      : ConsentSource.COOKIE_BANNER;
    const record = await recordCookiePreferences({
      ...(req.user?.userId ? { userId: req.user.userId } : {}),
      anonymousId,
      source,
      preferences: req.body.preferences,
      audit: getConsentAuditContext(req),
    });
    res.status(201).json({ success: true, data: { id: record.id, action: record.action } });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not save cookie preferences" });
  }
}

export async function recordOAuthConsentHandler(req: Request, res: Response) {
  try {
    const anonymousId = ensureConsentId(req, res);
    const record = await recordTermsAndPrivacyAcceptance({
      source: ConsentSource.OAUTH,
      payload: req.body,
      audit: { ...getConsentAuditContext(req), anonymousId },
    });
    res.status(201).json({ success: true, data: { id: record.id } });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not record consent" });
  }
}

export async function claimConsentHandler(req: Request, res: Response) {
  const anonymousId = (req.cookies as Record<string, string> | undefined)?.[CONSENT_ID_COOKIE];
  const claimed = await claimAnonymousConsents(anonymousId, req.user!.userId);
  res.json({ success: true, data: { claimed } });
}

export async function getAdminConsentsHandler(req: Request, res: Response) {
  const data = await getAdminConsentRecords(adminQuery(req));
  res.json({ success: true, data });
}

export async function exportAdminConsentsHandler(req: Request, res: Response) {
  const records = await getConsentRecordsForExport({ ...adminQuery(req), page: 1, limit: 100 });
  const headers = [
    "record_id", "created_at", "user_email", "user_name", "anonymous_id", "order_id",
    "type", "action", "source", "policy_version", "preferences", "ip_address", "user_agent",
  ];
  const rows = records.map((record) => [
    record.id,
    record.createdAt.toISOString(),
    record.user?.email,
    record.user?.name,
    record.anonymousId,
    record.orderId,
    record.type,
    record.action,
    record.source,
    record.policyVersion,
    record.preferences,
    record.ipAddress,
    record.userAgent,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="roboroot-consents-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${csv}`);
}

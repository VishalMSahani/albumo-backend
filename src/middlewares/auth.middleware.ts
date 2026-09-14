import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { prisma } from "../lib/prisma.js";
import { UnauthorizedError, ForbiddenError, type JWTPayload } from "../utils/types.js";
declare global { namespace Express { interface Request { user?: JWTPayload; } } }

async function resolveUser(req: Request): Promise<JWTPayload> {
  const header = req.headers.authorization;
  const token = header ? (/^Bearer ([^ ]+)$/.exec(header)?.[1]) : (req.cookies as Record<string, string> | undefined)?.accessToken;
  if (!token) throw new UnauthorizedError("Please sign in to continue");
  const decoded = verifyAccessToken(token);
  const session = await prisma.session.findUnique({ where: { id: decoded.sessionId! }, include: { user: true } });
  if (!session || session.userId !== decoded.userId || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.user.isActive) throw new UnauthorizedError("Session expired. Please sign in again.");
  return { ...decoded, role: session.user.role, email: session.user.email };
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { req.user = await resolveUser(req); next(); }
  catch (error) {
    if (error instanceof UnauthorizedError) res.status(401).json({ success: false, error: error.message, code: "UNAUTHORIZED" });
    else next(error);
  }
}

export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) { next(new UnauthorizedError()); return; }
    if (!roles.includes(req.user.role) && !(roles.includes("ADMIN") && req.user.role === "SUPER_ADMIN")) { next(new ForbiddenError("You do not have permission for this action")); return; }
    next();
  };
}

export async function optionalAuthenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { req.user = await resolveUser(req); }
  catch (error) { if (!(error instanceof UnauthorizedError)) { next(error); return; } }
  next();
}

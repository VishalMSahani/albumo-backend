import {
  ConsentAction,
  ConsentSource,
  ConsentType,
  Prisma,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { ValidationError } from "../../utils/types.js";
import {
  LEGAL_LAST_UPDATED,
  LEGAL_POLICY_LINKS,
  LEGAL_POLICY_VERSION,
  LEGAL_POLICY_VERSIONS,
} from "./legal.constants.js";

export type ConsentAuditContext = {
  ipAddress?: string;
  userAgent?: string;
  anonymousId?: string;
};

export type LegalAcceptancePayload = {
  accepted?: boolean;
  policyVersion?: string;
};

type ConsentClient = Prisma.TransactionClient | typeof prisma;

type RecordAcceptanceInput = {
  userId?: string;
  orderId?: string;
  anonymousId?: string;
  type: ConsentType;
  source: ConsentSource;
  action?: ConsentAction;
  preferences?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  audit?: ConsentAuditContext;
};

export const legalConfig = {
  policyVersion: LEGAL_POLICY_VERSION,
  lastUpdated: LEGAL_LAST_UPDATED,
  policyVersions: LEGAL_POLICY_VERSIONS,
  links: LEGAL_POLICY_LINKS,
};

export function validateLegalAcceptance(payload: unknown): LegalAcceptancePayload {
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("You must accept the applicable legal policies to continue");
  }

  const accepted = (payload as LegalAcceptancePayload).accepted;
  const policyVersion = (payload as LegalAcceptancePayload).policyVersion;

  if (accepted !== true) {
    throw new ValidationError("You must accept the applicable legal policies to continue");
  }

  if (policyVersion !== LEGAL_POLICY_VERSION) {
    throw new ValidationError("The legal policies have changed. Review and accept the current version");
  }

  return { accepted: true, policyVersion };
}

export async function recordAcceptance(
  client: ConsentClient,
  input: RecordAcceptanceInput,
) {
  return client.consentRecord.create({
    data: {
      userId: input.userId ?? null,
      orderId: input.orderId ?? null,
      anonymousId: input.anonymousId ?? input.audit?.anonymousId ?? null,
      type: input.type,
      action: input.action ?? ConsentAction.GRANTED,
      source: input.source,
      policyVersion: LEGAL_POLICY_VERSION,
      policyVersions: LEGAL_POLICY_VERSIONS,
      preferences: input.preferences ?? Prisma.DbNull,
      metadata: input.metadata ?? Prisma.DbNull,
      ipAddress: input.audit?.ipAddress ?? null,
      userAgent: input.audit?.userAgent ?? null,
    },
  });
}

export async function recordTermsAndPrivacyAcceptance(input: {
  userId?: string;
  source: Extract<ConsentSource, "REGISTRATION" | "LOGIN" | "OAUTH">;
  payload: unknown;
  audit?: ConsentAuditContext;
  client?: ConsentClient;
}) {
  validateLegalAcceptance(input.payload);
  return recordAcceptance(input.client ?? prisma, {
    ...(input.userId ? { userId: input.userId } : {}),
    type: ConsentType.TERMS_AND_PRIVACY,
    source: input.source,
    ...(input.audit ? { audit: input.audit } : {}),
    metadata: {
      acceptedDocuments: ["termsAndConditions", "privacyPolicy"],
    },
  });
}

export async function recordCheckoutAcceptance(input: {
  userId: string;
  orderId: string;
  source: Extract<ConsentSource, "CHECKOUT" | "THREE_D_PRINTING_CHECKOUT">;
  payload: unknown;
  audit?: ConsentAuditContext;
  client?: ConsentClient;
}) {
  validateLegalAcceptance(input.payload);
  return recordAcceptance(input.client ?? prisma, {
    userId: input.userId,
    orderId: input.orderId,
    type: ConsentType.CHECKOUT_POLICIES,
    source: input.source,
    ...(input.audit ? { audit: input.audit } : {}),
    metadata: {
      acceptedDocuments: [
        "termsAndConditions",
        "privacyPolicy",
        "refundPolicy",
        "shippingPolicy",
        "cancellationPolicy",
      ],
    },
  });
}

export type CookiePreferences = {
  essential: true;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
};

export function validateCookiePreferences(value: unknown): CookiePreferences {
  if (!value || typeof value !== "object") {
    throw new ValidationError("Cookie preferences are required");
  }

  const input = value as Record<string, unknown>;
  if (input.essential !== true) {
    throw new ValidationError("Essential cookies cannot be disabled");
  }

  for (const field of ["preferences", "analytics", "marketing"] as const) {
    if (typeof input[field] !== "boolean") {
      throw new ValidationError(`Cookie preference ${field} must be true or false`);
    }
  }

  return {
    essential: true,
    preferences: input.preferences as boolean,
    analytics: input.analytics as boolean,
    marketing: input.marketing as boolean,
  };
}

export async function recordCookiePreferences(input: {
  userId?: string;
  anonymousId: string;
  source: Extract<ConsentSource, "COOKIE_BANNER" | "COOKIE_SETTINGS">;
  preferences: unknown;
  audit?: ConsentAuditContext;
}) {
  const preferences = validateCookiePreferences(input.preferences);
  const previous = await prisma.consentRecord.findFirst({
    where: {
      type: ConsentType.COOKIE_PREFERENCES,
      OR: [
        ...(input.userId ? [{ userId: input.userId }] : []),
        { anonymousId: input.anonymousId },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { preferences: true },
  });

  const previousPreferences = previous?.preferences as CookiePreferences | null;
  const optionalWereEnabled = Boolean(
    previousPreferences?.preferences || previousPreferences?.analytics || previousPreferences?.marketing,
  );
  const optionalAreDisabled = !preferences.preferences && !preferences.analytics && !preferences.marketing;
  const action = !previous
    ? ConsentAction.GRANTED
    : optionalWereEnabled && optionalAreDisabled
      ? ConsentAction.WITHDRAWN
      : ConsentAction.UPDATED;

  return recordAcceptance(prisma, {
    ...(input.userId ? { userId: input.userId } : {}),
    anonymousId: input.anonymousId,
    type: ConsentType.COOKIE_PREFERENCES,
    source: input.source,
    action,
    preferences: preferences as Prisma.InputJsonValue,
    ...(input.audit ? { audit: input.audit } : {}),
  });
}

export async function claimAnonymousConsents(anonymousId: string | undefined, userId: string) {
  if (!anonymousId) return 0;
  const result = await prisma.consentRecord.updateMany({
    where: { anonymousId, userId: null },
    data: { userId },
  });
  return result.count;
}

export type ConsentAdminQuery = {
  page: number;
  limit: number;
  search?: string;
  type?: ConsentType;
  source?: ConsentSource;
  action?: ConsentAction;
  from?: Date;
  to?: Date;
};

function consentWhere(input: ConsentAdminQuery): Prisma.ConsentRecordWhereInput {
  return {
    ...(input.type ? { type: input.type } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...((input.from || input.to)
      ? {
          createdAt: {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          },
        }
      : {}),
    ...(input.search
      ? {
          OR: [
            { id: { contains: input.search, mode: "insensitive" } },
            { anonymousId: { contains: input.search, mode: "insensitive" } },
            { orderId: { contains: input.search, mode: "insensitive" } },
            { ipAddress: { contains: input.search, mode: "insensitive" } },
            { user: { name: { contains: input.search, mode: "insensitive" } } },
            { user: { email: { contains: input.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

const adminConsentInclude = {
  user: { select: { id: true, name: true, email: true } },
  order: { select: { id: true, totalAmountCents: true, status: true } },
} satisfies Prisma.ConsentRecordInclude;

export async function getAdminConsentRecords(input: ConsentAdminQuery) {
  const where = consentWhere(input);
  const [records, total, grouped] = await Promise.all([
    prisma.consentRecord.findMany({
      where,
      include: adminConsentInclude,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.consentRecord.count({ where }),
    prisma.consentRecord.groupBy({
      by: ["type"],
      where,
      _count: { _all: true },
    }),
  ]);

  return {
    records,
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.limit)),
    },
    summary: {
      total,
      byType: Object.fromEntries(grouped.map((item) => [item.type, item._count._all])),
    },
  };
}

export async function getConsentRecordsForExport(input: ConsentAdminQuery) {
  return prisma.consentRecord.findMany({
    where: consentWhere(input),
    include: adminConsentInclude,
    orderBy: { createdAt: "desc" },
    take: 10_000,
  });
}

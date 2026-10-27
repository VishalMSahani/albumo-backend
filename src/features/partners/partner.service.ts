import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { NotFoundError, ValidationError } from "../../utils/types.js";
import type {
  CreatePartnerInquiryInput,
  UpdatePartnerInquiryInput,
  PartnerQueryInput,
  PartnerDirectoryQueryInput,
} from "./partner.validator.js";

export async function createPartnerInquiry(input: CreatePartnerInquiryInput) {
  return prisma.partnerInquiry.create({
    data: {
      partnerType: input.partnerType,
      name: input.name,
      email: input.email.toLowerCase(),
      phone: input.phone,
      companyName: input.companyName || null,
      website: input.website || null,
      city: input.city || null,
      message: input.message,
      expectedVolume: input.expectedVolume || null,
      contactConsentAt: new Date(),
      directoryConsent: input.directoryConsent,
      directoryConsentAt: input.directoryConsent ? new Date() : null,
    },
  });
}

export async function listPartnerInquiries(input: PartnerQueryInput) {
  const where: Prisma.PartnerInquiryWhereInput = {
    ...(input.partnerType ? { partnerType: input.partnerType } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.search
      ? {
          OR: [
            { name: { contains: input.search, mode: "insensitive" } },
            { email: { contains: input.search, mode: "insensitive" } },
            { companyName: { contains: input.search, mode: "insensitive" } },
            { city: { contains: input.search, mode: "insensitive" } },
            { phone: { contains: input.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [inquiries, total] = await Promise.all([
    prisma.partnerInquiry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.partnerInquiry.count({ where }),
  ]);

  return {
    inquiries,
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.limit)),
    },
  };
}

export async function getPartnerInquiry(id: string) {
  const inquiry = await prisma.partnerInquiry.findUnique({ where: { id } });
  if (!inquiry) throw new NotFoundError("Partner inquiry not found");
  return inquiry;
}

export async function updatePartnerInquiry(
  id: string,
  input: UpdatePartnerInquiryInput,
) {
  return prisma.$transaction(async (tx) => {
    // Serialize publication and status edits so a concurrent decline cannot publish a profile.
    await tx.$queryRaw`SELECT id FROM "PartnerInquiry" WHERE id = ${id} FOR UPDATE`;
    const current = await tx.partnerInquiry.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("Partner inquiry not found");
    const next = { ...current, ...input };
    if (input.isPublished && next.status !== "ONBOARDED") {
      throw new ValidationError(
        "Onboard this partner before publishing their profile",
      );
    }
    const isPublished =
      next.status === "ONBOARDED" && (input.isPublished ?? current.isPublished);
    if (isPublished) {
      if (!current.directoryConsent) {
        throw new ValidationError(
          "This partner has not opted in to a public listing",
        );
      }
      if (
        !next.publicName ||
        !next.publicCity ||
        !next.publicWebsite ||
        !next.publicDescription
      ) {
        throw new ValidationError(
          "Complete all public profile fields before publishing",
        );
      }
    }
    return tx.partnerInquiry.update({
      where: { id },
      data: {
        isPublished,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.adminNotes !== undefined
          ? { adminNotes: input.adminNotes }
          : {}),
        ...(input.publicName !== undefined
          ? { publicName: input.publicName }
          : {}),
        ...(input.publicDescription !== undefined
          ? { publicDescription: input.publicDescription }
          : {}),
        ...(input.publicCity !== undefined
          ? { publicCity: input.publicCity }
          : {}),
        ...(input.publicWebsite !== undefined
          ? { publicWebsite: input.publicWebsite }
          : {}),
      },
    });
  });
}

export async function listPartnerDirectory(input: PartnerDirectoryQueryInput) {
  const limit = 12;
  const where: Prisma.PartnerInquiryWhereInput = {
    isPublished: true,
    directoryConsent: true,
    status: "ONBOARDED",
    ...(input.partnerType ? { partnerType: input.partnerType } : {}),
    ...(input.search
      ? {
          OR: [
            { publicName: { contains: input.search, mode: "insensitive" } },
            { publicCity: { contains: input.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [partners, total] = await Promise.all([
    prisma.partnerInquiry.findMany({
      where,
      // Never expose application contact details, messages or internal notes.
      select: {
        id: true,
        partnerType: true,
        publicName: true,
        publicDescription: true,
        publicCity: true,
        publicWebsite: true,
      },
      orderBy: [{ publicName: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * limit,
      take: limit,
    }),
    prisma.partnerInquiry.count({ where }),
  ]);
  return {
    partners,
    pagination: {
      page: input.page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getPartnerSummary() {
  const [total, byStatus, byType] = await Promise.all([
    prisma.partnerInquiry.count(),
    prisma.partnerInquiry.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    prisma.partnerInquiry.groupBy({
      by: ["partnerType"],
      _count: { id: true },
    }),
  ]);

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count.id])),
    byType: Object.fromEntries(byType.map((t) => [t.partnerType, t._count.id])),
  };
}

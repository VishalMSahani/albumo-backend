import crypto from "crypto";
import {
  EmailEventType,
  OrderItemType,
  OrderStatus,
  OrderType,
  PaymentGateway,
  PaymentStatus,
  PrintFinish,
  PrintOrderStatus,
  PrintQuality,
  PrintStorageProvider,
  ConsentSource,
  type Prisma,
} from "../../../generated/prisma/client.js";
import { prisma } from "../../../lib/prisma.js";
import { queueEmailNotification } from "../../../services/email-notification.service.js";
import {
  getPrivateFileAccess,
  uploadPrivateFile,
  type PrivateFileAccess,
} from "../../../services/azure-storage.service.js";
import {
  calculateDeliveryFee,
  getDeliverySettings,
} from "../../settings/services/store-settings.service.js";
import { analyzeModel } from "./model-analysis.service.js";
import {
  recordCheckoutAcceptance,
  type ConsentAuditContext,
} from "../../legal/legal.service.js";

type ShippingAddressInput = {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
};

export type PrintQuoteInput = {
  userId: string;
  fileIds: string[];
  materialId: string;
  color: string;
  quality: PrintQuality;
  finish: PrintFinish;
  infillPercent: number;
  quantity: number;
};

export type PrintPreviewQuoteInput = Omit<PrintQuoteInput, "userId" | "fileIds">;

type CreatePrintOrderInput = PrintQuoteInput & {
  shippingAddressId?: string;
  shippingAddress?: ShippingAddressInput;
  customerNotes?: string;
  legalConsent: unknown;
  consentAudit?: ConsentAuditContext;
};

type AdminPricingInput = {
  isEnabled: boolean;
  baseFeeCents: number;
  minimumOrderCents: number;
  shellMaterialPercent: number;
  draftMultiplierPercent: number;
  standardMultiplierPercent: number;
  fineMultiplierPercent: number;
  rawFinishFeeCents: number;
  supportRemovalFeeCents: number;
  sandingFeeCents: number;
  primerFeeCents: number;
  paintingFeeCents: number;
  draftLeadDays: number;
  standardLeadDays: number;
  fineLeadDays: number;
  maxFileSizeMb: number;
  maxFilesPerOrder: number;
  materials: Array<{
    id?: string;
    code: string;
    name: string;
    densityGramsPerCm3: number;
    pricePerGramCents: number;
    colors: string[];
    isActive: boolean;
    sortOrder: number;
  }>;
};

const safeFileSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  format: true,
  sizeBytes: true,
  volumeMm3: true,
  widthMm: true,
  heightMm: true,
  depthMm: true,
  triangleCount: true,
  createdAt: true,
} satisfies Prisma.ThreeDPrintFileSelect;

type SafePrintModelFile = Prisma.ThreeDPrintFileGetPayload<{
  select: typeof safeFileSelect;
}>;

const printOrderInclude = {
  modelFiles: {
    select: safeFileSelect,
    orderBy: { sortOrder: "asc" as const },
  },
  material: true,
  commerceOrder: {
    include: {
      address: true,
      payments: { orderBy: { createdAt: "desc" as const } },
    },
  },
  statusHistory: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.ThreeDPrintOrderInclude;

function serviceError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function roundMeasurement(value: number) {
  return Math.round(value * 100) / 100;
}

function qualityMultiplier(
  quality: PrintQuality,
  setting: {
    draftMultiplierPercent: number;
    standardMultiplierPercent: number;
    fineMultiplierPercent: number;
  },
) {
  if (quality === PrintQuality.DRAFT) return setting.draftMultiplierPercent;
  if (quality === PrintQuality.FINE) return setting.fineMultiplierPercent;
  return setting.standardMultiplierPercent;
}

function finishFee(
  finish: PrintFinish,
  setting: {
    rawFinishFeeCents: number;
    supportRemovalFeeCents: number;
    sandingFeeCents: number;
    primerFeeCents: number;
    paintingFeeCents: number;
  },
) {
  if (finish === PrintFinish.SUPPORT_REMOVAL) return setting.supportRemovalFeeCents;
  if (finish === PrintFinish.SANDED) return setting.sandingFeeCents;
  if (finish === PrintFinish.PRIMED) return setting.primerFeeCents;
  if (finish === PrintFinish.PAINTED) return setting.paintingFeeCents;
  return setting.rawFinishFeeCents;
}

function leadDays(
  quality: PrintQuality,
  finish: PrintFinish,
  setting: {
    draftLeadDays: number;
    standardLeadDays: number;
    fineLeadDays: number;
  },
) {
  const printDays =
    quality === PrintQuality.DRAFT
      ? setting.draftLeadDays
      : quality === PrintQuality.FINE
        ? setting.fineLeadDays
        : setting.standardLeadDays;
  const finishingDays =
    finish === PrintFinish.PAINTED
      ? 2
      : finish === PrintFinish.PRIMED || finish === PrintFinish.SANDED
        ? 1
        : 0;
  return printDays + finishingDays;
}

export async function getPrintPricingSettings(includeInactive = false) {
  const settings = await prisma.printPricingSetting.findUnique({
    where: { id: 1 },
    include: {
      materials: {
        ...(includeInactive ? {} : { where: { isActive: true } }),
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
  });

  if (!settings) {
    throw serviceError("3D printing pricing is not configured", 503);
  }
  return settings;
}

async function persistModelFile(
  userId: string,
  file: Express.Multer.File,
  maximumBytes: number,
) {
  if (file.size > maximumBytes) {
    throw serviceError(`Model files must be ${Math.floor(maximumBytes / 1024 / 1024)} MB or smaller`, 400);
  }

  const analysis = analyzeModel(file.buffer, file.originalname);
  const checksumSha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const stored = await uploadPrivateFile(
    file.buffer,
    file.originalname,
    file.mimetype || "application/octet-stream",
  );

  return prisma.threeDPrintFile.create({
    data: {
      userId,
      originalName: file.originalname,
      storageProvider:
        stored.storageProvider === "AZURE"
          ? PrintStorageProvider.AZURE
          : PrintStorageProvider.LOCAL,
      storageKey: stored.storageKey,
      mimeType: file.mimetype || "application/octet-stream",
      format: analysis.format,
      sizeBytes: stored.size,
      checksumSha256,
      volumeMm3: analysis.volumeMm3,
      widthMm: analysis.widthMm,
      heightMm: analysis.heightMm,
      depthMm: analysis.depthMm,
      triangleCount: analysis.triangleCount,
    },
    select: safeFileSelect,
  });
}

export async function createModelFile(userId: string, file: Express.Multer.File) {
  const settings = await getPrintPricingSettings();
  return persistModelFile(userId, file, settings.maxFileSizeMb * 1024 * 1024);
}

export async function createModelFiles(userId: string, files: Express.Multer.File[]) {
  const settings = await getPrintPricingSettings();
  if (files.length > settings.maxFilesPerOrder) {
    throw serviceError(`A print order can contain up to ${settings.maxFilesPerOrder} model files`, 400);
  }
  const maximumBytes = settings.maxFileSizeMb * 1024 * 1024;
  return Promise.all(files.map((file) => persistModelFile(userId, file, maximumBytes)));
}

function buildPrintQuote(
  input: PrintPreviewQuoteInput,
  modelFiles: SafePrintModelFile[],
  settings: Awaited<ReturnType<typeof getPrintPricingSettings>>,
  deliverySettings: Awaited<ReturnType<typeof getDeliverySettings>>,
) {
  if (!settings.isEnabled) throw serviceError("3D printing orders are temporarily paused", 503);
  if (modelFiles.length === 0) throw serviceError("Select at least one model file", 400);
  if (modelFiles.length > settings.maxFilesPerOrder) {
    throw serviceError(`A print order can contain up to ${settings.maxFilesPerOrder} model files`, 400);
  }

  const material = settings.materials.find((item) => item.id === input.materialId);
  if (!material) throw serviceError("Selected material is unavailable", 400);
  if (!material.colors.some((color) => color.toLowerCase() === input.color.toLowerCase())) {
    throw serviceError("Selected color is unavailable for this material", 400);
  }

  const combinedVolumeMm3 = modelFiles.reduce((sum, file) => sum + file.volumeMm3, 0);
  const solidWeightGrams =
    (combinedVolumeMm3 / 1000) * material.densityGramsPerCm3;
  const shellRatio = settings.shellMaterialPercent / 100;
  const effectiveMaterialRatio =
    shellRatio + (1 - shellRatio) * (input.infillPercent / 100);
  const unitWeightGrams = solidWeightGrams * effectiveMaterialRatio;
  const totalWeightGrams = unitWeightGrams * input.quantity;
  const materialCostCents = Math.round(totalWeightGrams * material.pricePerGramCents);
  const multiplierPercent = qualityMultiplier(input.quality, settings);
  const qualityMarkupCents = Math.round(
    (materialCostCents * (multiplierPercent - 100)) / 100,
  );
  const baseFeeCents = settings.baseFeeCents;
  const selectedFinishFeeCents =
    finishFee(input.finish, settings) * modelFiles.length * input.quantity;
  const calculatedSubtotalCents =
    baseFeeCents + materialCostCents + qualityMarkupCents + selectedFinishFeeCents;
  const subtotalCents = Math.max(settings.minimumOrderCents, calculatedSubtotalCents);
  const minimumAdjustmentCents = subtotalCents - calculatedSubtotalCents;
  const shippingCents = calculateDeliveryFee(subtotalCents, deliverySettings);
  const totalAmountCents = subtotalCents + shippingCents;
  const estimatedDays = leadDays(input.quality, input.finish, settings);

  return {
    files: modelFiles,
    material: {
      id: material.id,
      code: material.code,
      name: material.name,
      densityGramsPerCm3: material.densityGramsPerCm3,
      pricePerGramCents: material.pricePerGramCents,
    },
    color: input.color,
    quality: input.quality,
    finish: input.finish,
    infillPercent: input.infillPercent,
    quantity: input.quantity,
    unitWeightGrams: roundMeasurement(unitWeightGrams),
    totalWeightGrams: roundMeasurement(totalWeightGrams),
    baseFeeCents,
    materialCostCents,
    qualityMarkupCents,
    finishFeeCents: selectedFinishFeeCents,
    minimumAdjustmentCents,
    subtotalCents,
    shippingCents,
    totalAmountCents,
    estimatedDays,
    pricingVersion: settings.updatedAt.toISOString(),
    disclaimer:
      "Instant pricing is based on enclosed mesh volume. The team may contact you if the model needs repair, supports, or orientation changes.",
  };
}

export async function calculatePrintQuote(input: PrintQuoteInput) {
  const uniqueFileIds = Array.from(new Set(input.fileIds));
  if (uniqueFileIds.length !== input.fileIds.length) {
    throw serviceError("Each model file can only be included once", 400);
  }

  const [settings, storedFiles, deliverySettings] = await Promise.all([
    getPrintPricingSettings(),
    prisma.threeDPrintFile.findMany({
      where: { id: { in: uniqueFileIds }, userId: input.userId, orderId: null },
      select: safeFileSelect,
    }),
    getDeliverySettings(),
  ]);

  if (storedFiles.length !== uniqueFileIds.length) {
    throw serviceError("One or more model files were not found or are already ordered", 404);
  }
  const filesById = new Map(storedFiles.map((file) => [file.id, file]));
  const modelFiles = uniqueFileIds.map((id) => filesById.get(id)!);
  return buildPrintQuote(input, modelFiles, settings, deliverySettings);
}

export async function calculatePreviewPrintQuote(
  input: PrintPreviewQuoteInput,
  files: Express.Multer.File[],
) {
  const [settings, deliverySettings] = await Promise.all([
    getPrintPricingSettings(),
    getDeliverySettings(),
  ]);
  const maximumBytes = settings.maxFileSizeMb * 1024 * 1024;
  if (files.length > settings.maxFilesPerOrder) {
    throw serviceError(`A print order can contain up to ${settings.maxFilesPerOrder} model files`, 400);
  }
  const previewFiles = files.map((file, index): SafePrintModelFile => {
    if (file.size > maximumBytes) {
      throw serviceError(`Model files must be ${settings.maxFileSizeMb} MB or smaller`, 400);
    }
    const analysis = analyzeModel(file.buffer, file.originalname);
    return {
      id: `preview-${index + 1}`,
      originalName: file.originalname,
      mimeType: file.mimetype || "application/octet-stream",
      format: analysis.format,
      sizeBytes: file.size,
      volumeMm3: analysis.volumeMm3,
      widthMm: analysis.widthMm,
      heightMm: analysis.heightMm,
      depthMm: analysis.depthMm,
      triangleCount: analysis.triangleCount,
      createdAt: new Date(),
    };
  });

  return buildPrintQuote(input, previewFiles, settings, deliverySettings);
}

function createReference() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `3DP-${date}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function createPrintOrder(input: CreatePrintOrderInput) {
  const quote = await calculatePrintQuote(input);

  const result = await prisma.$transaction(async (tx) => {
    const address = input.shippingAddressId
      ? await tx.address.findFirst({
          where: { id: input.shippingAddressId, userId: input.userId },
        })
      : input.shippingAddress
        ? await tx.address.create({
            data: {
              userId: input.userId,
              name: input.shippingAddress.name,
              phone: input.shippingAddress.phone,
              line1: input.shippingAddress.line1,
              line2: input.shippingAddress.line2 || null,
              city: input.shippingAddress.city,
              state: input.shippingAddress.state,
              pincode: input.shippingAddress.pincode,
              country: input.shippingAddress.country || "India",
            },
          })
        : null;

    if (!address) throw serviceError("Shipping address not found", 400);

    const reference = createReference();
    const commerceOrder = await tx.order.create({
      data: {
        userId: input.userId,
        addressId: address.id,
        orderType: OrderType.THREE_D_PRINT,
        status: OrderStatus.PENDING_PAYMENT,
        totalAmountCents: quote.totalAmountCents,
        notes: `3D printing service ${reference}`,
        items: {
          create: {
            itemType: OrderItemType.SERVICE,
            description: `3D print: ${quote.files.length} model${quote.files.length === 1 ? "" : "s"} - ${quote.material.name} - Qty ${quote.quantity}`,
            quantity: 1,
            unitPriceCents: quote.subtotalCents,
            subtotalCents: quote.subtotalCents,
          },
        },
        payments: {
          create: {
            gateway: PaymentGateway.ZOHO,
            amountCents: quote.totalAmountCents,
            status: PaymentStatus.CREATED,
            gatewayOrderId: `rr3d_${Date.now()}`,
            rawPayload: {
              mode: "gateway_pending",
              service: "3d_printing",
              reference,
              subtotalCents: quote.subtotalCents,
              shippingCents: quote.shippingCents,
            },
          },
        },
      },
    });

    const createdPrintOrder = await tx.threeDPrintOrder.create({
      data: {
        reference,
        userId: input.userId,
        materialId: input.materialId,
        commerceOrderId: commerceOrder.id,
        status: PrintOrderStatus.PAYMENT_PENDING,
        color: input.color,
        quality: input.quality,
        finish: input.finish,
        infillPercent: input.infillPercent,
        quantity: input.quantity,
        unitWeightGrams: quote.unitWeightGrams,
        totalWeightGrams: quote.totalWeightGrams,
        baseFeeCents: quote.baseFeeCents,
        materialCostCents: quote.materialCostCents,
        qualityMarkupCents: quote.qualityMarkupCents,
        finishFeeCents: quote.finishFeeCents,
        subtotalCents: quote.subtotalCents,
        shippingCents: quote.shippingCents,
        totalAmountCents: quote.totalAmountCents,
        estimatedDays: quote.estimatedDays,
        pricingSnapshot: {
          pricingVersion: quote.pricingVersion,
          minimumAdjustmentCents: quote.minimumAdjustmentCents,
          material: quote.material,
          disclaimer: quote.disclaimer,
        },
        customerNotes: input.customerNotes || null,
        statusHistory: {
          create: {
            status: PrintOrderStatus.PAYMENT_PENDING,
            note: "Order created and awaiting payment",
            actorLabel: "Customer",
          },
        },
      },
    });

    for (const [sortOrder, fileId] of input.fileIds.entries()) {
      const claimed = await tx.threeDPrintFile.updateMany({
        where: { id: fileId, userId: input.userId, orderId: null },
        data: { orderId: createdPrintOrder.id, sortOrder },
      });
      if (claimed.count !== 1) {
        throw serviceError("One or more model files could not be attached to this order", 409);
      }
    }

    const printOrder = await tx.threeDPrintOrder.findUniqueOrThrow({
      where: { id: createdPrintOrder.id },
      include: printOrderInclude,
    });

    await recordCheckoutAcceptance({
      userId: input.userId,
      orderId: commerceOrder.id,
      source: ConsentSource.THREE_D_PRINTING_CHECKOUT,
      payload: input.legalConsent,
      ...(input.consentAudit ? { audit: input.consentAudit } : {}),
      client: tx,
    });

    return { printOrder, commerceOrderId: commerceOrder.id };
  });

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { name: true, email: true },
  });
  if (user) {
    void queueEmailNotification(
      user.email,
      EmailEventType.ORDER_CREATED,
      {
        order: {
          orderId: result.commerceOrderId,
          total: quote.totalAmountCents / 100,
          items: [
            {
              name: `3D printing: ${quote.files.length} model${quote.files.length === 1 ? "" : "s"}`,
              quantity: quote.quantity,
              price: quote.subtotalCents / 100,
            },
          ],
        },
        user: { name: user.name || user.email },
      },
      input.userId,
    ).catch(() => null);
  }

  return {
    order: result.printOrder,
    commerceOrderId: result.commerceOrderId,
  };
}

export async function getUserPrintOrders(userId: string) {
  return prisma.threeDPrintOrder.findMany({
    where: { userId },
    include: printOrderInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getPrintOrderById(id: string, userId: string, isAdmin: boolean) {
  const order = await prisma.threeDPrintOrder.findUnique({
    where: { id },
    include: {
      ...printOrderInclude,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!order) throw serviceError("3D print order not found", 404);
  if (!isAdmin && order.userId !== userId) throw serviceError("Access denied", 403);
  return order;
}

export async function getModelFileDownload(
  fileId: string,
  userId: string,
  isAdmin: boolean,
): Promise<{ fileName: string; access: PrivateFileAccess }> {
  const file = await prisma.threeDPrintFile.findUnique({
    where: { id: fileId },
    select: {
      userId: true,
      originalName: true,
      storageProvider: true,
      storageKey: true,
    },
  });
  if (!file) throw serviceError("Model file not found", 404);
  if (!isAdmin && file.userId !== userId) throw serviceError("Access denied", 403);

  const access = await getPrivateFileAccess(
    file.storageProvider,
    file.storageKey,
    file.originalName,
  );
  return { fileName: file.originalName, access };
}

export async function getAdminPrintOrders(input: {
  page: number;
  limit: number;
  status?: PrintOrderStatus;
  search?: string;
}) {
  const where: Prisma.ThreeDPrintOrderWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.search
      ? {
          OR: [
            { reference: { contains: input.search, mode: "insensitive" } },
            { modelFiles: { some: { originalName: { contains: input.search, mode: "insensitive" } } } },
            { user: { name: { contains: input.search, mode: "insensitive" } } },
            { user: { email: { contains: input.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.threeDPrintOrder.findMany({
      where,
      include: {
        ...printOrderInclude,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.threeDPrintOrder.count({ where }),
  ]);

  return {
    orders,
    total,
    page: input.page,
    limit: input.limit,
    totalPages: Math.ceil(total / input.limit),
  };
}

function commerceStatusForPrintStatus(status: PrintOrderStatus): OrderStatus | null {
  if (status === PrintOrderStatus.PAYMENT_PENDING) return OrderStatus.PENDING_PAYMENT;
  if (status === PrintOrderStatus.PAID) return OrderStatus.PAID;
  if (
    status === PrintOrderStatus.UNDER_REVIEW ||
    status === PrintOrderStatus.APPROVED ||
    status === PrintOrderStatus.PRINTING ||
    status === PrintOrderStatus.POST_PROCESSING ||
    status === PrintOrderStatus.QUALITY_CHECK
  ) {
    return OrderStatus.PROCESSING;
  }
  if (status === PrintOrderStatus.PACKED) return OrderStatus.PACKED;
  if (status === PrintOrderStatus.SHIPPED) return OrderStatus.SHIPPED;
  if (status === PrintOrderStatus.DELIVERED) return OrderStatus.DELIVERED;
  if (status === PrintOrderStatus.CANCELLED) return OrderStatus.CANCELLED;
  if (status === PrintOrderStatus.REFUNDED) return OrderStatus.REFUNDED;
  return null;
}

export async function updateAdminPrintOrder(
  id: string,
  input: {
    status?: PrintOrderStatus;
    adminNotes?: string | null;
    estimatedDays?: number;
    trackingAwb?: string | null;
    trackingUrl?: string | null;
    statusNote?: string;
  },
  actorLabel: string,
) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.threeDPrintOrder.findUnique({ where: { id } });
    if (!existing) throw serviceError("3D print order not found", 404);

    await tx.threeDPrintOrder.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
        ...(input.estimatedDays !== undefined ? { estimatedDays: input.estimatedDays } : {}),
      },
    });

    if (input.status && input.status !== existing.status) {
      await tx.threeDPrintStatusEvent.create({
        data: {
          printOrderId: id,
          status: input.status,
          note: input.statusNote || null,
          actorLabel,
        },
      });
      const commerceStatus = commerceStatusForPrintStatus(input.status);
      if (commerceStatus) {
        await tx.order.update({
          where: { id: existing.commerceOrderId },
          data: { status: commerceStatus },
        });
      }
    }

    if (input.trackingAwb !== undefined || input.trackingUrl !== undefined) {
      await tx.order.update({
        where: { id: existing.commerceOrderId },
        data: {
          ...(input.trackingAwb !== undefined ? { trackingAwb: input.trackingAwb } : {}),
          ...(input.trackingUrl !== undefined ? { trackingUrl: input.trackingUrl } : {}),
        },
      });
    }

    if (input.status === PrintOrderStatus.SHIPPED) {
      await tx.order.update({
        where: { id: existing.commerceOrderId },
        data: { shippedAt: new Date() },
      });
    }
    if (input.status === PrintOrderStatus.DELIVERED) {
      await tx.order.update({
        where: { id: existing.commerceOrderId },
        data: { deliveredAt: new Date() },
      });
    }
  });

  return getPrintOrderById(id, "", true);
}

export async function updatePrintPricingSettings(input: AdminPricingInput) {
  await prisma.$transaction(async (tx) => {
    await tx.printPricingSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        isEnabled: input.isEnabled,
        baseFeeCents: input.baseFeeCents,
        minimumOrderCents: input.minimumOrderCents,
        shellMaterialPercent: input.shellMaterialPercent,
        draftMultiplierPercent: input.draftMultiplierPercent,
        standardMultiplierPercent: input.standardMultiplierPercent,
        fineMultiplierPercent: input.fineMultiplierPercent,
        rawFinishFeeCents: input.rawFinishFeeCents,
        supportRemovalFeeCents: input.supportRemovalFeeCents,
        sandingFeeCents: input.sandingFeeCents,
        primerFeeCents: input.primerFeeCents,
        paintingFeeCents: input.paintingFeeCents,
        draftLeadDays: input.draftLeadDays,
        standardLeadDays: input.standardLeadDays,
        fineLeadDays: input.fineLeadDays,
        maxFileSizeMb: input.maxFileSizeMb,
        maxFilesPerOrder: input.maxFilesPerOrder,
      },
      update: {
        isEnabled: input.isEnabled,
        baseFeeCents: input.baseFeeCents,
        minimumOrderCents: input.minimumOrderCents,
        shellMaterialPercent: input.shellMaterialPercent,
        draftMultiplierPercent: input.draftMultiplierPercent,
        standardMultiplierPercent: input.standardMultiplierPercent,
        fineMultiplierPercent: input.fineMultiplierPercent,
        rawFinishFeeCents: input.rawFinishFeeCents,
        supportRemovalFeeCents: input.supportRemovalFeeCents,
        sandingFeeCents: input.sandingFeeCents,
        primerFeeCents: input.primerFeeCents,
        paintingFeeCents: input.paintingFeeCents,
        draftLeadDays: input.draftLeadDays,
        standardLeadDays: input.standardLeadDays,
        fineLeadDays: input.fineLeadDays,
        maxFileSizeMb: input.maxFileSizeMb,
        maxFilesPerOrder: input.maxFilesPerOrder,
      },
    });

    const retainedIds: string[] = [];
    for (const material of input.materials) {
      const values = {
        code: material.code,
        name: material.name,
        densityGramsPerCm3: material.densityGramsPerCm3,
        pricePerGramCents: material.pricePerGramCents,
        colors: Array.from(new Set(material.colors)),
        isActive: material.isActive,
        sortOrder: material.sortOrder,
      };
      const saved = material.id
        ? await tx.printMaterial.update({
            where: { id: material.id },
            data: values,
          })
        : await tx.printMaterial.upsert({
            where: { code: material.code },
            create: { ...values, pricingSettingId: 1 },
            update: values,
          });
      retainedIds.push(saved.id);
    }

    await tx.printMaterial.updateMany({
      where: { pricingSettingId: 1, id: { notIn: retainedIds } },
      data: { isActive: false },
    });
  });

  return getPrintPricingSettings(true);
}

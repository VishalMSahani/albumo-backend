ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'THREE_D_PRINT';

CREATE TYPE "PrintModelFormat" AS ENUM ('STL', 'OBJ');
CREATE TYPE "PrintStorageProvider" AS ENUM ('AZURE', 'LOCAL');
CREATE TYPE "PrintQuality" AS ENUM ('DRAFT', 'STANDARD', 'FINE');
CREATE TYPE "PrintFinish" AS ENUM ('RAW', 'SUPPORT_REMOVAL', 'SANDED', 'PRIMED', 'PAINTED');
CREATE TYPE "PrintOrderStatus" AS ENUM (
    'PAYMENT_PENDING',
    'PAID',
    'UNDER_REVIEW',
    'APPROVED',
    'PRINTING',
    'POST_PROCESSING',
    'QUALITY_CHECK',
    'PACKED',
    'SHIPPED',
    'DELIVERED',
    'ON_HOLD',
    'CANCELLED',
    'REFUNDED'
);

CREATE TABLE "PrintPricingSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "baseFeeCents" INTEGER NOT NULL DEFAULT 9900,
    "minimumOrderCents" INTEGER NOT NULL DEFAULT 24900,
    "shellMaterialPercent" INTEGER NOT NULL DEFAULT 20,
    "draftMultiplierPercent" INTEGER NOT NULL DEFAULT 90,
    "standardMultiplierPercent" INTEGER NOT NULL DEFAULT 100,
    "fineMultiplierPercent" INTEGER NOT NULL DEFAULT 135,
    "rawFinishFeeCents" INTEGER NOT NULL DEFAULT 0,
    "supportRemovalFeeCents" INTEGER NOT NULL DEFAULT 0,
    "sandingFeeCents" INTEGER NOT NULL DEFAULT 9900,
    "primerFeeCents" INTEGER NOT NULL DEFAULT 14900,
    "paintingFeeCents" INTEGER NOT NULL DEFAULT 24900,
    "draftLeadDays" INTEGER NOT NULL DEFAULT 3,
    "standardLeadDays" INTEGER NOT NULL DEFAULT 5,
    "fineLeadDays" INTEGER NOT NULL DEFAULT 7,
    "maxFileSizeMb" INTEGER NOT NULL DEFAULT 50,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintPricingSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrintMaterial" (
    "id" TEXT NOT NULL,
    "pricingSettingId" INTEGER NOT NULL DEFAULT 1,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "densityGramsPerCm3" DOUBLE PRECISION NOT NULL,
    "pricePerGramCents" INTEGER NOT NULL,
    "colors" TEXT[] NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PrintMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ThreeDPrintFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageProvider" "PrintStorageProvider" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "format" "PrintModelFormat" NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "volumeMm3" DOUBLE PRECISION NOT NULL,
    "widthMm" DOUBLE PRECISION NOT NULL,
    "heightMm" DOUBLE PRECISION NOT NULL,
    "depthMm" DOUBLE PRECISION NOT NULL,
    "triangleCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreeDPrintFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ThreeDPrintOrder" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelFileId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "commerceOrderId" TEXT NOT NULL,
    "status" "PrintOrderStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "color" TEXT NOT NULL,
    "quality" "PrintQuality" NOT NULL,
    "finish" "PrintFinish" NOT NULL,
    "infillPercent" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitWeightGrams" DOUBLE PRECISION NOT NULL,
    "totalWeightGrams" DOUBLE PRECISION NOT NULL,
    "baseFeeCents" INTEGER NOT NULL,
    "materialCostCents" INTEGER NOT NULL,
    "qualityMarkupCents" INTEGER NOT NULL,
    "finishFeeCents" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL,
    "totalAmountCents" INTEGER NOT NULL,
    "estimatedDays" INTEGER NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "customerNotes" TEXT,
    "adminNotes" TEXT,
    "quotedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreeDPrintOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ThreeDPrintStatusEvent" (
    "id" TEXT NOT NULL,
    "printOrderId" TEXT NOT NULL,
    "status" "PrintOrderStatus" NOT NULL,
    "note" TEXT,
    "actorLabel" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreeDPrintStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrintMaterial_code_key" ON "PrintMaterial"("code");
CREATE INDEX "PrintMaterial_pricingSettingId_sortOrder_idx" ON "PrintMaterial"("pricingSettingId", "sortOrder");
CREATE INDEX "PrintMaterial_isActive_idx" ON "PrintMaterial"("isActive");
CREATE UNIQUE INDEX "ThreeDPrintFile_storageKey_key" ON "ThreeDPrintFile"("storageKey");
CREATE INDEX "ThreeDPrintFile_userId_createdAt_idx" ON "ThreeDPrintFile"("userId", "createdAt");
CREATE INDEX "ThreeDPrintFile_checksumSha256_idx" ON "ThreeDPrintFile"("checksumSha256");
CREATE UNIQUE INDEX "ThreeDPrintOrder_reference_key" ON "ThreeDPrintOrder"("reference");
CREATE UNIQUE INDEX "ThreeDPrintOrder_modelFileId_key" ON "ThreeDPrintOrder"("modelFileId");
CREATE UNIQUE INDEX "ThreeDPrintOrder_commerceOrderId_key" ON "ThreeDPrintOrder"("commerceOrderId");
CREATE INDEX "ThreeDPrintOrder_userId_createdAt_idx" ON "ThreeDPrintOrder"("userId", "createdAt");
CREATE INDEX "ThreeDPrintOrder_status_idx" ON "ThreeDPrintOrder"("status");
CREATE INDEX "ThreeDPrintOrder_materialId_idx" ON "ThreeDPrintOrder"("materialId");
CREATE INDEX "ThreeDPrintStatusEvent_printOrderId_createdAt_idx" ON "ThreeDPrintStatusEvent"("printOrderId", "createdAt");

ALTER TABLE "PrintMaterial"
ADD CONSTRAINT "PrintMaterial_pricingSettingId_fkey"
FOREIGN KEY ("pricingSettingId") REFERENCES "PrintPricingSetting"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreeDPrintFile"
ADD CONSTRAINT "ThreeDPrintFile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreeDPrintOrder"
ADD CONSTRAINT "ThreeDPrintOrder_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreeDPrintOrder"
ADD CONSTRAINT "ThreeDPrintOrder_modelFileId_fkey"
FOREIGN KEY ("modelFileId") REFERENCES "ThreeDPrintFile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ThreeDPrintOrder"
ADD CONSTRAINT "ThreeDPrintOrder_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "PrintMaterial"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ThreeDPrintOrder"
ADD CONSTRAINT "ThreeDPrintOrder_commerceOrderId_fkey"
FOREIGN KEY ("commerceOrderId") REFERENCES "Order"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ThreeDPrintStatusEvent"
ADD CONSTRAINT "ThreeDPrintStatusEvent_printOrderId_fkey"
FOREIGN KEY ("printOrderId") REFERENCES "ThreeDPrintOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PrintPricingSetting" ("id") VALUES (1)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "PrintMaterial" (
    "id",
    "pricingSettingId",
    "code",
    "name",
    "densityGramsPerCm3",
    "pricePerGramCents",
    "colors",
    "isActive",
    "sortOrder"
) VALUES
    ('print-material-pla', 1, 'PLA', 'PLA', 1.24, 600, ARRAY['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Grey'], true, 0),
    ('print-material-petg', 1, 'PETG', 'PETG', 1.27, 750, ARRAY['Black', 'White', 'Clear', 'Red', 'Blue', 'Grey'], true, 1),
    ('print-material-abs', 1, 'ABS', 'ABS', 1.04, 700, ARRAY['Black', 'White', 'Red', 'Blue', 'Grey'], true, 2),
    ('print-material-tpu', 1, 'TPU', 'Flexible TPU', 1.21, 950, ARRAY['Black', 'White', 'Red', 'Blue'], true, 3)
ON CONFLICT ("code") DO NOTHING;

ALTER TYPE "EmailEventType" ADD VALUE 'BULK_ORDER_UPDATED';
ALTER TYPE "BulkOrderStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "BulkOrderStatus" ADD VALUE 'DECLINED';
ALTER TYPE "BulkOrderStatus" ADD VALUE 'IN_FULFILLMENT';
ALTER TABLE "BulkOrderRequest"
ADD COLUMN "reference" TEXT, ADD COLUMN "requestKey" TEXT, ADD COLUMN "accessKeyHash" TEXT,
ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "postalCode" TEXT,
ADD COLUMN "deliveryAddress" TEXT, ADD COLUMN "gstin" TEXT, ADD COLUMN "timeline" TEXT,
ADD COLUMN "consentAt" TIMESTAMPTZ(6), ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "BulkOrderRequest_reference_key" ON "BulkOrderRequest"("reference");
CREATE UNIQUE INDEX "BulkOrderRequest_requestKey_key" ON "BulkOrderRequest"("requestKey");
CREATE TABLE "BulkOrderQuote" (
  "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "BulkOrderRequest"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL, "items" JSONB NOT NULL, "subtotalCents" INTEGER NOT NULL,
  "taxCents" INTEGER NOT NULL, "shippingCents" INTEGER NOT NULL, "totalCents" INTEGER NOT NULL,
  "validUntil" TIMESTAMPTZ(6) NOT NULL, "leadTime" TEXT NOT NULL, "terms" TEXT NOT NULL,
  "decision" TEXT, "decidedAt" TIMESTAMPTZ(6), "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BulkOrderQuote_requestId_version_key" ON "BulkOrderQuote"("requestId", "version");
CREATE TABLE "BulkOrderMessage" (
  "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "BulkOrderRequest"("id") ON DELETE CASCADE,
  "sender" TEXT NOT NULL, "body" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BulkOrderMessage_requestId_createdAt_idx" ON "BulkOrderMessage"("requestId", "createdAt");

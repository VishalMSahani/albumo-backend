ALTER TABLE "PrintPricingSetting"
ADD COLUMN "maxFilesPerOrder" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "ThreeDPrintFile"
ADD COLUMN "orderId" TEXT,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "ThreeDPrintFile" AS file
SET "orderId" = print_order."id"
FROM "ThreeDPrintOrder" AS print_order
WHERE print_order."modelFileId" = file."id";

ALTER TABLE "ThreeDPrintOrder"
DROP CONSTRAINT "ThreeDPrintOrder_modelFileId_fkey";

DROP INDEX "ThreeDPrintOrder_modelFileId_key";

ALTER TABLE "ThreeDPrintOrder"
DROP COLUMN "modelFileId";

CREATE INDEX "ThreeDPrintFile_orderId_sortOrder_idx"
ON "ThreeDPrintFile"("orderId", "sortOrder");

ALTER TABLE "ThreeDPrintFile"
ADD CONSTRAINT "ThreeDPrintFile_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "ThreeDPrintOrder"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

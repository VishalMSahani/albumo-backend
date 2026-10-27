ALTER TYPE "PrintStorageProvider" ADD VALUE IF NOT EXISTS 'R2';

CREATE TABLE "StagedUpload" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT,
  "path" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "contentType" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StagedUpload_expiresAt_idx" ON "StagedUpload"("expiresAt");

ALTER TABLE "StudioProject" ADD COLUMN "productId" TEXT,
ADD COLUMN "configuration" JSONB, ADD COLUMN "pageCount" INTEGER,
ADD COLUMN "minimumPhotos" INTEGER, ADD COLUMN "recommendedPhotos" INTEGER,
ADD COLUMN "document" JSONB;
CREATE TABLE "StudioInvite" (
 "id" UUID PRIMARY KEY, "projectId" UUID NOT NULL REFERENCES "StudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "tokenHash" VARCHAR(64) NOT NULL UNIQUE, "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "revokedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StudioInvite_projectId_idx" ON "StudioInvite"("projectId");
CREATE TABLE "StudioGuestSession" (
 "id" UUID PRIMARY KEY, "inviteId" UUID NOT NULL REFERENCES "StudioInvite"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "tokenHash" VARCHAR(64) NOT NULL UNIQUE, "displayName" VARCHAR(80) NOT NULL,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StudioGuestSession_inviteId_idx" ON "StudioGuestSession"("inviteId");
CREATE TABLE "StudioAsset" (
 "id" UUID PRIMARY KEY, "projectId" UUID NOT NULL REFERENCES "StudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "guestId" UUID REFERENCES "StudioGuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestId" UUID NOT NULL, "uploaderKey" VARCHAR(100) NOT NULL,
 "filename" VARCHAR(180) NOT NULL, "mimeType" VARCHAR(40) NOT NULL, "byteSize" INTEGER NOT NULL CHECK ("byteSize" BETWEEN 1 AND 15728640),
 "status" VARCHAR(20) NOT NULL DEFAULT 'UPLOADING' CHECK ("status" IN ('UPLOADING','PROCESSING','READY','FAILED','CANCELLED')),
 "selected" BOOLEAN NOT NULL DEFAULT true, "stagingKey" TEXT NOT NULL UNIQUE,
 "originalKey" TEXT, "previewKey" TEXT, "checksum" VARCHAR(64), "width" INTEGER, "height" INTEGER,
 "errorCode" VARCHAR(50), "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "leaseUntil" TIMESTAMPTZ(3), "leaseToken" UUID, "attempts" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "StudioAsset_projectId_uploaderKey_requestId_key" ON "StudioAsset"("projectId", "uploaderKey", "requestId");
CREATE INDEX "StudioAsset_projectId_createdAt_id_idx" ON "StudioAsset"("projectId", "createdAt", "id");
CREATE INDEX "StudioAsset_status_leaseUntil_idx" ON "StudioAsset"("status", "leaseUntil");

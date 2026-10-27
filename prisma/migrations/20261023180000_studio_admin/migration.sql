ALTER TABLE "StudioProject"
  ADD COLUMN "reviewStatus" VARCHAR(24) NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN "reviewRevision" INTEGER,
  ADD COLUMN "reviewNote" VARCHAR(1000),
  ADD COLUMN "reviewedAt" TIMESTAMPTZ(3);

CREATE TABLE "StudioActivity" (
  "id" UUID PRIMARY KEY,
  "projectId" UUID NOT NULL REFERENCES "StudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" TEXT NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "note" VARCHAR(1000) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StudioActivity_projectId_createdAt_id_idx" ON "StudioActivity"("projectId", "createdAt", "id");

CREATE TABLE "StudioOrderLink" (
  "id" UUID PRIMARY KEY,
  "projectId" UUID NOT NULL REFERENCES "StudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderItemId" TEXT NOT NULL REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StudioOrderLink_orderItemId_key" ON "StudioOrderLink"("orderItemId");
CREATE INDEX "StudioOrderLink_projectId_idx" ON "StudioOrderLink"("projectId");

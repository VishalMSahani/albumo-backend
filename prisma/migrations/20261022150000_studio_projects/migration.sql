-- Additive only: no changes to inherited Project, catalogue, cart or order data.
CREATE TABLE "StudioProject" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "occasion" VARCHAR(24) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),
    "requestId" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "StudioProject_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudioProject_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "StudioProject_title_check" CHECK (length(trim("title")) > 0),
    CONSTRAINT "StudioProject_occasion_check" CHECK ("occasion" IN ('EVERYDAY', 'FAMILY', 'TRAVEL', 'CELEBRATION', 'OTHER'))
);
CREATE UNIQUE INDEX "StudioProject_ownerId_requestId_key" ON "StudioProject"("ownerId", "requestId");
CREATE INDEX "StudioProject_ownerId_archivedAt_createdAt_id_idx" ON "StudioProject"("ownerId", "archivedAt", "createdAt", "id");
ALTER TABLE "StudioProject" ADD CONSTRAINT "StudioProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

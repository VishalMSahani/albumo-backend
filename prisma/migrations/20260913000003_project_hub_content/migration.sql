-- Media columns were introduced by 20251211212726_add_project_media_fields.
ALTER TABLE "Project"
  ADD COLUMN "costEstimateMinCents" INTEGER,
  ADD COLUMN "costEstimateMaxCents" INTEGER,
  ADD COLUMN "heroImageUrl" TEXT,
  ADD COLUMN "heroVideoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "pdfUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "externalLinks" JSONB;

ALTER TABLE "ProjectComponent"
  ADD COLUMN "isOptional" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "note" TEXT;

CREATE TABLE "ProjectContentSection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sectionKey" TEXT NOT NULL,
  "heading" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "diagramUrl" TEXT,
  "code" TEXT,
  "repoUrl" TEXT,
  "steps" JSONB,
  "faqs" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ProjectContentSection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectContentSection_projectId_sectionKey_key"
  ON "ProjectContentSection"("projectId", "sectionKey");
CREATE INDEX "ProjectContentSection_projectId_sortOrder_idx"
  ON "ProjectContentSection"("projectId", "sortOrder");
ALTER TABLE "ProjectContentSection"
  ADD CONSTRAINT "ProjectContentSection_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
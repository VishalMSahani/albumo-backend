-- Complete the existing catalogue/media models without dropping inherited columns.
BEGIN;
ALTER TABLE "Component"
  ADD COLUMN IF NOT EXISTS "slug" TEXT,
  ADD COLUMN IF NOT EXISTS "discountedPriceCents" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Component_slug_key" ON "Component"("slug");
CREATE INDEX IF NOT EXISTS "Component_slug_idx" ON "Component"("slug");
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS "Project_deletedAt_idx" ON "Project"("deletedAt");
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
COMMIT;

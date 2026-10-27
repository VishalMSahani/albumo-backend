ALTER TABLE "StudioProject" ADD COLUMN "trashedAt" TIMESTAMPTZ(3), ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
CREATE INDEX "StudioProject_trashedAt_deletedAt_idx" ON "StudioProject"("trashedAt", "deletedAt");

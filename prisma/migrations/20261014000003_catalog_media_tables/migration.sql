-- These models existed in the copied Prisma schema but had no creation migration.
-- Add their tables so Albumo category images and uploaded media can be persisted.
BEGIN;
DO $$ BEGIN
  CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Category" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_key" ON "Category"("name");
CREATE INDEX IF NOT EXISTS "Category_isActive_idx" ON "Category"("isActive");

CREATE TABLE IF NOT EXISTS "Subcategory" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "Subcategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Subcategory_categoryId_name_key" ON "Subcategory"("categoryId", "name");
CREATE INDEX IF NOT EXISTS "Subcategory_categoryId_idx" ON "Subcategory"("categoryId");
CREATE INDEX IF NOT EXISTS "Subcategory_isActive_idx" ON "Subcategory"("isActive");
DO $$ BEGIN
  ALTER TABLE "Subcategory" ADD CONSTRAINT "Subcategory_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ProductMedia" (
  "id" TEXT NOT NULL,
  "componentId" TEXT NOT NULL,
  "type" "MediaType" NOT NULL DEFAULT 'IMAGE',
  "url" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProductMedia_componentId_idx" ON "ProductMedia"("componentId");
DO $$ BEGIN
  ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_componentId_fkey"
    FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MediaLibrary" (
  "id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaLibrary_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MediaLibrary_url_key" ON "MediaLibrary"("url");
CREATE INDEX IF NOT EXISTS "MediaLibrary_createdAt_idx" ON "MediaLibrary"("createdAt");
COMMIT;

-- The original partner feature had a Prisma model but no creation migration.
-- Preserve installations where the base table was created with db push.
DO $$ BEGIN
  CREATE TYPE "PartnerType" AS ENUM ('TRAVEL_AGENCY', 'PHOTOGRAPHER', 'WEDDING_PLANNER', 'CORPORATE_EVENTS', 'REAL_ESTATE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "PartnerInquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'IN_DISCUSSION', 'ONBOARDED', 'DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PartnerInquiry" (
  "id" TEXT NOT NULL,
  "partnerType" "PartnerType" NOT NULL,
  "status" "PartnerInquiryStatus" NOT NULL DEFAULT 'NEW',
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "companyName" TEXT,
  "website" TEXT,
  "city" TEXT,
  "message" TEXT NOT NULL,
  "expectedVolume" TEXT,
  "adminNotes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PartnerInquiry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PartnerInquiry"
  ADD COLUMN "contactConsentAt" TIMESTAMPTZ(6),
  ADD COLUMN "directoryConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "directoryConsentAt" TIMESTAMPTZ(6),
  ADD COLUMN "publicName" TEXT,
  ADD COLUMN "publicDescription" TEXT,
  ADD COLUMN "publicCity" TEXT,
  ADD COLUMN "publicWebsite" TEXT,
  ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "PartnerInquiry_partnerType_idx" ON "PartnerInquiry"("partnerType");
CREATE INDEX IF NOT EXISTS "PartnerInquiry_status_idx" ON "PartnerInquiry"("status");
CREATE INDEX IF NOT EXISTS "PartnerInquiry_createdAt_idx" ON "PartnerInquiry"("createdAt");
CREATE INDEX "PartnerInquiry_isPublished_partnerType_idx" ON "PartnerInquiry"("isPublished", "partnerType");

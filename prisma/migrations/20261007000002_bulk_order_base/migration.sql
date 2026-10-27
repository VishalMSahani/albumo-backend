-- The quotation migration extends this table, but its original creation was
-- missing from the copied history. Preserve databases that already have it.
DO $$ BEGIN
  CREATE TYPE "BulkOrderStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'QUOTED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BulkOrderRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "companyName" TEXT,
  "csvFileUrl" TEXT,
  "notes" TEXT,
  "status" "BulkOrderStatus" NOT NULL DEFAULT 'SUBMITTED',
  "adminNotes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "BulkOrderRequest_userId_idx" ON "BulkOrderRequest"("userId");
CREATE INDEX IF NOT EXISTS "BulkOrderRequest_status_idx" ON "BulkOrderRequest"("status");

-- CreateEnum
CREATE TYPE "PcbQuoteStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'QUOTED', 'ACCEPTED', 'IN_PRODUCTION', 'SHIPPED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PcbQuoteRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "boardLayers" INTEGER NOT NULL,
    "boardSizeX" DOUBLE PRECISION NOT NULL,
    "boardSizeY" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL,
    "surfaceFinish" TEXT NOT NULL,
    "copperWeight" TEXT NOT NULL,
    "gerberFileUrl" TEXT,
    "notes" TEXT,
    "status" "PcbQuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
    "quotedPricePaise" INTEGER,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PcbQuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PcbQuoteRequest_userId_idx" ON "PcbQuoteRequest"("userId");
CREATE INDEX "PcbQuoteRequest_status_idx" ON "PcbQuoteRequest"("status");

-- AddForeignKey
ALTER TABLE "PcbQuoteRequest" ADD CONSTRAINT "PcbQuoteRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

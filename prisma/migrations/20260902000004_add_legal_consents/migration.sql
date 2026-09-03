CREATE TYPE "ConsentType" AS ENUM ('TERMS_AND_PRIVACY', 'CHECKOUT_POLICIES', 'COOKIE_PREFERENCES');

CREATE TYPE "ConsentAction" AS ENUM ('GRANTED', 'UPDATED', 'WITHDRAWN');

CREATE TYPE "ConsentSource" AS ENUM ('REGISTRATION', 'LOGIN', 'OAUTH', 'CHECKOUT', 'THREE_D_PRINTING_CHECKOUT', 'COOKIE_BANNER', 'COOKIE_SETTINGS');

CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT,
    "anonymousId" TEXT,
    "type" "ConsentType" NOT NULL,
    "action" "ConsentAction" NOT NULL DEFAULT 'GRANTED',
    "source" "ConsentSource" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policyVersions" JSONB NOT NULL,
    "preferences" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsentRecord_userId_createdAt_idx" ON "ConsentRecord"("userId", "createdAt");
CREATE INDEX "ConsentRecord_orderId_idx" ON "ConsentRecord"("orderId");
CREATE INDEX "ConsentRecord_anonymousId_createdAt_idx" ON "ConsentRecord"("anonymousId", "createdAt");
CREATE INDEX "ConsentRecord_type_createdAt_idx" ON "ConsentRecord"("type", "createdAt");
CREATE INDEX "ConsentRecord_source_createdAt_idx" ON "ConsentRecord"("source", "createdAt");
CREATE INDEX "ConsentRecord_createdAt_idx" ON "ConsentRecord"("createdAt");

ALTER TABLE "ConsentRecord"
ADD CONSTRAINT "ConsentRecord_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConsentRecord"
ADD CONSTRAINT "ConsentRecord_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

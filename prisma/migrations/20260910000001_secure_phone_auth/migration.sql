ALTER TABLE "User" ADD COLUMN "phone" TEXT, ADD COLUMN "phoneVerifiedAt" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
ALTER TABLE "Session" ADD COLUMN "refreshVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rotatedAt" TIMESTAMPTZ(6), ADD COLUMN "revokedAt" TIMESTAMPTZ(6);
CREATE TABLE "AuthChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY, "phone" TEXT NOT NULL, "purpose" TEXT NOT NULL,
  "userId" TEXT, "codeHash" TEXT NOT NULL, "proofHash" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "deliveredAt" TIMESTAMPTZ(6), "verifiedAt" TIMESTAMPTZ(6), "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AuthChallenge_proofHash_key" ON "AuthChallenge"("proofHash");
CREATE INDEX "AuthChallenge_phone_purpose_createdAt_idx" ON "AuthChallenge"("phone", "purpose", "createdAt");
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");
CREATE TABLE "AuthThrottle" ("key" TEXT NOT NULL PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMPTZ(6) NOT NULL);
CREATE INDEX "AuthThrottle_expiresAt_idx" ON "AuthThrottle"("expiresAt");

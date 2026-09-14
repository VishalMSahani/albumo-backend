-- A phone entered while WhatsApp OTP is unavailable is remembered for later
-- verification, but is never treated as an authentication identifier.
ALTER TABLE "User" ADD COLUMN "pendingPhone" TEXT;
CREATE INDEX "User_pendingPhone_idx" ON "User"("pendingPhone");

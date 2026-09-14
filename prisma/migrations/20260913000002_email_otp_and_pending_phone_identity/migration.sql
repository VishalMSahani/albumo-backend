-- Email verification now uses a short-lived, attempt-limited OTP.
ALTER TABLE "User" ADD COLUMN "emailVerifyAttempts" INTEGER NOT NULL DEFAULT 0;

-- A pending phone is an account identifier and must never point at multiple users.
DROP INDEX IF EXISTS "User_pendingPhone_idx";
CREATE UNIQUE INDEX "User_pendingPhone_key" ON "User"("pendingPhone");

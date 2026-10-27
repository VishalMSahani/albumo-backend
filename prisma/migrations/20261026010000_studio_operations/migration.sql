ALTER TABLE "StudioProject" ADD COLUMN "proof" JSONB, ADD COLUMN "cleanupAttempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "cleanupLastAt" TIMESTAMPTZ(3), ADD COLUMN "cleanupError" VARCHAR(80);
ALTER TABLE "StudioOrderLink" ADD COLUMN "printApproval" JSONB;
CREATE TABLE "StudioOperationSetting" (
 "id" INTEGER NOT NULL DEFAULT 1 PRIMARY KEY, "revision" INTEGER NOT NULL DEFAULT 0, "policy" JSONB NOT NULL,
 "updatedBy" TEXT, "updatedAt" TIMESTAMPTZ(3) NOT NULL, "workerHeartbeatAt" TIMESTAMPTZ(3), "workerLastSuccessAt" TIMESTAMPTZ(3), "workerError" VARCHAR(80)
);
CREATE TABLE "StudioPolicyAudit" ("id" UUID PRIMARY KEY, "revision" INTEGER NOT NULL, "actorId" TEXT NOT NULL, "policy" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);

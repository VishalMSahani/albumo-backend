ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'ADMIN_NOTIFICATION';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'NEWSLETTER_WELCOME';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'MARKETING_CAMPAIGN';
ALTER TYPE "EmailEventType" ADD VALUE IF NOT EXISTS 'CUSTOM_EMAIL';

ALTER TABLE "EmailNotification"
 ADD COLUMN "text" TEXT,
 ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'TRANSACTIONAL',
 ADD COLUMN "status" TEXT NOT NULL DEFAULT 'QUEUED',
 ADD COLUMN "fromAddress" TEXT,
 ADD COLUMN "replyTo" TEXT,
 ADD COLUMN "headers" JSONB,
 ADD COLUMN "dedupeKey" TEXT,
 ADD COLUMN "providerMessageId" TEXT,
 ADD COLUMN "providerEventAt" TIMESTAMPTZ(6),
 ADD COLUMN "deliveredAt" TIMESTAMPTZ(6),
 ADD COLUMN "openedAt" TIMESTAMPTZ(6),
 ADD COLUMN "clickedAt" TIMESTAMPTZ(6),
 ADD COLUMN "lockedUntil" TIMESTAMPTZ(6),
 ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "firstAttemptAt" TIMESTAMPTZ(6),
 ADD COLUMN "campaignId" TEXT,
 ADD COLUMN "subscriberId" TEXT,
 ADD COLUMN "ticketId" TEXT;
UPDATE "EmailNotification" SET "status" = CASE WHEN "isSent" THEN 'SENT' WHEN "retryCount" >= "maxRetries" THEN 'FAILED' ELSE 'QUEUED' END;

CREATE TABLE "EmailCampaign" (
 "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "subject" TEXT NOT NULL,
 "body" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT',
 "queuedAt" TIMESTAMPTZ(6), "recipientCount" INTEGER NOT NULL DEFAULT 0, "createdById" TEXT,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL
);
CREATE TABLE "EmailSuppression" (
 "email" TEXT NOT NULL PRIMARY KEY, "reason" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "EmailWebhookEvent" (
 "id" TEXT NOT NULL PRIMARY KEY, "type" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "processedAt" TIMESTAMPTZ(6), "error" TEXT,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "InboundEmail" (
 "id" TEXT NOT NULL PRIMARY KEY, "providerId" TEXT NOT NULL, "fromEmail" TEXT NOT NULL,
 "fromName" TEXT NOT NULL DEFAULT '', "recipients" JSONB NOT NULL, "subject" TEXT NOT NULL,
 "text" TEXT NOT NULL, "messageId" TEXT, "attachments" JSONB NOT NULL DEFAULT '[]',
 "authenticated" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'NEW',
 "ticketId" TEXT, "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "EmailNotification_dedupeKey_key" ON "EmailNotification"("dedupeKey");
CREATE UNIQUE INDEX "EmailNotification_providerMessageId_key" ON "EmailNotification"("providerMessageId");
CREATE INDEX "EmailNotification_status_nextAttemptAt_idx" ON "EmailNotification"("status", "nextAttemptAt");
CREATE INDEX "EmailNotification_campaignId_idx" ON "EmailNotification"("campaignId");
CREATE INDEX "EmailWebhookEvent_processedAt_createdAt_idx" ON "EmailWebhookEvent"("processedAt", "createdAt");
CREATE UNIQUE INDEX "InboundEmail_providerId_key" ON "InboundEmail"("providerId");
CREATE INDEX "InboundEmail_status_receivedAt_idx" ON "InboundEmail"("status", "receivedAt");
ALTER TABLE "EmailNotification" ADD CONSTRAINT "EmailNotification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

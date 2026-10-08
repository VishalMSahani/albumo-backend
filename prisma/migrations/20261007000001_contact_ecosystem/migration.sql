ALTER TABLE "SupportTicket" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'SUPPORT', ADD COLUMN "enquiry" JSONB;
CREATE INDEX "SupportTicket_source_createdAt_idx" ON "SupportTicket"("source", "createdAt");
CREATE TABLE "ContactSetting" (
  "id" INTEGER NOT NULL DEFAULT 1 PRIMARY KEY,
  "email" TEXT NOT NULL DEFAULT '', "phone" TEXT NOT NULL DEFAULT '',
  "whatsapp" TEXT NOT NULL DEFAULT '', "hours" TEXT NOT NULL DEFAULT '',
  "newsletterEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL
);
CREATE TABLE "NewsletterSubscriber" (
  "id" TEXT NOT NULL PRIMARY KEY, "email" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'ACTIVE', 'UNSUBSCRIBED')),
  "source" TEXT NOT NULL, "consentVersion" TEXT NOT NULL,
  "consentAt" TIMESTAMPTZ(6) NOT NULL, "confirmedAt" TIMESTAMPTZ(6), "unsubscribedAt" TIMESTAMPTZ(6),
  "confirmTokenHash" TEXT, "confirmExpiresAt" TIMESTAMPTZ(6), "unsubscribeTokenHash" TEXT,
  "lastEmailAt" TIMESTAMPTZ(6), "deliveryError" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL
);
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
CREATE UNIQUE INDEX "NewsletterSubscriber_confirmTokenHash_key" ON "NewsletterSubscriber"("confirmTokenHash");
CREATE UNIQUE INDEX "NewsletterSubscriber_unsubscribeTokenHash_key" ON "NewsletterSubscriber"("unsubscribeTokenHash");
CREATE INDEX "NewsletterSubscriber_status_createdAt_idx" ON "NewsletterSubscriber"("status", "createdAt");

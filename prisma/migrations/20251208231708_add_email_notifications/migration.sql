-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('USER_SIGNUP', 'USER_EMAIL_VERIFICATION', 'PASSWORD_RESET', 'ORDER_CREATED', 'ORDER_PAID', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'MENTOR_SESSION_BOOKED', 'MENTOR_SESSION_REMINDER', 'AI_PROJECT_GENERATED', 'PROJECT_APPROVED', 'PAYMENT_FAILED', 'LOW_STOCK_ALERT');

-- CreateTable
CREATE TABLE "EmailNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "eventType" "EmailEventType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "isSent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMPTZ(6),
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "EmailNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailNotification_userId_idx" ON "EmailNotification"("userId");

-- CreateIndex
CREATE INDEX "EmailNotification_eventType_isSent_idx" ON "EmailNotification"("eventType", "isSent");

-- CreateIndex
CREATE INDEX "EmailNotification_createdAt_idx" ON "EmailNotification"("createdAt");

-- CreateIndex
CREATE INDEX "EmailNotification_isSent_retryCount_idx" ON "EmailNotification"("isSent", "retryCount");

-- AddForeignKey
ALTER TABLE "EmailNotification" ADD CONSTRAINT "EmailNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add RAZORPAY to PaymentGateway enum
ALTER TYPE "PaymentGateway" ADD VALUE IF NOT EXISTS 'RAZORPAY';

-- Add gatewayPaymentId column for Razorpay payment ID (distinct from order ID)
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "gatewayPaymentId" TEXT;

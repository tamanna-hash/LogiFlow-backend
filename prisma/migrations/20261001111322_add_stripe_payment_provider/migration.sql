-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('BKASH', 'STRIPE');

-- AlterTable: Add Stripe fields and provider column to payments
-- All new columns are nullable or have defaults, so existing rows are unaffected.
ALTER TABLE "payments"
  ADD COLUMN "provider"             "PaymentProvider" NOT NULL DEFAULT 'BKASH',
  ADD COLUMN "stripeSessionId"      TEXT,
  ADD COLUMN "stripePaymentIntent"  TEXT,
  ADD COLUMN "stripeWebhookEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripeSessionId_key" ON "payments"("stripeSessionId");

-- CreateIndex
CREATE INDEX "payments_provider_idx" ON "payments"("provider");

-- CreateIndex
CREATE INDEX "payments_stripeSessionId_idx" ON "payments"("stripeSessionId");

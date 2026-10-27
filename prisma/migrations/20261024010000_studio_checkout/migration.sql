CREATE TABLE "StudioCartItem" (
  "id" UUID PRIMARY KEY,
  "cartId" TEXT NOT NULL REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "projectId" UUID NOT NULL REFERENCES "StudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Component"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN 1 AND 100),
  "snapshot" JSONB NOT NULL,
  "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "StudioCartItem_cartId_projectId_key" ON "StudioCartItem"("cartId", "projectId");
CREATE INDEX "StudioCartItem_projectId_idx" ON "StudioCartItem"("projectId");

CREATE TABLE "CheckoutAttempt" (
  "id" UUID PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "requestId" UUID NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "summary" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CheckoutAttempt_orderId_key" ON "CheckoutAttempt"("orderId");
CREATE UNIQUE INDEX "CheckoutAttempt_userId_requestId_key" ON "CheckoutAttempt"("userId", "requestId");

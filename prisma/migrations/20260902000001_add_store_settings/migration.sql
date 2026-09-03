CREATE TABLE "StoreSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "deliveryFeeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 5000,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "StoreSetting" ("id", "deliveryFeeEnabled", "deliveryFeeCents")
VALUES (1, true, 5000)
ON CONFLICT ("id") DO NOTHING;

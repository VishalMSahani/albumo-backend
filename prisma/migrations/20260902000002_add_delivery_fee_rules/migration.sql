ALTER TABLE "StoreSetting"
ADD COLUMN "freeDeliveryThresholdCents" INTEGER NOT NULL DEFAULT 50000;

CREATE TABLE "DeliveryFeeRule" (
    "id" TEXT NOT NULL,
    "storeSettingId" INTEGER NOT NULL DEFAULT 1,
    "minOrderCents" INTEGER NOT NULL,
    "maxOrderCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryFeeRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryFeeRule_storeSettingId_sortOrder_idx"
ON "DeliveryFeeRule"("storeSettingId", "sortOrder");

ALTER TABLE "DeliveryFeeRule"
ADD CONSTRAINT "DeliveryFeeRule_storeSettingId_fkey"
FOREIGN KEY ("storeSettingId") REFERENCES "StoreSetting"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "DeliveryFeeRule" (
    "id",
    "storeSettingId",
    "minOrderCents",
    "maxOrderCents",
    "feeCents",
    "sortOrder"
)
SELECT
    'default-delivery-rule',
    1,
    0,
    "freeDeliveryThresholdCents",
    "deliveryFeeCents",
    0
FROM "StoreSetting"
WHERE "id" = 1
ON CONFLICT ("id") DO NOTHING;

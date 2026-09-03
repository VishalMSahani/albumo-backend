-- Expand Component into a broader electronics/product catalog while keeping
-- existing component, cart, order, and project BOM flows compatible.

CREATE TYPE "ComponentProductType" AS ENUM (
  'ELECTRONICS_COMPONENT',
  'MODULE',
  'SENSOR',
  'DEVELOPMENT_BOARD',
  'MOTOR_ACTUATOR',
  'POWER_BATTERY',
  'TOOL_EQUIPMENT',
  'COURSE_KIT',
  'BOOK',
  'SOFTWARE',
  'CUSTOM_PROJECT_SERVICE',
  'OTHER'
);

ALTER TABLE "Component"
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Electronics Components',
ADD COLUMN "subcategory" TEXT NOT NULL DEFAULT 'General',
ADD COLUMN "productType" "ComponentProductType" NOT NULL DEFAULT 'ELECTRONICS_COMPONENT',
ADD COLUMN "brand" TEXT,
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "isBestSeller" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isRobomaniacItem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isSoftware" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Component_category_subcategory_idx" ON "Component"("category", "subcategory");
CREATE INDEX "Component_productType_idx" ON "Component"("productType");
CREATE INDEX "Component_isBestSeller_idx" ON "Component"("isBestSeller");
CREATE INDEX "Component_isRobomaniacItem_idx" ON "Component"("isRobomaniacItem");

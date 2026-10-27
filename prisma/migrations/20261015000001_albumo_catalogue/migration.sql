-- Additive catalogue extension. Existing products and order references are preserved.
ALTER TABLE "Subcategory" ADD COLUMN "configuration" JSONB;
ALTER TABLE "Component" ADD COLUMN "subcategoryId" TEXT;
ALTER TABLE "Component" ADD COLUMN "configuration" JSONB;
UPDATE "Component" p SET "subcategoryId" = s.id
FROM "Subcategory" s JOIN "Category" c ON c.id = s."categoryId"
WHERE lower(p.category) = lower(c.name) AND lower(p.subcategory) = lower(s.name);
CREATE INDEX "Component_subcategoryId_idx" ON "Component"("subcategoryId");
ALTER TABLE "Component" ADD CONSTRAINT "Component_subcategoryId_fkey"
FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

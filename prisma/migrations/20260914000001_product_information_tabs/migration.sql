-- Optional product details. Existing descriptions and catalogue rows are preserved.
ALTER TABLE "Component"
ADD COLUMN "specifications" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "countryOfOrigin" TEXT,
ADD COLUMN "warranty" TEXT;

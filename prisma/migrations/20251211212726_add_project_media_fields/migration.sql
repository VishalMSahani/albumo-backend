-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "externalLinks" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pdfUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

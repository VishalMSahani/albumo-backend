/*
  Warnings:

  - Added the required column `category` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProjectCategory" AS ENUM ('IOT', 'ROBOTICS', 'DRONE', 'AUTOMATION', 'ENVIRONMENT', 'HEALTH', 'AGRICULTURE', 'SECURITY', 'EDUCATION', 'AUTOMOTIVE', 'SMART_HOME', 'ENERGY', 'WEARABLES', 'GAMING', 'MUSIC', 'COMMUNICATION', 'AI_ML', 'COMPUTER_VISION', 'OTHER');

-- CreateEnum
CREATE TYPE "StudentListingType" AS ENUM ('COMPONENT', 'PROJECT', 'KIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SOLD', 'REMOVED');

-- CreateEnum
CREATE TYPE "StudentOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_SECURED', 'SELLER_CONFIRMED', 'ITEM_SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "OrderType" ADD VALUE 'PRE_BUILT_PROJECT';

-- AlterEnum
ALTER TYPE "ProjectAssetType" ADD VALUE 'VIDEO';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "buildCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "category" "ProjectCategory" NOT NULL,
ADD COLUMN     "isAIGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "learningOutcomes" TEXT[],
ADD COLUMN     "preBuiltAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preBuiltImages" TEXT[],
ADD COLUMN     "preBuiltPriceCents" INTEGER,
ADD COLUMN     "preBuiltStock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "prerequisites" TEXT[],
ADD COLUMN     "publishedAt" TIMESTAMPTZ(6),
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "youtubeUrl" TEXT;

-- CreateIndex
CREATE INDEX "Project_category_idx" ON "Project"("category");

-- CreateIndex
CREATE INDEX "Project_isFeatured_idx" ON "Project"("isFeatured");

-- CreateIndex
CREATE INDEX "Project_isAIGenerated_idx" ON "Project"("isAIGenerated");

-- CreateIndex
CREATE INDEX "Project_publishedAt_idx" ON "Project"("publishedAt");

-- Pause the storefront review system until enabled by an administrator.
-- Existing reviews are retained and can be displayed again without data loss.
ALTER TABLE "StoreSetting" ADD COLUMN "productReviewsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Pre-checkout commerce and Studio tables for a disposable PostgreSQL fixture.
-- The actual checkout migration is applied on top in checkout.test.mjs.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'MENTOR', 'ADMIN', 'SUPER_ADMIN');

CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'GITHUB', 'EMAIL_PASSWORD');

CREATE TYPE "EmailEventType" AS ENUM ('ADMIN_NOTIFICATION', 'NEWSLETTER_WELCOME', 'MARKETING_CAMPAIGN', 'CUSTOM_EMAIL', 'BULK_ORDER_UPDATED', 'USER_SIGNUP', 'USER_EMAIL_VERIFICATION', 'PASSWORD_RESET', 'ORDER_CREATED', 'ORDER_PAID', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'MENTOR_SESSION_BOOKED', 'MENTOR_SESSION_REMINDER', 'AI_PROJECT_GENERATED', 'PROJECT_APPROVED', 'PAYMENT_FAILED', 'LOW_STOCK_ALERT', 'CART_ABANDONED', 'SUPPORT_TICKET_CREATED', 'SUPPORT_TICKET_UPDATED', 'SUPPORT_TICKET_REPLY');

CREATE TYPE "SupportTicketPriority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW');

CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED');

CREATE TYPE "SupportTicketCategory" AS ENUM ('ORDER', 'SHIPPING', 'RETURNS_REFUNDS', 'PRODUCT', 'TECHNICAL', 'OTHER');

CREATE TYPE "SupportMessageSender" AS ENUM ('CUSTOMER', 'SUPPORT', 'SYSTEM');

CREATE TYPE "KnowledgeBaseCategory" AS ENUM ('GENERAL', 'SHIPPING', 'RETURNS', 'PRODUCT', 'TROUBLESHOOTING');

CREATE TYPE "KnowledgeBaseStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TYPE "ProjectType" AS ENUM ('FEATURED', 'AI_GENERATED', 'CUSTOM');

CREATE TYPE "DifficultyLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

CREATE TYPE "ProjectCategory" AS ENUM ('IOT', 'ROBOTICS', 'DRONE', 'AUTOMATION', 'ENVIRONMENT', 'HEALTH', 'AGRICULTURE', 'SECURITY', 'EDUCATION', 'AUTOMOTIVE', 'SMART_HOME', 'ENERGY', 'WEARABLES', 'GAMING', 'MUSIC', 'COMMUNICATION', 'AI_ML', 'COMPUTER_VISION', 'OTHER');

CREATE TYPE "ProjectAssetType" AS ENUM ('CIRCUIT_DIAGRAM', 'BLOCK_DIAGRAM', 'IMAGE', 'CODE_ZIP', 'VIDEO', 'OTHER');

CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED', 'RETURNED', 'REFUND_INITIATED', 'REFUNDED', 'CANCELLED');

CREATE TYPE "OrderType" AS ENUM ('KIT_ONLY', 'PROJECT_KIT', 'COMPONENTS_ONLY', 'BUILT_PROJECT', 'PRE_BUILT_PROJECT', 'THREE_D_PRINT');

CREATE TYPE "OrderItemType" AS ENUM ('KIT', 'COMPONENT', 'SERVICE');

CREATE TYPE "PaymentGateway" AS ENUM ('PHONEPE', 'STRIPE', 'RAZORPAY', 'ZOHO', 'TEST');

CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'SUCCESS', 'FAILED', 'REFUNDED');

CREATE TYPE "ConsentType" AS ENUM ('TERMS_AND_PRIVACY', 'CHECKOUT_POLICIES', 'COOKIE_PREFERENCES');

CREATE TYPE "ConsentAction" AS ENUM ('GRANTED', 'UPDATED', 'WITHDRAWN');

CREATE TYPE "ConsentSource" AS ENUM ('REGISTRATION', 'LOGIN', 'OAUTH', 'CHECKOUT', 'THREE_D_PRINTING_CHECKOUT', 'COOKIE_BANNER', 'COOKIE_SETTINGS');

CREATE TYPE "PrintModelFormat" AS ENUM ('STL', 'OBJ');

CREATE TYPE "PrintStorageProvider" AS ENUM ('R2', 'AZURE', 'LOCAL');

CREATE TYPE "PrintQuality" AS ENUM ('DRAFT', 'STANDARD', 'FINE');

CREATE TYPE "PrintFinish" AS ENUM ('RAW', 'SUPPORT_REMOVAL', 'SANDED', 'PRIMED', 'PAINTED');

CREATE TYPE "PrintOrderStatus" AS ENUM ('PAYMENT_PENDING', 'PAID', 'UNDER_REVIEW', 'APPROVED', 'PRINTING', 'POST_PROCESSING', 'QUALITY_CHECK', 'PACKED', 'SHIPPED', 'DELIVERED', 'ON_HOLD', 'CANCELLED', 'REFUNDED');

CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FLAT', 'FREE_SHIPPING');

CREATE TYPE "AIGenerationStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'DISCARDED');

CREATE TYPE "MentorSessionStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

CREATE TYPE "MentorRole" AS ENUM ('PRIMARY', 'SECONDARY');

CREATE TYPE "FileType" AS ENUM ('PDF', 'IMAGE', 'CODE_ZIP', 'OTHER');

CREATE TYPE "StudentListingType" AS ENUM ('COMPONENT', 'PROJECT', 'KIT', 'OTHER');

CREATE TYPE "ItemCondition" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR');

CREATE TYPE "ListingStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SOLD', 'REMOVED');

CREATE TYPE "StudentOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_SECURED', 'SELLER_CONFIRMED', 'ITEM_SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED');

CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

CREATE TYPE "ComponentProductType" AS ENUM ('ELECTRONICS_COMPONENT', 'MODULE', 'SENSOR', 'DEVELOPMENT_BOARD', 'MOTOR_ACTUATOR', 'POWER_BATTERY', 'TOOL_EQUIPMENT', 'COURSE_KIT', 'BOOK', 'SOFTWARE', 'CUSTOM_PROJECT_SERVICE', 'OTHER');

CREATE TYPE "RagChunkSourceType" AS ENUM ('COMPONENT', 'PROJECT', 'FAQ', 'SHORT_POLICY');

CREATE TYPE "RagDocumentSourceType" AS ENUM ('MANUAL', 'DATASHEET', 'POLICY', 'TUTORIAL', 'PROJECT_REPORT', 'COURSE_MATERIAL');

CREATE TYPE "ComponentRelationType" AS ENUM ('COMPATIBLE_WITH', 'INCLUDES', 'UPGRADE_OF', 'FREQUENTLY_BOUGHT_WITH', 'REQUIRES');

CREATE TYPE "PcbQuoteStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'QUOTED', 'ACCEPTED', 'IN_PRODUCTION', 'SHIPPED', 'CANCELLED');

CREATE TYPE "BulkOrderStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'QUOTED', 'ACCEPTED', 'DECLINED', 'IN_FULFILLMENT', 'COMPLETED', 'CANCELLED');

CREATE TYPE "CareerApplicationStatus" AS ENUM ('APPLIED', 'UNDER_REVIEW', 'SHORTLISTED', 'REJECTED', 'HIRED');

CREATE TYPE "PartnerType" AS ENUM ('TRAVEL_AGENCY', 'PHOTOGRAPHER', 'WEDDING_PLANNER', 'CORPORATE_EVENTS', 'REAL_ESTATE', 'OTHER');

CREATE TYPE "PartnerInquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'IN_DISCUSSION', 'ONBOARDED', 'DECLINED');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "pendingPhone" TEXT,
    "phoneVerifiedAt" TIMESTAMPTZ(6),
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "college" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifyToken" TEXT,
    "emailVerifyExpiry" TIMESTAMP(3),
    "emailVerifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioProject" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "occasion" VARCHAR(24) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),
    "requestId" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "productId" TEXT,
    "configuration" JSONB,
    "pageCount" INTEGER,
    "minimumPhotos" INTEGER,
    "recommendedPhotos" INTEGER,
    "document" JSONB,
    "reviewStatus" VARCHAR(24) NOT NULL DEFAULT 'UNREVIEWED',
    "reviewRevision" INTEGER,
    "reviewNote" VARCHAR(1000),
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "StudioProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioActivity" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "note" VARCHAR(1000) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioOrderLink" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioOrderLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioInvite" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioGuestSession" (
    "id" UUID NOT NULL,
    "inviteId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioGuestSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioAsset" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "guestId" UUID,
    "requestId" UUID NOT NULL,
    "uploaderKey" VARCHAR(100) NOT NULL,
    "filename" VARCHAR(180) NOT NULL,
    "mimeType" VARCHAR(40) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'UPLOADING',
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "stagingKey" TEXT NOT NULL,
    "originalKey" TEXT,
    "previewKey" TEXT,
    "checksum" VARCHAR(64),
    "width" INTEGER,
    "height" INTEGER,
    "errorCode" VARCHAR(50),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "leaseUntil" TIMESTAMPTZ(3),
    "leaseToken" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudioAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Component" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "sku" TEXT,
    "description" TEXT,
    "typicalUseCase" TEXT,
    "specifications" JSONB NOT NULL DEFAULT '[]',
    "countryOfOrigin" TEXT,
    "warranty" TEXT,
    "vendorLink" TEXT,
    "imageUrl" TEXT,
    "subcategoryId" TEXT,
    "configuration" JSONB,
    "category" TEXT NOT NULL DEFAULT 'Electronics Components',
    "subcategory" TEXT NOT NULL DEFAULT 'General',
    "productType" "ComponentProductType" NOT NULL DEFAULT 'ELECTRONICS_COMPONENT',
    "brand" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isBestSeller" BOOLEAN NOT NULL DEFAULT false,
    "isRobomaniacItem" BOOLEAN NOT NULL DEFAULT false,
    "isSoftware" BOOLEAN NOT NULL DEFAULT false,
    "unitPriceCents" INTEGER NOT NULL,
    "discountedPriceCents" INTEGER,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "totalAmountCents" INTEGER NOT NULL,
    "projectId" TEXT,
    "couponId" TEXT,
    "notes" TEXT,
    "trackingAwb" TEXT,
    "trackingUrl" TEXT,
    "shippedAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemType" "OrderItemType" NOT NULL,
    "kitId" TEXT,
    "componentId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'PHONEPE',
    "gatewayOrderId" TEXT,
    "gatewayTransactionId" TEXT,
    "gatewayPaymentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "addedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "minOrderCents" INTEGER NOT NULL DEFAULT 0,
    "maxUsageCount" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER,
    "allowedEmail" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "productReviewsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryFeeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryFeeCents" INTEGER NOT NULL DEFAULT 5000,
    "freeDeliveryThresholdCents" INTEGER NOT NULL DEFAULT 50000,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryFeeRule" (
    "id" TEXT NOT NULL,
    "storeSettingId" INTEGER NOT NULL DEFAULT 1,
    "minOrderCents" INTEGER NOT NULL,
    "maxOrderCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryFeeRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ThreeDPrintOrder" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "commerceOrderId" TEXT NOT NULL,
    "status" "PrintOrderStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "color" TEXT NOT NULL,
    "quality" "PrintQuality" NOT NULL,
    "finish" "PrintFinish" NOT NULL,
    "infillPercent" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitWeightGrams" DOUBLE PRECISION NOT NULL,
    "totalWeightGrams" DOUBLE PRECISION NOT NULL,
    "baseFeeCents" INTEGER NOT NULL,
    "materialCostCents" INTEGER NOT NULL,
    "qualityMarkupCents" INTEGER NOT NULL,
    "finishFeeCents" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL,
    "totalAmountCents" INTEGER NOT NULL,
    "estimatedDays" INTEGER NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "customerNotes" TEXT,
    "adminNotes" TEXT,
    "quotedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ThreeDPrintOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ThreeDPrintStatusEvent" (
    "id" TEXT NOT NULL,
    "printOrderId" TEXT NOT NULL,
    "status" "PrintOrderStatus" NOT NULL,
    "note" TEXT,
    "actorLabel" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreeDPrintStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT,
    "anonymousId" TEXT,
    "type" "ConsentType" NOT NULL,
    "action" "ConsentAction" NOT NULL DEFAULT 'GRANTED',
    "source" "ConsentSource" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "policyVersions" JSONB NOT NULL,
    "preferences" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

CREATE UNIQUE INDEX "User_pendingPhone_key" ON "User"("pendingPhone");

CREATE UNIQUE INDEX "User_emailVerifyToken_key" ON "User"("emailVerifyToken");

CREATE INDEX "StudioProject_ownerId_archivedAt_createdAt_id_idx" ON "StudioProject"("ownerId", "archivedAt", "createdAt", "id");

CREATE UNIQUE INDEX "StudioProject_ownerId_requestId_key" ON "StudioProject"("ownerId", "requestId");

CREATE INDEX "StudioActivity_projectId_createdAt_id_idx" ON "StudioActivity"("projectId", "createdAt", "id");

CREATE UNIQUE INDEX "StudioOrderLink_orderItemId_key" ON "StudioOrderLink"("orderItemId");

CREATE INDEX "StudioOrderLink_projectId_idx" ON "StudioOrderLink"("projectId");

CREATE UNIQUE INDEX "StudioInvite_tokenHash_key" ON "StudioInvite"("tokenHash");

CREATE INDEX "StudioInvite_projectId_idx" ON "StudioInvite"("projectId");

CREATE UNIQUE INDEX "StudioGuestSession_tokenHash_key" ON "StudioGuestSession"("tokenHash");

CREATE INDEX "StudioGuestSession_inviteId_idx" ON "StudioGuestSession"("inviteId");

CREATE UNIQUE INDEX "StudioAsset_stagingKey_key" ON "StudioAsset"("stagingKey");

CREATE INDEX "StudioAsset_projectId_createdAt_id_idx" ON "StudioAsset"("projectId", "createdAt", "id");

CREATE INDEX "StudioAsset_status_leaseUntil_idx" ON "StudioAsset"("status", "leaseUntil");

CREATE UNIQUE INDEX "StudioAsset_projectId_uploaderKey_requestId_key" ON "StudioAsset"("projectId", "uploaderKey", "requestId");

CREATE UNIQUE INDEX "Component_slug_key" ON "Component"("slug");

CREATE UNIQUE INDEX "Component_sku_key" ON "Component"("sku");

CREATE INDEX "Component_slug_idx" ON "Component"("slug");

CREATE INDEX "Component_isActive_idx" ON "Component"("isActive");

CREATE INDEX "Component_subcategoryId_idx" ON "Component"("subcategoryId");

CREATE INDEX "Component_category_subcategory_idx" ON "Component"("category", "subcategory");

CREATE INDEX "Component_productType_idx" ON "Component"("productType");

CREATE INDEX "Component_isBestSeller_idx" ON "Component"("isBestSeller");

CREATE INDEX "Component_isRobomaniacItem_idx" ON "Component"("isRobomaniacItem");

CREATE INDEX "Component_sku_idx" ON "Component"("sku");

CREATE INDEX "Address_userId_idx" ON "Address"("userId");

CREATE INDEX "Order_userId_idx" ON "Order"("userId");

CREATE INDEX "Order_status_idx" ON "Order"("status");

CREATE INDEX "Order_projectId_idx" ON "Order"("projectId");

CREATE INDEX "Order_couponId_idx" ON "Order"("couponId");

CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

CREATE INDEX "OrderItem_kitId_idx" ON "OrderItem"("kitId");

CREATE INDEX "OrderItem_componentId_idx" ON "OrderItem"("componentId");

CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

CREATE INDEX "Payment_status_idx" ON "Payment"("status");

CREATE INDEX "Payment_gatewayTransactionId_idx" ON "Payment"("gatewayTransactionId");

CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

CREATE UNIQUE INDEX "CartItem_cartId_componentId_key" ON "CartItem"("cartId", "componentId");

CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

CREATE INDEX "DeliveryFeeRule_storeSettingId_sortOrder_idx" ON "DeliveryFeeRule"("storeSettingId", "sortOrder");

CREATE UNIQUE INDEX "ThreeDPrintOrder_reference_key" ON "ThreeDPrintOrder"("reference");

CREATE UNIQUE INDEX "ThreeDPrintOrder_commerceOrderId_key" ON "ThreeDPrintOrder"("commerceOrderId");

CREATE INDEX "ThreeDPrintOrder_userId_createdAt_idx" ON "ThreeDPrintOrder"("userId", "createdAt");

CREATE INDEX "ThreeDPrintOrder_status_idx" ON "ThreeDPrintOrder"("status");

CREATE INDEX "ThreeDPrintOrder_materialId_idx" ON "ThreeDPrintOrder"("materialId");

CREATE INDEX "ThreeDPrintStatusEvent_printOrderId_createdAt_idx" ON "ThreeDPrintStatusEvent"("printOrderId", "createdAt");

CREATE INDEX "ConsentRecord_userId_createdAt_idx" ON "ConsentRecord"("userId", "createdAt");

CREATE INDEX "ConsentRecord_orderId_idx" ON "ConsentRecord"("orderId");

CREATE INDEX "ConsentRecord_anonymousId_createdAt_idx" ON "ConsentRecord"("anonymousId", "createdAt");

CREATE INDEX "ConsentRecord_type_createdAt_idx" ON "ConsentRecord"("type", "createdAt");

CREATE INDEX "ConsentRecord_source_createdAt_idx" ON "ConsentRecord"("source", "createdAt");

CREATE INDEX "ConsentRecord_createdAt_idx" ON "ConsentRecord"("createdAt");

ALTER TABLE "StudioProject" ADD CONSTRAINT "StudioProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudioActivity" ADD CONSTRAINT "StudioActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudioOrderLink" ADD CONSTRAINT "StudioOrderLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudioOrderLink" ADD CONSTRAINT "StudioOrderLink_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudioInvite" ADD CONSTRAINT "StudioInvite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudioGuestSession" ADD CONSTRAINT "StudioGuestSession_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "StudioInvite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudioAsset" ADD CONSTRAINT "StudioAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StudioProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudioAsset" ADD CONSTRAINT "StudioAsset_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "StudioGuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD CONSTRAINT "Order_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryFeeRule" ADD CONSTRAINT "DeliveryFeeRule_storeSettingId_fkey" FOREIGN KEY ("storeSettingId") REFERENCES "StoreSetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreeDPrintOrder" ADD CONSTRAINT "ThreeDPrintOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ThreeDPrintOrder" ADD CONSTRAINT "ThreeDPrintOrder_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ThreeDPrintStatusEvent" ADD CONSTRAINT "ThreeDPrintStatusEvent_printOrderId_fkey" FOREIGN KEY ("printOrderId") REFERENCES "ThreeDPrintOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
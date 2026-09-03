ALTER TYPE "EmailEventType" ADD VALUE 'SUPPORT_TICKET_CREATED';
ALTER TYPE "EmailEventType" ADD VALUE 'SUPPORT_TICKET_UPDATED';
ALTER TYPE "EmailEventType" ADD VALUE 'SUPPORT_TICKET_REPLY';

CREATE TYPE "SupportTicketPriority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED');
CREATE TYPE "SupportTicketCategory" AS ENUM ('ORDER', 'SHIPPING', 'RETURNS_REFUNDS', 'PRODUCT', 'TECHNICAL', 'OTHER');
CREATE TYPE "SupportMessageSender" AS ENUM ('CUSTOMER', 'SUPPORT', 'SYSTEM');
CREATE TYPE "KnowledgeBaseCategory" AS ENUM ('GENERAL', 'SHIPPING', 'RETURNS', 'PRODUCT', 'TROUBLESHOOTING');
CREATE TYPE "KnowledgeBaseStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT,
    "assignedToId" TEXT,
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "category" "SupportTicketCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "firstResponseDueAt" TIMESTAMPTZ(6) NOT NULL,
    "resolutionDueAt" TIMESTAMPTZ(6) NOT NULL,
    "firstRespondedAt" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "lastActivityAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "sender" "SupportMessageSender" NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeBaseArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "KnowledgeBaseCategory" NOT NULL,
    "status" "KnowledgeBaseStatus" NOT NULL DEFAULT 'DRAFT',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "KnowledgeBaseArticle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");
CREATE INDEX "SupportTicket_requesterEmail_createdAt_idx" ON "SupportTicket"("requesterEmail", "createdAt");
CREATE INDEX "SupportTicket_status_priority_lastActivityAt_idx" ON "SupportTicket"("status", "priority", "lastActivityAt");
CREATE INDEX "SupportTicket_assignedToId_status_idx" ON "SupportTicket"("assignedToId", "status");
CREATE INDEX "SupportTicket_firstResponseDueAt_idx" ON "SupportTicket"("firstResponseDueAt");
CREATE INDEX "SupportTicket_resolutionDueAt_idx" ON "SupportTicket"("resolutionDueAt");
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");
CREATE UNIQUE INDEX "KnowledgeBaseArticle_slug_key" ON "KnowledgeBaseArticle"("slug");
CREATE INDEX "KnowledgeBaseArticle_status_category_sortOrder_idx" ON "KnowledgeBaseArticle"("status", "category", "sortOrder");
CREATE INDEX "KnowledgeBaseArticle_isFeatured_status_idx" ON "KnowledgeBaseArticle"("isFeatured", "status");

ALTER TABLE "SupportTicket"
ADD CONSTRAINT "SupportTicket_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportTicket"
ADD CONSTRAINT "SupportTicket_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportTicket"
ADD CONSTRAINT "SupportTicket_assignedToId_fkey"
FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportTicketMessage"
ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "KnowledgeBaseArticle"
    ("id", "slug", "title", "excerpt", "content", "category", "status", "isFeatured", "sortOrder", "publishedAt", "updatedAt")
VALUES
    ('kb-general-contact-support', 'contact-roboroot-support', 'How do I contact RoboRoot support?', 'Choose the fastest support route for an order, product, or technical question.', 'Search the Help Center first for an immediate answer. If you still need help, select Create a ticket and include the relevant order number, product name, and a clear description. You will receive a ticket number by email and can track every response from the Support Tickets page.', 'GENERAL', 'PUBLISHED', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb-general-ticket-priority', 'choose-ticket-priority', 'Which ticket priority should I choose?', 'Use priority carefully so the team can respond to the most time-sensitive issues first.', 'Urgent is for safety issues or a paid order blocked at a critical deadline. High is for failed deliveries, payments, or unusable products. Medium is for normal order and technical questions. Low is for general guidance or feedback. The support team may adjust priority after review.', 'GENERAL', 'PUBLISHED', false, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb-shipping-delivery-time', 'shipping-delivery-times', 'How long does delivery take?', 'Understand dispatch and delivery timelines for stocked and made-to-order items.', 'Delivery time depends on stock availability, destination, courier service, and whether assembly or customization is required. Your order detail page shows the latest status. Once dispatched, use the tracking link provided there. Custom projects and 3D printing orders may need production time before dispatch.', 'SHIPPING', 'PUBLISHED', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb-shipping-track-order', 'track-shipped-order', 'How do I track a shipped order?', 'Find the live courier status for your order.', 'Sign in and open My Orders, then select Order Details. When a courier tracking number is available, the page displays the tracking link and shipment progress. If tracking has not updated for more than 48 hours, create a Shipping ticket with your order number.', 'SHIPPING', 'PUBLISHED', false, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb-returns-eligibility', 'return-eligibility', 'Is my product eligible for return?', 'Check the basic return conditions before raising a request.', 'Return eligibility depends on the product condition and the published Refund and Return Policy. Keep the original packaging and do not solder, alter, or physically damage electronic components. Report incorrect, damaged, or defective products promptly and include clear photos in your support description.', 'RETURNS', 'PUBLISHED', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb-returns-refund-time', 'refund-processing-time', 'When will I receive my refund?', 'Learn what happens after a refund is approved.', 'After RoboRoot approves a refund, it is sent through the original payment method where possible. Banks and payment providers may require additional processing time. Track the related ticket for confirmation and reference details.', 'RETURNS', 'PUBLISHED', false, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb-product-compatibility', 'check-component-compatibility', 'How do I check component compatibility?', 'Confirm voltage, logic level, interface, and power requirements before ordering.', 'Compare operating voltage, current draw, connector type, logic level, communication interface, and required libraries. For motors and high-current devices, verify the driver and power supply separately. Create a Product ticket with links or names for both components if you need a compatibility check.', 'PRODUCT', 'PUBLISHED', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb-product-stock', 'product-stock-and-restock', 'What does the stock status mean?', 'Understand available, low-stock, and unavailable products.', 'Available products can normally be ordered immediately, subject to final inventory checks. Low-stock products may sell out before checkout is completed. For unavailable products or a large quantity, use a support ticket or the Bulk Order page to request a restock estimate.', 'PRODUCT', 'PUBLISHED', false, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb-troubleshoot-power', 'component-not-powering-on', 'My component does not power on', 'Run a safe set of checks before connecting power again.', 'Disconnect power first. Confirm polarity, input voltage, current capacity, and wiring against the product specification. Inspect for shorts, loose connections, overheating, or visible damage. Do not repeatedly power a hot or damaged board. If the issue continues, create a Technical ticket with the component name, power source, wiring details, and test results.', 'TROUBLESHOOTING', 'PUBLISHED', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb-troubleshoot-sensor', 'unstable-sensor-readings', 'Why are my sensor readings unstable?', 'Improve noisy or inconsistent sensor values.', 'Check that the sensor and controller share ground, use the correct supply voltage, and keep signal wires away from motors and switching power circuits. Confirm pull-up requirements and library settings. Try a short cable and a known-good power source. Include code, wiring, and sample readings in a Technical ticket if the issue remains.', 'TROUBLESHOOTING', 'PUBLISHED', false, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

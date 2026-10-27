import { emailConfig, emailIdentity } from "../../services/email-config.js";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { bulkOrderTemplate } from "../../utils/emailTemplates/bulkOrder.js";
import {
  assertQuoteDecision,
  assertTransition,
  BulkWorkflowError,
  quoteTotals,
} from "./bulk-order.logic.js";
import type {
  CreateBulkOrderInput,
  QuoteInput,
  listSchema,
  statusSchema,
} from "./validators/bulk-order.validator.js";
import type { z } from "zod";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reference = () => `BQ-${randomBytes(8).toString("hex").toUpperCase()}`;
const include = {
  quotes: { orderBy: { version: "desc" as const } },
  messages: { orderBy: { createdAt: "desc" as const }, take: 100 },
} satisfies Prisma.BulkOrderRequestInclude;
type RequestRecord = Prisma.BulkOrderRequestGetPayload<{
  include: typeof include;
}>;
type Access = { accessKey?: string; userId?: string };

async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bulk:${key}`}))`;
}
export function customerView(row: RequestRecord) {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    email: row.email,
    phone: row.phone,
    companyName: row.companyName,
    notes: row.notes,
    status: row.status,
    items: row.items,
    postalCode: row.postalCode,
    deliveryAddress: row.deliveryAddress,
    gstin: row.gstin,
    timeline: row.timeline,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    quotes: row.quotes.map(({ createdById: _author, ...quote }) => {
      void _author;
      return quote;
    }),
    messages: [...row.messages].reverse(),
  };
}
function adminView(row: RequestRecord) {
  return {
    ...customerView(row),
    adminNotes: row.adminNotes,
    legacyCsvFileUrl: row.csvFileUrl,
  };
}
function authorizeCustomer(
  row: RequestRecord | null,
  access: Access,
): asserts row is RequestRecord {
  if (
    !row ||
    !(
      (access.userId && row.userId === access.userId) ||
      (access.accessKey && row.accessKeyHash === digest(access.accessKey))
    )
  )
    throw new BulkWorkflowError(
      "NOT_FOUND",
      "Request not found. Check your reference and private access code, or recover access by email.",
    );
}
function assertVersion(row: RequestRecord, version: number) {
  if (row.version !== version)
    throw new BulkWorkflowError(
      "CONFLICT",
      "This request changed in another session. Refresh before saving.",
    );
}
async function notice(
  tx: Prisma.TransactionClient,
  row: { email: string; reference: string | null },
  message: string,
  audience: "CUSTOMER" | "ADMIN" = "CUSTOMER",
  accessKey?: string,
) {
  const base =
    audience === "ADMIN" ? emailConfig().adminUrl : emailConfig().siteUrl;
  if (!base) return;
  const recipient = audience === "ADMIN" ? emailConfig().admin : row.email;
  if (!recipient) return;
  const url =
    audience === "ADMIN"
      ? `${base}/bulk-orders`
      : `${base}/bulk-order/track?reference=${row.reference}${accessKey ? `#key=${accessKey}` : ""}`;
  const data = { reference: row.reference || "Legacy request", message, url };
  const template = bulkOrderTemplate(data);
  await tx.emailNotification.create({
    data: {
      email: recipient,
      eventType: "BULK_ORDER_UPDATED",
      subject: template.subject,
      body: template.html,
      text: template.text || "",
      ...emailIdentity(
        "BULK_ORDER_UPDATED",
        audience === "ADMIN" ? "ADMIN" : "TRANSACTIONAL",
      ),
      metadata: data,
    },
  });
}
const transactionOptions = { maxWait: 10000, timeout: 15000 };

export async function createRequest(
  input: CreateBulkOrderInput,
  userId?: string,
) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, input.requestKey);
    const existing = await tx.bulkOrderRequest.findUnique({
      where: { requestKey: input.requestKey },
      include,
    });
    if (existing) {
      if (existing.accessKeyHash !== digest(input.accessKey))
        throw new BulkWorkflowError(
          "CONFLICT",
          "This submission key has already been used.",
        );
      return customerView(existing);
    }
    const row = await tx.bulkOrderRequest.create({
      data: {
        ...(userId ? { userId } : {}),
        name: input.name,
        email: input.email,
        phone: input.phone,
        companyName: input.companyName,
        notes: input.notes,
        reference: reference(),
        requestKey: input.requestKey,
        accessKeyHash: digest(input.accessKey),
        items: input.items,
        postalCode: input.postalCode,
        deliveryAddress: input.deliveryAddress,
        gstin: input.gstin,
        timeline: input.timeline,
        consentAt: new Date(),
        messages: {
          create: {
            sender: "SYSTEM",
            body: "Request received. The team will review your list and publish an itemised quotation here. No payment has been collected.",
          },
        },
      },
      include,
    });
    await notice(
      tx,
      row,
      "We received your bulk request. Keep the private access code shown on the confirmation screen, or request a new access email from the tracking page.",
    );
    await notice(
      tx,
      row,
      "A new bulk quotation request is ready for review.",
      "ADMIN",
    );
    return customerView(row);
  }, transactionOptions);
}

export async function trackRequest(ref: string, access: Access) {
  const row = await prisma.bulkOrderRequest.findUnique({
    where: { reference: ref },
    include,
  });
  authorizeCustomer(row, access);
  return customerView(row);
}
export async function listRequests(input: z.infer<typeof listSchema>) {
  const where: Prisma.BulkOrderRequestWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.search
      ? {
          OR: ["reference", "name", "email", "companyName"].map((key) => ({
            [key]: { contains: input.search, mode: "insensitive" },
          })),
        }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.bulkOrderRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * 20,
      take: 20,
      include,
    }),
    prisma.bulkOrderRequest.count({ where }),
  ]);
  return {
    requests: rows.map(adminView),
    total,
    pages: Math.max(1, Math.ceil(total / 20)),
    page: input.page,
  };
}
export async function adminRequest(id: string) {
  const row = await prisma.bulkOrderRequest.findUnique({
    where: { id },
    include,
  });
  if (!row) throw new BulkWorkflowError("NOT_FOUND", "Request not found");
  return adminView(row);
}
export async function publishQuote(
  id: string,
  input: QuoteInput,
  adminId: string,
) {
  const validUntil = new Date(input.validUntil);
  if (
    validUntil <= new Date() ||
    validUntil.getTime() > Date.now() + 90 * 86400000
  )
    throw new BulkWorkflowError(
      "INVALID",
      "Quote validity must be in the future, within 90 days.",
    );
  const totals = quoteTotals(input);
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const current = await tx.bulkOrderRequest.findUnique({
      where: { id },
      include,
    });
    if (!current) throw new BulkWorkflowError("NOT_FOUND", "Request not found");
    assertVersion(current, input.expectedVersion);
    if (
      !["SUBMITTED", "REVIEWING", "QUOTED", "DECLINED"].includes(current.status)
    )
      throw new BulkWorkflowError(
        "CONFLICT",
        "An accepted, fulfilled, or cancelled request cannot be repriced.",
      );
    if (current.quotes.length >= 50)
      throw new BulkWorkflowError(
        "CONFLICT",
        "Quote revision limit reached. Create a new request.",
      );
    const revision = (current.quotes[0]?.version ?? 0) + 1;
    const row = await tx.bulkOrderRequest.update({
      where: { id },
      data: {
        reference: current.reference || reference(),
        status: "QUOTED",
        version: { increment: 1 },
        quotes: {
          create: {
            version: revision,
            items: input.items,
            ...totals,
            shippingCents: input.shippingCents,
            validUntil,
            leadTime: input.leadTime,
            terms: input.terms,
            createdById: adminId,
          },
        },
        messages: {
          create: {
            sender: "SYSTEM",
            body: `Quote revision ${revision} published. Review the items, taxes, shipping, validity, and terms before accepting.`,
          },
        },
      },
      include,
    });
    await notice(
      tx,
      row,
      `Your itemised quote (revision ${revision}) is ready to review.`,
    );
    return adminView(row);
  }, transactionOptions);
}
export async function decideQuote(
  ref: string,
  access: Access,
  quoteId: string,
  decision: "ACCEPTED" | "DECLINED",
) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.bulkOrderRequest.findUnique({
      where: { reference: ref },
      select: { id: true },
    });
    if (!found) throw new BulkWorkflowError("NOT_FOUND", "Request not found");
    await lock(tx, found.id);
    const current = await tx.bulkOrderRequest.findUnique({
      where: { id: found.id },
      include,
    });
    authorizeCustomer(current, access);
    const latest = current.quotes[0];
    if (latest?.id === quoteId && latest.decision === decision)
      return customerView(current);
    if (!latest)
      throw new BulkWorkflowError(
        "CONFLICT",
        "There is no quote to respond to yet.",
      );
    assertQuoteDecision(current.status, latest.id, quoteId, latest.validUntil);
    await tx.bulkOrderQuote.update({
      where: { id: quoteId },
      data: { decision, decidedAt: new Date() },
    });
    const row = await tx.bulkOrderRequest.update({
      where: { id: current.id },
      data: {
        status: decision,
        version: { increment: 1 },
        messages: {
          create: {
            sender: "SYSTEM",
            body: `Customer ${decision.toLowerCase()} quote revision ${latest.version}.${decision === "ACCEPTED" ? " The team will coordinate payment and fulfilment under the agreed terms. No payment or stock reservation was made here." : " Send a message to discuss changes."}`,
          },
        },
      },
      include,
    });
    await notice(
      tx,
      row,
      `You ${decision.toLowerCase()} quote revision ${latest.version}.`,
    );
    await notice(
      tx,
      row,
      `Customer ${decision.toLowerCase()} quote revision ${latest.version}.`,
      "ADMIN",
    );
    return customerView(row);
  }, transactionOptions);
}
export async function updateRequest(
  id: string,
  input: z.infer<typeof statusSchema>,
) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const current = await tx.bulkOrderRequest.findUnique({
      where: { id },
      include,
    });
    if (!current) throw new BulkWorkflowError("NOT_FOUND", "Request not found");
    assertVersion(current, input.expectedVersion);
    if (input.status) assertTransition(current.status, input.status);
    const changed = input.status && current.status !== input.status;
    const row = await tx.bulkOrderRequest.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.adminNotes !== undefined
          ? { adminNotes: input.adminNotes }
          : {}),
        version: { increment: 1 },
        ...(changed
          ? {
              messages: {
                create: {
                  sender: "SYSTEM",
                  body: `Request status changed to ${input.status!.replace(/_/g, " ").toLowerCase()}.`,
                },
              },
            }
          : {}),
      },
      include,
    });
    if (changed)
      await notice(
        tx,
        row,
        `Your request status is now ${row.status.replace(/_/g, " ").toLowerCase()}.`,
      );
    return adminView(row);
  }, transactionOptions);
}
export async function addMessage(
  identifier: string,
  message: string,
  access: Access | null,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.bulkOrderRequest.findUnique({
      where: access ? { reference: identifier } : { id: identifier },
      include,
    });
    if (access) authorizeCustomer(current, access);
    if (!current) throw new BulkWorkflowError("NOT_FOUND", "Request not found");
    const row = await tx.bulkOrderRequest.update({
      where: { id: current.id },
      data: {
        messages: {
          create: { sender: access ? "CUSTOMER" : "TEAM", body: message },
        },
      },
      include,
    });
    await notice(
      tx,
      row,
      "There is a new message on this bulk request.",
      access ? "ADMIN" : "CUSTOMER",
    );
    return access ? customerView(row) : adminView(row);
  }, transactionOptions);
}
export async function recoverAccess(ref: string, email: string) {
  const key = randomBytes(32).toString("hex");
  await prisma.$transaction(async (tx) => {
    const current = await tx.bulkOrderRequest.findUnique({
      where: { reference: ref },
    });
    if (!current || current.email !== email) return;
    await tx.bulkOrderRequest.update({
      where: { id: current.id },
      data: { accessKeyHash: digest(key) },
    });
    await notice(
      tx,
      current,
      "Here is your private access link. Keep it private; it lets you view this request and respond to its quotation. Your previous access code has been replaced.",
      "CUSTOMER",
      key,
    );
  }, transactionOptions);
}

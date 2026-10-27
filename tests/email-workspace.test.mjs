import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import express from "express";

Object.assign(process.env, {
  EMAIL_FROM: "noreply@mail.albumo.in",
  EMAIL_FROM_NAME: "Albumo",
  ADMIN_ALERT_EMAIL: "vishal.sahani@albumo.in",
  EMAIL_REPLY_TO: "",
  ACCOUNT_EMAIL_FROM: "account@mail.albumo.in",
  ACCOUNT_EMAIL_REPLY_TO: "support@albumo.in",
  MARKETING_EMAIL_FROM: "update@alert.albumo.in",
  MARKETING_EMAIL_REPLY_TO: "hello@albumo.in",
  EMAIL_SITE_URL: "https://albumo.in",
  EMAIL_API_URL: "https://api.albumo.in",
  EMAIL_INBOUND_DOMAIN: "inbox.albumo.in",
  EMAIL_INBOUND_ENABLED: "true",
  EMAIL_MARKETING_ENABLED: "true",
  EMAIL_SIGNING_SECRET: "fixture-secret-".repeat(4),
});
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});
const tables = {};
let calls = [];
let transport = async () => ({ success: true, messageId: "provider-1" });
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part) => matches(row, part));
    if (key === "AND") return value.every((part) => matches(row, part));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("in" in value && !value.in.includes(row[key])) return false;
      if ("notIn" in value && value.notIn.includes(row[key])) return false;
      if ("not" in value && row[key] === value.not) return false;
      if (
        "lt" in value &&
        !(row[key] < (value.lt === "$maxRetries" ? row.maxRetries : value.lt))
      )
        return false;
      if ("lte" in value && !(row[key] <= value.lte)) return false;
      if (
        "contains" in value &&
        !String(row[key]).toLowerCase().includes(value.contains.toLowerCase())
      )
        return false;
      return true;
    }
    return value instanceof Date
      ? row[key]?.getTime() === value.getTime()
      : row[key] === value;
  });
}
function update(row, data) {
  for (const [key, value] of Object.entries(data))
    row[key] = value?.increment
      ? row[key] + value.increment
      : structuredClone(value);
  return structuredClone(row);
}
function model(name) {
  tables[name] = [];
  const rows = () => tables[name];
  return {
    fields: { maxRetries: "$maxRetries" },
    findUnique: async ({ where }) =>
      structuredClone(rows().find((row) => matches(row, where)) || null),
    findUniqueOrThrow: async ({ where }) => {
      const row = rows().find((row) => matches(row, where));
      assert(row, name + " missing");
      return structuredClone(row);
    },
    findFirst: async ({ where }) =>
      structuredClone(rows().find((row) => matches(row, where)) || null),
    findMany: async ({ where, take, skip = 0, select } = {}) =>
      structuredClone(
        rows()
          .filter((row) => matches(row, where))
          .slice(skip, take ? skip + take : undefined)
          .map((row) =>
            select
              ? Object.fromEntries(
                  Object.keys(select).map((key) => [key, row[key]]),
                )
              : row,
          ),
      ),
    count: async ({ where } = {}) =>
      rows().filter((row) => matches(row, where)).length,
    create: async ({ data }) => {
      const row = {
        id: name + (rows().length + 1),
        createdAt: new Date(),
        status: name === "emailCampaign" ? "DRAFT" : "QUEUED",
        retryCount: 0,
        maxRetries: 3,
        nextAttemptAt: new Date(),
        lockedUntil: null,
        firstAttemptAt: null,
        isSent: false,
        sentAt: null,
        providerMessageId: null,
        providerEventAt: null,
        error: null,
        processedAt: null,
        ticketId: null,
        ...structuredClone(data),
      };
      rows().push(row);
      return structuredClone(row);
    },
    update: async ({ where, data }) => {
      const row = rows().find((row) => matches(row, where));
      assert(row, name + " missing");
      return update(row, data);
    },
    updateMany: async ({ where, data }) => {
      const found = rows().filter((row) => matches(row, where));
      for (const row of found) update(row, data);
      return { count: found.length };
    },
    upsert: async ({ where, create, update: data }) => {
      const row = rows().find((row) => matches(row, where));
      return row ? update(row, data) : mock[name].create({ data: create });
    },
    createMany: async ({ data }) => {
      for (const row of data)
        if (!rows().some((item) => item.dedupeKey === row.dedupeKey))
          await mock[name].create({ data: row });
      return { count: data.length };
    },
    groupBy: async () => [],
  };
}
const mock = Object.fromEntries(
  [
    "emailNotification",
    "emailCampaign",
    "emailSuppression",
    "emailWebhookEvent",
    "inboundEmail",
    "newsletterSubscriber",
    "supportTicket",
    "supportTicketMessage",
    "adminActionLog",
  ].map((name) => [name, model(name)]),
);
mock.$executeRaw = async () => 1;
mock.$transaction = async (fn) => {
  const snapshot = structuredClone(tables);
  try {
    return await (typeof fn === "function" ? fn(mock) : Promise.all(fn));
  } catch (error) {
    Object.assign(tables, snapshot);
    throw error;
  }
};
globalThis.__emailTestPrisma = mock;
globalThis.__emailTestSend = async (...args) => {
  calls.push(args);
  return transport(...args);
};
const bundled = await build({
  stdin: {
    contents: [
      "export * from './src/services/email-notification.service.ts';",
      "export * from './src/services/email-marketing.service.ts';",
      "export * from './src/services/campaign-design.ts';",
      "export { addAdminReply, sendSupportEmail } from './src/features/support/support.service.ts';",
      "export { default as supportRoutes } from './src/features/support/support.routes.ts';",
      "export * from './src/services/email-inbox.service.ts';",
      "export * from './src/services/email-webhook.service.ts';",
      "export * from './src/services/email-tokens.ts';",
      "export * from './src/services/resend-webhook-signature.ts';",
      "export * from './src/routes/emailPreferencesRoutes.ts';",
      "export * from './src/routes/emailWorkspaceRoutes.ts';",
    ].join("\n"),
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  packages: "external",
  plugins: [
    {
      name: "isolated-email",
      setup(builder) {
        const replacements = [
          [
            /lib\/prisma\.js$/,
            "export const prisma=globalThis.__emailTestPrisma;",
          ],
          [/lib\/queue\.js$/, "export const getEmailQueue=()=>null;"],
          [
            /email\.service\.js$/,
            "export const emailDeliveryConfigured=()=>true;export const sendEmail=(...args)=>globalThis.__emailTestSend(...args);",
          ],
          [
            /generated\/prisma\/client\.js$/,
            "const values=new Proxy({},{get:(_,key)=>key}); export const Prisma={DbNull:null}, EmailEventType=values, KnowledgeBaseCategory=values, SupportTicketCategory=values, KnowledgeBaseStatus=values, SupportMessageSender=values, SupportTicketPriority=values, SupportTicketStatus=values, UserRole=values;",
          ],
          [
            /middlewares\/auth\.middleware\.js$/,
            'export const optionalAuthenticate=(req,res,next)=>next();export const authenticate=(req,res,next)=>{if(!req.headers["x-test-role"])return res.sendStatus(401);req.user={userId:"admin",role:req.headers["x-test-role"]};next();};export const authorize=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.sendStatus(403);',
          ],
        ];
        replacements.forEach(([filter, contents], index) => {
          builder.onResolve({ filter }, () => ({
            path: String(index),
            namespace: "fixture",
          }));
          builder.onLoad(
            { filter: new RegExp("^" + index + "$"), namespace: "fixture" },
            () => ({ contents, loader: "js" }),
          );
        });
      },
    },
  ],
});
const filename = fileURLToPath(new URL("./email-fixture.cjs", import.meta.url));
const mod = new Module(filename);
mod.filename = filename;
mod.paths = createRequire(import.meta.url).resolve.paths("express");
mod._compile(bundled.outputFiles[0].text, filename);
const api = mod.exports;

beforeEach(() => {
  for (const name of Object.keys(tables)) tables[name] = [];
  calls = [];
  transport = async () => ({ success: true, messageId: "provider-1" });
  globalThis.fetch = async () => {
    throw Error("Unexpected external request");
  };
});
const consentAt = new Date("2026-10-15T10:00:00Z");
const subscriber = () => ({
  id: "subscriber1",
  email: "reader@example.com",
  status: "ACTIVE",
  consentAt,
});
async function raw(extra = {}) {
  return api.queueRawEmail({
    email: "reader@example.com",
    eventType: "CUSTOM_EMAIL",
    subject: "Hello",
    html: "<p>Hello</p>",
    text: "Hello",
    ...extra,
  });
}

test("order events notify the customer and configured admin once", async () => {
  const data = {
    order: { orderId: "AL100", total: 599, items: [] },
    user: { name: "Asha" },
  };
  await api.queueEmailNotification("reader@example.com", "ORDER_CREATED", data);
  await api.queueEmailNotification("reader@example.com", "ORDER_CREATED", data);
  assert.equal(tables.emailNotification.length, 2);
  assert.equal(
    tables.emailNotification.find((row) => row.channel === "ADMIN").email,
    "vishal.sahani@albumo.in",
  );
  assert(
    tables.emailNotification.every((row) => !row.body.includes("RoboRoot")),
  );
});

test("account messages use their own sender while orders and OTP remain transactional", async () => {
  for (const eventType of [
    "USER_SIGNUP",
    "USER_EMAIL_VERIFICATION",
    "PASSWORD_RESET",
    "ORDER_CREATED",
  ]) {
    const row = await raw({ eventType });
    await api.retryEmailNotification(row.id);
    assert.equal(
      calls.at(-1)[5].from,
      eventType === "USER_SIGNUP"
        ? "Albumo <account@mail.albumo.in>"
        : "Albumo <noreply@mail.albumo.in>",
    );
    assert.equal(
      calls.at(-1)[5].replyTo,
      eventType === "USER_SIGNUP" ? "support@albumo.in" : "",
    );
  }
  const update = await raw({ channel: "ACCOUNT" });
  await api.retryEmailNotification(update.id);
  assert.equal(calls.at(-1)[5].from, "Albumo <account@mail.albumo.in>");
  assert.equal(tables.emailNotification[0].channel, "ACCOUNT");
});

test("support conversations keep a monitored reply address when receiving is disabled", () => {
  const previous = process.env.EMAIL_INBOUND_ENABLED;
  const previousSupport = process.env.SUPPORT_EMAIL;
  try {
    process.env.EMAIL_INBOUND_ENABLED = "false";
    process.env.SUPPORT_EMAIL = "support@albumo.in";
    assert.equal(api.supportReplyAddress("ticket1"), "support@albumo.in");
  } finally {
    process.env.EMAIL_INBOUND_ENABLED = previous;
    if (previousSupport === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = previousSupport;
  }
});

test("new and previously queued low-stock alerts never reach the provider", async () => {
  const current = await raw({ eventType: "LOW_STOCK_ALERT", channel: "ADMIN" });
  assert.equal(tables.emailNotification[0].status, "SKIPPED");
  await api.retryEmailNotification(current.id);
  const old = await raw({ eventType: "LOW_STOCK_ALERT", channel: "ADMIN" });
  tables.emailNotification[1].status = "QUEUED";
  await api.retryEmailNotification(old.id);
  assert.equal(tables.emailNotification[1].status, "SKIPPED");
  assert.equal(calls.length, 0);
});

test("atomic outbox claim prevents competing workers from sending twice", async () => {
  const row = await raw();
  await Promise.all([
    api.retryEmailNotification(row.id),
    api.retryEmailNotification(row.id),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(tables.emailNotification[0].status, "SENT");
  assert.equal(calls[0][5].idempotencyKey, "albumo-email/" + row.id);
});

test("retry preserves provider idempotency and schedules backoff", async () => {
  const row = await raw();
  transport = async () => ({
    success: false,
    error: "Temporary provider failure",
  });
  assert.equal((await api.retryEmailNotification(row.id)).success, false);
  assert.equal(tables.emailNotification[0].status, "QUEUED");
  assert(tables.emailNotification[0].nextAttemptAt > new Date());
  tables.emailNotification[0].nextAttemptAt = new Date(0);
  transport = async () => ({ success: true, messageId: "retry-provider" });
  const previousFrom = process.env.EMAIL_FROM;
  const previousReply = process.env.EMAIL_REPLY_TO;
  try {
    process.env.EMAIL_FROM = "changed@mail.albumo.in";
    process.env.EMAIL_REPLY_TO = "changed@albumo.in";
    await api.retryEmailNotification(row.id);
  } finally {
    process.env.EMAIL_FROM = previousFrom;
    process.env.EMAIL_REPLY_TO = previousReply;
  }
  assert.equal(calls[0][5].from, calls[1][5].from);
  assert.equal(calls[0][5].replyTo, calls[1][5].replyTo);
  assert.equal(calls[0][5].idempotencyKey, calls[1][5].idempotencyKey);
});

test("a fast webhook status is not overwritten by the send response", async () => {
  const row = await raw();
  transport = async () => {
    tables.emailNotification[0].status = "DELIVERED";
    return { success: true, messageId: "fast" };
  };
  await api.retryEmailNotification(row.id);
  assert.equal(tables.emailNotification[0].status, "DELIVERED");
});

test("suppressed recipients and old uncertain delivery attempts are not sent", async () => {
  const row = await raw();
  tables.emailSuppression.push({
    email: "reader@example.com",
    reason: "email.bounced",
  });
  await api.retryEmailNotification(row.id);
  assert.equal(tables.emailNotification[0].status, "SKIPPED");
  const old = await raw({ email: "other@example.com" });
  tables.emailNotification[1].firstAttemptAt = new Date(
    Date.now() - 24 * 3600000,
  );
  await api.retryEmailNotification(old.id);
  assert.equal(tables.emailNotification[1].status, "FAILED");
  assert.equal(calls.length, 0);
});

test("authentication codes are redacted after delivery and stale codes are skipped", async () => {
  const row = await raw({
    eventType: "USER_EMAIL_VERIFICATION",
    text: "123456",
    html: "<p>123456</p>",
    metadata: { verificationCode: "123456" },
  });
  await api.retryEmailNotification(row.id);
  assert(!JSON.stringify(tables.emailNotification[0]).includes("123456"));
  const stale = await raw({ eventType: "PASSWORD_RESET" });
  tables.emailNotification[1].createdAt = new Date(Date.now() - 11 * 60000);
  await api.retryEmailNotification(stale.id);
  assert.equal(tables.emailNotification[1].status, "SKIPPED");
  assert.equal(calls.length, 1);
});

test("marketing delivery rechecks current consent and includes one-click headers", async () => {
  tables.newsletterSubscriber.push(subscriber());
  const row = await api.queueNewsletterWelcome(subscriber());
  await api.retryEmailNotification(row.id);
  assert.equal(calls[0][5].from, "Albumo <update@alert.albumo.in>");
  assert.equal(calls[0][5].replyTo, "hello@albumo.in");
  assert.equal(
    calls[0][5].headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click",
  );
  assert(
    calls[0][5].headers["List-Unsubscribe"].includes(
      "https://api.albumo.in/api/email-preferences",
    ),
  );
  const second = await raw({
    channel: "MARKETING",
    subscriberId: "subscriber1",
    metadata: { consentAt: consentAt.toISOString() },
    headers: { "List-Unsubscribe": "<https://example.com>" },
  });
  tables.newsletterSubscriber[0].consentAt = new Date();
  await api.retryEmailNotification(second.id);
  assert.equal(tables.emailNotification[1].status, "SKIPPED");
  assert.equal(calls.length, 1);
});

test("unsubscribed readers and legacy unconsented cart reminders are skipped", async () => {
  tables.newsletterSubscriber.push({ ...subscriber(), status: "UNSUBSCRIBED" });
  const row = await api.queueNewsletterWelcome(subscriber());
  await api.retryEmailNotification(row.id);
  const old = await raw({ eventType: "CART_ABANDONED" });
  await api.retryEmailNotification(old.id);
  assert.equal(calls.length, 0);
  assert(tables.emailNotification.every((item) => item.status === "SKIPPED"));
});

test("campaign launch is idempotent and excludes unsubscribed/suppressed addresses", async () => {
  tables.newsletterSubscriber.push(
    subscriber(),
    {
      ...subscriber(),
      id: "sub2",
      email: "left@example.com",
      status: "UNSUBSCRIBED",
    },
    { ...subscriber(), id: "sub3", email: "bounced@example.com" },
  );
  tables.emailSuppression.push({
    email: "bounced@example.com",
    reason: "bounce",
  });
  tables.emailCampaign.push({
    id: "campaign1",
    status: "DRAFT",
    name: "October",
    subject: "Your next story",
    body: "Print your memories with Albumo.",
  });
  await api.queueCampaign("campaign1");
  await api.queueCampaign("campaign1");
  assert.equal(tables.emailNotification.length, 1);
  assert.equal(tables.emailCampaign[0].recipientCount, 1);
  assert.equal(
    tables.emailNotification[0].fromAddress,
    "Albumo <update@alert.albumo.in>",
  );
  assert.equal(tables.emailNotification[0].replyTo, "hello@albumo.in");
  await api.cancelCampaign("campaign1");
  assert.equal(tables.emailNotification[0].status, "CANCELLED");
});

test("newsletter links reject tampering and old consent; successful opt-out cancels queued marketing", async () => {
  tables.newsletterSubscriber.push(subscriber());
  const token = api.newsletterToken(subscriber());
  assert.throws(() => api.readNewsletterToken(token + "x"));
  const old = api.newsletterToken({
    ...subscriber(),
    consentAt: new Date("2025-01-01"),
  });
  assert.equal(await api.applyEmailUnsubscribe(old), false);
  await api.queueNewsletterWelcome(subscriber());
  assert.equal(await api.applyEmailUnsubscribe(token), true);
  assert.equal(tables.newsletterSubscriber[0].status, "UNSUBSCRIBED");
  assert.equal(tables.emailNotification[0].status, "CANCELLED");
});

test("raw-body webhook signatures reject forgery and stale timestamps", () => {
  const secret = "whsec_" + Buffer.from("webhook-fixture").toString("base64");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from(
    JSON.stringify({
      type: "email.delivered",
      data: { email_id: "provider-1" },
    }),
  );
  const digest = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update("event1." + timestamp + ".")
    .update(body)
    .digest("base64");
  const headers = { id: "event1", timestamp, signature: "v1," + digest };
  assert.equal(
    api.verifyResendWebhook(body, headers, secret).type,
    "email.delivered",
  );
  assert.throws(() =>
    api.verifyResendWebhook(Buffer.from("{}"), headers, secret),
  );
  assert.throws(() =>
    api.verifyResendWebhook(body, headers, secret, Date.now() + 360000),
  );
});

test("bounces suppress recipients and cannot be downgraded by delayed delivery events", async () => {
  await raw();
  Object.assign(tables.emailNotification[0], {
    providerMessageId: "provider-1",
    isSent: true,
    status: "SENT",
  });
  tables.newsletterSubscriber.push(subscriber());
  const payload = {
    type: "email.bounced",
    created_at: "2026-10-16T10:00:00Z",
    data: { email_id: "provider-1" },
  };
  await api.saveEmailWebhook("bounce1", payload);
  await api.saveEmailWebhook("bounce1", payload);
  await api.saveEmailWebhook("delivery1", {
    ...payload,
    type: "email.delivered",
    created_at: "2026-10-16T11:00:00Z",
  });
  assert.equal(tables.emailNotification[0].status, "BOUNCED");
  assert.equal(tables.emailSuppression.length, 1);
  assert.equal(tables.newsletterSubscriber[0].status, "UNSUBSCRIBED");
  assert.equal(tables.emailWebhookEvent.length, 2);
});

test("early delivery webhooks are saved and recovered after the sender stores provider ID", async () => {
  const event = { type: "email.delivered", data: { email_id: "early-1" } };
  await assert.rejects(api.saveEmailWebhook("early-event", event));
  assert.equal(tables.emailWebhookEvent[0].processedAt, null);
  await raw();
  tables.emailNotification[0].providerMessageId = "early-1";
  await api.recoverEmailWebhooks();
  assert.equal(tables.emailNotification[0].status, "DELIVERED");
});

function received(remote) {
  globalThis.fetch = async (url) => {
    assert(String(url).startsWith("https://api.resend.com/emails/receiving/"));
    return new Response(JSON.stringify(remote), { status: 200 });
  };
  process.env.RESEND_RECEIVING_API_KEY = "fixture-only";
}
test("unauthenticated email is held for review and HTML is never rendered", async () => {
  received({
    from: "Reader <reader@example.com>",
    to: ["support@inbox.albumo.in"],
    subject: "Help",
    html: "<script>alert(1)</script><p>Need assistance</p>",
    authentication: { dmarc: "fail" },
  });
  const row = await api.receiveEmail("incoming1");
  assert.equal(row.status, "NEEDS_REVIEW");
  assert(!row.text.includes("<script>"));
  assert.equal(tables.supportTicket.length, 0);
  await api.linkInbound(row.id);
  assert.equal(tables.supportTicket.length, 1);
});

test("signed support replies match requester and webhook duplicates do not duplicate tickets", async () => {
  const address = api.supportReplyAddress("ticket1");
  assert.equal(api.ticketFromReplyAddress(address), "ticket1");
  assert.equal(
    api.ticketFromReplyAddress(address.replace("ticket1", "ticket2")),
    null,
  );
  tables.supportTicket.push({
    id: "ticket1",
    requesterEmail: "reader@example.com",
  });
  received({
    from: "reader@example.com",
    to: [address],
    subject: "Re: Help",
    text: "More details",
    authentication: { dmarc: "pass" },
  });
  await api.receiveEmail("reply1");
  await api.receiveEmail("reply1");
  assert.equal(tables.supportTicket.length, 1);
  assert.equal(tables.inboundEmail[0].ticketId, "ticket1");
  assert.equal(tables.emailNotification.length, 1);
});

test("authenticated sender mismatch cannot append to another customer's conversation", async () => {
  tables.supportTicket.push({
    id: "ticket1",
    requesterEmail: "owner@example.com",
  });
  received({
    from: "stranger@example.com",
    to: [api.supportReplyAddress("ticket1")],
    subject: "Help",
    text: "Unrelated",
    authentication: { dmarc: "pass" },
  });
  const row = await api.receiveEmail("mismatch1");
  assert.equal(row.status, "NEEDS_REVIEW");
  assert.equal(row.ticketId, null);
  assert.equal(tables.supportTicket.length, 1);
});

test("a persisted incoming message resumes after a failed ticket transaction", async () => {
  received({
    from: "reader@example.com",
    to: ["support@inbox.albumo.in"],
    subject: "Help",
    text: "Need help",
    authentication: { dmarc: "pass" },
  });
  const transact = mock.$transaction;
  mock.$transaction = async () => {
    throw Error("Temporary database error");
  };
  try {
    await assert.rejects(api.receiveEmail("recover-inbox"));
  } finally {
    mock.$transaction = transact;
  }
  await api.receiveEmail("recover-inbox");
  assert.equal(tables.inboundEmail.length, 1);
  assert.equal(tables.supportTicket.length, 1);
  assert.equal(tables.inboundEmail[0].status, "LINKED");
});

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use("/preferences", api.emailPreferencesRoutes);
  app.use("/emails", api.emailWorkspaceRoutes);
  app.use("/support", api.supportRoutes);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
test("unsubscribe GET is read-only; one-click POST opts out", async () => {
  tables.newsletterSubscriber.push(subscriber());
  const token = api.newsletterToken(subscriber());
  await withServer(async (origin) => {
    const url =
      origin + "/preferences/unsubscribe?token=" + encodeURIComponent(token);
    assert.equal((await originalFetch(url)).status, 200);
    assert.equal(tables.newsletterSubscriber[0].status, "ACTIVE");
    const response = await originalFetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    assert.equal(response.status, 200);
    assert.equal(tables.newsletterSubscriber[0].status, "UNSUBSCRIBED");
  });
});
test("admin routes deny customers, hide authentication codes and require campaign confirmation", async () => {
  const row = await raw({
    eventType: "PASSWORD_RESET",
    subject: "Code 123456",
    text: "123456",
  });
  await withServer(async (origin) => {
    assert.equal(
      (await originalFetch(origin + "/emails/messages")).status,
      401,
    );
    assert.equal(
      (
        await originalFetch(origin + "/emails/messages", {
          headers: { "x-test-role": "USER" },
        })
      ).status,
      403,
    );
    const headers = {
      "x-test-role": "SUPER_ADMIN",
      "content-type": "application/json",
    };
    const detail = await (
      await originalFetch(origin + "/emails/messages/" + row.id, { headers })
    ).text();
    assert(!detail.includes("123456"));
    const list = await (
      await originalFetch(origin + "/emails/messages", { headers })
    ).text();
    assert(!list.includes("123456"));
    const response = await originalFetch(
      origin + "/emails/campaigns/test/send",
      { method: "POST", headers, body: "{}" },
    );
    assert.equal(response.status, 400);
    await originalFetch(origin + "/emails/test", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "attacker@example.com" }),
    });
    assert.equal(
      tables.emailNotification.at(-1).email,
      "vishal.sahani@albumo.in",
    );
  });
});

test("all campaign layouts escape content and preserve custom links and unsubscribe", () => {
  for (const template of ["STORY", "COLLECTION", "OFFER"]) {
    const design = {
      template,
      heading: "<script>unsafe</script>",
      preheader: "A little inspiration",
      imageUrl: "https://cdn.albumo.in/campaign.jpg",
      imageAlt: 'A book "cover"',
      buttonLabel: "Shop & create",
      buttonUrl: "https://albumo.in/products?from=email&offer=story",
      offerCode: "STORY20",
      alignment: "center",
      accent: "CHARCOAL",
    };
    const content = api.renderCampaign(
      "Subject",
      "<img src=x onerror=bad> Our story",
      design,
      "https://api.albumo.in/unsubscribe",
    );
    assert(!content.html.includes("<script>"));
    assert(!content.html.includes("<img src=x"));
    assert(content.html.includes("https://cdn.albumo.in/campaign.jpg"));
    assert(content.html.includes("from=email&amp;offer=story"));
    assert(content.html.includes("A little inspiration"));
    assert(content.text.includes("https://api.albumo.in/unsubscribe"));
    assert.equal(
      content.text.includes("Offer code: STORY20"),
      template === "OFFER",
    );
  }
  assert(
    api
      .renderCampaign("Old draft", "Existing message", {})
      .html.includes("Old draft"),
  );
});

test("campaign design rejects unsafe links, off-CDN images and incomplete buttons", () => {
  for (const design of [
    { buttonUrl: "javascript:alert(1)", buttonLabel: "Click" },
    { imageUrl: "https://outside.example.com/image.jpg", imageAlt: "Book" },
    { imageUrl: "https://cdn.albumo.in/image.jpg" },
    { buttonLabel: "Missing link" },
    { accent: "red;display:none" },
  ])
    assert.equal(api.campaignDesignSchema.safeParse(design).success, false);
});

function supportFixture() {
  tables.supportTicket.push({
    id: "support1",
    ticketNumber: "AL-SUPPORT-1",
    requesterEmail: "reader@example.com",
    requesterName: "Asha",
    subject: "Help with my photo book",
    status: "OPEN",
    priority: "MEDIUM",
    firstRespondedAt: null,
    userId: null,
  });
}
test("public support reply is saved with one email to the ticket requester", async () => {
  supportFixture();
  await api.addAdminReply(
    "support1",
    "We are reviewing your enquiry.",
    false,
    "admin1",
    "Albumo Support",
  );
  assert.equal(tables.supportTicketMessage.length, 1);
  assert.equal(tables.emailNotification.length, 1);
  assert.equal(tables.emailNotification[0].email, "reader@example.com");
  assert.equal(tables.emailNotification[0].ticketId, "support1");
  assert(
    tables.emailNotification[0].text.includes("We are reviewing your enquiry."),
  );
  assert(tables.emailNotification[0].replyTo.includes("@inbox.albumo.in"));
  assert.equal(tables.supportTicket[0].status, "WAITING_FOR_CUSTOMER");
  assert.equal(
    tables.emailNotification[0].dedupeKey,
    "support-message:" + tables.supportTicketMessage[0].id,
  );
});
test("internal support notes are never queued as email", async () => {
  supportFixture();
  await api.addAdminReply(
    "support1",
    "Private team note.",
    true,
    "admin1",
    "Support",
  );
  assert.equal(tables.supportTicketMessage[0].isInternal, true);
  assert.equal(tables.emailNotification.length, 0);
  assert.equal(tables.supportTicket[0].firstRespondedAt, null);
});
test("support reply rolls back if the email outbox cannot be saved", async () => {
  supportFixture();
  const original = mock.emailNotification.upsert;
  mock.emailNotification.upsert = async () => {
    throw Error("Outbox unavailable");
  };
  try {
    await assert.rejects(
      api.addAdminReply(
        "support1",
        "A public reply.",
        false,
        "admin1",
        "Support",
      ),
      /Outbox unavailable/,
    );
    assert.equal(tables.supportTicketMessage.length, 0);
    assert.equal(tables.supportTicket[0].status, "OPEN");
  } finally {
    mock.emailNotification.upsert = original;
  }
});

test("campaign API saves design and renders the same preview and admin test", async () => {
  await withServer(async (origin) => {
    const headers = {
      "x-test-role": "ADMIN",
      "content-type": "application/json",
    };
    const draft = {
      name: "Collection launch",
      subject: "Your next keepsake",
      body: "Discover our new collection.",
      design: {
        template: "OFFER",
        heading: "Keep your story",
        offerCode: "MEMORIES",
        buttonLabel: "Explore",
        buttonUrl: "https://albumo.in/products",
      },
    };
    const created = await originalFetch(origin + "/emails/campaigns", {
      method: "POST",
      headers,
      body: JSON.stringify(draft),
    });
    assert.equal(created.status, 200);
    const row = (await created.json()).data;
    assert.equal(row.design.offerCode, "MEMORIES");
    const preview = (
      await (
        await originalFetch(
          origin + "/emails/campaigns/" + row.id + "/preview",
          { headers },
        )
      ).json()
    ).data;
    assert(preview.html.includes("Keep your story"));
    await originalFetch(origin + "/emails/campaigns/" + row.id + "/test", {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(tables.emailNotification[0].body, preview.html);
    assert.equal(tables.emailNotification[0].email, "vishal.sahani@albumo.in");
    tables.newsletterSubscriber.push(subscriber());
    await api.queueCampaign(row.id);
    assert(tables.emailNotification[1].body.includes("Keep your story"));
    assert(tables.emailNotification[1].text.includes("Offer code: MEMORIES"));
    assert(tables.emailNotification[1].headers["List-Unsubscribe"]);
    const edit = await originalFetch(origin + "/emails/campaigns/" + row.id, {
      method: "PATCH",
      headers,
      body: JSON.stringify(draft),
    });
    assert.equal(edit.status, 409);
    const invalid = await originalFetch(origin + "/emails/campaigns", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...draft,
        design: { buttonUrl: "javascript:bad", buttonLabel: "Bad" },
      }),
    });
    assert.equal(invalid.status, 400);
  });
});

test("separate support email is idempotent and does not change the ticket conversation or status", async () => {
  supportFixture();
  const before = structuredClone(tables.supportTicket[0]);
  const requestId = "89d3bace-7384-4ab2-9315-a287bb939c26";
  const email = await api.sendSupportEmail(
    "support1",
    "About your enquiry",
    "Here is the information you requested.",
    requestId,
    "admin",
  );
  const repeat = await api.sendSupportEmail(
    "support1",
    "About your enquiry",
    "Here is the information you requested.",
    requestId,
    "admin",
  );
  assert.equal(repeat.id, email.id);
  assert.equal(tables.emailNotification.length, 1);
  assert.equal(tables.emailNotification[0].email, before.requesterEmail);
  assert.equal(
    tables.emailNotification[0].metadata.source,
    "SUPPORT_MANUAL_EMAIL",
  );
  assert(
    tables.emailNotification[0].text.includes(
      "Here is the information you requested.",
    ),
  );
  assert.equal(tables.supportTicketMessage.length, 0);
  assert.deepEqual(tables.supportTicket[0], before);
});
test("separate support email rejects placeholder recipients", async () => {
  supportFixture();
  tables.supportTicket[0].requesterEmail = "phone@customer.invalid";
  await assert.rejects(
    api.sendSupportEmail(
      "support1",
      "Hello",
      "A custom message.",
      "request",
      "admin",
    ),
    /deliverable/,
  );
  assert.equal(tables.emailNotification.length, 0);
});
test("manual support email endpoint enforces admin access and a fixed recipient", async () => {
  supportFixture();
  await withServer(async (origin) => {
    const url = origin + "/support/admin/tickets/support1/email";
    const payload = {
      subject: "Your book enquiry",
      message: "We can help with your book.",
      requestId: "89d3bace-7384-4ab2-9315-a287bb939c26",
    };
    for (const [role, expected] of [
      [null, 401],
      ["USER", 403],
      ["ADMIN", 201],
    ]) {
      const response = await originalFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(role ? { "x-test-role": role } : {}),
        },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, expected);
    }
    assert.equal(tables.emailNotification.length, 1);
    assert.equal(tables.adminActionLog[0].actionType, "EMAIL_SUPPORT_CUSTOMER");
    assert.equal(tables.supportTicketMessage.length, 0);
    const headers = {
      "content-type": "application/json",
      "x-test-role": "ADMIN",
    };
    for (const invalid of [
      { ...payload, email: "someoneelse@example.com" },
      { ...payload, subject: "Injected\r\nBcc: other@example.com" },
      { ...payload, message: "" },
    ]) {
      const response = await originalFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(invalid),
      });
      assert.equal(response.status, 400);
    }
    assert.equal(tables.emailNotification.length, 1);
  });
});

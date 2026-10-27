import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  enquirySchema,
  subscribeSchema,
  contactSettingsSchema,
  tokenSchema,
  subscriberQuerySchema,
} from "../src/features/contact/contact.validator.ts";

const state = {
  rows: [],
  emails: [],
  settings: null,
  configured: true,
  mailSuccess: true,
  enquiries: [],
  welcomes: [],
};
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      if ("gt" in value) return row[key] > value.gt;
      if ("contains" in value)
        return row[key].toLowerCase().includes(value.contains.toLowerCase());
    }
    return row[key] === value;
  });
}
function select(row, fields) {
  return fields
    ? Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]))
    : row;
}
const db = {
  contactSetting: {
    findUnique: async () => state.settings,
    upsert: async ({ create, update }) =>
      (state.settings = state.settings
        ? { ...state.settings, ...update }
        : create),
  },
  newsletterSubscriber: {
    findUnique: async ({ where }) =>
      state.rows.find((row) => matches(row, where)) || null,
    upsert: async ({ where, create, update }) => {
      let row = state.rows.find((item) => matches(item, where));
      if (row) Object.assign(row, update);
      else {
        row = {
          id: `subscriber-${state.rows.length}`,
          status: "PENDING",
          createdAt: new Date(),
          confirmedAt: null,
          ...create,
        };
        state.rows.push(row);
      }
      return { ...row };
    },
    update: async ({ where, data }) => {
      const row = state.rows.find((item) => matches(item, where));
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }) => {
      const rows = state.rows.filter((row) => matches(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
    findMany: async ({ where, select: fields, skip = 0, take }) =>
      state.rows
        .filter((row) => matches(row, where))
        .slice(skip, take ? skip + take : undefined)
        .map((row) => select(row, fields)),
    count: async ({ where }) =>
      state.rows.filter((row) => matches(row, where)).length,
  },
  $queryRaw: async () => {
    throw new Error("Do not deserialize PostgreSQL void lock results");
  },
  $executeRaw: async (sql, key) => {
    assert.match(
      sql.join("?"),
      /SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/,
    );
    assert.match(key, /^newsletter:/);
    return 1;
  },
  $transaction: async (input) =>
    typeof input === "function" ? input(db) : Promise.all(input),
};
globalThis.__contactTest = { db, state };
const bundle = await build({
  stdin: {
    contents: "export * from './src/features/contact/contact.service.ts';",
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "isolated-contact",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /(?:lib\/prisma|services\/email(?:\.service|-notification\.service|-marketing\.service)|support\/support\.service)\.js$/,
          },
          ({ path }) => ({ path, namespace: "contact-test" }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: "contact-test" },
          ({ path }) => ({
            loader: "js",
            contents: path.includes("prisma")
              ? "export const prisma = globalThis.__contactTest.db;"
              : path.includes("email-notification")
                ? 'export async function queueRawEmail(input) { const state=globalThis.__contactTest.state;if(!state.mailSuccess)throw Error("Queue unavailable");state.emails.push([input.email,input.subject,input.html,input.text]);return {id:"fixture-email",success:true}; }'
                : path.includes("email-marketing")
                  ? "export async function queueNewsletterWelcome(subscriber) { globalThis.__contactTest.state.welcomes.push(subscriber); }"
                  : path.includes("email.service")
                    ? "export const emailDeliveryConfigured = () => globalThis.__contactTest.state.configured; export async function sendEmail(...args) { globalThis.__contactTest.state.emails.push(args); return {success: globalThis.__contactTest.state.mailSuccess}; }"
                    : 'export async function createSupportTicket(...args) { globalThis.__contactTest.state.enquiries.push(args); return { ticketNumber: "RR-TEST", requesterEmail: args[0].email }; }',
          }),
        );
      },
    },
  ],
});
const service = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
process.env.FRONTEND_URL = "https://store.example.test";
process.env.EMAIL_SITE_URL = "https://store.example.test";
process.env.EMAIL_MARKETING_ENABLED = "false";
const digest = (token) => createHash("sha256").update(token).digest("hex");
const latestToken = () =>
  state.emails.at(-1)[3].match(/#token=([a-f0-9]{64})/)[1];
const input = {
  name: "Test Maker",
  email: "MAKER@example.test",
  intent: "CUSTOM_PROJECT",
  subject: "Soil monitoring system",
  message: "I would like a soil monitoring system for a classroom.",
  consent: true,
};

test("enquiries require consent, meaningful detail and a clean honeypot", () => {
  const parsed = enquirySchema.parse(input);
  assert.equal(parsed.email, "maker@example.test");
  for (const patch of [
    { consent: false },
    { consent: undefined },
    { message: "short" },
    { intent: "ADMIN" },
    { website: "spam" },
    { email: "broken" },
  ])
    assert.equal(
      enquirySchema.safeParse({ ...input, ...patch }).success,
      false,
    );
  assert.equal(
    subscribeSchema.safeParse({ email: "maker@example.test", consent: false })
      .success,
    false,
  );
  assert.equal(tokenSchema.safeParse({ token: "not-a-token" }).success, false);
  assert.equal(
    contactSettingsSchema.safeParse({
      email: "",
      phone: "",
      whatsapp: "javascript:alert(1)",
      hours: "",
      newsletterEnabled: true,
    }).success,
    false,
  );
  assert.equal(subscriberQuerySchema.safeParse({ page: -1 }).success, false);
});

test("custom enquiry uses the existing support pipeline with structured context", async () => {
  const parsed = enquirySchema.parse({
    ...input,
    budget: "To discuss",
    timeline: "Flexible",
    phone: "+91 1234567890",
  });
  const result = await service.createEnquiry(parsed, "signed-in-user");
  const [ticket, user, context] = state.enquiries.at(-1);
  assert.equal(result.ticketNumber, "RR-TEST");
  assert.equal(user, "signed-in-user");
  assert.equal(context.source, "CUSTOM_PROJECT");
  assert.equal(context.enquiry.budget, "To discuss");
  assert.match(ticket.subject, /^\[Custom project\]/);
  assert.match(ticket.description, /not newsletter marketing/);
  assert.equal(ticket.priority, "MEDIUM");
  assert.equal(ticket.category, "TECHNICAL");
});

test("signup records consent without email while marketing is disabled", async () => {
  state.configured = false;
  const before = state.emails.length;
  assert.deepEqual(
    await service.requestNewsletterEmail(
      "maker@example.test",
      "subscribe",
      "FOOTER",
    ),
    { available: true, delivered: true },
  );
  const row = state.rows[0];
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.confirmedAt, null);
  assert.equal(row.confirmTokenHash, null);
  assert.equal(row.confirmExpiresAt, null);
  assert.equal(row.source, "FOOTER");
  assert.equal(row.consentVersion, "newsletter-single-opt-in-2026-10-08");
  assert.equal(state.emails.length, before);
  assert.equal((await service.getContactSettings()).newsletterEnabled, true);
  state.configured = true;
});

test("duplicate signup is idempotent and preserves the existing consent timestamp", async () => {
  const before = state.emails.length,
    consentAt = state.rows[0].consentAt;
  await service.requestNewsletterEmail("maker@example.test", "subscribe");
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].consentAt, consentAt);
  assert.equal(state.emails.length, before);
  await service.requestNewsletterEmail("unknown@example.test", "manage");
  assert.equal(state.emails.length, before);
});

test("unsubscribe still uses a private link; fresh explicit signup reactivates without email", async () => {
  await service.requestNewsletterEmail("maker@example.test", "manage");
  const token = latestToken();
  assert.equal(state.rows[0].unsubscribeTokenHash, digest(token));
  assert.equal(await service.unsubscribeNewsletter(token), true);
  assert.equal(await service.unsubscribeNewsletter(token), true);
  assert.equal(state.rows[0].status, "UNSUBSCRIBED");
  const before = state.emails.length;
  await service.requestNewsletterEmail("maker@example.test", "subscribe");
  assert.equal(state.rows[0].status, "ACTIVE");
  assert.equal(state.rows[0].unsubscribedAt, null);
  assert.equal(state.emails.length, before);
  assert.equal(await service.adminUnsubscribe(state.rows[0].id), true);
  assert.equal(state.rows[0].status, "UNSUBSCRIBED");
});

test("legacy pending records activate on signup and invalidate old confirmation tokens", async () => {
  state.rows.push({
    id: "legacy",
    email: "legacy@example.test",
    status: "PENDING",
    consentAt: new Date(0),
    confirmTokenHash: digest("a".repeat(64)),
    confirmExpiresAt: new Date(Date.now() + 60000),
  });
  const before = state.emails.length;
  await service.requestNewsletterEmail("legacy@example.test", "subscribe");
  assert.equal(state.rows.at(-1).status, "ACTIVE");
  assert.equal(await service.confirmNewsletter("a".repeat(64)), false);
  assert.equal(state.emails.length, before);
});

test("preference queue failure is reported and retryable without changing subscription status", async () => {
  state.mailSuccess = false;
  assert.deepEqual(
    await service.requestNewsletterEmail("legacy@example.test", "manage"),
    { available: true, delivered: false },
  );
  assert.equal(state.rows.at(-1).deliveryError, true);
  assert.equal(state.rows.at(-1).status, "ACTIVE");
  assert.equal(state.rows.at(-1).lastEmailAt, null);
  state.mailSuccess = true;
  assert.equal(
    (await service.requestNewsletterEmail("legacy@example.test", "manage"))
      .delivered,
    true,
  );
  assert.equal(state.rows.at(-1).deliveryError, false);
});

test("pausing acquisition still permits preference management", async () => {
  state.settings = { email: "team@example.test", newsletterEnabled: false };
  assert.equal(
    (await service.requestNewsletterEmail("new@example.test", "subscribe"))
      .available,
    false,
  );
  state.rows.at(-1).lastEmailAt = null;
  assert.equal(
    (await service.requestNewsletterEmail("legacy@example.test", "manage"))
      .delivered,
    true,
  );
  state.settings.newsletterEnabled = true;
});

test("admin export includes active form consent, excludes opt-outs and never exposes tokens", async () => {
  const data = await service.listSubscribers({ page: 1, search: "" });
  assert.equal(data.summary.active, 1);
  assert.equal(data.subscribers[0].confirmTokenHash, undefined);
  const csv = await service.exportSubscribers();
  assert.match(csv, /Email,Consent at/);
  assert.match(csv, /legacy@example.test/);
  assert.doesNotMatch(csv, /maker@example.test/);
  assert.equal(service.csvCell("=1+1"), '"\'=1+1"');
});

test("enabled marketing queues one welcome per fresh consent and invalidates old preference tokens", async () => {
  process.env.EMAIL_MARKETING_ENABLED = "true";
  state.settings.newsletterEnabled = true;
  await service.requestNewsletterEmail("welcome@example.test", "subscribe");
  await service.requestNewsletterEmail("welcome@example.test", "subscribe");
  assert.equal(state.welcomes.length, 1);
  await service.requestNewsletterEmail("welcome@example.test", "manage");
  const oldToken = latestToken();
  await service.unsubscribeNewsletter(oldToken);
  await service.requestNewsletterEmail("welcome@example.test", "subscribe");
  assert.equal(state.welcomes.length, 2);
  assert.equal(await service.unsubscribeNewsletter(oldToken), false);
  process.env.EMAIL_MARKETING_ENABLED = "false";
});

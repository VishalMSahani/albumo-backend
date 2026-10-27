import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import express from "express";

let rows = [];
let sequence = 0;
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part) => matches(row, part));
    if (value && typeof value === "object" && "contains" in value)
      return String(row[key] || "")
        .toLowerCase()
        .includes(value.contains.toLowerCase());
    return row[key] === value;
  });
}
const model = {
  create: async ({ data }) => {
    const row = {
      id: "p" + ++sequence,
      status: "NEW",
      isPublished: false,
      directoryConsent: false,
      ...data,
    };
    rows.push(row);
    return structuredClone(row);
  },
  findUnique: async ({ where }) =>
    structuredClone(rows.find((row) => matches(row, where)) || null),
  update: async ({ where, data }) => {
    const row = rows.find((item) => matches(item, where));
    Object.assign(row, data);
    return structuredClone(row);
  },
  findMany: async ({ where, select, skip = 0, take = 100 }) =>
    rows
      .filter((row) => matches(row, where))
      .slice(skip, skip + take)
      .map((row) =>
        select
          ? Object.fromEntries(
              Object.keys(select).map((key) => [key, row[key]]),
            )
          : structuredClone(row),
      ),
  count: async ({ where } = {}) =>
    rows.filter((row) => matches(row, where)).length,
};
const mock = { partnerInquiry: model, $queryRaw: async () => [] };
mock.$transaction = async (callback) => callback(mock);
globalThis.__partnerTestPrisma = mock;
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/features/partners/partner.service.ts'; export * from './src/features/partners/partner.validator.ts'; export {default as routes} from './src/features/partners/partner.routes.ts';",
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
      name: "isolated-partners",
      setup(builder) {
        const replacements = [
          [
            /lib\/prisma\.js$/,
            "export const prisma=globalThis.__partnerTestPrisma;",
          ],
          [
            /auth-throttle\.service\.js$/,
            "export async function limitAuth() {}",
          ],
          [
            /admin-action-log\.service\.js$/,
            "export async function logAdminAction() {}",
          ],
          [
            /auth\.middleware\.js$/,
            `export function authenticate(req,res,next){if(req.headers["x-test-admin"]!=="yes")return res.status(401).json({error:"Authentication required"});req.user={userId:"admin"};next();}export const authorize=()=> (req,res,next)=>next();`,
          ],
        ];
        for (const [filter, contents] of replacements) {
          builder.onResolve({ filter }, (args) => ({
            path: args.path,
            namespace: "partner-fixture",
          }));
          builder.onLoad(
            { filter: /.*/, namespace: "partner-fixture" },
            (args) =>
              filter.test(args.path) ? { contents, loader: "js" } : undefined,
          );
        }
      },
    },
  ],
});
const filename = fileURLToPath(
  new URL("./partners-fixture.cjs", import.meta.url),
);
const mod = new Module(filename);
mod.filename = filename;
mod.paths = createRequire(import.meta.url).resolve.paths("express");
mod._compile(bundle.outputFiles[0].text, filename);
const api = mod.exports;
const app = express();
app.use(express.json());
app.use("/api/partners", api.routes);
app.use((error, _req, res, _next) =>
  res
    .status(error.statusCode || (error.name === "ZodError" ? 400 : 500))
    .json({ error: error.message }),
);
const server = await new Promise((resolve) => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const origin = "http://127.0.0.1:" + server.address().port;
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  rows = [];
});
const application = () => ({
  partnerType: "TRAVEL_AGENCY",
  name: "Asha Shah",
  email: "ASHA@example.invalid",
  phone: "+91 98765 43210",
  companyName: "Example Journeys",
  city: "Pune",
  website: "https://example.invalid",
  message: "We would like albums after our group trips.",
  contactConsent: true,
  directoryConsent: true,
  companyFax: "",
});
const profile = () => ({
  publicName: "Example Journeys",
  publicDescription: "Small group journeys in the mountains.",
  publicCity: "Pune",
  publicWebsite: "https://example.invalid",
});
async function create(extra = {}) {
  return api.createPartnerInquiry(
    api.createPartnerInquirySchema.parse({ ...application(), ...extra }),
  );
}
async function request(path, method = "GET", body, admin = false) {
  const response = await fetch(origin + "/api/partners" + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(admin ? { "x-test-admin": "yes" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("applications record separate contact and optional directory consent", async () => {
  const row = await create({ directoryConsent: false });
  assert.equal(row.email, "asha@example.invalid");
  assert(row.contactConsentAt instanceof Date);
  assert.equal(row.directoryConsentAt, null);
  assert.equal(row.isPublished, false);
  const optedIn = await create();
  assert(optedIn.directoryConsentAt instanceof Date);
});

test("contact consent, business details and an empty spam trap are enforced", () => {
  for (const extra of [
    { contactConsent: false },
    { contactConsent: undefined },
    { companyName: "" },
    { city: "" },
    { companyFax: "spam" },
    { phone: "not a phone" },
  ])
    assert.equal(
      api.createPartnerInquirySchema.safeParse({ ...application(), ...extra })
        .success,
      false,
    );
});

test("unsafe website links are rejected in applications and public profiles", () => {
  for (const website of [
    "javascript:alert(1)",
    "data:text/html,test",
    "ftp://example.invalid",
    "https://user:password@example.invalid",
  ])
    assert.equal(
      api.createPartnerInquirySchema.safeParse({ ...application(), website })
        .success,
      false,
    );
  assert.equal(
    api.updatePartnerInquirySchema.safeParse({
      publicWebsite: "javascript:alert(1)",
    }).success,
    false,
  );
  assert.equal(
    api.updatePartnerInquirySchema.safeParse({ directoryConsent: true })
      .success,
    false,
  );
});

test("partners can apply without opting in to a public listing", async () => {
  const { directoryConsent, ...input } = application();
  const result = await request("/inquiries", "POST", input);
  assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.body.data).sort(), ["email", "id"]);
  assert.equal(rows[0].directoryConsent, false);
});

test("onboarding and explicit consent are both required before publication", async () => {
  const row = await create();
  await assert.rejects(
    api.updatePartnerInquiry(row.id, { ...profile(), isPublished: true }),
    /Onboard/,
  );
  const privateRow = await create({ directoryConsent: false });
  await assert.rejects(
    api.updatePartnerInquiry(privateRow.id, {
      ...profile(),
      status: "ONBOARDED",
      isPublished: true,
    }),
    /opted in/,
  );
});

test("incomplete profiles remain private; complete approved profiles can be published", async () => {
  const row = await create();
  await assert.rejects(
    api.updatePartnerInquiry(row.id, {
      status: "ONBOARDED",
      isPublished: true,
    }),
    /Complete/,
  );
  const published = await api.updatePartnerInquiry(row.id, {
    ...profile(),
    status: "ONBOARDED",
    isPublished: true,
  });
  assert.equal(published.isPublished, true);
  await assert.rejects(
    api.updatePartnerInquiry(row.id, { publicName: "" }),
    /Complete/,
  );
});

test("moving away from onboarded unpublishes and returning does not auto-publish", async () => {
  const row = await create();
  await api.updatePartnerInquiry(row.id, {
    ...profile(),
    status: "ONBOARDED",
    isPublished: true,
  });
  assert.equal(
    (await api.updatePartnerInquiry(row.id, { status: "DECLINED" }))
      .isPublished,
    false,
  );
  assert.equal(
    (await api.updatePartnerInquiry(row.id, { status: "ONBOARDED" }))
      .isPublished,
    false,
  );
});

test("manual unpublish preserves the application and the profile draft", async () => {
  const row = await create();
  await api.updatePartnerInquiry(row.id, {
    ...profile(),
    status: "ONBOARDED",
    isPublished: true,
  });
  const updated = await api.updatePartnerInquiry(row.id, {
    isPublished: false,
  });
  assert.equal(updated.publicName, profile().publicName);
  assert.equal(updated.email, row.email);
  assert.equal(
    (await api.listPartnerDirectory({ page: 1 })).partners.length,
    0,
  );
});

test("public directory excludes private enquiries and all personal/internal fields", async () => {
  await create({ directoryConsent: false });
  const row = await create();
  await api.updatePartnerInquiry(row.id, {
    ...profile(),
    status: "ONBOARDED",
    adminNotes: "Private agreement",
    isPublished: true,
  });
  const result = await request("/directory");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.partners.length, 1);
  assert.deepEqual(Object.keys(result.body.data.partners[0]).sort(), [
    "id",
    "partnerType",
    "publicCity",
    "publicDescription",
    "publicName",
    "publicWebsite",
  ]);
  assert(!JSON.stringify(result.body).includes("Private agreement"));
  assert(!JSON.stringify(result.body).includes(row.email));
});

test("public filters search business name and city, never private contact data", async () => {
  const row = await create();
  await api.updatePartnerInquiry(row.id, {
    ...profile(),
    status: "ONBOARDED",
    isPublished: true,
  });
  assert.equal(
    (
      await api.listPartnerDirectory({
        page: 1,
        search: "pune",
        partnerType: "TRAVEL_AGENCY",
      })
    ).partners.length,
    1,
  );
  assert.equal(
    (
      await api.listPartnerDirectory({
        page: 1,
        search: "asha@example.invalid",
      })
    ).partners.length,
    0,
  );
  assert.equal(
    (await api.listPartnerDirectory({ page: 1, partnerType: "PHOTOGRAPHER" }))
      .partners.length,
    0,
  );
});

test("public directory paginates and validates query input", async () => {
  for (let index = 0; index < 13; index++) {
    const row = await create();
    await api.updatePartnerInquiry(row.id, {
      ...profile(),
      status: "ONBOARDED",
      isPublished: true,
    });
  }
  const first = await api.listPartnerDirectory({ page: 1 });
  const second = await api.listPartnerDirectory({ page: 2 });
  assert.equal(first.partners.length, 12);
  assert.equal(second.partners.length, 1);
  assert.equal(first.pagination.totalPages, 2);
  assert.equal((await request("/directory?page=-1")).status, 400);
  assert.equal((await request("/directory?partnerType=INVALID")).status, 400);
});

test("anonymous visitors cannot read enquiries or publish profiles", async () => {
  const row = await create();
  assert.equal((await request("/admin/inquiries")).status, 401);
  assert.equal(
    (
      await request("/admin/inquiries/" + row.id, "PATCH", {
        isPublished: true,
      })
    ).status,
    401,
  );
  const result = await request(
    "/admin/inquiries/" + row.id,
    "PATCH",
    { ...profile(), status: "ONBOARDED", isPublished: true },
    true,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.data.isPublished, true);
});

test("blank and omitted websites are accepted for applications and profile drafts", () => {
  for (const website of ["", "   ", undefined]) {
    const applicationResult = api.createPartnerInquirySchema.safeParse({
      ...application(),
      website,
    });
    assert.equal(applicationResult.success, true);
    assert.equal(
      applicationResult.data.website,
      website === undefined ? undefined : "",
    );
    const profileResult = api.updatePartnerInquirySchema.safeParse({
      publicWebsite: website,
    });
    assert.equal(profileResult.success, true);
  }
  assert.equal(
    api.updatePartnerInquirySchema.safeParse({ publicWebsite: null }).success,
    true,
  );
});

test("malformed website validation returns issues instead of throwing", () => {
  for (const website of [
    "not a url",
    "example.com",
    "https://",
    "https://[invalid",
    "https://exa mple.com",
  ]) {
    const applicationResult = api.createPartnerInquirySchema.safeParse({
      ...application(),
      website,
    });
    assert.equal(applicationResult.success, false);
    const profileResult = api.updatePartnerInquirySchema.safeParse({
      publicWebsite: website,
    });
    assert.equal(profileResult.success, false);
  }
});

test("blank application websites are saved as optional contact details", async () => {
  for (const website of ["", "   "]) {
    const result = await request("/inquiries", "POST", {
      ...application(),
      website,
    });
    assert.equal(result.status, 201);
    assert.equal(rows.at(-1).website, null);
  }
});

test("admin can save or clear a draft website but must supply one to publish", async () => {
  const row = await create();
  const path = "/admin/inquiries/" + row.id;
  const draft = await request(
    path,
    "PATCH",
    {
      ...profile(),
      publicWebsite: "",
      status: "ONBOARDED",
      isPublished: false,
    },
    true,
  );
  assert.equal(draft.status, 200);
  assert.equal(draft.body.data.publicWebsite, "");
  const incomplete = await request(path, "PATCH", { isPublished: true }, true);
  assert.equal(incomplete.status, 400);
  assert.match(incomplete.body.error, /Complete all public profile fields/);
  const published = await request(
    path,
    "PATCH",
    { publicWebsite: " https://example.invalid ", isPublished: true },
    true,
  );
  assert.equal(published.status, 200);
  assert.equal(published.body.data.publicWebsite, "https://example.invalid");
  const cleared = await request(
    path,
    "PATCH",
    { publicWebsite: "", isPublished: false },
    true,
  );
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.isPublished, false);
});

test("malformed website PATCH requests return validation errors and preserve the existing profile", async () => {
  const row = await create();
  await api.updatePartnerInquiry(row.id, {
    ...profile(),
    status: "ONBOARDED",
    isPublished: true,
  });
  for (const publicWebsite of [
    "not a url",
    "https://",
    "javascript:alert(1)",
  ]) {
    const response = await request(
      "/admin/inquiries/" + row.id,
      "PATCH",
      { publicWebsite },
      true,
    );
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "VALIDATION_ERROR");
    assert.match(response.body.error, /http:\/\/ or https:\/\//);
    assert.equal(
      rows.find((item) => item.id === row.id).publicWebsite,
      profile().publicWebsite,
    );
  }
});

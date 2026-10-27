// Disposable local PostgreSQL only. No .env, remote database, storage, email or payment calls.
import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { build } from "esbuild";
import express from "express";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
const bin = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
let temporary, started, db, server, origin, services;
const configuration = {
  format: "album",
  personalizationEnabled: true,
  allowPhotoUpload: true,
  allowText: true,
  instructions: "",
  productionDays: 7,
  groups: ["dimension", "cover", "paper", "pages"].map((kind) => ({
    id: kind,
    kind,
    label: kind,
    required: true,
    defaultOptionId: "choice",
    options: [
      {
        id: "choice",
        label: kind === "pages" ? "20 pages" : kind,
        priceAdjustmentCents: 1000,
        ...(kind === "dimension" ? { width: 8, height: 8, unit: "in" } : {}),
      },
    ],
  })),
};
const shippingAddress = {
  name: "Test Customer",
  phone: "9876543210",
  line1: "123 Test Road",
  line2: "",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
  country: "India",
};
function command(name, args) {
  const result = spawnSync(
    path.join(bin, name + (process.platform === "win32" ? ".exe" : "")),
    args,
    { windowsHide: true, stdio: "ignore", timeout: 60000 },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
}
before(
  async () => {
    let connectionString = process.env.CHECKOUT_TEST_DATABASE_URL;
    if (connectionString) {
      const target = new URL(connectionString);
      assert(
        ["127.0.0.1", "localhost"].includes(target.hostname) &&
          target.pathname.startsWith("/albumo_checkout_test"),
        "Only a dedicated local checkout test database is allowed",
      );
    } else {
      temporary = await mkdtemp(path.join(tmpdir(), "albumo-checkout-test-"));
      const finder = createServer();
      await new Promise((r) => finder.listen(0, "127.0.0.1", r));
      const port = finder.address().port;
      await new Promise((r) => finder.close(r));
      command("initdb", [
        "-D",
        path.join(temporary, "data"),
        "-U",
        "postgres",
        "-A",
        "trust",
        "--encoding=UTF8",
        "--locale=C",
        "--no-sync",
      ]);
      command("pg_ctl", [
        "-D",
        path.join(temporary, "data"),
        "-l",
        path.join(temporary, "pg.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -F -c shared_buffers=16MB -c max_connections=30`,
        "-w",
        "start",
      ]);
      started = true;
      connectionString = `postgresql://postgres@127.0.0.1:${port}/postgres`;
    }
    const sql = new pg.Client({ connectionString });
    await sql.connect();
    try {
      await sql.query(
        await readFile(
          new URL("./fixtures/checkout-base.sql", import.meta.url),
          "utf8",
        ),
      );
      await sql.query(
        await readFile(
          new URL(
            "../prisma/migrations/20261024010000_studio_checkout/migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await sql.query(await readFile(new URL('../prisma/migrations/20261024180000_studio_trash/migration.sql', import.meta.url), 'utf8'));
    await sql.query(await readFile(new URL('../prisma/migrations/20261026010000_studio_operations/migration.sql', import.meta.url), 'utf8'));
    } finally {
      await sql.end();
    }
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    globalThis.__checkoutDb = db;
    const result = await build({
      stdin: {
        contents: `export {default as routes} from './src/features/checkout/checkout.routes.ts'; export * from './src/features/checkout/cart.service.ts'; export * from './src/features/checkout/checkout.service.ts'; export {projectQuality,acceptProjectProof,approveOrderPrint,printReport} from './src/features/studio/print-quality.ts'; export {resolveConfiguration} from './src/features/studio/configuration.ts'; export {handleHostedCheckoutReturn,handleWebhook} from './src/features/payments/services/zoho.service.ts'; export {confirmUserOrderPayment,updateAdminOrderStatus} from './src/features/orders/services/order.service.ts'; export {updateUserAddress} from './src/features/addresses/services/address.service.ts';`,
        resolveDir: process.cwd(),
      },
      define: {
        "import.meta.url": JSON.stringify(
          new URL("../src/generated/prisma/client.ts", import.meta.url).href,
        ),
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
      write: false,
      plugins: [
        {
          name: "fixtures",
          setup(b) {
            for (const [filter, name] of [
              [/lib\/prisma\.js$/, "db"],
              [/lib\/redis\.js$/, "redis"],
              [/auth\.middleware\.js$/, "auth"],
              [/r2-storage\.service\.js$/, "storage"],
              [/email-notification\.service\.js$/, "email"],
            ])
              b.onResolve({ filter }, () => ({
                path: name,
                namespace: "fixture",
              }));
            b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
              loader: "js",
              contents: {
                db: "export const prisma=globalThis.__checkoutDb;",
                redis: "export const redis=null;",
                auth: `export function authenticate(req,res,next){const userId=req.headers['x-owner'];if(!['a','b'].includes(userId))return res.status(401).json({success:false});req.user={userId,role:'STUDENT'};next();}`,
                storage: `export async function privateDownloadUrl(key){return 'https://private.invalid/'+key;} export async function prepareStagedPut(){} export async function deleteR2Object(){} export async function openStagedObject(){} export async function putR2Object(){}`,
                email: "export async function queueEmailNotification(){}",
              }[path],
            }));
          },
        },
      ],
    });
    const module = { exports: {} };
    new Function("require", "module", "exports", result.outputFiles[0].text)(
      createRequire(import.meta.url),
      module,
      module.exports,
    );
    services = module.exports;
    const app = express();
    app.use(express.json());
    app.use("/api/checkout", services.routes);
    app.use((e, _q, r, _n) =>
      r.status(e.statusCode || 500).json({ success: false, error: e.message }),
    );
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    origin = `http://127.0.0.1:${server.address().port}/api/checkout`;
    process.env.ZOHO_PAYMENTS_SIGNING_KEY = "isolated-checkout-test-key";
  },
  { timeout: 180000 },
);
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (db) await db.$disconnect();
  delete globalThis.__checkoutDb;
  if (started)
    command("pg_ctl", [
      "-D",
      path.join(temporary, "data"),
      "-m",
      "fast",
      "-w",
      "stop",
    ]);
  if (temporary) {
    const target = path.resolve(temporary);
    assert(
      path.dirname(target) === path.resolve(tmpdir()) &&
        path.basename(target).startsWith("albumo-checkout-test-"),
    );
    await rm(target, { recursive: true, force: true });
  }
});
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "User", "Component" CASCADE');
  await db.user.createMany({
    data: [
      { id: "a", email: "a@example.test" },
      { id: "b", email: "b@example.test" },
    ],
  });
});
async function fixture(ownerId = "a", productId) {
  const product = productId
    ? await db.component.findUniqueOrThrow({ where: { id: productId } })
    : await db.component.create({
        data: {
          name: "Everyday album",
          unitPriceCents: 20000,
          discountedPriceCents: 15000,
          stockQuantity: 10,
          configuration,
        },
      });
  const config = services.resolveConfiguration(product, {
    productId: product.id,
    choices: Object.fromEntries(
      configuration.groups.map((g) => [g.id, "choice"]),
    ),
    quantity: 1,
    personalText: "Our summer",
  });
  const project = await db.studioProject.create({
    data: {
      ownerId,
      title: "Our summer",
      occasion: "TRAVEL",
      requestId: randomUUID(),
      requestHash: "a".repeat(64),
      productId: product.id,
      configuration: config,
      pageCount: config.pageCount,
      minimumPhotos: config.minimumPhotos,
      recommendedPhotos: config.recommendedPhotos,
    },
  });
  const assets = await Promise.all(
    Array.from({ length: config.minimumPhotos }, (_, i) =>
      db.studioAsset.create({
        data: {
          projectId: project.id,
          requestId: randomUUID(),
          uploaderKey: ownerId,
          filename: `photo-${i}.jpg`,
          mimeType: "image/jpeg",
          byteSize: 100,
          status: "READY",
          stagingKey: randomUUID(),
          originalKey: randomUUID(),
          previewKey: randomUUID(),
          expiresAt: new Date(Date.now() + 100000),
        },
      }),
    ),
  );
  const placement = (a) => ({ assetId: a.id, x: 50, y: 50 });
  const document = {
    version: 1,
    template: "travel",
    cover: { title: "Our summer", photo: placement(assets[0]) },
    pages: Array.from({ length: config.pageCount }, (_, i) => ({
      id: randomUUID(),
      layout: "full",
      caption: "",
      photos: [placement(assets[i])],
    })),
  };
  await db.studioProject.update({
    where: { id: project.id },
    data: { document },
  });
  return { project, product, assets, document };
}
async function request(route, { owner = "a", method = "GET", body } = {}) {
  const r = await fetch(origin + route, {
    method,
    headers: { "content-type": "application/json", "x-owner": owner },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: r.status,
    cache: r.headers.get("cache-control"),
    ...(await r.json()),
  };
}
async function added(owner = "a", productId) {
  const f = await fixture(owner, productId);
  const item = await services.addAlbumToCart(owner, f.project.id, 1);
  return { ...f, item };
}
async function payload(owner = "a", overrides = {}) {
  const quote = await services.getCheckoutCart(owner);
  return {
    requestId: randomUUID(),
    quoteHash: quote.quoteHash,
    couponCode: "",
    shippingAddress,
    legalConsent: { accepted: true, policyVersion: "2026-09-02" },
    designAccepted: true,
    ...overrides,
  };
}
test("session, ownership and strict checkout validation protect cart and private previews", async () => {
  const { project, item } = await added();
  assert.equal((await request("/cart", { owner: "" })).status, 401);
  assert.equal(
    (
      await request(`/albums/${project.id}`, {
        owner: "b",
        method: "POST",
        body: { baseRevision: 1 },
      })
    ).status,
    404,
  );
  assert.equal(
    (await request(`/albums/${item.cartItemId}/design`, { owner: "b" })).status,
    404,
  );
  assert.equal(
    (
      await request("/orders", {
        method: "POST",
        body: { ...(await payload()), totalCents: 1 },
      })
    ).status,
    400,
  );
  assert.equal((await request("/cart")).cache, "private, no-store");
});
test("distinct albums using one product stay separate; repeated add is idempotent; prices include sale and option charges", async () => {
  const first = await added();
  await added("a", first.product.id);
  await services.addAlbumToCart("a", first.project.id, 1);
  const cart = await services.getCheckoutCart("a");
  assert.equal(cart.lines.length, 2);
  assert.equal(cart.lines[0].unitPriceCents, 19000);
  assert.equal(cart.subtotalCents, 38000);
  assert.equal(cart.shippingCents, 5000);
  await services.changeAlbumQuantity("a", first.item.cartItemId, 1, 2);
  await assert.rejects(
    services.changeAlbumQuantity("a", first.item.cartItemId, 1, 3),
  );
  await services.addAlbumToCart("a", first.project.id, 1);
  assert.equal(
    (
      await db.studioCartItem.findUnique({
        where: { id: first.item.cartItemId },
      })
    ).quantity,
    2,
  );
});
test("incomplete designs and unavailable photo originals cannot enter cart", async () => {
  const f = await fixture();
  await db.studioProject.update({
    where: { id: f.project.id },
    data: { document: { ...f.document, cover: { title: "", photo: null } } },
  });
  await assert.rejects(services.addAlbumToCart("a", f.project.id, 1), /photo/);
  await db.studioProject.update({
    where: { id: f.project.id },
    data: { document: f.document },
  });
  await db.studioAsset.update({
    where: { id: f.assets[0].id },
    data: { originalKey: null },
  });
  await assert.rejects(services.addAlbumToCart("a", f.project.id, 1), /photos/);
});
test("checkout freezes the saved design, records consent, consumes cart and replays exactly one order", async () => {
  const f = await added();
  const input = await payload();
  await db.studioProject.update({
    where: { id: f.project.id },
    data: { title: "Later edit", revision: 2 },
  });
  await db.studioAsset.update({
    where: { id: f.assets[0].id },
    data: { selected: false },
  });
  const results = await Promise.all([
    services.createCheckoutOrder("a", input, {}),
    services.createCheckoutOrder("a", input, {}),
  ]);
  assert.equal(results[0].orderId, results[1].orderId);
  const order = await services.checkoutOrder("a", results[0].orderId);
  assert.equal(order.items[0].album.title, "Our summer");
  assert.equal(order.status, "PENDING_PAYMENT");
  assert.equal(order.totalAmountCents, 24000);
  assert.equal(await db.order.count(), 1);
  assert.equal(await db.consentRecord.count(), 1);
  assert.equal((await services.getCheckoutCart("a")).lines.length, 0);
  const link = await db.studioOrderLink.findFirst();
  assert.equal(link.snapshot.printApproved, false);
  assert.deepEqual(link.snapshot.document, f.document);
  assert.equal(
    (await services.checkoutAttempt("a", input.requestId)).orderId,
    order.id,
  );
  await assert.rejects(services.checkoutOrder("b", order.id));
  const saved = await services.savedOrderDesign(
    "a",
    order.id,
    order.items[0].id,
  );
  assert.equal(saved.revision, 1);
  assert(
    saved.photos.every((p) =>
      p.previewUrl.startsWith("https://private.invalid/"),
    ),
  );
  await assert.rejects(
    services.createCheckoutOrder(
      "a",
      { ...input, shippingAddress: { ...shippingAddress, city: "Delhi" } },
      {},
    ),
    /already used/,
  );
  const storedOrder = await db.order.findUnique({ where: { id: order.id } });
  await assert.rejects(
    services.updateUserAddress("a", storedOrder.addressId, {
      ...shippingAddress,
      city: "Delhi",
    }),
    /saved with an order/,
  );
});
test("changed prices require fresh review; another user address is rejected without stock loss", async () => {
  const f = await added();
  const input = await payload();
  await db.component.update({
    where: { id: f.product.id },
    data: { discountedPriceCents: 16000 },
  });
  await assert.rejects(
    services.createCheckoutOrder("a", input, {}),
    /prices changed/,
  );
  assert.equal(await db.order.count(), 0);
  const foreign = await db.address.create({
    data: { ...shippingAddress, userId: "b" },
  });
  const next = await payload();
  delete next.shippingAddress;
  next.shippingAddressId = foreign.id;
  await assert.rejects(services.createCheckoutOrder("a", next, {}), /address/);
  assert.equal(
    (await db.component.findUnique({ where: { id: f.product.id } }))
      .stockQuantity,
    10,
  );
});
test("two customers racing for the final album cannot oversell", async () => {
  const f = await added();
  await added("b", f.product.id);
  await db.component.update({
    where: { id: f.product.id },
    data: { stockQuantity: 1 },
  });
  const inputs = await Promise.all([payload("a"), payload("b")]);
  const results = await Promise.allSettled(
    ["a", "b"].map((owner, i) =>
      services.createCheckoutOrder(owner, inputs[i], {}),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await db.order.count(), 1);
  assert.equal(
    (await db.component.findUnique({ where: { id: f.product.id } }))
      .stockQuantity,
    0,
  );
});
test("a one-use coupon cannot be redeemed concurrently by two customers", async () => {
  await added();
  await added("b");
  await db.coupon.deleteMany();
  await db.coupon.create({
    data: {
      code: "ONLYONE",
      label: "One use",
      discountType: "FLAT",
      discountValue: 1000,
      maxUsageCount: 1,
    },
  });
  const inputs = await Promise.all(
    ["a", "b"].map(async (owner) => ({
      ...(await payload(owner)),
      couponCode: "ONLYONE",
      quoteHash: (await services.getCheckoutCart(owner, "ONLYONE")).quoteHash,
    })),
  );
  const results = await Promise.allSettled(
    ["a", "b"].map((owner, i) =>
      services.createCheckoutOrder(owner, inputs[i], {}),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
function signedReturn(session, orderId, amount) {
  const query = {
    payments_session_id: session,
    payment_session_status: "succeeded",
    payment_id: "fixture-payment",
    payment_status: "success",
    amount: String(amount),
    udf1: orderId,
  };
  const fields = [
    "payments_session_id",
    "payment_session_status",
    "payment_id",
    "payment_status",
    "amount",
    "mandate_id",
    "udf1",
    "udf2",
    "udf3",
    "udf4",
    "udf5",
  ];
  query.signature = createHmac("sha256", process.env.ZOHO_PAYMENTS_SIGNING_KEY)
    .update(fields.map((f) => query[f] || "").join("."))
    .digest("hex");
  return query;
}
test("payment success requires the correct signed session and amount; repeats never regress shipped orders", async () => {
  await added();
  const { orderId } = await services.createCheckoutOrder(
    "a",
    await payload(),
    {},
  );
  await db.payment.updateMany({
    where: { orderId },
    data: { gatewayOrderId: "fixture-session" },
  });
  await assert.rejects(
    services.confirmUserOrderPayment("a", orderId),
    /provider/,
  );
  await assert.rejects(
    services.handleHostedCheckoutReturn(
      orderId,
      signedReturn("wrong-session", orderId, 240),
    ),
    /session/,
  );
  await assert.rejects(
    services.handleHostedCheckoutReturn(
      orderId,
      signedReturn("fixture-session", orderId, 1),
    ),
    /amount/,
  );
  assert.equal(
    (await db.order.findUnique({ where: { id: orderId } })).status,
    "PENDING_PAYMENT",
  );
  await services.handleHostedCheckoutReturn(
    orderId,
    signedReturn("fixture-session", orderId, 240),
  );
  assert.equal(
    (await db.order.findUnique({ where: { id: orderId } })).status,
    "PAID",
  );
  await db.order.update({
    where: { id: orderId },
    data: { status: "SHIPPED" },
  });
  await services.handleHostedCheckoutReturn(
    orderId,
    signedReturn("fixture-session", orderId, 240),
  );
  assert.equal(
    (await db.order.findUnique({ where: { id: orderId } })).status,
    "SHIPPED",
  );
});
test("late payment on a cancelled order goes to refund review instead of fulfilment", async () => {
  await added();
  const { orderId } = await services.createCheckoutOrder(
    "a",
    await payload(),
    {},
  );
  await db.payment.updateMany({
    where: { orderId },
    data: { gatewayOrderId: "late-session" },
  });
  await db.order.update({
    where: { id: orderId },
    data: { status: "CANCELLED" },
  });
  await services.handleHostedCheckoutReturn(
    orderId,
    signedReturn("late-session", orderId, 240),
  );
  assert.equal(
    (await db.order.findUnique({ where: { id: orderId } })).status,
    "REFUND_INITIATED",
  );
});


test("confirmed print profiles require current proof and reapproval refreshes the same cart line", async () => {
  const f=await fixture();
  await db.studioAsset.updateMany({where:{projectId:f.project.id},data:{width:3600,height:3600}});
  const policy={profiles:[{productId:'',supplier:'Fixture printer',targetDpi:300,minimumDpi:150,bleedMm:3,safeMm:5,approved:true}],retentionEnabled:false,retentionDays:null,alertMinutes:30};
  await db.studioOperationSetting.upsert({where:{id:1},create:{id:1,policy},update:{policy}});
  try {
    await assert.rejects(services.addAlbumToCart('a',f.project.id,1),/proof|Review|approve/i);
    let quality=await services.projectQuality(f.project.id,'a');
    await services.acceptProjectProof(f.project.id,'a',{baseRevision:1,reportHash:quality.reportHash,accepted:true});
    const first=await services.addAlbumToCart('a',f.project.id,1);
    await db.studioOperationSetting.update({where:{id:1},data:{policy:{...policy,profiles:[{...policy.profiles[0],targetDpi:350}]}}});
    assert((await services.getCheckoutCart('a')).lines[0].issues.length>0);
    quality=await services.projectQuality(f.project.id,'a');assert(!quality.accepted);
    await services.acceptProjectProof(f.project.id,'a',{baseRevision:1,reportHash:quality.reportHash,accepted:true});
    const renewed=await services.addAlbumToCart('a',f.project.id,1);assert.equal(renewed.cartItemId,first.cartItemId);
    const cart=await services.getCheckoutCart('a');assert.equal(cart.lines.length,1);assert.equal(cart.lines[0].issues.length,0);
  } finally { await db.studioOperationSetting.deleteMany(); }
});


test("album fulfilment requires supplier proof and manual delivery records retention date", async()=>{
  const {project}=await added();
  const {orderId}=await services.createCheckoutOrder('a',await payload(),{});
  await db.order.update({where:{id:orderId},data:{status:'PAID'}});
  await assert.rejects(services.updateAdminOrderStatus(orderId,'PROCESSING'),/Approve the saved album/);
  await db.studioAsset.updateMany({where:{projectId:project.id},data:{width:3600,height:3600}});
  const policy={profiles:[{productId:'',supplier:'Fixture printer',targetDpi:300,minimumDpi:150,bleedMm:3,safeMm:5,approved:true}],retentionEnabled:false,retentionDays:null,alertMinutes:30};
  await db.studioOperationSetting.create({data:{id:1,policy}});
  try {
    const link=await db.studioOrderLink.findFirstOrThrow({where:{projectId:project.id}});
    const quality=await services.printReport(db,project.id,link.snapshot.document,link.snapshot.configuration);
    await services.approveOrderPrint(project.id,link.id,'admin-fixture',{reportHash:quality.reportHash,note:'Verified supplier proof.',supplierProofChecked:true});
    await services.updateAdminOrderStatus(orderId,'PROCESSING');
    await services.updateAdminOrderStatus(orderId,'DELIVERED');
    const order=await db.order.findUnique({where:{id:orderId}});assert.equal(order.status,'DELIVERED');assert(order.deliveredAt instanceof Date);
  }finally{await db.studioOperationSetting.deleteMany();}
});

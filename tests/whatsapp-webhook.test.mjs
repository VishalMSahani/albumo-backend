import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import express from "express";
import whatsappWebhookRoutes from "../dist/features/whatsapp/whatsapp-webhook.routes.js";
import { csrfProtection } from "../dist/middlewares/csrf.middleware.js";

const originalVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const originalAppSecret = process.env.WHATSAPP_APP_SECRET;

let server;
let baseUrl;

before(async () => {
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "whatsapp-verify-fixture";
  process.env.WHATSAPP_APP_SECRET = "whatsapp-app-secret-fixture";

  const app = express();
  app.use("/webhooks/whatsapp", express.raw({ type: "application/json", limit: "1mb" }));
  app.use("/webhooks/whatsapp", whatsappWebhookRoutes);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/webhooks/whatsapp`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

  if (originalVerifyToken === undefined) delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  else process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = originalVerifyToken;

  if (originalAppSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
  else process.env.WHATSAPP_APP_SECRET = originalAppSecret;
});

test("WhatsApp webhook returns Meta's challenge only for the configured verify token", async () => {
  const challenge = "meta-challenge-fixture";
  const accepted = await fetch(
    `${baseUrl}?hub.mode=subscribe&hub.verify_token=whatsapp-verify-fixture&hub.challenge=${challenge}`,
  );
  assert.equal(accepted.status, 200);
  assert.equal(await accepted.text(), challenge);
  assert.equal(accepted.headers.get("content-type"), "text/plain; charset=utf-8");

  const rejected = await fetch(
    `${baseUrl}?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=${challenge}`,
  );
  assert.equal(rejected.status, 403);
});

test("WhatsApp webhook accepts Meta-signed requests and rejects unsigned requests", async () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const signature = `sha256=${createHmac("sha256", process.env.WHATSAPP_APP_SECRET)
    .update(body)
    .digest("hex")}`;

  const accepted = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
    },
    body,
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { success: true });

  const rejected = await fetch(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  assert.equal(rejected.status, 401);
});

test("WhatsApp webhook is exempt from browser CSRF checks", () => {
  const originalCsrfEnabled = process.env.CSRF_ENABLED;
  process.env.CSRF_ENABLED = "true";

  let passed = false;
  csrfProtection(
    { method: "POST", path: "/webhooks/whatsapp", cookies: {}, headers: {} },
    { status: () => ({ json: () => undefined }) },
    () => { passed = true; },
  );
  assert.equal(passed, true);

  if (originalCsrfEnabled === undefined) delete process.env.CSRF_ENABLED;
  else process.env.CSRF_ENABLED = originalCsrfEnabled;
});

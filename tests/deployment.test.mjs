import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import multer from "multer";
import jwt from "jsonwebtoken";
import { build } from "esbuild";
import { withStagedUpload } from "../dist/middlewares/upload-transport.middleware.js";
import { csrfProtection } from "../dist/middlewares/csrf.middleware.js";
import { checkDeployment } from "../scripts/check-deployment.mjs";

process.env.JWT_SECRET = "upload-test-secret-with-at-least-32-characters";
const uploadKey = () =>
  createHmac("sha256", process.env.JWT_SECRET)
    .update("roboroot:multipart-upload")
    .digest("hex");
const signTicket = (claims, expiresIn = "5m") =>
  jwt.sign(claims, uploadKey(), {
    algorithm: "HS256",
    expiresIn,
    audience: "multipart-upload",
    issuer: "roboroot-api",
  });

test("upload tickets cannot authenticate as ordinary access tokens", () => {
  const ticket = signTicket({ owner: "user-1" });
  assert.throws(
    () => jwt.verify(ticket, process.env.JWT_SECRET),
    /invalid signature/,
  );
});

async function uploadFixture({
  owner = "user-1",
  path = "/api/3d-printing/files",
  limit = 100,
  expiresIn = "5m",
  sizeOffset = 0,
} = {}) {
  const form = new FormData();
  form.append("note", "keep this field");
  form.append("model", new Blob(["test-file"]), "part.stl");
  const multipart = new Response(form);
  const contentType = multipart.headers.get("Content-Type");
  const serialized = await multipart.blob();
  const buffer = Buffer.from(await serialized.arrayBuffer());
  let deleted = false,
    opened = false;
  const manifest = {
    path,
    owner,
    size: buffer.length + sizeOffset,
    contentType,
    key: "staging/abcdef-1234",
  };
  const req = {
    method: "POST",
    baseUrl: "/api/3d-printing",
    path: "/files",
    url: "/files",
    headers: {},
    user: { userId: "user-1" },
    get: () => signTicket(manifest, expiresIn),
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  const store = {
    claim: async () => {
      opened = true;
    },
    open: async (_key, size) => {
      if (size !== buffer.length)
        throw Object.assign(new Error("Size mismatch"), { statusCode: 400 });
      return Readable.from([buffer]);
    },
    remove: async () => {
      deleted = true;
    },
  };
  let nextError;
  await withStagedUpload(
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: limit },
    }).single("model"),
    store,
  )(req, res, (error) => {
    nextError = error;
  });
  return { req, res, nextError, opened, deleted };
}

test("cache and queue connections follow the Redis URL TLS scheme", () => {
  for (const protocol of ["redis:", "rediss:"]) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      const { redis, createBullMQConnection } = await import('./dist/lib/redis.js');
      const queue = createBullMQConnection();
      queue.on('error', () => {});
      // Inspect parsed connection options without contacting an external server.
      redis.disconnect();
      queue.disconnect();
      for (const client of [redis, queue]) {
        assert.equal(Boolean(client.options.tls), process.env.REDIS_URL.startsWith('rediss:'));
        assert.equal(client.options.host, 'redis.example.invalid');
        assert.equal(client.options.port, 10852);
        assert.equal(client.options.username, 'default');
        assert.equal(client.options.password, 'test-password');
      }
      assert.equal(queue.options.maxRetriesPerRequest, null);
    `,
      ],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          REDIS_URL:
            protocol + "//default:test-password@redis.example.invalid:10852",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  }
});

test("server bundle exposes Helmet to deployment dependency tracing", async () => {
  const { metafile } = await build({
    absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
    entryPoints: ["src/server.mts"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
    metafile: true,
  });
  assert(
    Object.values(metafile.outputs).some((output) =>
      output.imports.some(
        (dependency) => dependency.path === "helmet" && dependency.external,
      ),
    ),
    "Helmet must be a statically traceable dependency of the server bundle",
  );
});

test("generated Vercel bundle starts without credentials for optional gateways", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const { default: app } = await import('./server.mjs');
    if (typeof app !== 'function') throw new Error('Missing Express export');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    const root = await fetch(url);
    if (root.status !== 200) throw new Error('Root smoke check failed');
    if (root.headers.get('x-content-type-options') !== 'nosniff') throw new Error('Helmet security headers missing');
    if (root.headers.has('x-powered-by')) throw new Error('Express fingerprint was not removed');
    const csrf = await fetch(url + '/api/auth/csrf-token');
    if (!(await csrf.json()).data.csrfToken) throw new Error('CSRF initialization failed');
    const untrusted = await fetch(url + '/api/auth/csrf-token', { headers: { Origin: 'https://roboroot-attacker.vercel.app' } });
    if (untrusted.headers.has('access-control-allow-origin')) throw new Error('Untrusted preview origin was allowed');
    const whatsappChallenge = 'meta-challenge-fixture';
    const verifiedWebhook = await fetch(url + '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=whatsapp-verify-fixture&hub.challenge=' + whatsappChallenge);
    if (verifiedWebhook.status !== 200 || await verifiedWebhook.text() !== whatsappChallenge) {
      throw new Error('WhatsApp webhook verification failed');
    }
    const rejectedWebhook = await fetch(url + '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=' + whatsappChallenge);
    if (rejectedWebhook.status !== 403) throw new Error('WhatsApp webhook accepted an invalid verify token');
    const webhookBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const webhookSignature = 'sha256=' + (await import('node:crypto')).createHmac('sha256', 'whatsapp-app-secret-fixture').update(webhookBody).digest('hex');
    const acknowledgedWebhook = await fetch(url + '/webhooks/whatsapp', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': webhookSignature }, body: webhookBody,
    });
    if (acknowledgedWebhook.status !== 200) throw new Error('WhatsApp webhook acknowledgement failed');
    const unsignedWebhook = await fetch(url + '/webhooks/whatsapp', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: webhookBody,
    });
    if (unsignedWebhook.status !== 401) throw new Error('Unsigned WhatsApp webhook was accepted');
    const denied = await fetch(url + '/api/internal/jobs');
    if (denied.status !== 401) throw new Error('Job endpoint must reject missing credentials');
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  `,
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        VERCEL: "1",
        NODE_ENV: "production",
        DOTENV_CONFIG_PATH: "__no_deployment_test_env__",
        DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
        REDIS_URL: "redis://127.0.0.1:1",
        CRON_SECRET: "test-cron-secret",
        RAZORPAY_KEY_ID: "",
        RAZORPAY_KEY_SECRET: "",
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: "whatsapp-verify-fixture",
        WHATSAPP_APP_SECRET: "whatsapp-app-secret-fixture",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test("staged multipart preserves file bytes and fields, then deletes temporary storage", async () => {
  const result = await uploadFixture();
  assert.equal(result.nextError, undefined);
  assert.equal(result.req.file.buffer.toString(), "test-file");
  assert.equal(result.req.file.originalname, "part.stl");
  assert.equal(result.req.body.note, "keep this field");
  assert.equal(result.deleted, true);
});

test("staged uploads retain the existing per-file size limit", async () => {
  const result = await uploadFixture({ limit: 2 });
  assert.equal(result.nextError.code, "LIMIT_FILE_SIZE");
  assert.equal(result.deleted, true);
});

test("tickets cannot be used by another user, on another route, or after expiry", async () => {
  for (const options of [
    { owner: "someone-else" },
    { path: "/api/3d-printing/preview-quote" },
    { expiresIn: -1 },
  ]) {
    const result = await uploadFixture(options);
    assert.equal(result.res.statusCode, 400);
    assert.equal(result.opened, false);
  }
});

test("a mismatched blob size is rejected and cleaned up", async () => {
  const result = await uploadFixture({ sizeOffset: 1 });
  assert.equal(result.nextError.statusCode, 400);
  assert.equal(result.deleted, true);
});

test("production CSRF rejects missing/invalid tokens and accepts matching tokens", () => {
  process.env.CSRF_ENABLED = "true";
  for (const [cookie, header, expected] of [
    ["", "", 403],
    ["é", "a", 403],
    ["correct", "correct", 200],
  ]) {
    let status = 200,
      passed = false;
    const req = {
      method: "POST",
      path: "/api/auth/login",
      cookies: { csrf_token: cookie },
      headers: { "x-csrf-token": header },
    };
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json() {},
    };
    csrfProtection(req, res, () => {
      passed = true;
    });
    assert.equal(status, expected);
    assert.equal(passed, expected === 200);
  }
});

test("deployment checks flag development URLs, disabled CSRF, and missing webhook secrets without exposing secrets", () => {
  const errors = checkDeployment({
    NODE_ENV: "development",
    FRONTEND_URL: "http://localhost:3000",
    BACKEND_PUBLIC_URL: "https://test.trycloudflare.com",
    CSRF_ENABLED: "false",
    RAZORPAY_KEY_ID: "private-value",
  });
  assert(errors.some((error) => error.includes("RAZORPAY_WEBHOOK_SECRET")));
  assert(errors.some((error) => error.includes("BACKEND_PUBLIC_URL")));
  assert(errors.some((error) => error.includes("CSRF_ENABLED")));
  assert(!errors.join(" ").includes("private-value"));
});

test("deployment checks distinguish production gateway keys from test keys", () => {
  const env = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:password@db.test/store",
    REDIS_URL: "rediss://cache.test",
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_ACCESS_KEY_ID: "test",
    R2_SECRET_ACCESS_KEY: "test",
    R2_BUCKET_NAME: "public-assets",
    R2_PRIVATE_BUCKET_NAME: "private-assets",
    R2_PUBLIC_DOMAIN: "cdn.albumo.in",
    RESEND_API_KEY: "re_test_fixture",
    EMAIL_FROM: "noreply@mail.roboroot.in",
    JWT_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
    AUTH_OTP_SECRET: "d".repeat(32),
    CRON_SECRET: "c".repeat(32),
    FRONTEND_URL: "https://store.test",
    ADMIN_FRONTEND_URL: "https://admin.test",
    BACKEND_PUBLIC_URL: "https://api.test",
    CORS_ALLOWED_ORIGINS: "https://store.test,https://admin.test",
    CSRF_ENABLED: "true",
    RAZORPAY_KEY_ID: "rzp_live_fixture",
    RAZORPAY_KEY_SECRET: "fixture",
    RAZORPAY_WEBHOOK_SECRET: "fixture",
  };
  assert.deepEqual(checkDeployment(env), []);
  const errors = checkDeployment({
    ...env,
    RAZORPAY_KEY_ID: "rzp_test_fixture",
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /test key/);
});

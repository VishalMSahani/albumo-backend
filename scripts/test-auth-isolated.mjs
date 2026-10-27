// Runs the existing auth suite against a disposable local PostgreSQL cluster.
// Never loads .env and never connects to Albumo's configured database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import pg from "pg";

const bin =
  process.env.PG_BIN ||
  (process.platform === "win32"
    ? "C:/Program Files/PostgreSQL/18/bin"
    : "/usr/lib/postgresql/18/bin");
const executable = (name) =>
  path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
assert(
  existsSync(executable("initdb")),
  "Set PG_BIN to the local PostgreSQL bin directory.",
);
assert(
  existsSync("dist/services/phone-auth.service.js"),
  "Build the backend before running auth tests.",
);
const temporary = await mkdtemp(path.join(tmpdir(), "albumo-auth-test-"));
const data = path.join(temporary, "data");
const portFinder = createServer();
await new Promise((resolve) => portFinder.listen(0, "127.0.0.1", resolve));
const port = portFinder.address().port;
await new Promise((resolve) => portFinder.close(resolve));
function command(name, args) {
  const result = spawnSync(executable(name), args, {
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(name + " failed: " + result.stdout + result.stderr);
}
let started = false;
try {
  command("initdb", [
    "-D",
    data,
    "-U",
    "postgres",
    "-A",
    "trust",
    "--encoding=UTF8",
    "--locale=C",
  ]);
  command("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(temporary, "postgres.log"),
    "-o",
    "-h 127.0.0.1 -p " + port + " -F",
    "-w",
    "start",
  ]);
  started = true;
  const base = "postgresql://postgres@127.0.0.1:" + port + "/";
  const admin = new pg.Client({ connectionString: base + "postgres" });
  await admin.connect();
  try {
    await admin.query("CREATE DATABASE roboroot_auth_test");
  } finally {
    await admin.end();
  }
  const url = base + "roboroot_auth_test";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // Only the order foreign-key target is needed by consent records in this suite.
    await client.query('CREATE TABLE "Order" ("id" TEXT PRIMARY KEY)');
    for (const migration of [
      "20251208162750_user_auth",
      "20251208231708_add_email_notifications",
      "20260516000001_add_super_admin_role",
      "20260516000003_add_password_reset_token",
      "20260516000007_add_email_verification",
      "20260902000004_add_legal_consents",
      "20260910000001_secure_phone_auth",
      "20260913000001_add_pending_signup_phone",
      "20260913000002_email_otp_and_pending_phone_identity",
    ]) {
      await client.query(
        await readFile(
          path.join("prisma/migrations", migration, "migration.sql"),
          "utf8",
        ),
      );
    }
  } finally {
    await client.end();
  }
  const result = spawnSync(
    process.execPath,
    ["--test", "tests/auth.test.mjs"],
    {
      env: { ...process.env, AUTH_TEST_DATABASE_URL: url },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  if (started) command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  const target = path.resolve(temporary);
  const parent = path.resolve(tmpdir());
  assert(
    path.dirname(target) === parent &&
      path.basename(target).startsWith("albumo-auth-test-"),
  );
  await rm(target, { recursive: true, force: true });
}

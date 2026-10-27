import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(file, imports, env) {
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, {
    exports,
    process: { env },
    require: (name) => {
      if (!(name in imports)) throw new Error("Unexpected module: " + name);
      return imports[name];
    },
    console: { log() {}, warn() {}, error() {} },
  });
  return exports;
}
test("Albumo producers and workers share an isolated queue prefix", () => {
  const defaults = load("src/lib/queue-config.ts", {}, {});
  assert.equal(defaults.queuePrefix, "albumo");
  assert.equal(
    load("src/lib/queue-config.ts", {}, { BULLMQ_PREFIX: "albumo-staging" })
      .queuePrefix,
    "albumo-staging",
  );
  const created = [];
  class QueueDouble {
    constructor(name, optionsOrProcessor, options) {
      created.push({ name, options: options || optionsOrProcessor });
    }
    on() {}
  }
  const common = {
    bullmq: { Queue: QueueDouble, Worker: QueueDouble },
    "./redis.js": { createBullMQConnection: () => ({ test: true }) },
    "./queue-config.js": defaults,
    "../lib/redis.js": { createBullMQConnection: () => ({ test: true }) },
    "../lib/queue-config.js": defaults,
    "../lib/prisma.js": { prisma: {} },
    "../services/email.service.js": {},
    "../utils/email-templates.js": {},
    "../lib/logger.js": { logger: {} },
    "../services/shipping.service.js": {},
    "../services/email-notification.service.js": {},
    "../generated/prisma/client.js": { OrderStatus: {} },
  };
  const queues = load("src/lib/queue.ts", common, { REDIS_URL: "fixture" });
  for (const name of [
    "getEmailQueue",
    "getWebhookQueue",
    "getStockQueue",
    "getTrackingQueue",
  ])
    queues[name]();
  for (const [file, start] of [
    ["email-bullmq-worker", "startEmailWorker"],
    ["webhook-retry-worker", "startWebhookRetryWorker"],
    ["stock-sync-worker", "startStockSyncWorker"],
    ["tracking-poll-worker", "startTrackingPollWorker"],
  ]) {
    const worker = load("src/workers/" + file + ".ts", common, {
      REDIS_URL: "fixture",
    });
    worker[start]();
  }
  assert.equal(created.length, 8);
  for (const item of created) assert.equal(item.options.prefix, "albumo");
  for (const queue of created.slice(0, 4))
    assert(created.slice(4).some((worker) => worker.name === queue.name));
});

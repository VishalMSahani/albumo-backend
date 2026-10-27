// Isolated browser check: real import controller and workbook, in-memory catalogue only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "../node_modules/esbuild/lib/main.js";
import ts from "../../admin-frontend/node_modules/typescript/lib/typescript.js";
import * as XLSX from "../../admin-frontend/node_modules/xlsx/xlsx.mjs";
import { referenceProduct } from "../src/features/components/data/reference-products.ts";
import {
  productTemplateCsv,
  productsToCsv,
} from "../src/features/components/validators/product-csv.ts";

const root = path.resolve(process.cwd(), "../admin-frontend");
const originalNextEnv = readFileSync(path.join(root, "next-env.d.ts"), "utf8");
const apiPort = 4106,
  webPort = 3110,
  origin = "http://localhost:" + webPort;
const leaves = [
  {
    id: "cmg00000000000000000000001",
    name: "Travel Books",
    category: { id: "albums", name: "Photo Albums", isActive: true },
    configuration: null,
    isActive: true,
  },
  {
    id: "cmg00000000000000000000002",
    name: "Photo Mugs",
    category: { id: "gifts", name: "Gifts", isActive: true },
    configuration: null,
    isActive: true,
  },
];
for (const leaf of leaves)
  leaf.configuration = referenceProduct(leaf).configuration;
const adminCategories = leaves.map((leaf) => ({
  ...leaf.category,
  subcategories: [{ ...leaf, categoryId: leaf.category.id }],
}));
const adminProducts = [];
let previewCalls = 0,
  importCalls = 0,
  templateCalls = 0,
  exportCalls = 0;
globalThis.__browserImportPrisma = {
  subcategory: {
    findUnique: async (q) =>
      leaves.find((leaf) => leaf.id === q.where.id) ?? null,
    findFirst: async (q) =>
      leaves.find(
        (leaf) =>
          leaf.name.toLowerCase() === q.where.name.equals.toLowerCase() &&
          leaf.category.name.toLowerCase() ===
            q.where.category.name.equals.toLowerCase(),
      ) ?? null,
    findMany: async (q) =>
      leaves.filter((leaf) => !q.where?.id || leaf.id === q.where.id),
  },
  component: {
    findUnique: async (q) =>
      adminProducts.find((product) =>
        Object.entries(q.where).every(([key, value]) => product[key] === value),
      ) ?? null,
    findMany: async () => adminProducts,
    create: async (q) => {
      const product = {
        id: "product-" + adminProducts.length,
        ...structuredClone(q.data),
      };
      adminProducts.push(product);
      return product;
    },
    update: async (q) => {
      const product = adminProducts.find(
        (product) => product.id === q.where.id,
      );
      Object.assign(product, structuredClone(q.data));
      return product;
    },
  },
};
const bundle = await build({
  stdin: {
    contents:
      "export { bulkImportController, bulkExportController, productTemplateController } from './src/controller/bulk.ts';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "browser-prisma",
      setup(builder) {
        builder.onResolve({ filter: /lib\/prisma\.js$/ }, () => ({
          path: "prisma",
          namespace: "fixture",
        }));
        builder.onResolve({ filter: /lib\/redis\.js$/ }, () => ({
          path: "redis",
          namespace: "fixture",
        }));
        builder.onResolve(
          { filter: /services\/storage\.service\.js$/ },
          () => ({ path: "storage", namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "prisma"
              ? "export const prisma=globalThis.__browserImportPrisma;"
              : path === "redis"
                ? "export async function cacheInvalidate(){}"
                : "export const FileType={};export async function uploadFile(){throw Error('No storage in fixture');}",
          loader: "js",
        }));
      },
    },
  ],
});
const controllers = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const workbookSource = readFileSync(
  path.join(root, "lib/catalogue-workbook.ts"),
  "utf8",
).replace(
  '"xlsx"',
  JSON.stringify(
    new URL("../../admin-frontend/node_modules/xlsx/xlsx.mjs", import.meta.url)
      .href,
  ),
);
const workbookCode = ts.transpileModule(workbookSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const workbookApi = await import(
  "data:text/javascript;base64," + Buffer.from(workbookCode).toString("base64")
);
const fixture = createServer(async (req, res) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-csrf-token");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,DELETE,OPTIONS",
    );
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const url = new URL(req.url, "http://localhost");
    const send = (body, status = 200) =>
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(body));
    const ok = (data) => send({ success: true, data });
    if (req.method !== "GET" && req.headers["x-csrf-token"] !== "fixture-csrf")
      return send({ error: "CSRF missing" }, 403);
    if (url.pathname === "/api/auth/csrf-token")
      return ok({ csrfToken: "fixture-csrf" });
    if (url.pathname === "/api/auth/me")
      return ok({
        role: "ADMIN",
        name: "Catalogue reviewer",
        email: "admin@example.invalid",
      });
    if (url.pathname === "/api/categories/manage") return ok(adminCategories);
    if (url.pathname === "/api/components/manage") {
      const data = adminProducts.filter(
        (product) =>
          String(product.isActive) === url.searchParams.get("isActive"),
      );
      return send({
        success: true,
        data,
        pagination: { page: 1, totalPages: 1, total: data.length },
      });
    }
    const response = {
      code: 200,
      status(code) {
        this.code = code;
        return this;
      },
      setHeader(name, value) {
        res.setHeader(name, value);
      },
      json(value) {
        send(value, this.code);
      },
      send(value) {
        res.writeHead(this.code).end(value);
      },
    };
    const request = { query: Object.fromEntries(url.searchParams) };
    if (url.pathname === "/api/admin/products/template") {
      templateCalls++;
      return await controllers.productTemplateController(request, response);
    }
    if (url.pathname === "/api/admin/products/export") {
      exportCalls++;
      return await controllers.bulkExportController(request, response);
    }
    if (url.pathname === "/api/admin/products/bulk-import") {
      const form = await new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": req.headers["content-type"] },
        body: buffer,
      }).formData();
      const file = form.get("file");
      request.file = { buffer: Buffer.from(await file.arrayBuffer()) };
      if (request.query.dryRun === "true") previewCalls++;
      else importCalls++;
      return await controllers.bulkImportController(request, response);
    }
    return send({ error: "Unknown fixture route" }, 404);
  } catch (error) {
    res
      .writeHead(500, { "content-type": "application/json" })
      .end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve) => fixture.listen(apiPort, "localhost", resolve));
const artifacts = path.join(root, ".artifacts", "bulk-upload-qa");
await mkdir(artifacts, { recursive: true });
const next = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--port",
    String(webPort),
  ],
  {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      ALBUMO_TEST_MODE: "1",
      NEXT_PUBLIC_API_URL: "http://localhost:" + apiPort,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let nextLog = "";
next.stdout.on("data", (chunk) => {
  nextLog += chunk;
});
next.stderr.on("data", (chunk) => {
  nextLog += chunk;
});
let chrome, socket;
try {
  let serving = false;
  for (let count = 0; count < 90; count++) {
    try {
      const res = await fetch(origin + "/categories");
      if (res.ok) {
        serving = true;
        break;
      }
    } catch {}
    if (next.exitCode !== null) throw new Error("Preview failed: " + nextLog);
    await delay(500);
  }
  assert(serving, "Preview did not become ready");
  const executable = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((value) => value && existsSync(value));
  assert(executable, "Install Chrome/Edge or set CHROME_PATH");
  chrome = spawn(
    executable,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      "--user-data-dir=" +
        path.join(artifacts, "browser-profile-" + process.pid),
      "about:blank",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Browser startup timed out")),
      20_000,
    );
    chrome.stderr.on("data", (chunk) => {
      const match = chunk
        .toString()
        .match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const debugOrigin = new URL(wsUrl);
  debugOrigin.protocol = "http:";
  const target = await (
    await fetch(debugOrigin.origin + "/json/new?about:blank", { method: "PUT" })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const pageErrors = [];
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.method === "Runtime.exceptionThrown")
      pageErrors.push(
        data.params.exceptionDetails.text +
          " " +
          (data.params.exceptionDetails.exception?.description || ""),
      );
    if (data.id && pending.has(data.id)) {
      const entry = pending.get(data.id);
      clearTimeout(entry.timer);
      pending.delete(data.id);
      data.error
        ? entry.reject(new Error(data.error.message))
        : entry.resolve(data.result);
    }
  });
  function command(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, 25_000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result?.value;
  }
  async function waitFor(expression, label = expression) {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(expression)) return;
      await delay(250);
    }
    throw new Error("Timed out: " + label);
  }
  const go = async (route) => {
    await command("Page.navigate", { url: origin + route });
    await waitFor(
      "location.pathname === " +
        JSON.stringify(route.split("?")[0].split("#")[0]) +
        " && !!document.querySelector('main h1')",
      route,
    );
    await delay(200);
  };
  async function fill(name, value) {
    await evaluate(
      "(() => { const el = document.querySelector('main [name=" +
        JSON.stringify(name) +
        "]'); if(!el) throw new Error('Missing field'); const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, " +
        JSON.stringify(value) +
        "); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()",
    );
  }
  async function submit() {
    await evaluate(
      "(() => { const form = document.querySelector('main form'); if(!form.reportValidity()) throw new Error('Invalid fixture form'); form.requestSubmit(); })()",
    );
  }
  const clickText = (text) =>
    evaluate(
      "(() => { const button = [...document.querySelectorAll('button, main a')].find(el => el.textContent.trim() === " +
        JSON.stringify(text) +
        "); if(!button) throw new Error('Missing action'); button.click(); })()",
    );
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  async function field(label, value) {
    await evaluate(
      "(() => {const label=[...document.querySelectorAll('main label')].find(el=>el.textContent.trim().toLowerCase().startsWith(" +
        JSON.stringify(label.toLowerCase()) +
        "));const el=label?.querySelector('input,textarea,select');if(!el)throw Error('Missing labelled control');const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el," +
        JSON.stringify(value) +
        ");el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await delay(150);
  }
  const capture = async (name) => {
    const shot = await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(
      path.join(artifacts, name + ".png"),
      Buffer.from(shot.data, "base64"),
    );
  };

  const sourceProducts = leaves.map((leaf, index) => ({
    ...referenceProduct(leaf),
    sku: "BROWSER-" + index,
    name: "Browser " + leaf.name,
    id: "",
    isActive: true,
  }));
  const workbookPath = path.join(artifacts, "products.xlsx");
  await writeFile(
    workbookPath,
    XLSX.write(
      workbookApi.buildCatalogueWorkbook(
        productsToCsv(sourceProducts),
        adminCategories,
      ),
      { bookType: "xlsx", type: "buffer" },
    ),
  );
  await command("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: artifacts,
  });
  await go("/products");
  await clickText("Upload & export");
  await waitFor(
    "document.querySelector('main').textContent.includes('Upload your collection')",
  );
  await clickText("Download template");
  await waitFor(
    "document.querySelector('main').textContent.includes('Template downloaded')",
  );
  assert.equal(templateCalls, 1);
  async function attach(file) {
    const { root: documentRoot } = await command("DOM.getDocument");
    const { nodeId } = await command("DOM.querySelector", {
      nodeId: documentRoot.nodeId,
      selector: 'input[type="file"]',
    });
    await command("DOM.setFileInputFiles", { nodeId, files: [file] });
  }
  await attach(workbookPath);
  await waitFor(
    "[...document.querySelectorAll('button')].some(el=>el.textContent==='Import 2 selected'&&!el.disabled)",
  );
  assert.equal(previewCalls, 1);
  assert.equal(adminProducts.length, 0);
  assert(
    await evaluate(
      "document.querySelector('main').textContent.includes('5 option groups')",
    ),
  );
  assert(
    await evaluate(
      "document.querySelector('main').textContent.includes('4 option groups')",
    ),
  );
  await capture("bulk-upload-desktop");
  await evaluate(
    "document.getElementById('review-heading').scrollIntoView({block:'start'})",
  );
  await capture("bulk-review-desktop");
  await clickText("Import 2 selected");
  await waitFor(
    "document.querySelector('main').textContent.includes('Created 2, updated 0, failed 0')",
  );
  assert.equal(importCalls, 1);
  assert.equal(adminProducts.length, 2);
  assert(
    adminProducts.every((product) => product.isActive === false),
    "Default draft override applied",
  );
  assert.equal(adminProducts[0].configuration.groups[0].kind, "dimension");
  assert.equal(adminProducts[1].configuration.groups[0].label, "Capacity");
  await clickText("Export full catalogue");
  await waitFor(
    "document.querySelector('main').textContent.includes('Catalogue downloaded')",
  );
  assert.equal(exportCalls, 1);
  // Upload the same stable SKUs again; preview and commit must update, not duplicate.
  await attach(workbookPath);
  await waitFor(
    "[...document.querySelectorAll('button')].some(el=>el.textContent==='Import 2 selected'&&!el.disabled)",
  );
  await clickText("Import 2 selected");
  await waitFor(
    "document.querySelector('main').textContent.includes('Created 0, updated 2, failed 0')",
  );
  assert.equal(adminProducts.length, 2);
  // An invalid category is rejected by the real backend validation before any write.
  const bad = sourceProducts[0];
  bad.subcategoryId = "cmg99999999999999999999999";
  const badPath = path.join(artifacts, "invalid-category.xlsx");
  await writeFile(
    badPath,
    XLSX.write(
      workbookApi.buildCatalogueWorkbook(productsToCsv([bad]), adminCategories),
      { bookType: "xlsx", type: "buffer" },
    ),
  );
  await attach(badPath);
  await waitFor(
    "document.querySelector('main').textContent.includes('Choose a category within an existing')",
  );
  assert(
    await evaluate(
      "[...document.querySelectorAll('button')].find(el=>el.textContent.startsWith('Import ')).disabled",
    ),
  );
  for (const width of [390, 320]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(500);
    await waitFor(
      "document.querySelector('aside').getBoundingClientRect().right<=1",
    );
    assert(
      await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
      "Mobile overflow at " + width,
    );
    await evaluate(
      "document.querySelector('[aria-label=\\\"Bulk product upload\\\"]').scrollIntoView({block:'start'})",
    );
    await capture("bulk-upload-" + width);
    await evaluate(
      "document.getElementById('review-heading').scrollIntoView({block:'start'})",
    );
    await capture("bulk-review-" + width);
  }
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  console.log(
    "PASS Excel template download, server preview, two distinct product configurations, draft override, retry/update, catalogue export, row errors, desktop and 390/320px layout",
  );
} finally {
  socket?.close();
  if (chrome) chrome.kill();
  next.kill();
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
  await writeFile(path.join(artifacts, "preview.log"), nextLog);
  const configPath = path.join(root, "tsconfig.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.include = config.include.filter(
    (value) => !value.startsWith(".next-smoke/"),
  );
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  if (
    readFileSync(path.join(root, "next-env.d.ts"), "utf8").includes(
      ".next-smoke",
    )
  )
    await writeFile(path.join(root, "next-env.d.ts"), originalNextEnv);
}

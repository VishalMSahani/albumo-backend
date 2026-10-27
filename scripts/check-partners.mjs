// Isolated partner QA: local fixture API, no real applications or listings.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const admin = process.argv.includes("--admin");
const root = path.resolve(
  process.cwd(),
  admin ? "../admin-frontend" : "../frontend_album",
);
const originalNextEnv = readFileSync(path.join(root, "next-env.d.ts"), "utf8");
const apiPort = admin ? 4118 : 4117,
  webPort = admin ? 3118 : 3117;
const origin = "http://localhost:" + webPort;
const artifacts = path.join(root, ".artifacts", "partner-qa");
await mkdir(artifacts, { recursive: true });
let failDirectory = false,
  failApplication = false,
  submitted = null;
const now = new Date().toISOString();
let inquiry = {
  id: "fixture-partner",
  partnerType: "TRAVEL_AGENCY",
  name: "Asha Shah",
  companyName: "Example Journeys",
  email: "asha@example.invalid",
  phone: "+91 9876543210",
  city: "Pune",
  website: "https://example.invalid",
  message: "We would like albums after our group trips.",
  status: "NEW",
  expectedVolume: "11–50",
  adminNotes: null,
  directoryConsent: true,
  directoryConsentAt: now,
  contactConsentAt: now,
  publicName: null,
  publicDescription: null,
  publicCity: null,
  publicWebsite: null,
  isPublished: false,
  createdAt: now,
  updatedAt: now,
};
const publicRows = [
  {
    id: "travel",
    partnerType: "TRAVEL_AGENCY",
    publicName: "Example Journeys",
    publicDescription: "Small group journeys in the mountains.",
    publicCity: "Pune",
    publicWebsite: "https://example.invalid",
  },
  {
    id: "photo",
    partnerType: "PHOTOGRAPHER",
    publicName: "Example Studio",
    publicDescription: "Portraits and celebrations, thoughtfully photographed.",
    publicCity: "Mumbai",
    publicWebsite: "https://example.invalid",
  },
];
const fixture = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-csrf-token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const url = new URL(req.url, "http://localhost");
  const send = (data, status = 200) =>
    res
      .writeHead(status, { "content-type": "application/json" })
      .end(JSON.stringify({ success: status < 400, data }));
  const error = (message) =>
    res
      .writeHead(503, { "content-type": "application/json" })
      .end(JSON.stringify({ success: false, error: message }));
  if (req.method !== "GET" && req.headers["x-csrf-token"] !== "fixture-csrf")
    return error("CSRF missing");
  if (url.pathname === "/api/auth/csrf-token")
    return send({ csrfToken: "fixture-csrf" });
  if (url.pathname === "/api/auth/me")
    return send({
      id: "admin",
      role: "ADMIN",
      name: "Partner reviewer",
      email: "admin@example.invalid",
    });
  if (url.pathname === "/api/auth/config")
    return send({ google: false, github: false, whatsappOtp: false });
  if (url.pathname === "/api/components/catalogue/categories") return send([]);
  if (url.pathname === "/api/contact/settings")
    return send({
      email: "hello@example.invalid",
      phone: "",
      whatsapp: "",
      hours: "",
      newsletterEnabled: false,
    });
  if (url.pathname === "/api/partners/directory") {
    if (failDirectory) return error("Fixture directory unavailable");
    const type = url.searchParams.get("partnerType");
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const partners = publicRows.filter(
      (row) =>
        (!type || row.partnerType === type) &&
        (row.publicName + row.publicCity).toLowerCase().includes(search),
    );
    return send({
      partners,
      pagination: { page: 1, limit: 12, total: partners.length, totalPages: 1 },
    });
  }
  if (url.pathname === "/api/partners/inquiries" && req.method === "POST") {
    if (failApplication) return error("Fixture application unavailable");
    submitted = body;
    return send({ id: "received", email: body.email }, 201);
  }
  if (url.pathname === "/api/partners/admin/inquiries")
    return send({
      inquiries: [inquiry],
      pagination: { page: 1, limit: 30, total: 1, totalPages: 1 },
    });
  if (url.pathname === "/api/partners/admin/summary")
    return send({
      total: 1,
      byStatus: { [inquiry.status]: 1 },
      byType: { TRAVEL_AGENCY: 1 },
    });
  if (
    url.pathname === "/api/partners/admin/inquiries/fixture-partner" &&
    req.method === "PATCH"
  ) {
    inquiry = { ...inquiry, ...body };
    if (inquiry.status !== "ONBOARDED") inquiry.isPublished = false;
    return send(inquiry);
  }
  return send({});
});
await new Promise((resolve) => fixture.listen(apiPort, "localhost", resolve));
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
      if ((await fetch(origin + "/partners")).ok) {
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
      }, 60_000);
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
    await fetch(origin + route);
    await command("Page.navigate", { url: origin + route });
    await waitFor(
      "location.pathname === " +
        JSON.stringify(route.split("?")[0].split("#")[0]) +
        " && !!document.querySelector('main h2')",
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

  await go("/partners");
  if (admin) {
    await waitFor(
      "document.querySelector('main').textContent.includes('Example Journeys')",
    );
    await evaluate(
      "[...document.querySelectorAll('main button')].find(el=>el.textContent.includes('Example Journeys')).click()",
    );
    await waitFor("!!document.querySelector('input[name=publicName]')");
    assert(
      await evaluate(
        "document.querySelector('input[name=isPublished]').disabled",
      ),
    );
    await field("Enquiry status", "ONBOARDED");
    await waitFor(
      "!document.querySelector('input[name=isPublished]').disabled",
    );
    await fill(
      "publicDescription",
      "Small group trips and thoughtful travel experiences.",
    );
    await evaluate("document.querySelector('input[name=isPublished]').click()");
    await clickText("Save directory profile");
    await waitFor(
      "document.querySelector('main').textContent.includes('Profile is live')",
    );
    assert.equal(inquiry.isPublished, true);
    assert.equal(inquiry.publicName, "Example Journeys");
    await capture("admin-partner-desktop");
    await field("Internal notes", "Private agreement discussed.");
    await clickText("Save notes");
    await waitFor(
      "document.querySelector('main').textContent.includes('Enquiry updated')",
    );
    assert.equal(inquiry.adminNotes, "Private agreement discussed.");
    await field("Enquiry status", "DECLINED");
    await waitFor("document.querySelector('input[name=isPublished]').disabled");
    assert.equal(inquiry.isPublished, false);
    assert.equal(
      inquiry.publicDescription,
      "Small group trips and thoughtful travel experiences.",
    );
  } else {
    await waitFor(
      "document.querySelector('#discover').textContent.includes('Example Journeys')",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Essential only')?.click()",
    );
    assert.equal(
      await evaluate(
        "document.querySelectorAll('footer nav[aria-label=\"Explore the partner network\"] li a').length",
      ),
      6,
    );
    await capture("partners-desktop");
    await field("Business name or city", "Nowhere");
    await clickText("Find partners");
    await waitFor(
      "document.querySelector('#discover').textContent.includes('No partners match')",
    );
    failDirectory = true;
    await field("Business name or city", "Pune");
    await clickText("Find partners");
    await waitFor(
      "document.querySelector('#discover').textContent.includes('couldn’t load')",
    );
    failDirectory = false;
    await clickText("Try again");
    await waitFor(
      "document.querySelector('#discover').textContent.includes('Example Journeys')",
    );
    assert(
      !(await evaluate(
        "document.querySelector('#discover').textContent.includes('Example Studio')",
      )),
    );
    await go("/partners/travel-agencies");
    await waitFor("document.querySelector('form[data-ready=true]') !== null");
    assert.equal(
      await evaluate(
        "document.querySelector('select[name=partnerType]').value",
      ),
      "TRAVEL_AGENCY",
    );
    await capture("travel-desktop");
    for (const [name, value] of Object.entries({
      companyName: "Reference Travel",
      name: "Asha Shah",
      city: "Pune",
      email: "asha@example.invalid",
      phone: "+91 9876543210",
      website: "https://example.invalid",
      message: "We would like to include photo albums with our group trips.",
    }))
      await fill(name, value);
    await evaluate(
      "document.querySelector('input[name=contactConsent]').click();document.querySelector('input[name=directoryConsent]').click()",
    );
    failApplication = true;
    await evaluate(
      "document.querySelector('form[aria-label=\"Partnership enquiry\"]').requestSubmit()",
    );
    await waitFor(
      "document.querySelector('#apply').textContent.includes('Fixture application unavailable')",
    );
    assert.equal(
      await evaluate("document.querySelector('input[name=companyName]').value"),
      "Reference Travel",
    );
    failApplication = false;
    await clickText("Send partnership enquiry");
    await waitFor(
      "document.querySelector('#apply').textContent.includes('Enquiry received')",
    );
    assert.equal(submitted.partnerType, "TRAVEL_AGENCY");
    assert.equal(submitted.directoryConsent, true);
    assert.equal(submitted.contactConsent, true);
    assert.equal(submitted.companyFax, "");
    assert.equal(submitted.website, "https://example.invalid");
    for (const slug of [
      "photographers",
      "wedding-planners",
      "corporate-events",
      "real-estate",
      "creative-businesses",
    ]) {
      await go("/partners/" + slug);
      await waitFor("document.querySelector('form[data-ready=true]') !== null");
      assert(
        await evaluate(
          "!!document.querySelector('select[name=partnerType]').value",
        ),
      );
    }
    assert.equal(
      (await fetch(origin + "/partners/not-a-partner-type")).status,
      404,
    );
    await go("/partners");
  }
  for (const width of [390, 320]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate("window.scrollTo(0,0)");
    await delay(300);
    assert(
      await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
      "Mobile overflow at " + width,
    );
    await capture((admin ? "admin" : "partners") + "-" + width);
    if (!admin) {
      await evaluate(
        "document.querySelector('#apply').scrollIntoView({behavior:'instant'})",
      );
      await delay(200);
      assert(
        await evaluate(
          "[...document.querySelectorAll('#apply input:not([type=checkbox]),#apply select,#apply textarea')].filter(el=>el.offsetParent).every(el=>parseFloat(getComputedStyle(el).fontSize)>=16)",
        ),
      );
      await capture("partner-form-" + width);
    }
  }
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  console.log(
    admin
      ? "PASS admin onboard, public profile, publish, notes, decline/unpublish, desktop and mobile layouts"
      : "PASS six partner routes, footer links, search, empty/error/retry states, application error/retry, consent, category preselection, desktop and mobile layouts",
  );
} finally {
  socket?.close();
  chrome?.kill();
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

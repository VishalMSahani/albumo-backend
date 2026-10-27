// Isolated admin browser QA. Fixture API only; no customer data or real email delivery.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { renderCampaign } from "../dist/services/campaign-design.js";

const root = path.resolve(process.cwd(), "../admin-frontend");
const originalNextEnv = readFileSync(path.join(root, "next-env.d.ts"), "utf8");
const apiPort = 4116,
  webPort = 3116,
  origin = "http://localhost:" + webPort;
let campaignSends = 0,
  adminPreviews = 0,
  retries = 0,
  ticketCreates = 0;
const campaigns = [];
const now = new Date().toISOString();
const supportReplies = [];
const supportEmails = [];
const supportTicket = {
  id: "ticket1",
  ticketNumber: "AL-QA-001",
  requesterName: "Asha",
  requesterEmail: "reader@example.com",
  subject: "Help with my travel book",
  description: "Can you help me change the cover?",
  category: "PRODUCT",
  source: "SUPPORT",
  status: "OPEN",
  priority: "MEDIUM",
  assignedToId: null,
  assignedTo: null,
  orderId: null,
  order: null,
  enquiry: null,
  createdAt: now,
  lastActivityAt: now,
  firstRespondedAt: null,
  resolvedAt: null,
  firstResponseDueAt: new Date(Date.now() + 86400000).toISOString(),
  resolutionDueAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  messages: [
    {
      id: "message1",
      authorName: "Asha",
      sender: "CUSTOMER",
      body: "Can you help me change the cover?",
      isInternal: false,
      createdAt: now,
    },
  ],
};
const delivery = {
  id: "email1",
  email: "reader@example.com",
  subject: "We've received your order | Albumo",
  eventType: "ORDER_CREATED",
  channel: "TRANSACTIONAL",
  status: "FAILED",
  retryCount: 3,
  error: "Provider temporarily unavailable",
  createdAt: now,
  sentAt: null,
  deliveredAt: null,
};
const inbox = {
  id: "inbox1",
  fromEmail: "reader@example.com",
  fromName: "Asha",
  subject: "Help with my travel book",
  text: "Can you help me change the cover?\nThank you.",
  status: "NEEDS_REVIEW",
  authenticated: false,
  ticketId: null,
  receivedAt: now,
  attachments: [],
};
const config = {
  from: "noreply@mail.albumo.in",
  accountFrom: "account@mail.albumo.in",
  accountReplyTo: "support@albumo.in",
  marketingFrom: "update@alert.albumo.in",
  marketingReplyTo: "hello@albumo.in",
  replyTo: "",
  admin: "vishal.sahani@albumo.in",
  support: "support@albumo.in",
  inboundDomain: "inbox.albumo.in",
  inboundEnabled: false,
  marketingEnabled: true,
  providerConfigured: true,
  receivingKeyConfigured: false,
  webhookConfigured: false,
  signingConfigured: true,
  webhookUrl: "https://api.albumo.in/api/webhooks/resend",
  siteUrl: "https://albumo.in",
};
const fixture = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-csrf-token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const send = (data, status = 200) =>
    res
      .writeHead(status, { "content-type": "application/json" })
      .end(JSON.stringify({ success: status < 400, data }));
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : {};
  const url = new URL(req.url, "http://localhost");
  const route = url.pathname;
  if (req.method !== "GET" && req.headers["x-csrf-token"] !== "fixture-csrf")
    return send({ error: "CSRF missing" }, 403);
  if (route === "/api/auth/csrf-token")
    return send({ csrfToken: "fixture-csrf" });
  if (route === "/api/auth/me")
    return send({
      role: "ADMIN",
      name: "Email reviewer",
      email: "admin@example.invalid",
    });
  if (route === "/api/emails/overview")
    return send({
      stats: {
        total: 1,
        sent: 0,
        pending: 0,
        failed: 1,
        counts: { FAILED: 1 },
      },
      activeSubscribers: 2,
      inboxPending: 1,
      campaigns: campaigns.length,
      webhooks: [],
      config,
    });
  if (route === "/api/emails/messages")
    return send({ items: [delivery], total: 1, pages: 1 });
  if (route === "/api/emails/messages/email1")
    return send({
      ...delivery,
      from: "Albumo <noreply@mail.albumo.in>",
      replyTo: config.replyTo,
      text: "Hi Asha,\n\nOrder AL100\nTotal: INR 599.00",
    });
  if (route === "/api/emails/messages/email1/retry") {
    retries++;
    delivery.status = "QUEUED";
    return send({});
  }
  if (route === "/api/emails/inbox")
    return send({ items: [inbox], total: 1, pages: 1 });
  if (route === "/api/emails/inbox/inbox1/ticket") {
    ticketCreates++;
    inbox.ticketId = "ticket1";
    inbox.status = "LINKED";
    return send(inbox);
  }
  if (route === "/api/emails/campaigns") {
    if (req.method === "POST") {
      const row = {
        ...body,
        id: "campaign" + (campaigns.length + 1),
        status: "DRAFT",
        recipientCount: 0,
        createdAt: now,
        counts: {},
      };
      campaigns.push(row);
      return send(row);
    }
    return send(campaigns);
  }
  if (route === "/api/support/admin/agents")
    return send([
      { id: "agent1", name: "Albumo Support", email: "support@albumo.in" },
    ]);
  if (route === "/api/support/admin/tickets")
    return send({
      tickets: [supportTicket],
      summary: { total: 1, open: 1, breached: 0, unassigned: 1 },
      pagination: { page: 1, limit: 30, total: 1, totalPages: 1 },
    });
  if (route === "/api/support/admin/tickets/ticket1/email") {
    supportEmails.push(body);
    return send({ id: "manual-email-" + supportEmails.length }, 201);
  }
  if (route === "/api/support/admin/tickets/ticket1/messages") {
    supportReplies.push(body);
    supportTicket.messages.push({
      id: "reply" + supportReplies.length,
      body: body.message,
      isInternal: body.isInternal,
      authorName: "Albumo Support",
      sender: "SUPPORT",
      createdAt: now,
    });
    return send(supportTicket);
  }
  if (route.endsWith("/preview")) {
    const row = campaigns[0];
    return send({
      subject: row.subject,
      text: row.body,
      ...renderCampaign(row.subject, row.body, row.design),
    });
  }
  if (route.endsWith("/test")) {
    adminPreviews++;
    return send({ id: "preview1" });
  }
  if (route.endsWith("/send")) {
    assert.equal(body.confirm, true);
    campaignSends++;
    Object.assign(campaigns[0], {
      status: "QUEUED",
      recipientCount: 2,
      counts: { QUEUED: 2 },
    });
    return send(campaigns[0]);
  }
  if (route.endsWith("/cancel")) {
    campaigns[0].status = "CANCELLED";
    return send(campaigns[0]);
  }
  return send({ error: "Unknown fixture route " + route }, 404);
});
await new Promise((resolve) => fixture.listen(apiPort, "localhost", resolve));
const artifacts = path.join(root, ".artifacts", "email-workspace-qa");
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
      const res = await fetch(origin + "/emails");
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

  await go("/emails");
  await waitFor(
    "document.querySelector('main').textContent.includes('Delivery history')",
  );
  await waitFor(
    "document.querySelector('main').textContent.includes('Provider temporarily unavailable')",
  );
  await clickText("View");
  await waitFor(
    "document.querySelector('main').textContent.includes('Total: INR 599.00')",
  );
  await clickText("Close");
  await clickText("Retry");
  await waitFor(
    "document.querySelector('main').textContent.includes('another delivery attempt')",
  );
  assert.equal(retries, 1);
  await capture("email-delivery-desktop");
  await clickText("Support inbox");
  await waitFor(
    "document.querySelector('main').textContent.includes('Help with my travel book')",
  );
  await evaluate("document.querySelector('main details').open=true");
  await clickText("Create support ticket");
  await waitFor(
    "document.querySelector('main').textContent.includes('Open conversation')",
  );
  assert.equal(ticketCreates, 1);
  assert.equal(
    await evaluate(
      "document.querySelector('a[href*=\\\"ticket=\\\"]').getAttribute('href')",
    ),
    "/support?ticket=ticket1",
  );
  await capture("email-inbox-desktop");
  await clickText("Campaigns");
  await waitFor(
    "document.querySelector('main').textContent.includes('New campaign')",
  );
  await field("Internal campaign name", "October travel stories");
  await clickText("Use starter text");
  assert(
    (await evaluate("document.querySelector('main textarea').value")).includes(
      "Some journeys",
    ),
  );
  await evaluate(
    "document.querySelector('input[name=campaign-template][value=OFFER]').click()",
  );
  await field("Email heading", "A home for your favourite memories");
  await field("Inbox preview text", "A new chapter starts here");
  await field("Button label", "Discover Albumo");
  await field("Button destination", "https://albumo.in/products");
  await field("Offer code", "MEMORIES");
  await capture("campaign-designer-desktop");
  await field("Email subject", "Your next chapter deserves a home");
  await field(
    "Message",
    "A little inspiration for your next photo book.\n\nMake room for your favourite memories with Albumo.",
  );
  await clickText("Save draft");
  await waitFor(
    "document.querySelector('main').textContent.includes('Preview & send')",
  );
  assert.equal(campaignSends, 0);
  assert.equal(campaigns[0].design.offerCode, "MEMORIES");
  assert.equal(
    campaigns[0].design.heading,
    "A home for your favourite memories",
  );
  await clickText("Preview & send");
  await waitFor(
    "!!document.querySelector('iframe[title=\\\"Campaign email preview\\\"]')",
  );
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('button')].find(el=>el.textContent==='Queue campaign for subscribers').disabled",
    ),
    true,
  );
  await clickText("Send preview to admin");
  await waitFor(
    "document.querySelector('main').textContent.includes('Preview queued for the admin')",
  );
  assert.equal(adminPreviews, 1);
  await evaluate(
    "document.querySelector('section[aria-label=\\\"Campaign preview\\\"]').scrollIntoView({block:'start'})",
  );
  await capture("email-campaign-preview-desktop");
  await evaluate(
    "document.querySelector('section[aria-label=\\\"Campaign preview\\\"] input[type=checkbox]').click()",
  );
  await clickText("Queue campaign for subscribers");
  await waitFor(
    "document.querySelector('main').textContent.includes('Campaign queued.')",
  );
  assert.equal(campaignSends, 1);
  await go("/support?ticket=ticket1");
  await waitFor(
    "document.querySelector('main').textContent.includes('Email the customer separately')",
  );
  const fillTicketReply = async (text) => {
    await evaluate(
      "(() => { const el = document.querySelector('textarea[aria-label=\"Ticket reply\"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el," +
        JSON.stringify(text) +
        "); el.dispatchEvent(new Event('input', {bubbles:true})); })()",
    );
    await delay(150);
  };
  await fillTicketReply("A normal ticket reply draft.");
  await clickText("Send email");
  await field("Support email template", "quality");
  await clickText("Insert template text");
  assert(
    (
      await evaluate("document.querySelector('main form textarea').value")
    ).includes("Hi Asha"),
  );
  await field(
    "Email message",
    "Hi Asha, we are reviewing your cover enquiry. Please send a photograph of the book.",
  );
  await field("Email subject", "Your Albumo cover enquiry");
  await evaluate(
    "document.querySelector('main form').scrollIntoView({block:'start'})",
  );
  await capture("support-email-desktop");
  await clickText("Send email to customer");
  await waitFor(
    "document.querySelector('main').textContent.includes('Email queued. The ticket conversation and status have not changed.')",
  );
  assert.equal(supportEmails.length, 1);
  assert.equal(supportEmails[0].subject, "Your Albumo cover enquiry");
  assert(supportEmails[0].message.includes("cover enquiry"));
  assert.equal(supportReplies.length, 0);
  assert.equal(supportTicket.status, "OPEN");
  assert.equal(
    await evaluate(
      "document.querySelector('textarea[aria-label=\"Ticket reply\"]').value",
    ),
    "A normal ticket reply draft.",
  );
  await clickText("Send reply");
  await waitFor(
    "document.querySelector('textarea[aria-label=\"Ticket reply\"]').value === ''",
  );
  assert.equal(supportReplies.length, 1);
  assert.equal(supportReplies[0].isInternal, false);
  assert.equal(supportReplies[0].message, "A normal ticket reply draft.");
  await evaluate(
    "[...document.querySelectorAll('main label')].find(el=>el.textContent.trim()==='Internal note').querySelector('input').click()",
  );
  await fillTicketReply("Check the print with the production team.");
  await clickText("Add note");
  await waitFor(
    "document.querySelector('textarea[aria-label=\"Ticket reply\"]').value === ''",
  );
  assert.equal(supportReplies[1].isInternal, true);
  for (const width of [390, 320]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await go("/support?ticket=ticket1");
    await waitFor(
      "document.querySelector('main').textContent.includes('Email the customer separately')",
    );
    await clickText("Send email");
    await evaluate(
      "document.querySelector('main form').scrollIntoView({block:'start'})",
    );
    assert(
      await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"),
      "Support mobile overflow at " + width,
    );
    await capture("support-email-" + width);
    await go("/emails");
    for (const section of [
      "Delivery history",
      "Support inbox",
      "Campaigns",
      "Setup",
    ]) {
      await clickText(section);
      await delay(500);
      assert(
        await evaluate(
          "document.documentElement.scrollWidth <= innerWidth + 1",
        ),
        "Mobile overflow: " + section + " at " + width,
      );
    }
    await evaluate("window.scrollTo(0,0)");
    await capture("email-setup-" + width);
  }
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  console.log(
    "PASS campaign templates/customization/preview, separate support email with original ticket replies and private notes, delivery history, CSRF transport, desktop and 390/320px layouts",
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

#!/usr/bin/env node
/**
 * P4e 浏览器闭环验收：真实浏览器登录 → 打开 /admin/agent-platform →
 * UI 编辑并发布 memory 域草稿 → HTTP 新 Run 断言绑定新 configVersion →
 * UI 回滚 → 再建 Run 断言恢复。
 *
 * 后台只消费真实 API（无 mock）；配置内核 root 由 harness 隔离到临时目录。
 * 本机探测不到 Chrome/Edge/Chromium 时打印 UNVERIFIED 并 exit 0（环境依赖的
 * 诚实标记）；断言失败 exit 1。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "output", "agent-config-plane-browser");
// 固定端口：浏览器 fetch 写操作会带 Origin，CORS/写来源校验需要预先知道自身源。
const BROWSER_TEST_PORT = 18777;
const BROWSER_TEST_ORIGIN = `http://127.0.0.1:${BROWSER_TEST_PORT}`;

function resolveBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function sessionCookie(cookieHeader, baseUrl) {
  const pair = String(cookieHeader || "").split(";")[0];
  const separator = pair.indexOf("=");
  assert(separator > 0, "admin session cookie is malformed");
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    url: baseUrl,
    httpOnly: true,
    sameSite: "Lax",
  };
}

async function snapshotConfigVersion(harness, environment) {
  const response = await harness.request(`/api/admin/agent-platform/config/snapshot?env=${environment}`, {
    headers: { authorization: "Bearer c1-config-read-token" },
  });
  assert.strictEqual(response.status, 200, response.text);
  return response.json.snapshot.configVersion;
}

async function createRunAndWait(harness, tag) {
  const create = await harness.request("/api/ai/agent/runs", {
    method: "POST",
    body: {
      message: "你是谁？",
      protocolVersion: "agent.v2",
      requestId: `p4e-browser-${tag}`,
      conversationId: `p4e-browser-conversation-${tag}`,
      idempotencyKey: `p4e-browser-idempotency-${tag}`,
      context: { envVersion: "release", memoryMode: "local_only" },
    },
  });
  assert.strictEqual(create.status, 202, `create run ${tag}: ${create.text}`);
  const deadline = Date.now() + 10000;
  let view = null;
  while (Date.now() < deadline) {
    const poll = await harness.request(`/api/ai/agent/runs/${encodeURIComponent(create.json.runId)}?pollToken=${encodeURIComponent(create.json.pollToken)}`);
    assert.strictEqual(poll.status, 200, poll.text);
    view = poll.json;
    if (["completed", "degraded", "failed", "cancelled"].includes(view.status)) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(10, Number(view.nextPollMs) || 10)));
  }
  assert.ok(view && view.result && view.result.platformTrace, `run ${tag} must expose platformTrace`);
  return view.result.platformTrace;
}

async function waitToast(page, text) {
  await page.waitForFunction((expected) => {
    const toast = document.getElementById("toast");
    return toast && toast.style.display !== "none" && toast.textContent.indexOf(expected) >= 0;
  }, text, { timeout: 15000 });
}

async function main() {
  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    console.log("test-agent-config-plane-browser: UNVERIFIED (no Chrome/Edge/Chromium executable found on this machine; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to run the real browser loop)");
    return;
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const { chromium } = require("../server/node_modules/playwright-core");

  let harness;
  let browser;
  try {
    harness = await startAdminHttpHarness({
      environment: {
        PORT: String(BROWSER_TEST_PORT),
        FOSU_ALLOWED_ADMIN_ORIGINS: `http://admin.test,${BROWSER_TEST_ORIGIN}`,
        FOSU_ALLOWED_PUBLIC_ORIGINS: `http://public.test,${BROWSER_TEST_ORIGIN}`,
        AI_RUNTIME_MODE: "public",
        AI_AGENT_ENABLED: "false",
        AI_PROVIDER_IGNORE_ENV_FILE: "true",
        ADMIN_SERVICE_TOKENS: JSON.stringify([
          { name: "c1-config-read", token: "c1-config-read-token", scopes: ["agent-config:read"] },
        ]),
      },
      listenServer(server) {
        return new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(BROWSER_TEST_PORT, "127.0.0.1", resolve);
        });
      },
    });
    const session = await harness.login();
    const publicConfigBefore = await snapshotConfigVersion(harness, "public");

    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([sessionCookie(session.cookie, harness.baseUrl)]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());

    // ── 登录态打开控制面 ─────────────────────────────────────────────
    // I-2 注入链路：runtime-config.js 未登录 302；登录后下发部署方配置且 no-store。
    const runtimeConfigAnonymous = await harness.request("/admin/agent-platform/runtime-config.js");
    assert.strictEqual(runtimeConfigAnonymous.status, 302, `anonymous runtime-config must redirect: ${runtimeConfigAnonymous.status}`);
    const runtimeConfigResponse = await harness.request("/admin/agent-platform/runtime-config.js", { cookie: session.cookie });
    assert.strictEqual(runtimeConfigResponse.status, 200, runtimeConfigResponse.text);
    assert.ok(runtimeConfigResponse.text.indexOf("window.AGENT_ADMIN_RUNTIME_CONFIG") === 0, "runtime-config.js must define the injection global");
    assert.match(String(runtimeConfigResponse.headers["cache-control"] || ""), /no-store/);

    await page.goto(`${harness.baseUrl}/admin/agent-platform/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h1");
    assert.match(await page.locator("h1").textContent(), /助手运行中心/);
    // 页面品牌/CSRF 头名必须来自注入而非通用默认值；写操作（下方发布链）经注入头名仍 200。
    const injectedConfig = await page.evaluate(() => window.AGENT_ADMIN_RUNTIME_CONFIG || null);
    assert.ok(injectedConfig && injectedConfig.csrfHeader === "x-fosu-csrf", `csrf header must be injected by the server: ${JSON.stringify(injectedConfig)}`);
    assert.ok(injectedConfig.brand && injectedConfig.brand !== "Agent Admin", `brand must come from injection, not the generic default: ${JSON.stringify(injectedConfig)}`);
    assert.strictEqual(await page.title(), `助手运行中心 · ${injectedConfig.brand}`);
    assert.strictEqual(
      await page.locator("[data-domain-tab]").count(),
      0,
      "advanced config domains must not block the operations-center first paint",
    );

    // 未登录访问必须跳登录页（另起无 Cookie 上下文验证）。
    const anonymousContext = await browser.newContext();
    const anonymousPage = await anonymousContext.newPage();
    const anonymousResponse = await anonymousPage.goto(`${harness.baseUrl}/admin/agent-platform/`, { waitUntil: "domcontentloaded" });
    assert.ok(anonymousResponse, "anonymous page load must produce a response");
    await anonymousPage.waitForURL(/\/admin\/login/, { timeout: 10000 });
    await anonymousContext.close();

    // ── UI 编辑并发布（public / memory 域）────────────────────────────
    await page.locator("#advancedConfig summary").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-domain-tab]").length === 6, null, { timeout: 15000 });
    await page.locator("#envSelect").selectOption("public");
    await page.waitForFunction(() => {
      const el = document.getElementById("configStatus");
      return el && el.textContent.indexOf("public") >= 0 && el.textContent.indexOf("cfg-public-") >= 0;
    }, null, { timeout: 15000 });
    await page.locator('[data-domain-tab="memory"]').click();
    await page.locator("#btnLoadPublished").click();
    await page.waitForFunction(() => {
      const editor = document.getElementById("draftEditor");
      return editor && editor.value.trim().length > 0;
    }, null, { timeout: 15000 });
    await page.locator("#draftEditor").fill(JSON.stringify({ ttlOverridesMs: { grade: 13824000000 } }, null, 2));

    await page.locator("#btnSaveDraft").click();
    await waitToast(page, "草稿已保存");
    await page.locator("#btnValidate").click();
    await waitToast(page, "校验通过");
    await page.locator("#btnTest").click();
    await waitToast(page, "测试通过");
    await page.locator("#btnPublish").click();
    await waitToast(page, "已发布 v2");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "p4e-published.png"), fullPage: false });

    const publicConfigPublished = await snapshotConfigVersion(harness, "public");
    assert.notStrictEqual(publicConfigPublished, publicConfigBefore, "publish must mint a new configVersion");

    // ── 新 Run 必须绑定新快照 ─────────────────────────────────────────
    const traceAfterPublish = await createRunAndWait(harness, "ui-publish");
    assert.strictEqual(traceAfterPublish.configVersion, publicConfigPublished,
      `run after UI publish must bind ${publicConfigPublished}, got ${traceAfterPublish.configVersion}`);

    // ── UI 回滚到 v1，新 Run 必须恢复绑定 ─────────────────────────────
    await page.waitForSelector('[data-rollback-version="1"]', { timeout: 15000 });
    await page.locator('[data-rollback-version="1"]').click();
    await waitToast(page, "已回滚到 v1");
    await page.screenshot({ path: path.join(OUTPUT_DIR, "p4e-rolled-back.png"), fullPage: false });

    const publicConfigRestored = await snapshotConfigVersion(harness, "public");
    assert.notStrictEqual(publicConfigRestored, publicConfigPublished, "rollback must mint a new configVersion");
    const traceAfterRollback = await createRunAndWait(harness, "ui-rollback");
    assert.strictEqual(traceAfterRollback.configVersion, publicConfigRestored,
      `run after UI rollback must bind ${publicConfigRestored}, got ${traceAfterRollback.configVersion}`);

    // ── Run Trace 详情视图真实渲染 ────────────────────────────────────
    await page.waitForFunction(() => document.querySelectorAll("[data-run-id]").length > 0, null, { timeout: 15000 });
    await page.locator("[data-run-id]").first().click();
    await page.waitForFunction(() => {
      const el = document.getElementById("runDetail");
      return el && el.textContent.indexOf("configVersion") >= 0 && el.querySelector(".timeline-item");
    }, null, { timeout: 15000 });

    assert.deepStrictEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);
    console.log("test-agent-config-plane-browser: PASS (publish → new run bound → rollback → restored, real browser)");
  } finally {
    if (browser) await browser.close();
    if (harness) await harness.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

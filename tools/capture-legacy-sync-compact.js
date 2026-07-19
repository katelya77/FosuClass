"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");
const { chromium } = require("../server/node_modules/playwright-core");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "output", "legacy-sync-compact");

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

async function selectedTab(page) {
  return page.locator('#syncTaskTabs [role="tab"][aria-selected="true"]').getAttribute("data-sync-tab");
}

async function assertOnlyPanelVisible(page, key) {
  for (const candidate of ["overview", "upload", "versions", "operations"]) {
    const panel = page.locator("#sync-panel-" + candidate);
    const expected = candidate === key;
    assert.strictEqual(await panel.isVisible(), expected, "unexpected visibility for " + candidate);
    assert.strictEqual(await panel.getAttribute("hidden") === null, expected, "hidden state mismatch for " + candidate);
    assert.strictEqual(await panel.getAttribute("inert") === null, expected, "inert state mismatch for " + candidate);
    if (!expected) assert.strictEqual(await panel.evaluate((element) => element.offsetHeight), 0, candidate + " must not occupy page height");
  }
}

async function assertNoPageOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(dimensions.scroll <= dimensions.viewport + 1, label + " has page-level horizontal overflow");
}

async function activateTab(page, key) {
  const select = page.locator("#syncTabSelect");
  if (await select.isVisible()) await select.selectOption(key);
  else await page.locator("#sync-tab-" + key).click();
  await page.waitForFunction((tabKey) => {
    const panel = document.getElementById("sync-panel-" + tabKey);
    return panel && !panel.hidden && !panel.hasAttribute("inert");
  }, key);
  assert.strictEqual(await selectedTab(page), key);
  assert.strictEqual(new URL(page.url()).hash, "#" + key);
  await assertOnlyPanelVisible(page, key);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT_DIR, name), fullPage: false });
}

async function main() {
  const executablePath = resolveBrowserExecutable();
  assert(executablePath, "Chrome, Edge, or Chromium executable is required");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let harness;
  let browser;
  try {
    harness = await startAdminHttpHarness({ environment: { PORT: "3001" } });
    const session = await harness.login();
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

    await page.goto(harness.baseUrl + "/admin/sync#overview", { waitUntil: "domcontentloaded" });
    await page.locator('#syncTaskTabs[data-initialized="true"]').waitFor();
    await assertOnlyPanelVisible(page, "overview");
    assert.strictEqual(await selectedTab(page), "overview");
    await page.locator("#syncOnlineStatus.is-online").waitFor();
    assert.match(await page.locator("#syncOnlineStatus").innerText(), /\u5728\u7ebf\u72b6\u6001\uff1a\u6b63\u5e38/);
    assert.strictEqual(await page.locator("#refreshButton").isVisible(), false, "sync must expose only its single refresh-status action");
    const overviewHeight = await page.locator("#section-sync").evaluate((element) => element.getBoundingClientRect().height);
    assert(overviewHeight <= 1080, "overview exceeds the 1.2-screen compactness target: " + overviewHeight);
    await assertNoPageOverflow(page, "1440x900 overview");
    await screenshot(page, "desktop-overview.png");

    await activateTab(page, "upload");
    const flowState = await page.locator("#sync-primary-flow").evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      cards: Array.from(element.querySelectorAll("details.flow-card")).map((card) => card.open),
    }));
    assert.deepStrictEqual(flowState.cards, [false, false], "local and relay command cards must start collapsed");
    assert(flowState.height <= 120, "collapsed command cards are unexpectedly tall: " + flowState.height);
    await assertNoPageOverflow(page, "1440x900 upload");
    await screenshot(page, "desktop-upload.png");
    await activateTab(page, "versions");
    await assertNoPageOverflow(page, "1440x900 versions");
    await screenshot(page, "desktop-versions.png");
    await activateTab(page, "operations");
    assert((await page.locator("#healthGrid").evaluate((element) => element.getBoundingClientRect().height)) <= 80, "empty API health state must stay compact");
    await assertNoPageOverflow(page, "1440x900 operations");
    await screenshot(page, "desktop-operations.png");

    await activateTab(page, "overview");
    await page.locator("#sync-tab-overview").focus();
    await page.keyboard.press("ArrowRight");
    assert.strictEqual(await selectedTab(page), "upload", "ArrowRight should select upload");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('#syncTaskTabs[data-initialized="true"]').waitFor();
    assert.strictEqual(await selectedTab(page), "upload", "reload should restore the hash-selected tab");

    await page.goto(harness.baseUrl + "/admin/sync#release-history-panel", { waitUntil: "domcontentloaded" });
    await page.locator('#syncTaskTabs[data-initialized="true"]').waitFor();
    assert.strictEqual(await selectedTab(page), "versions", "legacy release anchor should map to versions");

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
      await page.setViewportSize(viewport);
      await activateTab(page, "overview");
      await assertNoPageOverflow(page, viewport.width + "x" + viewport.height + " overview");
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      if (typeof window.closeMobileDrawer === "function") window.closeMobileDrawer(false);
    });
    await activateTab(page, "overview");
    assert(await page.locator("#syncTabSelect").isVisible(), "mobile task select should be visible");
    assert.strictEqual(await page.locator("#appSidebar").evaluate((element) => element.classList.contains("show")), false, "mobile sidebar must be closed for the task view");
    await assertNoPageOverflow(page, "390px overview");
    await screenshot(page, "mobile-overview.png");

    assert.deepStrictEqual(pageErrors, [], "browser page errors: " + pageErrors.join("; "));
    await context.close();
    console.log("Legacy sync compact browser checks passed: " + OUTPUT_DIR);
  } finally {
    if (browser) await browser.close();
    if (harness) await harness.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

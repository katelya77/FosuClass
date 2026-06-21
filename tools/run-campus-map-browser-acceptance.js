#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    return require(path.join(__dirname, "fosu-sync-client", "node_modules", "playwright"));
  }
}

const { chromium } = loadPlaywright();

const BASE_URL = process.env.FOSU_ADMIN_BASE_URL || "http://127.0.0.1:3127";
const ADMIN_PASSWORD = process.env.FOSU_ADMIN_TEST_PASSWORD || process.env.ADMIN_PASSWORD || "codex-map-test";
const OUT_DIR = path.resolve(process.env.FOSU_ACCEPTANCE_OUT || "output/campus-map-acceptance");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function outPath(name) {
  return path.join(OUT_DIR, name);
}

async function screenshot(target, name, options = {}) {
  const filePath = outPath(name);
  await target.screenshot(Object.assign({ path: filePath }, options));
  return filePath;
}

async function fetchPublicConfig(context) {
  const response = await context.request.get(`${BASE_URL}/api/ai/campus-map/published`);
  const headers = response.headers();
  const body = await response.json();
  const config = body && body.data ? body.data : body;
  return {
    status: response.status(),
    etag: headers.etag || "",
    hash: config.hash || "",
    version: config.version || "",
    placeCount: Array.isArray(config.places) ? config.places.length : 0,
    body: config,
  };
}

async function waitForCampusMapReady(page) {
  await page.waitForFunction(() => {
    const section = document.querySelector("#section-campus-map");
    return section && section.classList.contains("active");
  }, { timeout: 30000 });
  await page.waitForSelector("#campusMapAssetGrid .campus-map-asset-card", { timeout: 30000 });
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll("#campusMapAssetGrid .campus-map-asset-card"));
    const thumbs = Array.from(document.querySelectorAll("#campusMapAssetGrid img.campus-map-thumb"));
    const editorImage = document.querySelector("#campusMapAdminImage");
    const visibleError = document.querySelector("#campusMapImageError:not([hidden])");
    return cards.length >= 4 &&
      thumbs.length >= 4 &&
      thumbs.every((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) &&
      editorImage &&
      editorImage.complete &&
      editorImage.naturalWidth > 0 &&
      editorImage.naturalHeight > 0 &&
      !visibleError;
  }, { timeout: 45000 });
}

async function login(context) {
  const response = await context.request.post(`${BASE_URL}/api/admin/login`, {
    data: { password: ADMIN_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`admin login failed with HTTP ${response.status()}: ${await response.text()}`);
  }
}

async function selectNorthMap(page) {
  await page.locator("#campusMapAssetGrid .campus-map-asset-card[data-map-key='xianxiNorth']").click();
  await page.selectOption("#campusMapAssetSelect", "xianxiNorth").catch(() => null);
}

async function waitForPost(page, pathPart, action) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes(pathPart) &&
    response.request().method() === "POST",
  { timeout: 45000 });
  await action();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`${pathPart} returned HTTP ${response.status()}`);
  }
  return response;
}

async function main() {
  ensureDir(OUT_DIR);
  const screenshots = {};
  const imageResponses = [];
  const consoleErrors = [];
  const dialogMessages = [];
  const testSuffix = Date.now();
  const testCode = `CM-AUTO-${testSuffix}`;

  const browser = await chromium.launch({ headless: process.env.FOSU_PLAYWRIGHT_HEADLESS !== "false" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/static/campus-maps/assets/")) return;
    const headers = response.headers();
    imageResponses.push({
      url,
      status: response.status(),
      mime: headers["content-type"] || "",
      size: Number(headers["content-length"] || 0),
      cacheControl: headers["cache-control"] || "",
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.stack || error.message || String(error));
  });
  page.on("dialog", async (dialog) => {
    dialogMessages.push({ type: dialog.type(), message: dialog.message() });
    await dialog.accept();
  });

  try {
    await login(context);
    await page.goto(`${BASE_URL}/admin/campus-map`, { waitUntil: "domcontentloaded" });
    await waitForCampusMapReady(page);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);

    screenshots.basemaps = await screenshot(page.locator("#campusMapAssetGrid"), "01-four-basemaps.png");
    screenshots.health = await screenshot(page.locator("#section-campus-map .card").first(), "02-oracle-cloudbase-health.png");

    const publicBefore = await fetchPublicConfig(context);
    await selectNorthMap(page);
    await page.click("#campusMapAddBtn");
    await page.waitForSelector("#campusMapRect:not([hidden])", { timeout: 10000 });
    await page.fill("#campusMapName", `Codex map acceptance ${testSuffix}`);
    await page.fill("#campusMapCode", testCode);
    await page.fill("#campusMapAliases", "codex-map-acceptance,auto-test");
    await page.fill("#campusMapDescription", "Browser acceptance draft place for campus map editor.");
    await page.selectOption("#campusMapVerified", "false");
    screenshots.addPlace = await screenshot(page.locator("#section-campus-map"), "03-new-place.png");

    screenshots.dragBefore = await screenshot(page.locator("#campusMapEditor"), "04-rect-before-drag.png");
    const rectBefore = await page.locator("#campusMapRect").boundingBox();
    if (!rectBefore) throw new Error("campus map rectangle was not visible before drag");
    await page.mouse.move(rectBefore.x + rectBefore.width / 2, rectBefore.y + rectBefore.height / 2);
    await page.mouse.down();
    await page.mouse.move(rectBefore.x + rectBefore.width / 2 + 70, rectBefore.y + rectBefore.height / 2 + 45, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    screenshots.dragAfter = await screenshot(page.locator("#campusMapEditor"), "05-rect-after-drag.png");

    const seHandle = await page.locator("#campusMapRect .campus-map-handle[data-handle='se']").boundingBox();
    if (!seHandle) throw new Error("campus map southeast resize handle was not visible");
    await page.mouse.move(seHandle.x + seHandle.width / 2, seHandle.y + seHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(seHandle.x + seHandle.width / 2 + 45, seHandle.y + seHandle.height / 2 + 35, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    screenshots.resizeAfter = await screenshot(page.locator("#campusMapEditor"), "06-rect-after-resize.png");

    await page.click("#campusMapUndoBtn");
    await page.waitForTimeout(150);
    await page.click("#campusMapRedoBtn");
    await page.waitForTimeout(150);
    screenshots.editPlace = await screenshot(page.locator("#section-campus-map"), "07-edited-place.png");

    await waitForPost(page, "/api/admin/campus-map/draft", () => page.click("#campusMapSaveDraftBtn"));
    await page.waitForTimeout(500);
    const publicAfterDraft = await fetchPublicConfig(context);
    screenshots.draftState = await screenshot(page.locator("#section-campus-map"), "08-draft-state.png");

    await waitForPost(page, "/api/admin/campus-map/diff", () => page.click("#campusMapDiffBtn"));
    await page.waitForTimeout(500);
    screenshots.diffPreview = await screenshot(page.locator("#campusMapDiffPreview"), "09-publish-diff-preview.png");

    await waitForPost(page, "/api/admin/campus-map/publish", () => page.click("#campusMapPublishBtn"));
    await page.waitForTimeout(800);
    const publicAfterPublish = await fetchPublicConfig(context);
    screenshots.publishedState = await screenshot(page.locator("#section-campus-map"), "10-published-state.png");

    await page.evaluate(() => {
      window.__campusMapConfirmMessages = [];
      window.confirm = (message) => {
        window.__campusMapConfirmMessages.push(String(message || ""));
        const existing = document.querySelector("#playwrightConfirmCapture");
        if (existing) existing.remove();
        const node = document.createElement("div");
        node.id = "playwrightConfirmCapture";
        node.style.cssText = [
          "position:fixed",
          "inset:0",
          "z-index:2147483647",
          "display:flex",
          "align-items:center",
          "justify-content:center",
          "background:rgba(15,23,42,.45)",
          "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        ].join(";");
        node.innerHTML = "<div style='width:420px;max-width:calc(100vw - 32px);background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 24px 80px rgba(15,23,42,.35);padding:20px;'>" +
          "<strong style='display:block;font-size:16px;margin-bottom:10px;'>Delete confirmation captured by Playwright</strong>" +
          "<p style='font-size:14px;line-height:1.5;margin:0 0 16px;white-space:pre-wrap;'>" + String(message || "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch])) + "</p>" +
          "<div style='display:flex;gap:8px;justify-content:flex-end;'><button style='padding:8px 12px;border-radius:6px;border:1px solid #d1d5db;background:#fff;'>Cancel</button><button style='padding:8px 12px;border-radius:6px;border:0;background:#b91c1c;color:#fff;'>Confirm</button></div>" +
          "</div>";
        document.body.appendChild(node);
        return true;
      };
    });
    await page.click("#campusMapDeleteBtn");
    await page.waitForSelector("#playwrightConfirmCapture", { timeout: 10000 });
    screenshots.deleteConfirm = await screenshot(page, "11-delete-confirmation.png");
    const deleteConfirmMessages = await page.evaluate(() => window.__campusMapConfirmMessages || []);
    await page.evaluate(() => {
      const node = document.querySelector("#playwrightConfirmCapture");
      if (node) node.remove();
    });
    await waitForPost(page, "/api/admin/campus-map/draft", () => page.click("#campusMapSaveDraftBtn"));
    await page.waitForTimeout(500);
    await waitForPost(page, "/api/admin/campus-map/diff", () => page.click("#campusMapDiffBtn"));
    await page.waitForTimeout(500);
    screenshots.deleteDiff = await screenshot(page.locator("#campusMapDiffPreview"), "12-delete-diff-preview.png");

    const historyOptions = await page.locator("#campusMapRollbackSelect option").count();
    if (historyOptions < 1) throw new Error("no campus map history option available after publish");
    await page.locator("#campusMapRollbackSelect").selectOption({ index: 0 });
    await waitForPost(page, "/api/admin/campus-map/rollback", () => page.click("#campusMapRollbackBtn"));
    await page.waitForTimeout(800);
    const publicAfterRollback = await fetchPublicConfig(context);
    screenshots.rollback = await screenshot(page.locator("#section-campus-map"), "13-history-rollback.png");

    const publishedTestPlace = (publicAfterPublish.body.places || []).find((place) => place.code === testCode);
    const rolledBackTestPlace = (publicAfterRollback.body.places || []).find((place) => place.code === testCode);

    const summary = {
      baseUrl: BASE_URL,
      testCode,
      screenshots,
      imageResponses,
      consoleErrors,
      dialogMessages,
      deleteConfirmMessages,
      public: {
        before: {
          status: publicBefore.status,
          version: publicBefore.version,
          hash: publicBefore.hash,
          etag: publicBefore.etag,
          placeCount: publicBefore.placeCount,
        },
        afterDraft: {
          status: publicAfterDraft.status,
          version: publicAfterDraft.version,
          hash: publicAfterDraft.hash,
          etag: publicAfterDraft.etag,
          placeCount: publicAfterDraft.placeCount,
          unchangedFromBefore: publicAfterDraft.hash === publicBefore.hash && publicAfterDraft.version === publicBefore.version,
        },
        afterPublish: {
          status: publicAfterPublish.status,
          version: publicAfterPublish.version,
          hash: publicAfterPublish.hash,
          etag: publicAfterPublish.etag,
          placeCount: publicAfterPublish.placeCount,
          testPlacePublished: Boolean(publishedTestPlace),
          unverifiedPreciseRegionHidden: publishedTestPlace ? publishedTestPlace.mapRegion === null : false,
        },
        afterRollback: {
          status: publicAfterRollback.status,
          version: publicAfterRollback.version,
          hash: publicAfterRollback.hash,
          etag: publicAfterRollback.etag,
          placeCount: publicAfterRollback.placeCount,
          testPlaceAbsent: !rolledBackTestPlace,
        },
      },
      checks: {
        allImageResponsesOk: imageResponses.length >= 4 && imageResponses.every((item) => item.status === 200 && /^image\//.test(item.mime)),
        draftDidNotChangePublic: publicAfterDraft.hash === publicBefore.hash && publicAfterDraft.version === publicBefore.version,
        publishChangedPublic: publicAfterPublish.hash !== publicBefore.hash && publicAfterPublish.version !== publicBefore.version,
        rollbackRemovedTestPlace: !rolledBackTestPlace,
        unverifiedPlaceHasNoPreciseRegion: publishedTestPlace ? publishedTestPlace.mapRegion === null : false,
        deleteRequiredConfirmation: deleteConfirmMessages.length > 0,
        noConsoleErrors: consoleErrors.length === 0,
      },
    };

    fs.writeFileSync(outPath("browser-acceptance.json"), JSON.stringify(summary, null, 2));

    const failed = Object.entries(summary.checks).filter(([, ok]) => !ok);
    if (failed.length) {
      throw new Error(`browser acceptance checks failed: ${failed.map(([name]) => name).join(", ")}`);
    }
    console.log(JSON.stringify(summary.checks, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});

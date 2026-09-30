#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("../server/node_modules/playwright-core");
const { adminConsoleHtml } = require("../server/src/routes/adminPages");

function browserExecutable() {
  const browserRoot = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const installed = fs.existsSync(browserRoot) ? fs.readdirSync(browserRoot)
    .filter((name) => name.startsWith("chromium_headless_shell-"))
    .sort().reverse()
    .map((name) => path.join(browserRoot, name, "chrome-headless-shell-win64", "chrome-headless-shell.exe")) : [];
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    ...installed,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((candidate) => candidate && fs.existsSync(candidate));
}

async function run() {
  const executablePath = browserExecutable();
  assert(executablePath, "Chrome, Edge, or Chromium executable is required");
  const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    const requests = [];
    let notices = [{
      id: "existing-notice", title: "已发布的图书馆公告", content: "开放安排以学校通知为准。",
      type: "info", priority: "normal", displayMode: "ticker", targetPage: "home",
      enabled: true, closable: true, version: "v1", updatedAt: "2026-09-29T09:00:00.000Z",
    }];
    await page.route("http://fosu.test/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/admin/content-center") {
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: adminConsoleHtml });
      }
      if (url.pathname.startsWith("/api/admin/")) {
        requests.push(url.pathname);
        const response = url.pathname === "/api/admin/session"
          ? { success: true, authenticated: true, csrfToken: "test" }
          : url.pathname === "/api/admin/notices"
            ? { success: true, items: notices }
            : url.pathname === "/api/admin/daily-knowledge"
              ? { success: true, data: { policy: { enabled: false }, managed: [], builtin: [], counts: {}, selected: null } }
              : { success: true, data: {} };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
      }
      return route.fulfill({ status: 404, body: "" });
    });

    await page.goto("http://fosu.test/admin/content-center", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("contentCenterDailyStatus")?.textContent === "已暂停");
    assert(requests.includes("/api/admin/notices"), "opening content center must fetch existing notices");
    await page.waitForFunction(() => document.getElementById("contentCenterNoticeList")?.textContent.includes("已发布的图书馆公告"));

    notices = [{ ...notices[0], id: "updated-notice", title: "新的图书馆公告" }];
    await page.locator("#refreshButton").click();
    await page.waitForFunction(() => document.getElementById("contentCenterNoticeList")?.textContent.includes("新的图书馆公告"));
    assert.strictEqual(await page.locator("#section-daily-knowledge.active").count(), 1,
      "refresh should keep the content center open");

    notices = [{ ...notices[0], id: "third-notice", title: "切换后更新的公告" }];
    await page.evaluate(() => { window.switchAdminPage("dashboard"); window.switchAdminPage("daily-knowledge"); });
    await page.waitForFunction(() => document.getElementById("contentCenterNoticeList")?.textContent.includes("切换后更新的公告"));
    console.log("test-admin-content-center-notice-load passed");
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

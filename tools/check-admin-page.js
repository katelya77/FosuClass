const vm = require("vm");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "test-admin-token";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "test-admin-password";

const router = require("../server/src/routes/adminPages");

function fail(message) {
  console.error(`Admin page smoke check failed: ${message}`);
  process.exit(1);
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    fail(`missing ${label}: ${needle}`);
  }
}

function countMatches(source, pattern) {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

function extractScripts(html) {
  const scripts = [];
  const re = /<script\b(?![^>]*type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    scripts.push(match[1]);
  }
  return scripts;
}

function assertStaticHtml(html) {
  if (!html || html.length < 1000) {
    fail("adminConsoleHtml is empty or unexpectedly short");
  }

  assertIncludes(html, 'id="loginView"', "login view");
  assertIncludes(html, "佛课小表后台", "login heading");
  assertIncludes(html, 'id="dashboardView"', "admin shell");
  assertIncludes(html, 'id="appSidebar"', "sidebar");
  assertIncludes(html, 'id="mobileMenuBtn"', "mobile menu");
  assertIncludes(html, 'id="section-sync"', "sync section");
  assertIncludes(html, 'id="section-terms"', "terms section");
  assertIncludes(html, 'id="section-daily-knowledge"', "daily knowledge section");
  assertIncludes(html, 'id="dailyKnowledgeList"', "daily knowledge visual library");
  assertIncludes(html, 'id="dailyKnowledgePhoneScreen"', "daily knowledge phone preview");
  assertIncludes(html, 'id="dailyKnowledgeImportJson"', "daily knowledge JSON import editor");
  assertIncludes(html, 'id="dailyKnowledgeValidateButton"', "daily knowledge import validator");
  assertIncludes(html, 'id="dailyKnowledgeImportButton"', "daily knowledge import action");
  assertIncludes(html, "/api/admin/daily-knowledge", "daily knowledge admin API");
  assertIncludes(html, "/api/admin/daily-knowledge/import", "daily knowledge import API");
  assertIncludes(html, "保存到正式版内容池", "daily knowledge publish action");
  assertIncludes(html, 'id="repairCurrentTermReleaseBtn"', "semester repair button");
  assertIncludes(html, 'id="termRepairJobLog"', "semester repair job log");
  assertIncludes(html, "/repair-release/dry-run", "semester repair dry-run API");
  assertIncludes(html, "/repair-release/start", "semester repair start API");
  assertIncludes(html, "repairCurrentTermReleaseFromPanel", "semester repair click handler");
  assertIncludes(html, "不重新采集课表", "semester repair confirmation no recrawl");
  assertIncludes(html, "不影响用户本地课表和 XLS 导入", "semester repair confirmation local data safety");
  assertIncludes(html, 'class="sync-dashboard-grid"', "compact sync two-column layout");
  assertIncludes(html, 'id="staging-cli-upload-panel"', "always-visible staging upload panel");
  assertIncludes(html, 'id="quickUploadCommand"', "quick staging CLI command");
  assertIncludes(html, 'id="release-history-panel"', "bottom release history panel");
  assertIncludes(html, "syncWizardStartDateWithTerm", "term startDate auto-sync helper");
  assertIncludes(html, "state.terms", "term registry-backed startDate mapping");
  if (html.includes('"2025-2026-2": "2026-03-09"')) {
    fail("sync wizard must not hardcode the legacy term start date");
  }
  ["#eef3f8", "#cfe0ff", "#8fbaff", "#4f86e8", "#1d4ed8"].forEach((color) => {
    assertIncludes(html, color, `heatmap color ${color}`);
  });
  assertIncludes(html, "bootAdminConsole", "boot script");
  assertIncludes(html, 'window.addEventListener("error"', "global error handler");
  assertIncludes(html, 'window.addEventListener("unhandledrejection"', "global rejection handler");
  [
    'id="drawFbContact"',
    "fb.contact",
    "<th>联系方式</th>",
    "关键词检索内容/联系方式/班级",
  ].forEach((needle) => {
    if (html.includes(needle)) {
      fail(`feedback admin UI must not expose contact field: ${needle}`);
    }
  });

  const openScriptCount = countMatches(html, /<script\b/gi);
  const closeScriptCount = countMatches(html, /<\/script>/gi);
  if (openScriptCount !== closeScriptCount) {
    fail(`script tag count mismatch: open=${openScriptCount}, close=${closeScriptCount}`);
  }

  const scripts = extractScripts(html);
  if (scripts.length === 0) {
    fail("no executable script block found");
  }
  scripts.forEach((script, index) => {
    try {
      new vm.Script(script, { filename: `admin-inline-${index + 1}.js` });
    } catch (error) {
      fail(`inline script ${index + 1} is not valid JavaScript: ${error.message}`);
    }
  });

  if (/<script[\s\S]*commandText \+= "set "[\s\S]*"\r?\n"/.test(html)) {
    fail("detected a commandText string with a raw newline inside script");
  }
}

function assertRoutes() {
  const paths = new Set();
  router.stack.forEach((layer) => {
    const routePath = layer.route && layer.route.path;
    if (Array.isArray(routePath)) {
      routePath.forEach((item) => paths.add(item));
    } else if (routePath) {
      paths.add(routePath);
    }
  });

  [
    "/login",
    "/dashboard",
    "/timetable",
    "/classes",
    "/teachers",
    "/classrooms",
    "/courses",
    "/feedback",
    "/sync",
    "/terms",
    "/settings",
    "/logs",
    "/quality",
    "/catalog",
    "/announcements",
    "/daily-knowledge",
    "/daily-tips",
    "/map",
  ].forEach((routePath) => {
    if (!paths.has(routePath)) {
      fail(`admin route is not registered: ${routePath}`);
    }
  });
}

async function assertRemoteHtml(baseUrl) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  const targets = [
    { path: "/admin/login", expect: "佛课小表后台" },
    { path: "/admin/dashboard", expectAny: ["佛课小表后台", "数据概览", "Found. Redirecting to /admin/login"] },
    { path: "/admin/sync", expectAny: ["佛课小表后台", "同步中心", "Found. Redirecting to /admin/login"] },
  ];

  for (const target of targets) {
    const response = await fetch(root + target.path, { redirect: "manual" });
    const text = await response.text();
    if (!text || text.trim().length === 0) {
      fail(`${target.path} returned empty body`);
    }
    const expected = target.expectAny || [target.expect];
    if (!expected.some((needle) => text.includes(needle))) {
      fail(`${target.path} did not contain expected admin content`);
    }
  }
}

async function main() {
  assertStaticHtml(router.adminConsoleHtml || "");
  assertRoutes();

  if (process.env.ADMIN_PAGE_BASE_URL) {
    await assertRemoteHtml(process.env.ADMIN_PAGE_BASE_URL);
  }

  console.log("Admin page smoke check passed.");
}

main().catch((error) => fail(error.stack || error.message));

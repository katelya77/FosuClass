const assert = require("assert");
const { adminConsoleHtml } = require("../server/src/routes/adminPages");

function between(start, end) {
  const startIndex = adminConsoleHtml.indexOf(start);
  const endIndex = adminConsoleHtml.indexOf(end, startIndex);
  assert(startIndex >= 0, `missing start marker: ${start}`);
  assert(endIndex > startIndex, `missing end marker: ${end}`);
  return adminConsoleHtml.slice(startIndex, endIndex);
}

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = adminConsoleHtml.indexOf(marker);
  assert(start >= 0, `missing function: ${name}`);
  const bodyStart = adminConsoleHtml.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < adminConsoleHtml.length; index += 1) {
    const char = adminConsoleHtml[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return adminConsoleHtml.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

function runPipelineScenario(data, details) {
  const ids = [
    "syncStageStaging",
    "syncStageRelease",
    "syncStageStatic",
    "syncStageVerify",
    "syncStageActive",
    "syncCurrentStageLabel",
    "syncNextStepText",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    dataset: {},
    textContent: "",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
  }]));
  const render = Function("$", `${extractFunction("renderSyncPipelineState")}; return renderSyncPipelineState;`)(
    (id) => elements[id] || null,
  );
  render(data, details);
  return ids.slice(0, 5).map((id) => elements[id].dataset.stageState);
}

function runStaticDirectoryScenario(data, staticSync) {
  const derive = Function(
    `${extractFunction("deriveStaticDirectorySynced")}; return deriveStaticDirectorySynced;`,
  )();
  return derive(data, staticSync);
}

function runStaticUrlScenario(staticSync, statusValue) {
  const derive = Function(
    `${extractFunction("deriveStaticUrlVerified")}; return deriveStaticUrlVerified;`,
  )();
  return derive(staticSync, statusValue);
}

function run() {
  [
    "--brand-accent",
    "--focus-ring",
    "--surface-sunken",
    "--sidebar-width",
    "--status-success-bg",
    "--status-warning-bg",
    "--status-danger-bg",
    "--on-primary",
    "--on-success",
    "--on-danger",
  ].forEach((token) => assert(adminConsoleHtml.includes(token), `missing design token: ${token}`));

  assert(adminConsoleHtml.includes('class="skip-link"'), "admin console needs a keyboard skip link");
  assert(adminConsoleHtml.includes('id="adminMainContent"'), "skip link needs a stable main-content target");
  assert(adminConsoleHtml.includes('id="sidebarCollapseBtn"'), "desktop sidebar must support collapse");
  assert(adminConsoleHtml.includes('id="sidebarCloseBtn"'), "mobile sidebar drawer must have an explicit close button");
  assert(adminConsoleHtml.includes('class="nav-icon"'), "navigation must use a consistent inline icon system");

  ["总览", "数据与课表", "发布与运维", "内容管理", "系统与安全"].forEach((label) => {
    assert(adminConsoleHtml.includes(`data-nav-group="${label}"`), `missing navigation group: ${label}`);
  });

  const sidebar = between('<aside id="appSidebar"', "</aside>");
  assert(!sidebar.includes('class="theme-switcher"'), "theme selector must not be duplicated in the sidebar footer");
  assert(!/[\u{1F300}-\u{1FAFF}]/u.test(sidebar), "navigation must not use emoji icons");

  ["dashboardSystemGrid", "dashboardAttentionList", "statsGrid"].forEach((id) => {
    assert(adminConsoleHtml.includes(`id="${id}"`), `dashboard hierarchy is missing #${id}`);
  });
  const dashboardRenderer = between("function renderDashboard()", "function renderDashboardVisuals()");
  assert(!/[\u{1F300}-\u{1FAFF}]/u.test(dashboardRenderer), "dashboard metrics must not use emoji icons");
  assert(dashboardRenderer.includes("dashboardSystemGrid"));
  assert(dashboardRenderer.includes("dashboardAttentionList"));

  assert(adminConsoleHtml.includes('id="syncPipelineRail"'), "sync center needs a visual release pipeline");
  [
    "Staging 上传",
    "Release Pack 生成",
    "OpenResty 静态目录同步",
    "URL 验证",
    "Active Pointer 生效",
  ].forEach((label) => assert(adminConsoleHtml.includes(label), `missing sync pipeline stage: ${label}`));
  const syncSection = between('<section id="section-sync"', '<section id="section-terms"');
  const syncPrimaryButtons = syncSection.match(/<button[^>]*class=["'][^"']*\bprimary\b[^"']*["']/g) || [];
  assert.strictEqual(syncPrimaryButtons.length, 1, "sync center must expose one clear primary action");
  assert(!adminConsoleHtml.includes('className = "btn primary"'), "sync table-row actions must remain secondary");
  assert(adminConsoleHtml.includes('$("manualStaticSyncBtn").className = "secondary"'), "advanced static sync must not compete with the recommended action");

  assert(adminConsoleHtml.includes('id="catalogResultCount"'), "catalog toolbar must expose result count");
  assert(adminConsoleHtml.includes('role="search"'), "catalog search controls need a search landmark");
  assert(adminConsoleHtml.includes('aria-label="搜索数据资源"'), "catalog search needs an accessible label");
  assert(adminConsoleHtml.includes("position: sticky"), "data tables need sticky headers");
  assert(adminConsoleHtml.includes("font-variant-numeric: tabular-nums"), "operational numbers need tabular figures");

  assert(adminConsoleHtml.includes('id="loginError" role="alert" aria-live="polite"'));
  const loginHandler = between("function login()", "function logout()");
  assert(loginHandler.includes("setButtonLoading"), "login must expose a clear processing state");
  assert(adminConsoleHtml.includes('aria-label="关闭后台导航"'));
  assert(adminConsoleHtml.includes('aria-label="收起侧栏"'));
  assert(adminConsoleHtml.includes('aria-label="退出登录"'));

  const sectionSwitcher = between("function switchSection(section, options)", "function loadDashboard()");
  assert(
    /targetSection === ["']dashboard["'][\s\S]*loadDashboardOperations/.test(sectionSwitcher),
    "navigating back to Dashboard must refresh operational status",
  );
  assert(sectionSwitcher.includes("mobileDrawerWasOpen"), "section navigation must remember whether the mobile drawer owned focus");
  assert(sectionSwitcher.includes('$("adminMainContent").focus()'), "mobile section navigation must move focus into the new page");
  const sidebarNavigationBinding = between(
    'document.querySelectorAll(".sidebar nav ul li[data-section]")',
    "// 实时预览监听",
  );
  assert(!sidebarNavigationBinding.includes("closeMobileDrawer()"), "sidebar navigation must not close the mobile drawer twice");

  assert.deepStrictEqual(
    runPipelineScenario({ releaseVersion: "v2", releasePackHealthy: false }, {}),
    ["complete", "current", "pending", "pending", "pending"],
    "an unhealthy published pack must not be marked complete",
  );
  assert.deepStrictEqual(
    runPipelineScenario({ releaseVersion: "v2", releasePackHealthy: true }, { staticDirectorySynced: true, staticUrlVerified: false }),
    ["complete", "complete", "complete", "current", "pending"],
    "directory sync and URL verification must remain independent stages",
  );
  assert.deepStrictEqual(
    runPipelineScenario({ releaseVersion: "v2", activeReleaseVersion: "v2", releasePackHealthy: true }, { staticDirectorySynced: true, staticUrlVerified: true }),
    ["complete", "complete", "complete", "complete", "complete"],
    "the chain completes only when the matching Active Pointer is effective",
  );
  assert.strictEqual(
    runStaticDirectoryScenario(
      { releaseVersion: "v2", activeReleaseVersion: "v2" },
      {
        enabled: true,
        configured: true,
        targetDirExists: true,
        targetDirWritable: true,
        targetReleaseDirExists: true,
        localRequiredFilesPresent: true,
        activeReleaseVersion: "v2",
        releaseVersion: "v2",
        versionMatched: false,
        syncedReleaseVersion: "",
        status: "failed",
        success: false,
        phase: "verifying-public-url",
        code: "STATIC_SYNC_URL_VERIFY_FAILED",
        needsSyncReason: "not-synced-yet",
      },
    ),
    true,
    "copied files must remain complete when only public URL verification fails",
  );
  assert.strictEqual(
    runStaticDirectoryScenario(
      { releaseVersion: "v2", activeReleaseVersion: "v2" },
      {
        enabled: true,
        configured: true,
        targetDirExists: true,
        targetDirWritable: true,
        targetReleaseDirExists: false,
        localRequiredFilesPresent: false,
        activeReleaseVersion: "v2",
        releaseVersion: "v2",
        versionMatched: false,
        syncedReleaseVersion: "v1",
        needsSyncReason: "target-release-missing",
      },
    ),
    false,
    "a missing current static directory must not complete the directory stage",
  );
  assert.strictEqual(
    runStaticUrlScenario(
      {
        status: "failed",
        success: false,
        manifestStatus: 200,
        classIndexStatus: 200,
        emptyRoomStatus: 200,
        verifiedUrls: [{ url: "/v1/manifest.json", ok: true, status: 200 }],
        verificationResults: [{ url: "/v2/manifest.json", ok: false, status: 502 }],
      },
      "failed",
    ),
    false,
    "stale successful URL records must not complete verification after the current attempt fails",
  );
  assert.strictEqual(
    runStaticUrlScenario(
      { status: "success", success: true, manifestStatus: 200, classIndexStatus: 200, emptyRoomStatus: 200 },
      "success",
    ),
    true,
    "the URL stage completes only for a current non-failed successful verification",
  );

  const syncStatusRenderer = between("function renderSyncStatusGrid()", "function renderRuntimeStorage()");
  assert(syncStatusRenderer.includes('data.activeReleaseVersion || "未生效"'), "sync summary must use the runtime pointer for Active Release");
  assert(syncStatusRenderer.includes('label: "最新 Published Release"'), "sync summary must distinguish Published from Active");
  const syncOperationsRenderer = between("function renderSyncOperationsPanels(data)", "function buildRelayRunCommand");
  assert(syncOperationsRenderer.includes("Boolean(data.activeReleaseVersion)"), "current-online panel must derive state from activeReleaseVersion");
  assert(syncOperationsRenderer.includes('["最近 Published Release", data.releaseVersion || "-"]'), "current-online panel must label the published candidate explicitly");

  ["feedbackDrawer", "catalogDrawer"].forEach((id) => {
    const markup = between(`id="${id}"`, "</div>");
    assert(markup.includes('role="dialog"'), `#${id} needs dialog semantics`);
    assert(markup.includes('aria-modal="true"'), `#${id} needs modal semantics`);
    assert(markup.includes("inert"), `#${id} must be non-interactive while closed`);
  });
  assert(adminConsoleHtml.includes("translateX(100%)"), "closed detail drawers must be fully off-canvas");
  assert(adminConsoleHtml.includes("syncSidebarAccessibility"), "mobile drawer needs breakpoint-aware inert state");
  assert(adminConsoleHtml.includes("trapFocusWithin"), "drawers need keyboard focus containment");
  assert(adminConsoleHtml.includes('id="mobilePageTitle"'), "mobile page heading must remain available");
  assert(!adminConsoleHtml.includes('<div class="mobile-topbar-title" id="mobilePageTitle"'), "mobile title must use heading semantics");

  const catalogLoader = between("function loadCatalog()", "function renderCatalogTable()");
  assert(catalogLoader.includes('setAttribute("aria-busy", "true")'), "catalog loading needs aria-busy");
  assert(catalogLoader.includes("catalog-error-state"), "catalog failures need a persistent error row");

  const kbRenderer = between("function renderAssistantKb()", "function bindAssistantKbEvents()");
  assert(kbRenderer.includes('tab === "rules" ? renderKbEditor("rule") : ""'), "only the active KB editor may render its stable IDs");
  assert(kbRenderer.includes('tab === "docs" ? renderKbEditor("doc") : ""'), "inactive KB tabs must not duplicate editor IDs");

  assert(adminConsoleHtml.includes('id="campusMapDiffBtn"'), "campus map diff preview must retain its bound operation entry point");

  const copyHandler = between("window.copyText = function(text)", "function fallbackCopyText(text)");
  assert(copyHandler.includes("clipboardFallbackTimer"), "clipboard copy needs a bounded timeout fallback");
  assert(copyHandler.includes("window.setTimeout"));
  assert(copyHandler.includes("window.clearTimeout"));
  const fallbackCopyHandler = between("function fallbackCopyText(text)", "function copyAppConfigUrl()");
  assert(fallbackCopyHandler.includes('document.execCommand("copy") === true'), "clipboard fallback must verify copy success");
  assert(fallbackCopyHandler.includes("finally"), "clipboard fallback must always clean up its temporary control");
  assert(fallbackCopyHandler.includes('showToast("复制失败'), "clipboard fallback must expose a manual-copy error path");

  const placeholderStyles = between("input::placeholder", "input:focus");
  assert(!placeholderStyles.includes("opacity:"), "placeholder text must keep its contrast in both themes");
  ["#92400e", "#991b1b", "#065f46"].forEach((legacyColor) => {
    assert(!adminConsoleHtml.includes(`color: ${legacyColor}`), `semantic UI must not retain light-only text color ${legacyColor}`);
    assert(!adminConsoleHtml.includes(`color:${legacyColor}`), `semantic UI must not retain light-only text color ${legacyColor}`);
  });
  assert(
    adminConsoleHtml.includes("onclick='location.reload()' style='background:var(--primary); color:var(--on-primary)"),
    "fatal error recovery must use the theme-aware primary contrast token",
  );

  console.log("test-admin-operations-studio-ui passed");
}

run();

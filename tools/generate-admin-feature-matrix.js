/**
 * Generate admin migration inventory artifacts from live sources.
 *
 * Outputs (under docs/admin-migration/):
 *   - feature-matrix.json
 *   - api-contracts.json
 *   - legacy-feature-inventory.md  (summary regenerated; keep hand notes in risk-register)
 *
 * Run: node tools/generate-admin-feature-matrix.js
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs/admin-migration");
const ADMIN_JS = path.join(ROOT, "server/src/routes/admin.js");
const ADMIN_PAGES = path.join(ROOT, "server/src/routes/adminPages.js");
const VUE_ROUTER = path.join(ROOT, "admin-web/src/router/index.ts");
const VUE_PAGES_DIR = path.join(ROOT, "admin-web/src/pages");

const NEXT_STATUS = new Set([
  "missing",
  "read-only",
  "write-implemented",
  "contract-verified",
  "browser-verified",
  "production-verified",
  "cutover-ready",
]);

const LEGACY_NAV = [
  { section: "dashboard", label: "数据概览", group: "总览", domain: "dashboard", vueRoute: "/dashboard" },
  { section: "catalog", label: "数据资源", group: "数据与课表", domain: "catalog", vueRoute: "/catalog" },
  { section: "terms", label: "学期管理", group: "数据与课表", domain: "term", vueRoute: "/terms" },
  { section: "quality", label: "数据质量", group: "数据与课表", domain: "quality", vueRoute: "/quality" },
  { section: "sync", label: "同步中心", group: "发布与运维", domain: "sync", vueRoute: "/sync" },
  { section: "config", label: "数据版本", group: "发布与运维", domain: "settings", vueRoute: "/settings" },
  { section: "notices", label: "公告管理", group: "内容管理", domain: "content", vueRoute: "/content" },
  { section: "news", label: "最新动态", group: "内容管理", domain: "content", vueRoute: "/content" },
  { section: "campus-map", label: "校园地图", group: "内容管理", domain: "campus-map", vueRoute: "/campus-map" },
  { section: "feedback", label: "反馈管理", group: "内容管理", domain: "feedback", vueRoute: "/feedback" },
  { section: "assistant-kb", label: "助手知识库", group: "内容管理", domain: "assistant", vueRoute: "/assistant" },
  { section: "ai-provider", label: "查询服务", group: "系统与安全", domain: "provider", vueRoute: "/provider" },
  { section: "security", label: "安全状态", group: "系统与安全", domain: "security", vueRoute: "/security" },
  { section: "settings", label: "系统设置", group: "系统与安全", domain: "settings", vueRoute: "/settings" },
];

/** Known Vue status at Phase A baseline (after PR #7 shell). */
const DOMAIN_NEXT_STATUS = {
  auth: "write-implemented",
  dashboard: "read-only",
  catalog: "read-only",
  staging: "read-only",
  release: "read-only",
  sync: "read-only",
  term: "read-only",
  quality: "read-only",
  content: "write-implemented",
  feedback: "write-implemented",
  "campus-map": "read-only",
  assistant: "missing",
  provider: "missing",
  security: "read-only",
  settings: "read-only",
  audit: "write-implemented",
  backups: "write-implemented",
  jobs: "missing",
  relay: "missing",
  misc: "missing",
};

const DOMAIN_TARGET_MODULE = {
  auth: "auth",
  dashboard: "dashboard",
  catalog: "catalog",
  staging: "staging",
  release: "release",
  sync: "sync",
  term: "term",
  quality: "quality",
  content: "content",
  feedback: "feedback",
  "campus-map": "campus-map",
  assistant: "assistant",
  provider: "provider",
  security: "security",
  settings: "settings",
  audit: "audit",
  backups: "backups",
  jobs: "jobs",
  relay: "relay",
  misc: "settings",
};

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function extractRoutes(src) {
  const routes = [];
  const re = /router\.(get|post|put|patch|delete)\s*\(\s*[\r\n\s]*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const method = m[1].toUpperCase();
    const routePath = m[2];
    const window = src.slice(m.index, Math.min(src.length, m.index + 900));
    const hasRequireScopes = /requireScopes\s*\(/.test(window.slice(0, 450));
    const usesWriteAccess = /verifyAdminWriteAccess/.test(window.slice(0, 450));
    const usesAdminAccess = /verifyAdminAccess|verifyAdminToken|verifyAdminWriteAccess/.test(
      window.slice(0, 450)
    );
    const audit = /writeAuditLog\s*\(/.test(window);
    const createsBackup = /createBackup\s*\(/.test(window);
    routes.push({
      method,
      path: routePath,
      fullPath: `/api/admin${routePath}`,
      writesData: !["GET", "HEAD", "OPTIONS"].includes(method),
      usesWriteAccess,
      usesAdminAccess,
      hasRequireScopes,
      auditLikely: audit,
      backupLikely: createsBackup,
      index: m.index,
    });
  }
  return routes;
}

function extractLegacyUiWriteCalls(pagesSrc) {
  // adminApi('POST', '/notices') style and fetch('/api/admin/...')
  const calls = [];
  const apiRe =
    /(?:adminApi|apiRequest|uploadApi|fetchJson|request)\s*\(\s*['"](GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*['"`]([^'"`]+)['"`]/gi;
  let m;
  while ((m = apiRe.exec(pagesSrc))) {
    calls.push({ method: m[1].toUpperCase(), path: normalizeAdminPath(m[2]), source: "adminApi-style" });
  }
  const fetchRe = /fetch\s*\(\s*[`'"](\/api\/admin\/[^`'"]+)[`'"]\s*(?:,\s*\{([\s\S]{0,200}?)\})?/g;
  while ((m = fetchRe.exec(pagesSrc))) {
    const url = m[1].split("?")[0];
    const opts = m[2] || "";
    const methodMatch = opts.match(/method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i);
    calls.push({
      method: (methodMatch ? methodMatch[1] : "GET").toUpperCase(),
      path: normalizeAdminPath(url),
      source: "fetch",
    });
  }
  // Template literals with method in options nearby are hard; also catch `/api/admin/...` string literals with method vars
  const pathOnly = [...pagesSrc.matchAll(/['"`](\/api\/admin\/[a-zA-Z0-9_./:-]+)['"`]/g)].map((x) =>
    normalizeAdminPath(x[1])
  );
  return { calls, pathOnly: [...new Set(pathOnly)].sort() };
}

function normalizeAdminPath(p) {
  let s = String(p || "").split("?")[0];
  if (s.startsWith("/api/admin")) s = s.slice("/api/admin".length) || "/";
  if (!s.startsWith("/")) s = `/${s}`;
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s || "/";
}

function domainForPath(p) {
  const s = String(p || "").toLowerCase();
  if (/^\/(login|logout|session)/.test(s)) return "auth";
  if (/dashboard|classroom-heatmap|system\/load/.test(s)) return "dashboard";
  if (/catalog/.test(s)) return "catalog";
  if (/staging|sync\/staging/.test(s)) return "staging";
  if (
    /static-release|static-ticket|release-pack|release\/|sync\/releases|sync\/status|sync\/history|sync\/record|sync\/reconcile|sync\/command|publisher/.test(
      s
    )
  ) {
    return "release";
  }
  if (/terms/.test(s)) return "term";
  if (/quality/.test(s)) return "quality";
  if (/notices|news/.test(s)) return "content";
  if (/feedback/.test(s)) return "feedback";
  if (/campus-map/.test(s)) return "campus-map";
  if (/assistant-kb/.test(s)) return "assistant";
  if (/ai-provider|ai-agent/.test(s)) return "provider";
  if (/security/.test(s)) return "security";
  if (/^\/config$|\/export$|storage\//.test(s)) return "settings";
  if (/audit/.test(s)) return "audit";
  if (/backup|snapshot/.test(s)) return "backups";
  if (/jobs/.test(s)) return "jobs";
  if (/relay/.test(s)) return "relay";
  return "misc";
}

function legacyPageForDomain(domain, path) {
  if (domain === "content") {
    if (String(path).includes("news")) return "news";
    return "notices";
  }
  const map = {
    auth: "login",
    dashboard: "dashboard",
    catalog: "catalog",
    staging: "sync",
    release: "sync",
    sync: "sync",
    term: "terms",
    quality: "quality",
    feedback: "feedback",
    "campus-map": "campus-map",
    assistant: "assistant-kb",
    provider: "ai-provider",
    security: "security",
    settings: "settings",
    audit: "settings",
    // Vue ExperimentalPage uses legacySection "backups"; Legacy UI embeds backups under settings.
    backups: "backups",
    jobs: "sync",
    relay: "sync",
    misc: "settings",
  };
  return map[domain] || "settings";
}

function riskForRoute(route) {
  const p = route.path;
  if (
    /activate|rollback|publish$|publish\/|rebuild|static-release-sync|repair-release\/start|storage\/maintenance\/run|delete.*backup|snapshot\/activate|release\/activate|bind-release|rebuild-runtime-pointer/i.test(
      p
    )
  ) {
    return "critical";
  }
  if (
    /staging|sync|terms|config|ai-provider|campus-map|assistant-kb|security|relay|catalog\/meta|delete|upload|finalize|quality\/mark|feedback/i.test(
      p
    )
  ) {
    return route.writesData ? "high" : "medium";
  }
  if (route.writesData) return "medium";
  return "low";
}

function actionSlug(method, routePath) {
  return `${method.toLowerCase()}-${routePath
    .replace(/^\//, "")
    .replace(/:/g, "")
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")}`;
}

function humanAction(method, routePath) {
  const leaf = routePath.replace(/\/:[^/]+/g, "");
  return `${method} ${leaf}`;
}

function detectVueUsage() {
  const routerSrc = fs.readFileSync(VUE_ROUTER, "utf8");
  const experimentalSections = [...routerSrc.matchAll(/legacySection:\s*['"]([^'"]+)['"]/g)].map(
    (m) => m[1]
  );
  const pageFiles = fs
    .readdirSync(VUE_PAGES_DIR)
    .filter((f) => f.endsWith(".vue"))
    .map((f) => ({
      file: f,
      src: fs.readFileSync(path.join(VUE_PAGES_DIR, f), "utf8"),
    }));
  const pagesUsingLegacyUrl = pageFiles
    .filter((p) => /legacyAdminUrl\s*\(/.test(p.src))
    .map((p) => p.file);
  const experimentalPageUsed = /ExperimentalPage/.test(routerSrc);
  return {
    experimentalSections,
    experimentalPageUsed,
    pagesUsingLegacyUrl,
    vuePageFiles: pageFiles.map((p) => p.file),
  };
}

function buildContract(route) {
  const writes = route.writesData;
  const errorCodes = writes
    ? [400, 401, 403, 404, 409, 429, 500]
    : [401, 403, 404, 500];
  const base = {
    method: route.method,
    path: route.fullPath,
    routePath: route.path,
    auth: route.usesAdminAccess || route.usesWriteAccess ? "admin-session-or-token" : "public-or-session",
    csrf: writes,
    scopes: route.hasRequireScopes ? "explicit-requireScopes" : writes ? "default-admin:full" : "authenticated-read",
    requestBody: writes
      ? {
          type: "object",
          notes: "See handler in server/src/routes/admin.js; Phase B+ will attach Zod/schema per domain.",
        }
      : null,
    query: !writes
      ? {
          type: "object",
          notes: "Optional filters; see handler.",
        }
      : null,
    successResponse: {
      type: "object",
      required: ["success"],
      properties: {
        success: { type: "boolean", const: true },
      },
      notes: "Legacy envelope preserved; additional fields vary by endpoint.",
    },
    errorResponse: {
      type: "object",
      required: ["success", "message"],
      properties: {
        success: { type: "boolean", const: false },
        message: { type: "string" },
        code: { type: "string", optional: true },
      },
    },
    errorCodes,
    audit: route.auditLikely,
    backup: route.backupLikely,
  };

  // High-value explicit contracts
  if (route.path === "/login" && route.method === "POST") {
    base.requestBody = {
      type: "object",
      required: ["username", "password"],
      properties: {
        username: { type: "string" },
        password: { type: "string" },
      },
    };
    base.successResponse.properties.csrfToken = { type: "string" };
    base.errorCodes = [400, 401, 429, 500];
  }
  if (route.path === "/notices" && route.method === "POST") {
    base.requestBody = {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        status: { type: "string" },
        publishAt: { type: "string", optional: true },
        expireAt: { type: "string", optional: true },
      },
    };
    base.successResponse.properties.item = { type: "object" };
  }
  if (route.path === "/feedbacks/:id" && route.method === "PUT") {
    base.requestBody = {
      type: "object",
      properties: {
        status: { type: "string" },
        note: { type: "string", optional: true },
        adminNote: { type: "string", optional: true },
      },
    };
  }
  if (route.path === "/sync/status" && route.method === "GET") {
    base.successResponse.properties = {
      success: { type: "boolean" },
      activeReleaseVersion: { type: "string", optional: true },
      releaseVersion: { type: "string", optional: true },
      semester: { type: "string", optional: true },
    };
  }
  if (route.path === "/staging/upload/init" && route.method === "POST") {
    base.requestBody = {
      type: "object",
      required: ["term"],
      properties: {
        term: { type: "string" },
        semester: { type: "string", optional: true },
        fileName: { type: "string", optional: true },
        fileSize: { type: "number", optional: true },
        contentHash: { type: "string", optional: true },
      },
    };
  }

  return base;
}

function main() {
  const adminSrc = fs.readFileSync(ADMIN_JS, "utf8");
  const pagesSrc = fs.readFileSync(ADMIN_PAGES, "utf8");
  const routes = extractRoutes(adminSrc);
  const uiWrites = extractLegacyUiWriteCalls(pagesSrc);
  const vue = detectVueUsage();
  const commit = gitCommit();
  const generatedAt = new Date().toISOString();

  const features = routes.map((route) => {
    const domain = domainForPath(route.path);
    const risk = riskForRoute(route);
    const nextStatus = DOMAIN_NEXT_STATUS[domain] || "missing";
    if (!NEXT_STATUS.has(nextStatus)) {
      throw new Error(`invalid nextStatus ${nextStatus}`);
    }
    return {
      id: actionSlug(route.method, route.path),
      domain,
      targetModule: DOMAIN_TARGET_MODULE[domain] || domain,
      legacyPage: legacyPageForDomain(domain, route.path),
      action: humanAction(route.method, route.path),
      actionId: actionSlug(route.method, route.path),
      legacyApi: `${route.method} ${route.fullPath}`,
      method: route.method,
      path: route.path,
      risk,
      writesData: route.writesData,
      requiresCsrf: route.writesData,
      requiresConfirmation:
        risk === "critical" ||
        /delete|activate|rollback|publish|repair-release\/start|maintenance\/run|disable|archive/i.test(
          route.path
        ),
      auditAction: route.writesData
        ? /delete/i.test(route.method)
          ? "delete"
          : /post/i.test(route.method) && !/update|mark|put/i.test(route.path)
            ? "create"
            : "update"
        : "read",
      hasExplicitScope: route.hasRequireScopes,
      auditInHandler: route.auditLikely,
      backupInHandler: route.backupLikely,
      nextStatus,
      idempotencyRequired: /publish|rebuild|static-release-sync|activate|repair-release\/start|finalize|rollback|maintenance\/run|snapshot\/activate|release\/activate/i.test(
        route.path
      ),
      concurrencyControlRecommended:
        /config|notices|news|campus-map|assistant-kb|ai-provider|catalog\/meta/i.test(route.path) &&
        route.writesData,
      productionSmokeAllowed: !/activate|publish|rollback|maintenance\/run|delete|repair-release\/start|snapshot\/activate/i.test(
        route.path
      ) || !route.writesData,
      apiTests: [],
      playwrightTests: [],
      notes: "",
    };
  });

  // UI surface features (non-API) that still need parity tracking
  const uiFeatures = [
    {
      id: "ui-nav-all-sections",
      domain: "dashboard",
      targetModule: "dashboard",
      legacyPage: "dashboard",
      action: "Navigate all legacy sidebar sections",
      actionId: "ui-nav-all-sections",
      legacyApi: null,
      method: null,
      path: null,
      risk: "low",
      writesData: false,
      requiresCsrf: false,
      requiresConfirmation: false,
      auditAction: "read",
      hasExplicitScope: false,
      auditInHandler: false,
      backupInHandler: false,
      nextStatus: "read-only",
      idempotencyRequired: false,
      concurrencyControlRecommended: false,
      productionSmokeAllowed: true,
      apiTests: [],
      playwrightTests: [],
      notes: "Sidebar parity across 14 sections",
    },
    {
      id: "ui-theme-switcher",
      domain: "settings",
      targetModule: "settings",
      legacyPage: "settings",
      action: "Theme switcher system/light/dark",
      actionId: "ui-theme-switcher",
      legacyApi: null,
      method: null,
      path: null,
      risk: "low",
      writesData: false,
      requiresCsrf: false,
      requiresConfirmation: false,
      auditAction: "read",
      hasExplicitScope: false,
      auditInHandler: false,
      backupInHandler: false,
      nextStatus: "write-implemented",
      idempotencyRequired: false,
      concurrencyControlRecommended: false,
      productionSmokeAllowed: true,
      apiTests: [],
      playwrightTests: [],
      notes: "Client-only preference",
    },
    {
      id: "ui-strong-confirm-active-pointer",
      domain: "release",
      targetModule: "release",
      legacyPage: "sync",
      action: "Strong confirmation dialog for Active Pointer switch",
      actionId: "ui-strong-confirm-active-pointer",
      legacyApi: "POST /api/admin/release/activate",
      method: "POST",
      path: "/release/activate",
      risk: "critical",
      writesData: true,
      requiresCsrf: true,
      requiresConfirmation: true,
      auditAction: "update",
      hasExplicitScope: false,
      auditInHandler: true,
      backupInHandler: true,
      nextStatus: "missing",
      idempotencyRequired: true,
      concurrencyControlRecommended: true,
      productionSmokeAllowed: false,
      apiTests: [],
      playwrightTests: [],
      notes: "Must show target, impact, miniprogram impact, rollback point",
    },
  ];

  const allFeatures = [...features, ...uiFeatures];

  const contracts = {
    version: 1,
    generatedAt,
    sourceCommit: commit,
    basePath: "/api/admin",
    envelope: {
      success: "boolean",
      message: "string on error",
      notes: "Do not break existing fields; additive fields allowed.",
    },
    routes: routes.map(buildContract),
  };

  const matrix = {
    version: 1,
    phase: "A",
    generatedAt,
    sourceCommit: commit,
    nextStatusEnum: [...NEXT_STATUS],
    primaryAdmin: "legacy",
    flags: {
      FOSU_ADMIN_PRIMARY: "legacy",
      FOSU_ADMIN_NEXT_ENABLED: true,
      FOSU_ADMIN_LEGACY_ENABLED: true,
      FOSU_ADMIN_NEXT_WRITE_MODULES: "",
    },
    summary: {
      totalFeatures: allFeatures.length,
      apiRoutes: routes.length,
      writeRoutes: routes.filter((r) => r.writesData).length,
      readRoutes: routes.filter((r) => !r.writesData).length,
      byDomain: {},
      byRisk: {},
      byNextStatus: {},
    },
    legacyNav: LEGACY_NAV,
    vueBaseline: vue,
    targetModules: [
      "auth",
      "dashboard",
      "catalog",
      "sync",
      "staging",
      "release",
      "runtime",
      "term",
      "quality",
      "content",
      "feedback",
      "campus-map",
      "assistant",
      "provider",
      "security",
      "settings",
      "audit",
      "backups",
      "jobs",
      "relay",
    ],
    features: allFeatures,
    legacyUiApiPaths: uiWrites.pathOnly,
    rules: {
      cutoverReadyRequires: ["apiTests non-empty", "playwrightTests non-empty", "no ExperimentalPage", "no business legacyAdminUrl"],
      unregisteredLegacyWriteForbidden: true,
      productionPrimaryUnchangedInPhaseA: true,
    },
  };

  for (const f of allFeatures) {
    matrix.summary.byDomain[f.domain] = (matrix.summary.byDomain[f.domain] || 0) + 1;
    matrix.summary.byRisk[f.risk] = (matrix.summary.byRisk[f.risk] || 0) + 1;
    matrix.summary.byNextStatus[f.nextStatus] = (matrix.summary.byNextStatus[f.nextStatus] || 0) + 1;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "feature-matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "api-contracts.json"), `${JSON.stringify(contracts, null, 2)}\n`);

  const invMd = buildInventoryMarkdown(matrix, contracts);
  fs.writeFileSync(path.join(OUT_DIR, "legacy-feature-inventory.md"), invMd);

  console.log(
    JSON.stringify(
      {
        ok: true,
        features: matrix.summary.totalFeatures,
        apiRoutes: matrix.summary.apiRoutes,
        writeRoutes: matrix.summary.writeRoutes,
        byNextStatus: matrix.summary.byNextStatus,
        out: [
          "docs/admin-migration/feature-matrix.json",
          "docs/admin-migration/api-contracts.json",
          "docs/admin-migration/legacy-feature-inventory.md",
        ],
      },
      null,
      2
    )
  );
}

function buildInventoryMarkdown(matrix, contracts) {
  const lines = [];
  lines.push("# Legacy Admin Feature Inventory (Phase A)");
  lines.push("");
  lines.push(`- Generated: \`${matrix.generatedAt}\``);
  lines.push(`- Source commit: \`${matrix.sourceCommit}\``);
  lines.push(`- Production primary remains: **legacy**`);
  lines.push(`- API routes inventoried: **${matrix.summary.apiRoutes}**`);
  lines.push(`- Write routes: **${matrix.summary.writeRoutes}**`);
  lines.push(`- Total matrix rows (API + UI): **${matrix.summary.totalFeatures}**`);
  lines.push("");
  lines.push("## Goals");
  lines.push("");
  lines.push("```text");
  lines.push("/admin        → full Vue admin (after Phase E cutover)");
  lines.push("/admin-next   → parallel Vue entry during migration");
  lines.push("/admin-legacy → emergency Legacy fallback during migration");
  lines.push("```");
  lines.push("");
  lines.push("Phase A does **not** change production primary admin.");
  lines.push("");
  lines.push("## Architecture constraint");
  lines.push("");
  lines.push("```text");
  lines.push("Legacy UI ─┐");
  lines.push("           ├─→ Domain Controller → Domain Service → Repository");
  lines.push("Vue UI ────┘");
  lines.push("```");
  lines.push("");
  lines.push("No duplicated business logic between Legacy handlers and Vue-only handlers.");
  lines.push("");
  lines.push("## Legacy navigation");
  lines.push("");
  lines.push("| Group | Section | Label | Domain | Vue route | Vue baseline |");
  lines.push("|-------|---------|-------|--------|-----------|--------------|");
  for (const nav of matrix.legacyNav) {
    const sample = matrix.features.find((f) => f.legacyPage === nav.section || f.domain === nav.domain);
    const status = sample ? DOMAIN_NEXT_STATUS[nav.domain] || "missing" : "missing";
    lines.push(
      `| ${nav.group} | \`${nav.section}\` | ${nav.label} | ${nav.domain} | \`${nav.vueRoute}\` | ${status} |`
    );
  }
  lines.push("");
  lines.push("## Domain summary");
  lines.push("");
  lines.push("| Domain | Features | Target module |");
  lines.push("|--------|----------|---------------|");
  for (const [domain, count] of Object.entries(matrix.summary.byDomain).sort()) {
    lines.push(`| ${domain} | ${count} | \`${DOMAIN_TARGET_MODULE[domain] || domain}\` |`);
  }
  lines.push("");
  lines.push("## nextStatus distribution");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("|--------|-------|");
  for (const [status, count] of Object.entries(matrix.summary.byNextStatus).sort()) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push("");
  lines.push("## Risk distribution");
  lines.push("");
  lines.push("| Risk | Count |");
  lines.push("|------|-------|");
  for (const [risk, count] of Object.entries(matrix.summary.byRisk).sort()) {
    lines.push(`| ${risk} | ${count} |`);
  }
  lines.push("");
  lines.push("## Critical write / control-plane APIs");
  lines.push("");
  lines.push("| API | Domain | Confirmation | Idempotency | Production smoke |");
  lines.push("|-----|--------|--------------|-------------|------------------|");
  for (const f of matrix.features.filter((x) => x.risk === "critical" && x.writesData)) {
    lines.push(
      `| \`${f.legacyApi}\` | ${f.domain} | ${f.requiresConfirmation} | ${f.idempotencyRequired} | ${f.productionSmokeAllowed} |`
    );
  }
  lines.push("");
  lines.push("## Vue baseline (PR #7 shell)");
  lines.push("");
  lines.push(`- ExperimentalPage used: **${matrix.vueBaseline.experimentalPageUsed}**`);
  lines.push(
    `- Experimental legacy sections: ${matrix.vueBaseline.experimentalSections.map((s) => `\`${s}\``).join(", ") || "(none)"}`
  );
  lines.push(
    `- Pages still calling \`legacyAdminUrl()\`: ${matrix.vueBaseline.pagesUsingLegacyUrl.map((s) => `\`${s}\``).join(", ") || "(none)"}`
  );
  lines.push("");
  lines.push("## Feature matrix schema");
  lines.push("");
  lines.push("Each feature row includes:");
  lines.push("");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        domain: "content",
        legacyPage: "notices",
        action: "create-notice",
        legacyApi: "POST /api/admin/notices",
        risk: "medium",
        writesData: true,
        requiresCsrf: true,
        requiresConfirmation: false,
        auditAction: "create",
        nextStatus: "missing",
      },
      null,
      2
    )
  );
  lines.push("```");
  lines.push("");
  lines.push("Canonical machine-readable file: [`feature-matrix.json`](./feature-matrix.json)");
  lines.push("");
  lines.push("## API contracts");
  lines.push("");
  lines.push(`- Routes with contract stubs: **${contracts.routes.length}**`);
  lines.push("- File: [`api-contracts.json`](./api-contracts.json)");
  lines.push("- Methods, request/response envelopes, and error code sets are recorded for every `/api/admin/*` route.");
  lines.push("- Domain-specific Zod/schemas are filled as modules are extracted (Phase B+).");
  lines.push("");
  lines.push("## Phase roadmap");
  lines.push("");
  lines.push("| Phase | Branch | Focus | Primary stays |");
  lines.push("|-------|--------|-------|---------------|");
  lines.push("| A | `grok/admin-parity-a-inventory` | Inventory + contracts + CI guards | legacy |");
  lines.push("| B | `grok/admin-parity-b-crud` | content / feedback / audit / backups writes | legacy |");
  lines.push("| C | `grok/admin-parity-c-system` | catalog / quality / map / kb / provider / security / settings / relay | legacy |");
  lines.push("| D | `grok/admin-parity-d-control-plane` | staging / release / static / term / jobs | legacy |");
  lines.push("| E | `grok/admin-parity-e-cutover` | Vue primary | next |");
  lines.push("| F | `grok/admin-parity-f-remove-legacy` | Remove Legacy UI after stability evidence | next |");
  lines.push("");
  lines.push("## Regeneration");
  lines.push("");
  lines.push("```bash");
  lines.push("node tools/generate-admin-feature-matrix.js");
  lines.push("node tools/test-admin-feature-matrix.js");
  lines.push("```");
  lines.push("");
  lines.push("Do not hand-edit `feature-matrix.json` route rows without regenerating, or CI will fail drift checks.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

main();

/**
 * Phase A CI guards for admin feature matrix + API contracts.
 *
 * Rules:
 * 1. Feature matrix exists and covers every admin.js route.
 * 2. No unregistered Legacy write API paths (adminPages references).
 * 3. cutover-ready features must list API + Playwright tests.
 * 4. cutover-ready domains must not use ExperimentalPage routes.
 * 5. Domains marked fully migrated (all features production-verified+)
 *    must not keep business legacyAdminUrl() usage.
 * 6. api-contracts.json must record method/body/response/error codes.
 * 7. nextStatus enum is closed.
 * 8. Regenerated route set must match matrix (drift detection).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MATRIX_PATH = path.join(ROOT, "docs/admin-migration/feature-matrix.json");
const CONTRACTS_PATH = path.join(ROOT, "docs/admin-migration/api-contracts.json");
const INVENTORY_PATH = path.join(ROOT, "docs/admin-migration/legacy-feature-inventory.md");
const RISK_PATH = path.join(ROOT, "docs/admin-migration/risk-register.md");
const ADMIN_JS = path.join(ROOT, "server/src/routes/admin.js");
const ADMIN_PAGES = path.join(ROOT, "server/src/routes/adminPages.js");
const VUE_ROUTER = path.join(ROOT, "admin-web/src/router/index.ts");
const VUE_PAGES = path.join(ROOT, "admin-web/src/pages");

const NEXT_STATUS = new Set([
  "missing",
  "read-only",
  "write-implemented",
  "contract-verified",
  "browser-verified",
  "production-verified",
  "cutover-ready",
]);

function extractRoutes(src) {
  const routes = [];
  const re = /router\.(get|post|put|patch|delete)\s*\(\s*[\r\n\s]*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    routes.push({
      method: m[1].toUpperCase(),
      path: m[2],
      key: `${m[1].toUpperCase()} /api/admin${m[2]}`,
    });
  }
  return routes;
}

function normalizeAdminPath(p) {
  let s = String(p || "").split("?")[0];
  if (s.startsWith("/api/admin")) s = s.slice("/api/admin".length) || "/";
  if (!s.startsWith("/")) s = `/${s}`;
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s || "/";
}

function routePatternToRegExp(pattern) {
  const escaped = normalizeAdminPath(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z0-9_]+)/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function pathCoveredByMatrix(pathOnly, matrixApiFeatures) {
  const p = normalizeAdminPath(pathOnly);
  // Exact Express-pattern match
  if (matrixApiFeatures.some((f) => routePatternToRegExp(f.path).test(p))) {
    return true;
  }
  // UI string prefixes used to build deeper paths, e.g. `/staging` + `/upload/init`
  const prefix = p.endsWith("/") ? p : `${p}/`;
  return matrixApiFeatures.some((f) => {
    const fp = normalizeAdminPath(f.path);
    return fp === p || fp.startsWith(prefix) || String(f.path).startsWith(prefix);
  });
}

function loadJson(filePath) {
  assert.ok(fs.existsSync(filePath), `missing ${path.relative(ROOT, filePath)}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// --- required artifacts ---
assert.ok(fs.existsSync(INVENTORY_PATH), "legacy-feature-inventory.md required");
assert.ok(fs.existsSync(RISK_PATH), "risk-register.md required");
const matrix = loadJson(MATRIX_PATH);
const contracts = loadJson(CONTRACTS_PATH);

assert.strictEqual(matrix.version, 1);
assert.ok(Array.isArray(matrix.features) && matrix.features.length > 0, "features required");
assert.ok(Array.isArray(contracts.routes) && contracts.routes.length > 0, "contracts.routes required");

const adminSrc = fs.readFileSync(ADMIN_JS, "utf8");
const liveRoutes = extractRoutes(adminSrc);
assert.ok(liveRoutes.length >= 100, `expected rich admin surface, got ${liveRoutes.length} routes`);

const apiFeatures = matrix.features.filter(
  (f) => f.legacyApi && f.method && f.path && !String(f.id || "").startsWith("ui-")
);
const apiKeys = new Set(apiFeatures.map((f) => f.legacyApi));

// 1) every live route is in the matrix
const missingFromMatrix = liveRoutes.filter((r) => !apiKeys.has(r.key));
assert.deepStrictEqual(
  missingFromMatrix,
  [],
  `Feature matrix missing routes: ${missingFromMatrix.map((r) => r.key).join(", ")}`
);

// 1b) matrix has no stale routes that disappeared from admin.js
const liveKeys = new Set(liveRoutes.map((r) => r.key));
const stale = apiFeatures.filter((f) => !liveKeys.has(f.legacyApi));
assert.deepStrictEqual(
  stale.map((f) => f.legacyApi),
  [],
  `Feature matrix has stale routes: ${stale.map((f) => f.legacyApi).join(", ")}`
);

// 2) Legacy UI write path references must be registered
const pagesSrc = fs.readFileSync(ADMIN_PAGES, "utf8");
const uiPaths = [...pagesSrc.matchAll(/['"`](\/api\/admin\/[a-zA-Z0-9_./:-]+)['"`]/g)].map((m) =>
  normalizeAdminPath(m[1])
);
const uniqueUiPaths = [...new Set(uiPaths)];
const unregisteredUi = uniqueUiPaths.filter((p) => !pathCoveredByMatrix(p, apiFeatures));
// Allow pure static/asset quirks only if empty; otherwise fail
assert.deepStrictEqual(
  unregisteredUi,
  [],
  `Unregistered Legacy UI admin API paths: ${unregisteredUi.join(", ")}`
);

// Also flag method-qualified write helpers if present
const writeHelperRe =
  /(?:adminApi|apiRequest|uploadApi)\s*\(\s*['"](POST|PUT|PATCH|DELETE)['"]\s*,\s*['"`]([^'"`]+)['"`]/gi;
let wm;
const unregisteredWrites = [];
while ((wm = writeHelperRe.exec(pagesSrc))) {
  const method = wm[1].toUpperCase();
  const p = normalizeAdminPath(wm[2]);
  const full = `${method} /api/admin${p}`;
  const covered =
    apiKeys.has(full) ||
    apiFeatures.some(
      (f) => f.method === method && routePatternToRegExp(f.path).test(p)
    );
  if (!covered) unregisteredWrites.push(full);
}
assert.deepStrictEqual(
  unregisteredWrites,
  [],
  `Unregistered Legacy write helpers: ${unregisteredWrites.join(", ")}`
);

// 3) nextStatus enum + cutover-ready requirements
for (const f of matrix.features) {
  assert.ok(NEXT_STATUS.has(f.nextStatus), `invalid nextStatus for ${f.id}: ${f.nextStatus}`);
  assert.ok(f.domain, `domain required for ${f.id}`);
  assert.ok(typeof f.writesData === "boolean", `writesData required for ${f.id}`);
  assert.ok(typeof f.requiresCsrf === "boolean", `requiresCsrf required for ${f.id}`);
  assert.ok(f.risk, `risk required for ${f.id}`);
  assert.ok(f.auditAction, `auditAction required for ${f.id}`);

  if (f.nextStatus === "cutover-ready") {
    assert.ok(
      Array.isArray(f.apiTests) && f.apiTests.length > 0,
      `cutover-ready ${f.id} requires apiTests`
    );
    assert.ok(
      Array.isArray(f.playwrightTests) && f.playwrightTests.length > 0,
      `cutover-ready ${f.id} requires playwrightTests`
    );
  }
}

// 4) cutover-ready pages must not use ExperimentalPage for that domain/section
const routerSrc = fs.readFileSync(VUE_ROUTER, "utf8");
const experimentalSections = [...routerSrc.matchAll(/legacySection:\s*['"]([^'"]+)['"]/g)].map(
  (m) => m[1]
);
const cutoverFeatures = matrix.features.filter((f) => f.nextStatus === "cutover-ready");
for (const f of cutoverFeatures) {
  if (f.legacyPage && experimentalSections.includes(f.legacyPage)) {
    assert.fail(
      `cutover-ready feature ${f.id} still on ExperimentalPage section ${f.legacyPage}`
    );
  }
}

// 5) If a legacyPage has ALL features >= production-verified, forbid legacyAdminUrl in its Vue page
const STATUS_RANK = {
  missing: 0,
  "read-only": 1,
  "write-implemented": 2,
  "contract-verified": 3,
  "browser-verified": 4,
  "production-verified": 5,
  "cutover-ready": 6,
};

const pageToVueFile = {
  notices: "ContentPage.vue",
  news: "ContentPage.vue",
  feedback: "FeedbackPage.vue",
  dashboard: "DashboardPage.vue",
  catalog: "CatalogPage.vue",
  terms: "TermsPage.vue",
  quality: "QualityPage.vue",
  sync: "SyncCenterPage.vue",
  "campus-map": "CampusMapPage.vue",
  security: "SecurityPage.vue",
  settings: "SettingsPage.vue",
  audit: "AuditPage.vue",
  "assistant-kb": "ExperimentalPage.vue",
  "ai-provider": "ExperimentalPage.vue",
  backups: "ExperimentalPage.vue",
};

const byPage = new Map();
for (const f of matrix.features) {
  if (!f.legacyPage) continue;
  if (!byPage.has(f.legacyPage)) byPage.set(f.legacyPage, []);
  byPage.get(f.legacyPage).push(f);
}

for (const [page, feats] of byPage.entries()) {
  if (!feats.length) continue;
  const allReady = feats.every((f) => STATUS_RANK[f.nextStatus] >= STATUS_RANK["production-verified"]);
  if (!allReady) continue;
  const vueFile = pageToVueFile[page];
  if (!vueFile) continue;
  const vuePath = path.join(VUE_PAGES, vueFile);
  if (!fs.existsSync(vuePath)) continue;
  const vueSrc = fs.readFileSync(vuePath, "utf8");
  assert.ok(
    !/legacyAdminUrl\s*\(/.test(vueSrc),
    `Fully migrated page ${page} must not use legacyAdminUrl() in ${vueFile}`
  );
  if (vueFile === "ExperimentalPage.vue") {
    assert.fail(`Fully migrated page ${page} must not remain on ExperimentalPage`);
  }
}

// 6) API contracts completeness
assert.strictEqual(contracts.routes.length, liveRoutes.length, "contracts must match live route count");
const contractKeys = new Set(contracts.routes.map((r) => `${r.method} ${r.path}`));
for (const r of liveRoutes) {
  assert.ok(contractKeys.has(r.key), `missing contract for ${r.key}`);
}
for (const c of contracts.routes) {
  assert.ok(c.method, "contract.method");
  assert.ok(c.path, "contract.path");
  assert.ok(c.successResponse, "contract.successResponse");
  assert.ok(c.errorResponse, "contract.errorResponse");
  assert.ok(Array.isArray(c.errorCodes) && c.errorCodes.length > 0, "contract.errorCodes");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.method)) {
    assert.ok(c.csrf === true, `write contract must require csrf: ${c.method} ${c.path}`);
    assert.ok(c.requestBody !== undefined, `write contract requestBody: ${c.path}`);
  }
}

// 7) Phase A production primary must remain legacy in matrix flags
assert.strictEqual(matrix.primaryAdmin, "legacy");
assert.strictEqual(matrix.flags.FOSU_ADMIN_PRIMARY, "legacy");

// 8) Required docs mention
const inventory = fs.readFileSync(INVENTORY_PATH, "utf8");
assert.ok(/feature-matrix\.json/.test(inventory), "inventory must reference feature-matrix.json");
assert.ok(/Phase A/.test(inventory), "inventory must mention Phase A");

console.log(
  JSON.stringify(
    {
      ok: true,
      liveRoutes: liveRoutes.length,
      matrixApiFeatures: apiFeatures.length,
      matrixTotalFeatures: matrix.features.length,
      contracts: contracts.routes.length,
      cutoverReady: cutoverFeatures.length,
      experimentalSections,
      byNextStatus: matrix.summary.byNextStatus,
    },
    null,
    2
  )
);

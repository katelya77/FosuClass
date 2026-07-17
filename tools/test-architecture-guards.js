/**
 * Architecture guards for progressive admin modernization.
 * Prevents unbounded growth of legacy admin monoliths and
 * re-introduction of known P0 route duplication.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function countLines(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function listDuplicateAdminRoutes(adminSource) {
  const re = /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)/g;
  const counts = new Map();
  let match;
  while ((match = re.exec(adminSource))) {
    const key = `${match[1].toUpperCase()} ${match[2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1);
}

const adminPagesPath = path.join(ROOT, "server/src/routes/adminPages.js");
const adminRoutesPath = path.join(ROOT, "server/src/routes/admin.js");

assert.ok(fs.existsSync(adminPagesPath), "adminPages.js must exist");
assert.ok(fs.existsSync(adminRoutesPath), "admin.js must exist");

const adminPagesLines = countLines(adminPagesPath);
const adminRoutesLines = countLines(adminRoutesPath);

// Hard ceilings: allow tiny churn, block unbounded growth.
const ADMIN_PAGES_HARD_MAX = 17500;
const ADMIN_ROUTES_HARD_MAX = 6500;

assert.ok(
  adminPagesLines <= ADMIN_PAGES_HARD_MAX,
  `adminPages.js has ${adminPagesLines} lines; hard max is ${ADMIN_PAGES_HARD_MAX}. ` +
    "New admin UI must go into admin-web/, not adminPages.js."
);

assert.ok(
  adminRoutesLines <= ADMIN_ROUTES_HARD_MAX,
  `admin.js has ${adminRoutesLines} lines; hard max is ${ADMIN_ROUTES_HARD_MAX}. ` +
    "New admin API handlers must go into server/src/modules/*."
);

const adminSource = fs.readFileSync(adminRoutesPath, "utf8");
const duplicates = listDuplicateAdminRoutes(adminSource);

// Phase 1+: zero duplicate routes allowed.
assert.deepStrictEqual(
  duplicates,
  [],
  `Duplicate admin routes are forbidden: ${duplicates.map(([k, c]) => `${k} x${c}`).join(", ") || "(none)"}`
);

// Ensure architecture docs exist
const requiredDocs = [
  "docs/architecture/current-state.md",
  "docs/architecture/target-state.md",
  "docs/architecture/module-boundaries.md",
  "docs/product-capability-tiers.md",
  "docs/adr/0001-keep-native-miniprogram.md",
  "docs/adr/0002-vue3-admin-spa.md",
  "docs/adr/0003-modular-express-monolith.md",
  "docs/adr/0004-release-pack-data-plane.md",
  "docs/adr/0005-scoped-service-tokens.md",
  // Phase A admin parity inventory
  "docs/admin-migration/legacy-feature-inventory.md",
  "docs/admin-migration/feature-matrix.json",
  "docs/admin-migration/api-contracts.json",
  "docs/admin-migration/risk-register.md",
];

for (const rel of requiredDocs) {
  assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing required doc: ${rel}`);
}

// Soft warnings (non-fatal) for visibility
const soft = [];
if (adminPagesLines > 17000) soft.push(`adminPages.js soft max exceeded: ${adminPagesLines}/17000`);
if (adminRoutesLines > 6200) soft.push(`admin.js soft max exceeded: ${adminRoutesLines}/6200`);
if (soft.length) {
  soft.forEach((msg) => console.log(`[architecture-guards] soft: ${msg}`));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      adminPagesLines,
      adminRoutesLines,
      duplicateRoutes: duplicates.map(([key, count]) => ({ key, count })),
      ceilings: {
        adminPagesHardMax: ADMIN_PAGES_HARD_MAX,
        adminRoutesHardMax: ADMIN_ROUTES_HARD_MAX,
      },
    },
    null,
    2
  )
);
console.log("Architecture guard tests passed.");

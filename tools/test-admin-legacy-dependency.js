/**
 * Tracks Vue → Legacy dependency surface area.
 * Phase A baseline allows ExperimentalPage and legacyAdminUrl for incomplete modules.
 * As modules reach production-verified/cutover-ready, those escapes must disappear
 * (enforced primarily by test-admin-feature-matrix.js).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ROUTER = path.join(ROOT, "admin-web/src/router/index.ts");
const PAGES = path.join(ROOT, "admin-web/src/pages");
const MATRIX = path.join(ROOT, "docs/admin-migration/feature-matrix.json");

assert.ok(fs.existsSync(ROUTER), "vue router required");
assert.ok(fs.existsSync(MATRIX), "feature matrix required");

const routerSrc = fs.readFileSync(ROUTER, "utf8");
const matrix = JSON.parse(fs.readFileSync(MATRIX, "utf8"));

const experimentalSections = [...routerSrc.matchAll(/legacySection:\s*['"]([^'"]+)['"]/g)].map(
  (m) => m[1]
);
const usesExperimental = /ExperimentalPage/.test(routerSrc);

const legacyUrlPages = fs
  .readdirSync(PAGES)
  .filter((f) => f.endsWith(".vue"))
  .filter((f) => /legacyAdminUrl\s*\(/.test(fs.readFileSync(path.join(PAGES, f), "utf8")));

// Baseline expectations while primary is legacy (Phase A–D)
assert.strictEqual(matrix.primaryAdmin, "legacy");

// Report-only hard assert: inventory must know about current dependency surface
for (const section of experimentalSections) {
  const related = matrix.features.filter((f) => f.legacyPage === section);
  assert.ok(
    related.length > 0,
    `Experimental section ${section} has no matrix features (register it)`
  );
  const anyIncomplete = related.some(
    (f) => f.nextStatus === "missing" || f.nextStatus === "read-only" || f.nextStatus === "write-implemented"
  );
  // If everything is cutover-ready, Experimental is forbidden (also covered by feature-matrix test)
  if (!anyIncomplete) {
    const allCutover = related.every((f) => f.nextStatus === "cutover-ready");
    if (allCutover) {
      assert.fail(`Experimental section ${section} is fully cutover-ready; remove ExperimentalPage`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      usesExperimental,
      experimentalSections,
      legacyUrlPages,
      primaryAdmin: matrix.primaryAdmin,
    },
    null,
    2
  )
);

/**
 * Matrix freshness: sourceCommit + generated summary must match live recompute.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MATRIX = path.join(ROOT, "docs/admin-migration/feature-matrix.json");

assert.ok(fs.existsSync(MATRIX), "feature-matrix.json missing — run npm run admin:feature-matrix:generate");

const matrix = JSON.parse(fs.readFileSync(MATRIX, "utf8"));
const head = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();

// sourceCommit must equal current HEAD when working tree is clean for generator inputs,
// or equal HEAD if matrix was just regenerated. Allow dirty tree only if sourceCommit === HEAD.
assert.strictEqual(
  matrix.sourceCommit,
  head,
  `feature-matrix sourceCommit ${matrix.sourceCommit} != HEAD ${head}. Run: npm run admin:feature-matrix:generate`
);

assert.ok(matrix.phase, "phase required");
assert.ok(matrix.generatedAt, "generatedAt required");
assert.ok(Array.isArray(matrix.features), "features required");

// Recompute summary from features — forbid hand-edited summary drift
const byDomain = {};
const byRisk = {};
const byNextStatus = {};
for (const f of matrix.features) {
  byDomain[f.domain] = (byDomain[f.domain] || 0) + 1;
  byRisk[f.risk] = (byRisk[f.risk] || 0) + 1;
  byNextStatus[f.nextStatus] = (byNextStatus[f.nextStatus] || 0) + 1;
}

assert.strictEqual(matrix.summary.totalFeatures, matrix.features.length, "summary.totalFeatures drift");
assert.deepStrictEqual(matrix.summary.byDomain, byDomain, "summary.byDomain drift");
assert.deepStrictEqual(matrix.summary.byRisk, byRisk, "summary.byRisk drift");
assert.deepStrictEqual(matrix.summary.byNextStatus, byNextStatus, "summary.byNextStatus drift");

// Write modules must match production explicit grant list
const expectedMods = (matrix.productionWriteModules || []).slice().sort();
const flagMods = String(matrix.flags.FOSU_ADMIN_NEXT_WRITE_MODULES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .sort();
assert.deepStrictEqual(flagMods, expectedMods, "flags write modules must match productionWriteModules");

console.log(
  JSON.stringify(
    {
      ok: true,
      phase: matrix.phase,
      sourceCommit: matrix.sourceCommit,
      totalFeatures: matrix.summary.totalFeatures,
      productionWriteModules: expectedMods,
    },
    null,
    2
  )
);

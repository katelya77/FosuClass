/**
 * Matrix freshness: stable input fingerprint + byte-for-byte check mode.
 */
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MATRIX = path.join(ROOT, "docs/admin-migration/feature-matrix.json");
const CONTRACTS = path.join(ROOT, "docs/admin-migration/api-contracts.json");
const INVENTORY = path.join(ROOT, "docs/admin-migration/legacy-feature-inventory.md");
const GENERATOR = path.join(ROOT, "tools/generate-admin-feature-matrix.js");
const OUTPUTS = [MATRIX, CONTRACTS, INVENTORY];

assert.ok(fs.existsSync(MATRIX), "feature-matrix.json missing — run npm run admin:feature-matrix:generate");

const matrix = JSON.parse(fs.readFileSync(MATRIX, "utf8"));

assert.ok(matrix.phase, "phase required");
assert.strictEqual(matrix.generatorVersion, 2, "generatorVersion required");
assert.match(matrix.inputFingerprint || "", /^[a-f0-9]{64}$/, "inputFingerprint required");
assert.ok(!("generatedAt" in matrix), "generatedAt must not drive freshness");
assert.ok(!("sourceCommit" in matrix), "sourceCommit/HEAD must not drive freshness");
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

function runGenerator(args, env = {}) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function digest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// Check mode must regenerate in a temporary directory, compare exact bytes, and
// leave all committed outputs untouched.
const before = Object.fromEntries(OUTPUTS.map((filePath) => [filePath, digest(filePath)]));
const checked = runGenerator(["--check"]);
assert.strictEqual(checked.status, 0, `matrix --check failed:\n${checked.stdout}\n${checked.stderr}`);
assert.deepStrictEqual(
  Object.fromEntries(OUTPUTS.map((filePath) => [filePath, digest(filePath)])),
  before,
  "--check must not mutate committed artifacts"
);

// A minimal isolated root proves deterministic bytes and fail-closed drift
// without temporarily dirtying the real worktree.
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-admin-matrix-"));
try {
  for (const rel of [
    "server/src/routes",
    "server/src/modules",
    "admin-web/src/router",
    "admin-web/src/pages",
    "config",
    "docs/admin-migration",
    "tools",
  ]) {
    const source = path.join(ROOT, rel);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(fixtureRoot, rel), { recursive: true });
  }
  const fixtureEnv = { FOSU_ADMIN_MATRIX_ROOT: fixtureRoot };
  const first = runGenerator([], fixtureEnv);
  assert.strictEqual(first.status, 0, `fixture generation failed: ${first.stderr}`);
  const firstFingerprint = JSON.parse(fs.readFileSync(path.join(fixtureRoot, path.relative(ROOT, MATRIX)), "utf8")).inputFingerprint;
  const firstBytes = OUTPUTS.map((filePath) => fs.readFileSync(path.join(fixtureRoot, path.relative(ROOT, filePath))));
  const second = runGenerator([], { ...fixtureEnv, GITHUB_SHA: "head-only-change-must-not-matter", CI_COMMIT_SHA: "different-head" });
  assert.strictEqual(second.status, 0, `second fixture generation failed: ${second.stderr}`);
  const secondBytes = OUTPUTS.map((filePath) => fs.readFileSync(path.join(fixtureRoot, path.relative(ROOT, filePath))));
  assert.deepStrictEqual(secondBytes, firstBytes, "identical stable inputs must produce byte-identical outputs");

  const fixtureMatrixPath = path.join(fixtureRoot, path.relative(ROOT, MATRIX));
  const originalFixtureMatrix = fs.readFileSync(fixtureMatrixPath);
  fs.appendFileSync(fixtureMatrixPath, "drift\n");
  const drift = runGenerator(["--check"], fixtureEnv);
  assert.notStrictEqual(drift.status, 0, "--check must fail when a committed artifact differs");
  assert.ok(fs.readFileSync(fixtureMatrixPath).equals(Buffer.concat([originalFixtureMatrix, Buffer.from("drift\n")])), "failed --check must not repair or overwrite drift");

  fs.writeFileSync(fixtureMatrixPath, originalFixtureMatrix);
  const routeFile = path.join(fixtureRoot, "server/src/modules/dashboard/routes.js");
  fs.appendFileSync(routeFile, "\nrouter.get('/dashboard/fingerprint-probe', (_req, res) => res.json({ success: true }));\n");
  const changed = runGenerator(["--check"], fixtureEnv);
  assert.notStrictEqual(changed.status, 0, "input changes must invalidate the committed fingerprint/artifacts");
  const regenerated = runGenerator([], fixtureEnv);
  assert.strictEqual(regenerated.status, 0, `changed-input generation failed: ${regenerated.stderr}`);
  const changedFingerprint = JSON.parse(fs.readFileSync(fixtureMatrixPath, "utf8")).inputFingerprint;
  assert.notStrictEqual(changedFingerprint, firstFingerprint, "normalized route changes must change inputFingerprint");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      phase: matrix.phase,
      inputFingerprint: matrix.inputFingerprint,
      totalFeatures: matrix.summary.totalFeatures,
      productionWriteModules: expectedMods,
    },
    null,
    2
  )
);

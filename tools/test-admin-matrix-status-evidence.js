/**
 * production-verified / cutover-ready require evidence lists.
 * Never allow empty evidence for those statuses.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MATRIX = path.join(ROOT, "docs/admin-migration/feature-matrix.json");
const matrix = JSON.parse(fs.readFileSync(MATRIX, "utf8"));

const HIGH = new Set(["production-verified", "cutover-ready"]);

for (const f of matrix.features) {
  if (!HIGH.has(f.nextStatus)) continue;
  assert.ok(
    Array.isArray(f.apiTests) && f.apiTests.length > 0,
    `${f.id} is ${f.nextStatus} but apiTests empty`
  );
  assert.ok(
    Array.isArray(f.playwrightTests) && f.playwrightTests.length > 0,
    `${f.id} is ${f.nextStatus} but playwrightTests empty`
  );
  for (const rel of [...f.apiTests, ...f.playwrightTests]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${f.id} missing evidence file ${rel}`);
  }
}

// browser-verified must have both api + playwright when claimed
for (const f of matrix.features) {
  if (f.nextStatus !== "browser-verified" && f.nextStatus !== "contract-verified") continue;
  if (f.nextStatus === "contract-verified") {
    assert.ok(Array.isArray(f.apiTests) && f.apiTests.length > 0, `${f.id} contract-verified needs apiTests`);
  }
  if (f.nextStatus === "browser-verified") {
    assert.ok(f.apiTests.length > 0 && f.playwrightTests.length > 0, `${f.id} browser-verified needs both`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      productionVerified: matrix.features.filter((f) => f.nextStatus === "production-verified").length,
      browserVerified: matrix.features.filter((f) => f.nextStatus === "browser-verified").length,
      contractVerified: matrix.features.filter((f) => f.nextStatus === "contract-verified").length,
    },
    null,
    2
  )
);

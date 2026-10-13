"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
process.env.FOSU_COLLECTOR_MODE = "1";
const { collectEntities } = require("./fosu-sync-client/directAcquisition");
const html = "<table><tr><td>Fixture course</td></tr></table>";
async function fixture(fn) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-target-checkpoint-")); try { await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } }
function options(dir, request) { return { baseDir: dir, term: "2026-2027-1", scope: "classSchedules", runId: "sc-target-fixture", targets: [{ key: "fixture-group" }], request, parse: async () => [{ className: "Fixture class", courses: [] }] }; }
function checkpoint(dir) { const p = path.join(dir, ".cache/2026-2027-1/checkpoints/classSchedules/sc-target-fixture"); return path.join(p, fs.readdirSync(p)[0]); }
test("parsed target binds source response digest and resumes without another request", () => fixture(async dir => {
  let requests = 0; const opts = options(dir, async () => { requests++; return { ok: true, status: 200, text: html }; });
  await collectEntities(opts);
  const data = JSON.parse(fs.readFileSync(checkpoint(dir)));
  assert.equal(data.state, "PARSED");
  assert.equal(data.decodedResponseSha256, crypto.createHash("sha256").update(html).digest("hex"));
  assert.equal(fs.readFileSync(checkpoint(dir), "utf8").includes("<table>"), false);
  const resumed = await collectEntities(opts);
  assert.equal(requests, 1); assert.equal(resumed.summary.reusedEntities, 1); assert.equal(resumed.summary.requestCount, 0);
}));
test("crash before response or before parsing cannot replay target", () => fixture(async dir => {
  const opts = options(dir, async () => ({ ok: true, status: 200, text: html })); await collectEntities(opts);
  const file = checkpoint(dir), saved = JSON.parse(fs.readFileSync(file));
  for (const state of ["REQUEST_RESERVED", "RESPONSE_RECEIVED", "FAILED"]) {
    fs.writeFileSync(file, JSON.stringify({ ...saved, state }));
    await assert.rejects(collectEntities({ ...opts, request: async () => assert.fail("unapproved replay") }), /CHECKPOINT_REVIEW_REQUIRED/);
  }
}));
test("parser failure stays failed and is not counted as coverage", () => fixture(async dir => {
  const opts = { ...options(dir, async () => ({ ok: true, status: 200, text: html })), parse: async () => { throw Object.assign(new Error("fixture-only"), { code: "SCHEDULE_PARSE_FAILED" }); } };
  await assert.rejects(collectEntities(opts), error => error.code === "SCHEDULE_PARSE_FAILED" && error.directSourceSummary.coverageValid === false && error.directSourceSummary.parserErrors === 1);
  assert.equal(JSON.parse(fs.readFileSync(checkpoint(dir))).state, "FAILED");
}));
test("changed worker source cannot reuse normalized output", () => fixture(async dir => {
  const opts = options(dir, async () => ({ ok: true, status: 200, text: html })); await collectEntities(opts);
  process.env.FOSU_COLLECTOR_WORKER_SOURCE_HASH = "c".repeat(64);
  try { await assert.rejects(collectEntities(opts), /CHECKPOINT_SOURCE_CHANGED/); }
  finally { delete process.env.FOSU_COLLECTOR_WORKER_SOURCE_HASH; }
}));

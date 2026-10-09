"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("../server/node_modules/express");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-wyz-test-"));
process.env.FOSU_STORAGE_DIR = path.join(temp, "oracle");
process.env.FOSU_DATA_DIR = path.join(temp, "data");
process.env.SCHEDULE_COLLECTOR_DIR = path.join(temp, "control");
process.env.FULL_SYNC_AGENT_TOKEN = crypto.randomBytes(32).toString("hex");
process.env.FULL_SYNC_SIGNING_SECRET = crypto.randomBytes(32).toString("hex");
process.env.FULL_SYNC_AGENT_ID = "wyz-schedule-collector";
const collector = require("./wyz-schedule-collector/collector");
const control = require("../server/src/services/scheduleCollectorService");
require("../server/src/services/termRegistryService").createPlannedTerm({ term: "2026-2027-1", semesterText: "2026-2027-1", termStartDate: "2026-09-07", totalWeeks: 20, weekStart: "monday" });
const { acquireLock, runDirectory } = require("./wyz-schedule-collector/runStore");
let cases = 0;
function check(fn) { fn(); cases++; }
async function main() {
  control.resetForTests();
  const cfg = collector.config(process.env);
  check(() => assert.equal(cfg.concurrency, 1));
  check(() => assert.throws(() => collector.config(Object.assign({}, process.env, { FOSU_API_BASE: "https://example.org" })), /ORACLE_ORIGIN_REJECTED/));
  check(() => assert.throws(() => collector.assertSession(path.join(temp, "missing")), /SESSION_EXPIRED/));
  check(() => assert.throws(() => runDirectory(temp, "2026-2027-1", "../escape"), /RUN_ID_INVALID/));
  const releaseLock = acquireLock(temp);
  check(() => assert.throws(() => acquireLock(temp), /COLLECTOR_LOCKED/));
  releaseLock();
  const packageWorkflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/prepare-wyz-schedule-collector.yml"), "utf8");
  check(() => {
    assert.match(packageWorkflow, /fetch-depth: 0/);
    assert.match(packageWorkflow, /git merge-base --is-ancestor/);
    assert.ok(packageWorkflow.indexOf("name: Verify live baseline before package upload") < packageWorkflow.indexOf("name: Upload independent collector package"));
    assert.match(packageWorkflow, /sha256sum -c wyz-schedule-collector.sha256/);
  });
  check(() => assert.ok(!/systemctl|docker compose|hosting deploy|wyz-campus-agent|runtime\/active.json/.test(packageWorkflow), "preparing a package must not deploy the backend, personal agent, timer, or active pointer"));
  const app = express();
  app.use(express.json({ verify(req, res, buf) { req.rawBody = buf; } }));
  app.use("/api/full-sync/v1", require("../server/src/routes/fullSyncAgent"));
  const server = await new Promise((resolve) => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  try {
    const api = collector.client(Object.assign({}, cfg, { oracle: "http://127.0.0.1:" + server.address().port }));
    const heartbeat = await api("POST", "/api/full-sync/v1/heartbeat", {});
    check(() => assert.equal(heartbeat.ok, true));
    const idle = await api("POST", "/api/full-sync/v1/runs/claim", {});
    check(() => assert.equal(idle, null));
    for (const mode of ["routine", "full"]) {
      control.requestRun(mode, "test", Date.now(), { term: "2026-2027-1" });
      const { run } = await api("POST", "/api/full-sync/v1/runs/claim", {});
      check(() => assert.equal(collector.validateRun(run).allowDerived, false));
      check(() => assert.equal(run.mode, mode));
      check(() => assert.equal(control.claim(cfg.agentId), null));
      const failed = await api("POST", "/api/full-sync/v1/runs/" + run.id + "/report", { claimId: run.claimId, failureCode: "SESSION_EXPIRED" });
      check(() => assert.equal(failed.run.result, "FAILED"));
      check(() => assert.equal(control.snapshot().sessionExpired, true));
      await assert.rejects(() => api("POST", "/api/full-sync/v1/runs/" + run.id + "/report", { claimId: run.claimId, stage: "class" }), /ORACLE_HTTP_409/); cases++;
    }
    const { run: queued } = control.requestRun("routine", "test", Date.now(), { term: "2026-2027-1" });
    const run = (await api("POST", "/api/full-sync/v1/runs/claim", {})).run;
    await assert.rejects(() => api("POST", "/api/full-sync/v1/runs/" + run.id + "/report", { claimId: run.claimId, cookie: "fixture" }), /ORACLE_HTTP_400/); cases++;
    await assert.rejects(() => api("POST", "/api/full-sync/v1/runs/" + run.id + "/report", { claimId: run.claimId, complete: true, canonicalHash: "a".repeat(64) }), /ORACLE_HTTP_409/); cases++;
    control.cancelCurrent();
    const cancelled = await api("POST", "/api/full-sync/v1/heartbeat", { runId: queued.id, claimId: run.claimId });
    check(() => assert.equal(cancelled.cancelled, true));
    control.requestRun("full", "fixture", Date.now(), { term: "2026-2027-1" });
    const uploadRun = (await api("POST", "/api/full-sync/v1/runs/claim", {})).run;
    const data = require("./fixtures/four-direct-source")();
    data.canonicalHash = require("../server/src/utils/stagingFingerprint").calculateFingerprint(data).canonicalHash;
    const dir = runDirectory(temp, uploadRun.term, uploadRun.id);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "staging.json"), JSON.stringify(data));
    let retried = false, chunks = 0;
    const retryApi = async (...args) => {
      if (args[1].includes("/chunks/")) { chunks++; if (!retried) { retried = true; throw Object.assign(new Error("fixture transient upload failure"), { status: 503 }); } }
      return api(...args);
    };
    const finalized = await collector.upload(retryApi, uploadRun, dir, data, { chunkSize: 100, sleep: async () => new Promise((resolve) => setTimeout(resolve, 20)) });
    check(() => assert.ok(chunks > 1 && retried));
    check(() => assert.ok(finalized.rawBytes > finalized.gzipBytes));
    check(() => assert.ok(fs.existsSync(path.join(temp, "oracle", "staging-latest.json"))));
    const completed = await api("POST", "/api/full-sync/v1/runs/" + uploadRun.id + "/report", { claimId: uploadRun.claimId, complete: true, uploadId: finalized.uploadId, canonicalHash: data.canonicalHash, directSourceSummary: data.directSourceSummary });
    check(() => assert.equal(completed.run.result, "PENDING REVIEW"));
    check(() => assert.equal(fs.existsSync(path.join(temp, "oracle", "active-release.json")), false));
    const release = require("../server/src/services/releaseService");
    const originalActive = release.getActiveReleaseInfo;
    release.getActiveReleaseInfo = () => ({ term: data.term, canonicalHash: data.canonicalHash, resourceCounts: require("../server/src/shared/resourceCountContract").buildResourceCountContract(data) });
    try {
      control.requestRun("routine", "fixture", Date.now(), { term: data.term });
      let uploadCalled = false;
      const noChange = await collector.runOnce(Object.assign({}, cfg, { execute: true, dataRoot: path.join(temp, "campus") }), {
        request: api, assertSession: () => {}, promoteRun: () => {},
        executeSync: async (run, cfg, dir) => fs.writeFileSync(path.join(dir, "staging.json"), JSON.stringify(data)),
        upload: async () => { uploadCalled = true; throw new Error("unchanged data must not upload"); },
      });
      check(() => assert.equal(noChange.status, "NO CHANGE"));
      check(() => assert.equal(uploadCalled, false));
      control.requestRun("routine", "fixture-review-response", Date.now(), { term: data.term });
      const reviewRoot = path.join(temp, "campus-review-response");
      const review = await collector.runOnce(Object.assign({}, cfg, { execute: true, dataRoot: reviewRoot }), {
        request: async (...args) => {
          const response = await api(...args);
          return args[2] && args[2].complete ? { success: true, run: Object.assign({}, response.run, { result: "PENDING REVIEW" }) } : response;
        },
        assertSession: () => {}, promoteRun: () => {},
        executeSync: async (run, cfg, dir) => fs.writeFileSync(path.join(dir, "staging.json"), JSON.stringify(data)),
        upload: async () => { throw new Error("identical canonical data must still skip upload"); },
      });
      check(() => assert.equal(review.status, "PENDING REVIEW", "the Oracle completion response controls the local result"));
      check(() => assert.equal(JSON.parse(fs.readFileSync(path.join(runDirectory(reviewRoot, data.term, review.runId), "state.json"))).result, "PENDING REVIEW"));
    } finally { release.getActiveReleaseInfo = originalActive; }
  } finally { await new Promise((resolve) => server.close(resolve)); }
  console.log("wyz-collector: " + cases + " PASS (local signed HTTP; no school requests)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

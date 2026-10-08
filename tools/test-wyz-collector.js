"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("../server/node_modules/express");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-wyz-test-"));
process.env.FOSU_STORAGE_DIR = path.join(temp, "oracle");
process.env.SCHEDULE_COLLECTOR_DIR = path.join(temp, "control");
process.env.FULL_SYNC_AGENT_TOKEN = crypto.randomBytes(32).toString("hex");
process.env.FULL_SYNC_SIGNING_SECRET = crypto.randomBytes(32).toString("hex");
process.env.FULL_SYNC_AGENT_ID = "wyz-schedule-collector";
const collector = require("./wyz-schedule-collector/collector");
const control = require("../server/src/services/scheduleCollectorService");
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
    const { run: queued } = control.requestRun("routine", "test");
    const run = (await api("POST", "/api/full-sync/v1/runs/claim", {})).run;
    await assert.rejects(() => api("POST", "/api/full-sync/v1/runs/" + run.id + "/report", { claimId: run.claimId, cookie: "fixture" }), /ORACLE_HTTP_400/); cases++;
    await assert.rejects(() => api("POST", "/api/full-sync/v1/runs/" + run.id + "/report", { claimId: run.claimId, complete: true, canonicalHash: "a".repeat(64) }), /ORACLE_HTTP_409/); cases++;
    control.cancelCurrent();
    const cancelled = await api("POST", "/api/full-sync/v1/heartbeat", { runId: queued.id, claimId: run.claimId });
    check(() => assert.equal(cancelled.cancelled, true));
  } finally { await new Promise((resolve) => server.close(resolve)); }
  console.log("wyz-collector: " + cases + " PASS (local signed HTTP; no school requests)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

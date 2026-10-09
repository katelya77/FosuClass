#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { signRequest } = require("../../server/src/security/fullSyncSignature");
const { buildSyncPlan, ALL_SCOPES } = require("../../shared/syncPlan");
const { assertFourSources } = require("../../server/src/shared/fourDirectSourceContract");
const { acquireLock, runDirectory, readJson, writeJsonAtomic, pruneRuns } = require("./runStore");

const ROOT = path.resolve(__dirname, "../..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function failure(code) { return Object.assign(new Error(code), { code }); }
function config(env = process.env) {
  const url = new URL(env.FOSU_API_BASE || "https://class.katelya.eu.org");
  if (url.origin !== "https://class.katelya.eu.org" || url.username || url.password || url.search || url.pathname !== "/") throw failure("ORACLE_ORIGIN_REJECTED");
  const token = env.FULL_SYNC_AGENT_TOKEN || "", secret = env.FULL_SYNC_SIGNING_SECRET || "";
  if (!env.FULL_SYNC_AGENT_ID || !token || !secret) throw failure("COLLECTOR_CONFIGURATION_MISSING");
  if (env.FOSU_COLLECTOR_EXECUTE !== undefined && !["0", "1"].includes(env.FOSU_COLLECTOR_EXECUTE)) throw failure("COLLECTOR_EXECUTION_MODE_REJECTED");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(env.FULL_SYNC_AGENT_ID || "wyz-schedule-collector") || token.length < 32 || secret.length < 32 || token === secret || [env.CAMPUS_AGENT_TOKEN, env.CAMPUS_AGENT_SIGNING_SECRET].includes(token) || [env.CAMPUS_AGENT_TOKEN, env.CAMPUS_AGENT_SIGNING_SECRET].includes(secret)) throw failure("COLLECTOR_CREDENTIALS_REJECTED");
  return { oracle: url.origin, token, secret, agentId: env.FULL_SYNC_AGENT_ID || "wyz-schedule-collector", execute: env.FOSU_COLLECTOR_EXECUTE === "1", sessionPath: env.FOSU_COLLECTOR_SESSION || "/var/lib/fosuclass/schedule-collector/session.json", dataRoot: env.FOSU_COLLECTOR_DATA_DIR || "/var/lib/fosuclass/schedule-collector", concurrency: Math.max(1, Math.min(2, Number(env.SCHOOL_CONCURRENCY) || 1)) };
}
function client(cfg, fetcher = fetch) {
  return async function request(method, pathname, value, binary = false) {
    const raw = binary ? value : Buffer.from(value === undefined ? "" : JSON.stringify(value));
    const timestamp = String(Date.now()), nonce = crypto.randomBytes(20).toString("hex");
    const signature = signRequest(cfg.secret, { method, path: pathname, timestamp, nonce, body: raw });
    let response;
    try { response = await fetcher(cfg.oracle + pathname, { method, redirect: "error", signal: AbortSignal.timeout(pathname.endsWith("/heartbeat") ? 15000 : 120000), headers: { authorization: "Bearer " + cfg.token, "content-type": binary ? "application/octet-stream" : "application/json", "x-full-sync-agent-id": cfg.agentId, "x-full-sync-timestamp": timestamp, "x-full-sync-nonce": nonce, "x-full-sync-signature": signature }, body: method === "GET" ? undefined : raw }); }
    catch (error) { throw failure(["AbortError", "TimeoutError"].includes(error.name) ? "ORACLE_TIMEOUT" : "ORACLE_NETWORK_FAILED"); }
    if (response.status === 204) return null;
    if (!response.ok) throw Object.assign(failure(({ 401: "ORACLE_AUTH_REJECTED", 403: "ORACLE_SIGNATURE_OR_CLOCK_REJECTED", 404: "ORACLE_AUTH_OR_ENDPOINT_REJECTED" })[response.status] || "ORACLE_HTTP_" + response.status), { status: response.status });
    try { return await response.json(); } catch (_) { throw failure("ORACLE_RESPONSE_INVALID"); }
  };
}
function validateRun(run) {
  if (!run || !/^sc-[A-Za-z0-9-]+$/.test(run.id) || !["routine", "full"].includes(run.mode) || !/^[a-f0-9]{48}$/.test(run.claimId || "")) throw failure("RUN_REJECTED");
  const plan = buildSyncPlan("crawl:daily", { term: run.term, "run-id": run.id, "allow-derived": false, "catalog-policy": run.mode === "full" ? "network-only" : "reuse-validated", "progress-policy": "resume", "negative-cache-policy": "ignore", "no-publish": true }, {});
  if (!plan.termValid || plan.upload || plan.activate || plan.allowDerived || ALL_SCOPES.some((scope) => !plan.scopes.includes(scope))) throw failure("RUN_PLAN_REJECTED");
  const tc = run.termConfig || {};
  if (tc.term !== plan.term || !/^\d{4}-\d{2}-\d{2}$/.test(tc.termStartDate || "") || !Number.isInteger(tc.totalWeeks) || tc.totalWeeks < 1 || tc.totalWeeks > 30 || !["monday", "sunday"].includes(tc.weekStart)) throw failure("RUN_TERM_CONFIG_REJECTED");
  return plan;
}
function assertSession(file, platform = process.platform) {
  if (!fs.existsSync(file)) throw failure("SESSION_EXPIRED");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (platform !== "win32" && (stat.uid !== 0 || (stat.mode & 0o077)))) throw failure("SESSION_PERMISSIONS_REJECTED");
  const parent = fs.lstatSync(path.dirname(file));
  if (platform !== "win32" && (parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o077))) throw failure("SESSION_PERMISSIONS_REJECTED");
  const data = readJson(file, null);
  if (!data || !Array.isArray(data.cookies) || !Array.isArray(data.origins)) throw failure("SESSION_EXPIRED");
}
function executeSync(run, cfg, dir, onChild) {
  const env = {};
  for (const key of ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "PLAYWRIGHT_BROWSERS_PATH", "NODE_PATH"]) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { FOSU_COLLECTOR_MODE: "1", FOSU_SYNC_HEADLESS: "1", FOSU_COLLECTOR_SESSION: cfg.sessionPath, FOSU_SYNC_DATA_DIR: path.join(dir, "client"), FOSU_SYNC_CATALOG_CACHE: path.join(cfg.dataRoot, "catalog"), FOSU_COLLECTOR_PROGRESS_FILE: path.join(dir, "progress.json"), FOSU_COLLECTOR_RESULT_FILE: path.join(dir, "sync-result.json"), SYNC_LOCAL_STAGING_ONLY: "true", SYNC_CLASS_CRAWL_ONLY: "true", SYNC_RESOURCE_DELAY_MIN_MS: "900", SYNC_RESOURCE_DELAY_MAX_MS: "1300", FOSU_API_BASE: cfg.oracle });
  const args = ["tools/fosu-sync-client/sync.js", "crawl:daily", "--term=" + run.term, "--run-id=" + run.id, "--output=" + path.join(dir, "staging.json"), "--catalog-policy=" + (run.mode === "full" ? "network-only" : "reuse-validated"), "--schedule-policy=network-only", "--progress-policy=resume", "--negative-cache-policy=ignore", "--allow-derived=false", "--resource-source=direct", "--class-scope=all", "--concurrency=" + cfg.concurrency, "--delay-ms=900", "--term-start-date=" + run.termConfig.termStartDate, "--total-weeks=" + run.termConfig.totalWeeks, "--week-start=" + run.termConfig.weekStart];
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.join(cfg.dataRoot, "catalog"), { recursive: true, mode: 0o700 });
    const command = require("./browserRuntime").workerCommand(process.execPath, args, env, cfg, dir, ROOT);
    const child = spawn(command.executable, command.args, { cwd: command.cwd, env: command.env, stdio: "ignore", windowsHide: true });
    onChild(child);
    child.once("error", () => reject(failure("SYNC_LAUNCH_FAILED")));
    child.once("exit", (code) => { const result = readJson(path.join(dir, "sync-result.json"), {}); code === 0 ? resolve() : reject(failure(result.code || "SYNC_FAILED")); });
  });
}
async function upload(request, run, dir, data, hooks = {}) {
  const { hashFile, gzipFile, readChunk } = require("../fosu-sync-client/uploadFileIO");
  const file = path.join(dir, "staging.json"), gzipPath = file + ".gz";
  await gzipFile(file, gzipPath);
  const originalSize = fs.statSync(file).size, uploadSize = fs.statSync(gzipPath).size;
  const originalSha256 = await hashFile(file), uploadSha256 = await hashFile(gzipPath);
  const chunkSize = hooks.chunkSize || 4 * 1024 * 1024;
  const metadata = { term: run.term, fileName: "staging.json", contentEncoding: "gzip", contentType: "application/json", uploadSize, uploadSha256, originalSize, originalSha256, canonicalHash: data.canonicalHash, chunkSize, totalChunks: Math.ceil(uploadSize / chunkSize) };
  const base = "/api/full-sync/v1/runs/" + run.id;
  const initialized = await request("POST", base + "/upload/init", Object.assign({ claimId: run.claimId }, metadata));
  if (initialized.unchanged) return initialized;
  const uploadId = initialized.upload.uploadId;
  const received = new Set(initialized.upload.receivedChunks || []);
  for (let index = 0; index < metadata.totalChunks; index++) {
    if (received.has(index)) continue;
    const chunk = readChunk(gzipPath, index * chunkSize, Math.min(uploadSize, (index + 1) * chunkSize) - 1);
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await request("POST", base + "/upload/" + uploadId + "/chunks/" + index + "/" + run.claimId, chunk, true); error = null; break; }
      catch (caught) { error = caught; if (caught.status && caught.status < 500 && caught.status !== 408 && caught.status !== 429) break; if (attempt < 2) await (hooks.sleep || sleep)(700 * 2 ** attempt); }
    }
    if (error) throw error;
    if (hooks.progress) await hooks.progress({ uploadBytes: Math.min(uploadSize, (index + 1) * chunkSize) });
  }
  const finalized = await request("POST", base + "/upload/finalize", Object.assign({ claimId: run.claimId, uploadId }, metadata));
  if (finalized.job) {
    for (let attempt = 0; attempt < 1200; attempt++) {
      const status = await request("GET", base + "/upload/status/" + run.claimId);
      if (status.status === "success") return Object.assign({}, status.result, { uploadId, rawBytes: originalSize, gzipBytes: uploadSize });
      if (status.status === "failed") throw failure(status.code || "STAGING_VALIDATION_FAILED");
      await (hooks.sleep || sleep)(2000);
    }
    throw failure("STAGING_FINALIZE_TIMEOUT");
  }
  return Object.assign({}, finalized, { uploadId, rawBytes: originalSize, gzipBytes: uploadSize });
}
function promoteRun(cfg, run, dir, verified) {
  const cache = require("../../shared/syncCacheStore");
  const base = path.join(dir, "client");
  cache.promoteValidatedRun(base, run.term, run.id, ["classSchedules", "teacherSchedules", "classroomSchedules", "courseSchedules"], verified);
  const source = path.join(cache.ensureTermCache(base, run.term), "catalog");
  const target = path.join(cfg.dataRoot, "catalog", run.term, "catalog");
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const name of ["catalog.json", "majors.json", "metadata.json", "majors.metadata.json"]) if (fs.existsSync(path.join(source, name))) fs.copyFileSync(path.join(source, name), path.join(target, name));
}
async function runOnce(cfg, deps = {}) {
  const request = deps.request || client(cfg);
  const heartbeat = await request("POST", "/api/full-sync/v1/heartbeat", { ok: true });
  if (!heartbeat || heartbeat.ok !== true) throw failure("ORACLE_HEARTBEAT_REJECTED");
  if (!cfg.execute) return { status: "heartbeat-only" };
  const claimed = await request("POST", "/api/full-sync/v1/runs/claim", {});
  if (!claimed) return { status: "idle" };
  const run = claimed.run;
  validateRun(run);
  const dir = runDirectory(cfg.dataRoot, run.term, run.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const started = Date.now();
  let child, timer, cancelled = false, lastLease = Date.now(), tickRunning = false;
  let reportQueue = Promise.resolve();
  const report = (patch) => (reportQueue = reportQueue.catch(() => {}).then(() => request("POST", "/api/full-sync/v1/runs/" + run.id + "/report", Object.assign({ claimId: run.claimId, durationMs: Date.now() - started }, patch))));
  writeJsonAtomic(path.join(dir, "state.json"), { runId: run.id, term: run.term, status: "running" });
  try {
    await report({ stage: "auth-check" });
    (deps.assertSession || assertSession)(cfg.sessionPath);
    timer = setInterval(async () => {
      if (tickRunning) return;
      tickRunning = true;
      try {
        const heartbeat = await request("POST", "/api/full-sync/v1/heartbeat", { runId: run.id, claimId: run.claimId });
        if (heartbeat.cancelled) { cancelled = true; if (child) child.kill("SIGTERM"); }
        else { lastLease = Date.now(); const progress = readJson(path.join(dir, "progress.json"), null); if (progress) await report(progress); }
      } catch (_) { if (Date.now() - lastLease > 90000) { cancelled = true; if (child) child.kill("SIGTERM"); } }
      finally { tickRunning = false; }
    }, 30000);
    if (!fs.existsSync(path.join(dir, "staging.json"))) await (deps.executeSync || executeSync)(run, cfg, dir, (value) => { child = value; });
    if (cancelled) throw failure("CANCELLED");
    await report({ stage: "hash" });
    const data = readJson(path.join(dir, "staging.json"), null);
    const verified = assertFourSources(data, run.term);
    if (run.activeCanonicalHash && verified.canonicalHash === run.activeCanonicalHash) {
      if (timer) clearInterval(timer);
      const completion = await report({ complete: true, canonicalHash: verified.canonicalHash, directSourceSummary: verified.directSourceSummary, schoolRequestCount: data.meta.actualNetworkRequestCount || 0, noChange: true });
      const outcome = completion && completion.run && completion.run.result || "PENDING REVIEW";
      (deps.promoteRun || promoteRun)(cfg, run, dir, verified);
      writeJsonAtomic(path.join(dir, "state.json"), { status: "completed", result: outcome });
      writeJsonAtomic(path.join(cfg.dataRoot, "last-success.json"), { directory: dir, runId: run.id });
      pruneRuns(cfg.dataRoot, dir, dir);
      return { status: outcome, runId: run.id };
    }
    await report({ stage: "upload", directSourceSummary: verified.directSourceSummary });
    const result = await (deps.upload || upload)(request, run, dir, data, { progress: report });
    if (timer) clearInterval(timer);
    const completion = await report({ complete: true, canonicalHash: verified.canonicalHash, directSourceSummary: verified.directSourceSummary, schoolRequestCount: data.meta.actualNetworkRequestCount || 0, uploadId: result.uploadId, stagingRawBytes: result.rawBytes, stagingGzipBytes: result.gzipBytes });
    const outcome = completion && completion.run && completion.run.result || "PENDING REVIEW";
    (deps.promoteRun || promoteRun)(cfg, run, dir, verified);
    writeJsonAtomic(path.join(dir, "state.json"), { status: "completed", result: outcome });
    writeJsonAtomic(path.join(cfg.dataRoot, "last-success.json"), { directory: dir, runId: run.id });
    pruneRuns(cfg.dataRoot, dir, dir);
    return { status: outcome, runId: run.id };
  } catch (error) {
    const code = /^[A-Z0-9_:-]{1,80}$/.test(error.code || "") ? error.code : "COLLECTOR_FAILED";
    if (!cancelled) await report({ failureCode: code }).catch(() => {});
    writeJsonAtomic(path.join(dir, "state.json"), { status: "failed", code });
    pruneRuns(cfg.dataRoot, dir, readJson(path.join(cfg.dataRoot, "last-success.json"), {}).directory);
    throw failure(code);
  } finally { if (timer) clearInterval(timer); }
}
async function main() {
  const envArg = process.argv.find(value => value.startsWith("--env-file="));
  if (envArg) Object.assign(process.env, require("./credentials").readEnvFile(envArg.slice(11)));
  const cfg = config();
  const release = acquireLock(cfg.dataRoot);
  try {
    do { const result = await runOnce(cfg); console.log(JSON.stringify(result)); if (process.argv.includes("--once")) break; await sleep(30000); } while (true);
  } finally { release(); }
}
if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ status: "failed", code: error.code || "COLLECTOR_FAILED" })); process.exitCode = 1; });
module.exports = { assertSession, client, config, executeSync, runOnce, upload, validateRun };

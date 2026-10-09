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
const recovery = require("./heartbeatRecovery");
const transport = require("./oracleTransport");

const ROOT = path.resolve(__dirname, "../..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function failure(code) { return Object.assign(new Error(code), { code }); }
function config(env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw failure("ORACLE_TLS_POLICY_REJECTED");
  let url;
  try { url = new URL(env.FOSU_API_BASE || "https://class.katelya.eu.org"); } catch (_) { throw failure("ORACLE_ORIGIN_REJECTED"); }
  if (url.origin !== "https://class.katelya.eu.org" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw failure("ORACLE_ORIGIN_REJECTED");
  const token = env.FULL_SYNC_AGENT_TOKEN || "", secret = env.FULL_SYNC_SIGNING_SECRET || "";
  if (!env.FULL_SYNC_AGENT_ID || !token || !secret) throw failure("COLLECTOR_CONFIGURATION_MISSING");
  if (env.FOSU_COLLECTOR_EXECUTE !== undefined && !["0", "1"].includes(env.FOSU_COLLECTOR_EXECUTE)) throw failure("COLLECTOR_EXECUTION_MODE_REJECTED");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(env.FULL_SYNC_AGENT_ID || "wyz-schedule-collector") || token.length < 32 || secret.length < 32 || token === secret || [env.CAMPUS_AGENT_TOKEN, env.CAMPUS_AGENT_SIGNING_SECRET].includes(token) || [env.CAMPUS_AGENT_TOKEN, env.CAMPUS_AGENT_SIGNING_SECRET].includes(secret)) throw failure("COLLECTOR_CREDENTIALS_REJECTED");
  const dataRoot = env.FOSU_COLLECTOR_DATA_DIR || "/var/lib/fosuclass/schedule-collector";
  return { oracle: url.origin, token, secret, agentId: env.FULL_SYNC_AGENT_ID || "wyz-schedule-collector", execute: env.FOSU_COLLECTOR_EXECUTE === "1", sessionPath: env.FOSU_COLLECTOR_SESSION || "/var/lib/fosuclass/schedule-collector/session.json", dataRoot, transport: transport.load(dataRoot), concurrency: Math.max(1, Math.min(2, Number(env.SCHOOL_CONCURRENCY) || 1)) };
}
function client(cfg, fetcher = fetch, options = {}) {
  return async function request(method, pathname, value, binary = false, bounds = {}) {
    const raw = binary ? value : Buffer.from(value === undefined ? "" : JSON.stringify(value));
    const timestamp = String((options.now || Date.now)()), nonce = crypto.randomBytes(20).toString("hex");
    const signature = signRequest(cfg.secret, { method, path: pathname, timestamp, nonce, body: raw });
    let response;
    const timeout = AbortSignal.timeout(options.timeoutMs || (pathname === recovery.HEARTBEAT ? 15000 : 120000));
    const signal = AbortSignal.any([options.signal, bounds.signal, timeout].filter(Boolean));
    try { response = await fetcher(cfg.oracle + pathname, { method, redirect: "error", signal, headers: { authorization: "Bearer " + cfg.token, "content-type": binary ? "application/octet-stream" : "application/json", "x-full-sync-agent-id": cfg.agentId, "x-full-sync-timestamp": timestamp, "x-full-sync-nonce": nonce, "x-full-sync-signature": signature }, body: method === "GET" ? undefined : raw }); }
    catch (error) { throw options.signal && options.signal.aborted || bounds.signal && bounds.signal.aborted ? recovery.stopped() : recovery.classify(error); }
    if (response.status === 204) return null;
    if (!response.ok) { if (response.body) await response.body.cancel().catch(() => {}); throw recovery.httpError(response.status); }
    try { return await response.json(); } catch (error) { if (options.signal && options.signal.aborted || bounds.signal && bounds.signal.aborted) throw recovery.stopped(); if (error.name === "SyntaxError") throw recovery.error("ORACLE_RESPONSE_INVALID", { errorCategory: "protocol", retryable: false }); throw recovery.classify(error); }
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
    writeJsonAtomic(path.join(dir, "worker-lease.json"), { deadline: Date.now() + 90000 });
    const child = spawn(command.executable, command.args, { cwd: command.cwd, env: command.env, stdio: "ignore", windowsHide: true });
    onChild(child);
    child.once("error", () => reject(failure("SYNC_LAUNCH_FAILED")));
    child.once("exit", (code) => { const result = readJson(path.join(dir, "sync-result.json"), {}); code === 0 ? resolve() : reject(failure(code === 65 ? "COLLECTOR_LEASE_EXPIRED" : result.code || "SYNC_FAILED")); });
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
      catch (caught) { error = caught; if (caught.retryable === false || caught.status && caught.status < 500 && caught.status !== 408 && caught.status !== 429) break; if (attempt < 2) await (hooks.sleep || sleep)(700 * 2 ** attempt); }
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
  const request = deps.request || client(cfg, deps.fetcher || fetch, { signal: deps.signal });
  const heartbeatRequest = deps.heartbeat || recovery.createHeartbeat(request, { execute: cfg.execute, signal: deps.signal });
  await heartbeatRequest({ ok: true });
  if (!cfg.execute) return { status: "heartbeat-only" };
  if (deps.signal && deps.signal.aborted) throw recovery.stopped();
  if (!heartbeatRequest.readyToClaim()) return { status: "waiting-for-heartbeat-stability" };
  const claimed = await request("POST", "/api/full-sync/v1/runs/claim", {});
  if (!claimed) return { status: "idle" };
  const run = claimed.run;
  validateRun(run);
  const dir = runDirectory(cfg.dataRoot, run.term, run.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const started = Date.now();
  let child, timer, leaseTimer, killTimer, cancelled = false, stopCode, stopProblem, lastLease = Date.now(), tickRunning = false;
  const now = deps.now || Date.now, leaseMs = deps.leaseMs || 90000;
  lastLease = now();
  const leaseControl = new AbortController();
  const stop = (code, problem) => {
    if (stopCode) return;
    stopCode = code; stopProblem = problem; cancelled = true;
    leaseControl.abort();
    writeJsonAtomic(path.join(dir, "worker-lease.json"), { deadline: 0 });
    if (child) {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      killTimer.unref();
    }
  };
  const onAbort = () => stop("COLLECTOR_STOPPED");
  if (deps.signal) deps.signal.addEventListener("abort", onAbort, { once: true });
  const leasedRequest = async (method, route, value, binary = false) => { if (stopCode) throw recovery.error(stopCode, { retryable: false }); const result = await request(method, route, value, binary, { signal: leaseControl.signal }); if (stopCode) throw recovery.error(stopCode, { retryable: false }); return result; };
  let reportQueue = Promise.resolve();
  const report = (patch) => (reportQueue = reportQueue.catch(() => {}).then(() => leasedRequest("POST", "/api/full-sync/v1/runs/" + run.id + "/report", Object.assign({ claimId: run.claimId, durationMs: Date.now() - started }, patch))));
  writeJsonAtomic(path.join(dir, "state.json"), { runId: run.id, term: run.term, status: "running" });
  try {
    leaseTimer = setInterval(() => { if (now() - lastLease >= leaseMs) stop("COLLECTOR_LEASE_EXPIRED"); }, deps.watchIntervalMs || 1000);
    await report({ stage: "auth-check" });
    if (stopCode) throw failure(stopCode);
    timer = setInterval(async () => {
      if (tickRunning) return;
      tickRunning = true;
      try {
        const heartbeat = await heartbeatRequest({ runId: run.id, claimId: run.claimId }, { deadline: lastLease + leaseMs, signal: leaseControl.signal });
        if (stopCode) return;
        if (heartbeat.cancelled) stop("CANCELLED");
        else { lastLease = now(); writeJsonAtomic(path.join(dir, "worker-lease.json"), { deadline: lastLease + 90000 }); const progress = readJson(path.join(dir, "progress.json"), null); if (progress) await report(progress); }
      } catch (error) { if (!error.retryable || now() - lastLease >= leaseMs) stop(error.retryable ? "COLLECTOR_LEASE_EXPIRED" : error.code || "COLLECTOR_LEASE_EXPIRED", error); }
      finally { tickRunning = false; }
    }, deps.heartbeatIntervalMs || 30000);
    if (stopCode) throw failure(stopCode);
    await (deps.ensureSchoolSession || require("./schoolSession").ensureSession)(cfg, { signal:leaseControl.signal });
    if (stopCode) throw failure(stopCode);
    (deps.assertSession || assertSession)(cfg.sessionPath);
    if (!fs.existsSync(path.join(dir, "staging.json"))) await (deps.executeSync || executeSync)(run, cfg, dir, (value) => { child = value; if (stopCode) child.kill("SIGTERM"); else if (deps.signal && deps.signal.aborted) onAbort(); });
    if (cancelled) throw failure(stopCode || "CANCELLED");
    await report({ stage: "hash" });
    const data = readJson(path.join(dir, "staging.json"), null);
    const verified = assertFourSources(data, run.term);
    if (run.activeCanonicalHash && verified.canonicalHash === run.activeCanonicalHash) {
      if (timer) clearInterval(timer);
      const completion = await report({ complete: true, canonicalHash: verified.canonicalHash, directSourceSummary: verified.directSourceSummary, schoolRequestCount: data.meta.actualNetworkRequestCount || 0, noChange: true });
      const outcome = completion && completion.run && completion.run.result || "PENDING REVIEW";
      (deps.promoteRun || promoteRun)(cfg, run, dir, verified);
      writeJsonAtomic(path.join(dir, "state.json"), { runId:run.id,term:run.term,status: "completed", result: outcome,finishedAt:new Date().toISOString() });
      writeJsonAtomic(path.join(cfg.dataRoot, "last-success.json"), { directory: dir, runId: run.id });
      pruneRuns(cfg.dataRoot, dir, dir);
      return { status: outcome, runId: run.id };
    }
    await report({ stage: "upload", directSourceSummary: verified.directSourceSummary });
    const result = await (deps.upload || upload)(leasedRequest, run, dir, data, { progress: report, sleep: ms => recovery.wait(ms, deps.signal) });
    if (timer) clearInterval(timer);
    const completion = await report({ complete: true, canonicalHash: verified.canonicalHash, directSourceSummary: verified.directSourceSummary, schoolRequestCount: data.meta.actualNetworkRequestCount || 0, uploadId: result.uploadId, stagingRawBytes: result.rawBytes, stagingGzipBytes: result.gzipBytes });
    const outcome = completion && completion.run && completion.run.result || "PENDING REVIEW";
    (deps.promoteRun || promoteRun)(cfg, run, dir, verified);
    writeJsonAtomic(path.join(dir, "state.json"), { runId:run.id,term:run.term,status: "completed", result: outcome,finishedAt:new Date().toISOString() });
    writeJsonAtomic(path.join(cfg.dataRoot, "last-success.json"), { directory: dir, runId: run.id });
    pruneRuns(cfg.dataRoot, dir, dir);
    return { status: outcome, runId: run.id };
  } catch (error) {
    const code = stopCode || (/^[A-Z0-9_:-]{1,80}$/.test(error.code || "") ? error.code : "COLLECTOR_FAILED");
    if (!cancelled) await report({ failureCode: code }).catch(() => {});
    writeJsonAtomic(path.join(dir, "state.json"), { runId:run.id,term:run.term,status: "failed", code,finishedAt:new Date().toISOString() });
    pruneRuns(cfg.dataRoot, dir, readJson(path.join(cfg.dataRoot, "last-success.json"), {}).directory);
    throw Object.assign(failure(code), { retryable: stopProblem ? stopProblem.retryable : error.retryable, errorCategory: stopProblem ? stopProblem.errorCategory : error.errorCategory });
  } finally { leaseControl.abort(); if (timer) clearInterval(timer); if (leaseTimer) clearInterval(leaseTimer); if (killTimer) clearTimeout(killTimer); if (deps.signal) deps.signal.removeEventListener("abort", onAbort); }
}
async function runLoop(cfg, deps = {}) {
  const request = deps.request || client(cfg, deps.fetcher || fetch, { signal: deps.signal });
  const heartbeat = recovery.createHeartbeat(request, { execute: cfg.execute, signal: deps.signal, now: deps.now, sleep: deps.sleep, delays: deps.delays, onState: deps.onState });
  const wait = deps.sleep || recovery.wait;
  try {
    while (!deps.signal || !deps.signal.aborted) {
      try { const result = await runOnce(cfg, { ...deps, request, heartbeat }); if (deps.onResult) deps.onResult(result); if (deps.once) return result; }
      catch (error) { if (error.code === "COLLECTOR_STOPPED") break; if (!error.heartbeatFailure || !error.retryable || deps.once) throw error; heartbeat.cooldown(); await wait(recovery.COOLDOWN_MS, deps.signal); continue; }
      if (deps.signal && deps.signal.aborted) break;
      await wait(30000, deps.signal);
    }
  } catch (error) { if (error.code !== "COLLECTOR_STOPPED") throw error; }
  finally { if (deps.signal && deps.signal.aborted) heartbeat.stopped(); }
  return { status: "stopped" };
}
async function main(deps = {}) {
  const envArg = process.argv.find(value => value.startsWith("--env-file="));
  if (envArg) Object.assign(process.env, require("./credentials").readEnvFile(envArg.slice(11)));
  const cfg = config(deps.env || process.env);
  const release = acquireLock(cfg.dataRoot);
  const control = new AbortController(), stop = () => control.abort();
  const fetcher = deps.fetcher || (cfg.transport.mode === "cloudflare-default" ? fetch : transport.createFetcher(cfg.transport));
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try {
    await runLoop(cfg, { ...deps, fetcher, signal: control.signal, once: process.argv.includes("--once"), onResult: result => console.log(JSON.stringify(result)), onState: state => { const status = { ...state, transportMode: cfg.transport.mode }; writeJsonAtomic(path.join(cfg.dataRoot, "collector-status.json"), status); console.log(JSON.stringify(status)); } });
  } finally { if (fetcher.close) fetcher.close(); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); release(); }
}
if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ status: "failed", code: error.code || "COLLECTOR_FAILED" })); process.exitCode = recovery.exitCode(error); });
module.exports = { assertSession, client, config, executeSync, main, runLoop, runOnce, upload, validateRun };

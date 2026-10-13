"use strict";
// Oracle maintenance admission only. Credentials never leave host-local requests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { parseEnv } = require("../../deploy/oracle-sample/preflight");
const { fetchLoopback } = require("./loopback-http");
const BASE = "http://127.0.0.1:18318";
const ORIGIN = "https://class.katelya.eu.org";
function fail(code) { throw Object.assign(new Error(code), { code }); }
function privateFile(file) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || process.platform !== "win32" && (s.mode & 0o077)) fail("MAINTENANCE_PRIVATE_FILE_REQUIRED");
  return fs.readFileSync(file, "utf8");
}
function durableWrite(file, value) {
  const directory = path.dirname(file), stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && (stat.mode & 0o077)) fail("MAINTENANCE_PRIVATE_DIRECTORY_REQUIRED");
  if (fs.existsSync(file)) privateFile(file);
  const temp = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  if (process.platform !== "win32") {
    const dir = fs.openSync(directory, "r");
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
}
function parse(args) {
  const mode = args[0], opts = {};
  if (!["acquire", "restore", "snapshot", "accept"].includes(mode)) fail("MAINTENANCE_MODE_REJECTED");
  for (const arg of args.slice(1)) {
    const m = arg.match(/^--(app-dir|credentials-file|state-file|approve-maintenance|wait-seconds|expected-sha|before-file)=(.+)$/);
    if (!m || opts[m[1]] !== undefined) fail("MAINTENANCE_ARGUMENT_REJECTED");
    opts[m[1]] = m[2];
  }
  if (!path.isAbsolute(opts["app-dir"] || "") || !path.isAbsolute(opts["credentials-file"] || "") || Object.values(opts).some(value => /[\r\n\0]/.test(value))) fail("MAINTENANCE_ARGUMENT_REJECTED");
  if (["acquire", "restore"].includes(mode) && !path.isAbsolute(opts["state-file"] || "")) fail("MAINTENANCE_STATE_REQUIRED");
  if (mode === "acquire" && opts["approve-maintenance"] !== "PAUSE_PERSONAL_ADMISSION") fail("MAINTENANCE_APPROVAL_REQUIRED");
  if (mode !== "acquire" && opts["approve-maintenance"]) fail("MAINTENANCE_ARGUMENT_REJECTED");
  if (opts["wait-seconds"] && !/^\d+$/.test(opts["wait-seconds"]) || Number(opts["wait-seconds"] || 180) < 1 || Number(opts["wait-seconds"] || 180) > 900) fail("MAINTENANCE_WAIT_REJECTED");
  if (mode === "accept" && !/^[a-f0-9]{40}$/.test(opts["expected-sha"] || "")) fail("MAINTENANCE_COMMIT_REQUIRED");
  return { mode, ...opts };
}
function safeQueue(value) {
  const s = value?.snapshot?.service, q = s?.queue;
  if (value?.success !== true || typeof s?.maintenance?.paused !== "boolean" || s?.maintenance?.storageStatus === "invalid" || !q || [q.queued, q.processing, q.active].some(n => !Number.isInteger(n) || n < 0) || q.active !== q.queued + q.processing) fail("PERSONAL_BROKER_IDLE_UNVERIFIABLE");
  return { paused: s.maintenance.paused, queued: q.queued, processing: q.processing, active: q.active, agentOnline: s.agent?.online === true };
}
async function wire(method, route, session, body, requestId, deps = {}) {
  const response = await (deps.fetch || fetchLoopback)((deps.base || BASE) + route, {
    method, redirect: "manual", signal: AbortSignal.timeout(10000),
    headers: { accept: "application/json", origin: ORIGIN, "content-type": "application/json", ...(session?.cookie ? { cookie: session.cookie, "x-fosu-csrf": session.csrf } : {}), ...(session?.token ? { "x-admin-token": session.token } : {}), ...(requestId ? { "x-request-id": requestId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let value = null;
  if (route === "/admin/schedule-collector") {
    const html = await response.text();
    if (response.status !== 200 || !html.includes("section-schedule-collector") || !html.includes("/api/admin/schedule-collector/overview")) fail("ADMIN_COLLECTOR_PAGE_FAILED");
    return { htmlSha256: crypto.createHash("sha256").update(html).digest("hex"), authenticatedPage: true };
  }
  try { value = await response.json(); } catch { fail("MAINTENANCE_API_RESPONSE_REJECTED"); }
  if (!response.ok) fail(/^(ADMIN|COLLECTOR|SAMPLE)_[A-Z0-9_]+$/.test(value?.code || "") ? value.code : "MAINTENANCE_API_REQUEST_REJECTED");
  if (route === "/api/admin/login") {
    const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
    const cookie = cookies.map(c => c.split(";")[0]).find(c => c.startsWith("fosu_admin_session="));
    if (value.success !== true || typeof value.csrfToken !== "string" || !value.csrfToken || !cookie) fail("ADMIN_LOGIN_SESSION_REQUIRED");
    return { cookie, csrf: value.csrfToken };
  }
  return value;
}
async function login(credentials, deps) {
  const credential = credentials.ADMIN_PASSWORD || credentials.ADMIN_TOKEN;
  if (typeof credential !== "string" || !credential || /[\r\n]/.test(credential)) fail("ADMIN_LOGIN_CREDENTIAL_REQUIRED");
  const session = await wire("POST", "/api/admin/login", null, { password: credential }, null, deps);
  const verified = await wire("GET", "/api/admin/session", session, undefined, null, deps);
  if (verified.authenticated !== true || verified.authMethod !== "admin-cookie" || !verified.csrfToken) fail("ADMIN_LOGIN_SESSION_REQUIRED");
  session.csrf = verified.csrfToken;
  return session;
}
async function verifyAudit(session, action, requestId, deps) {
  const value = await wire("GET", "/api/admin/audit-logs", session, undefined, null, deps);
  const entry = value?.items?.find(item => item.requestId === requestId && item.action === "campus-sync-" + action);
  if (value.success !== true || !entry || entry.authMethod !== "admin-cookie" || !entry.scopes?.includes("admin:full")) fail("MAINTENANCE_AUDIT_NOT_CONFIRMED");
  return { requestId, action: entry.action, authMethod: entry.authMethod, audited: true };
}
async function main(args = process.argv.slice(2), deps = {}) {
  const opts = parse(args);
  if (!deps.skipRootCheck && (process.platform === "win32" || process.geteuid?.() !== 0)) fail("MAINTENANCE_ROOT_REQUIRED");
  const credentials = parseEnv((deps.readFile || privateFile)(opts["credentials-file"]));
  if (opts.mode === "snapshot") {
    if (!credentials.ADMIN_API_TOKEN) fail("MAINTENANCE_READ_TOKEN_REQUIRED");
    return { schema: "oracle-maintenance-snapshot.v1", status: "PASS", ...safeQueue(await wire("GET", "/api/admin/campus-sync/snapshot", { token: credentials.ADMIN_API_TOKEN }, undefined, null, deps)), schoolRequests: 0, writes: 0 };
  }
  const session = await login(credentials, deps);
  if (opts.mode === "accept") {
    const status = await wire("GET", "/api/admin/security/status", session, undefined, null, deps);
    if (status.deployment?.commitSha !== opts["expected-sha"]) fail("LIVE_DEPLOYMENT_COMMIT_MISMATCH");
    const page = await wire("GET", "/admin/schedule-collector", session, undefined, null, deps);
    const overview = await wire("GET", "/api/admin/schedule-collector/overview", session, undefined, null, deps);
    const o = overview.overview;
    if (overview.success !== true || o?.health?.oracleRevision !== opts["expected-sha"] || o?.health?.oracleApi !== "RESPONDED" || o?.health?.signatureConfigured !== true || o?.readiness?.ready !== true || o?.readiness?.sampleOnly !== true || o?.readiness?.publishable !== false || o?.autoPublish !== false || !o?.sources || !Array.isArray(o.runs)) fail("ADMIN_COLLECTOR_API_FAILED");
    const notices = await wire("GET", "/api/admin/notices", session, undefined, null, deps);
    if (notices.success !== true) fail("ADMIN_NOTICES_READ_FAILED");
    const queue = safeQueue(await wire("GET", "/api/admin/campus-sync/snapshot", session, undefined, null, deps));
    if (queue.active !== 0) fail("PERSONAL_BROKER_JOB_IN_FLIGHT");
    return { schema: "oracle-maintenance-acceptance.v1", status: "PASS", oracleRevision: o.health.oracleRevision, authenticatedPage: page.authenticatedPage, pageSha256: page.htmlSha256, adminCollectorApi: true, originalNoticesReadable: true, personalQueueIdle: true, personalAgentOnline: queue.agentOnline, fullCollectionApproved: o.fullCollectionApproved, fullCollection: "LOCKED_OR_PENDING_SEPARATE_APPROVAL", sampleTaskAndReview: "PENDING_SCHOOL_AUTHORIZATION", schoolRequests: 0, writes: 0 };
  }
  const stateFile = opts["state-file"], writer = deps.writeState || durableWrite;
  let state = fs.existsSync(stateFile) ? JSON.parse((deps.readFile || privateFile)(stateFile)) : null;
  if (state && (state.schema !== "oracle-personal-admission.v1" || state.appDir !== path.resolve(opts["app-dir"]) || typeof state.originalPaused !== "boolean" || !/^[a-f0-9]{32}$/.test(state.operationId || ""))) fail("MAINTENANCE_STATE_CONFLICT");
  let observed = safeQueue(await wire("GET", "/api/admin/campus-sync/snapshot", session, undefined, null, deps));
  if (opts.mode === "restore") {
    if (!state) fail("MAINTENANCE_STATE_REQUIRED");
    if (observed.paused !== state.originalPaused) {
      state.phase = "RESTORE_REQUESTED"; writer(stateFile, state);
      const action = state.originalPaused ? "pause" : "resume";
      const requestId = "oracle-maintenance-" + state.operationId + "-restore";
      const value = await wire("POST", "/api/admin/campus-sync/actions/" + action, session, { confirmation: "RESTORE PERSONAL ADMISSION", idempotencyKey: state.operationId + ":restore" }, requestId, deps);
      if (value.success !== true || value.maintenance?.paused !== state.originalPaused) fail("MAINTENANCE_RESTORE_FAILED");
      state.restoreAudit = await verifyAudit(session, action, requestId, deps); writer(stateFile, state);
    }
    observed = safeQueue(await wire("GET", "/api/admin/campus-sync/snapshot", session, undefined, null, deps));
    if (observed.paused !== state.originalPaused) fail("MAINTENANCE_RESTORE_FAILED");
    state.phase = "RESTORED"; state.restoredAt = new Date().toISOString(); writer(stateFile, state);
    return { status: "PASS", originalAdmissionRestored: true, paused: observed.paused, schoolRequests: 0 };
  }
  if (state?.phase === "RESTORED") fail("MAINTENANCE_ALREADY_RESTORED");
  if (!state) {
    state = { schema: "oracle-personal-admission.v1", appDir: path.resolve(opts["app-dir"]), originalPaused: observed.paused, operationId: crypto.randomBytes(16).toString("hex"), phase: "PREPARED", approvedScope: "PAUSE_PERSONAL_ADMISSION", createdAt: new Date().toISOString() };
    writer(stateFile, state);
  }
  if (!observed.paused) {
    state.phase = "PAUSE_REQUESTED"; writer(stateFile, state);
    const requestId = "oracle-maintenance-" + state.operationId + "-pause";
    const value = await wire("POST", "/api/admin/campus-sync/actions/pause", session, { confirmation: "PAUSE PERSONAL ADMISSION", idempotencyKey: state.operationId + ":pause" }, requestId, deps);
    if (value.success !== true || value.maintenance?.paused !== true) fail("MAINTENANCE_PAUSE_FAILED");
    state.pauseAudit = await verifyAudit(session, "pause", requestId, deps); writer(stateFile, state);
  } else if (state.phase === "PAUSE_REQUESTED") {
    // A disconnected response can still mean the protected POST succeeded.
    state.pauseAudit = await verifyAudit(session, "pause", "oracle-maintenance-" + state.operationId + "-pause", deps); writer(stateFile, state);
  }
  const deadline = (deps.now || Date.now)() + Number(opts["wait-seconds"] || 180) * 1000;
  for (;;) {
    observed = safeQueue(await wire("GET", "/api/admin/campus-sync/snapshot", session, undefined, null, deps));
    if (!observed.paused) fail("MAINTENANCE_GATE_CHANGED");
    if (observed.active === 0) break;
    if ((deps.now || Date.now)() >= deadline) fail("PERSONAL_BROKER_DRAIN_TIMEOUT");
    await (deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(1000);
  }
  state.phase = "ACQUIRED"; state.acquiredAt = new Date().toISOString(); writer(stateFile, state);
  return { status: "PASS", personalAdmissionPaused: true, personalQueueIdle: true, originalPaused: state.originalPaused, schoolRequests: 0 };
}
if (require.main === module) main().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(JSON.stringify({ status: "BLOCKED", code: /^[A-Z0-9_]+$/.test(error.code || "") ? error.code : "MAINTENANCE_FAILED", schoolRequests: 0 })); process.exitCode = 2; });
module.exports = { privateFile, durableWrite, parse, safeQueue, wire, login, verifyAudit, main };

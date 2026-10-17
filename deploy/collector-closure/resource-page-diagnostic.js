"use strict";
// One approved teacher-page observation. No timetable, directory crawl, CAS,
// credential loader, Session save, Oracle client or production write path.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const PAGE = "/kbcx/kbxx_teacher", TERM = "2026-2027-1";
const REVISION = "7e8dfb24b2ce1b1e55313c7fcf9f9ba8edfb249f";
const WORKER_SHA = "af7ba793c02825b02e8415190a3aca2c27d97bba455394af2e05410c6c77679d";
const fail = code => Object.assign(new Error(code), { code });
const sensitive = /password|passwd|cookie|token|secret|ticket|execution|account|username|student|authorization|session|captcha|signature/i;
const safeName = name => /^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(name || "") && !sensitive.test(name);
function requestShape(request) {
  const url = new URL(request.url());
  const businessPath = /^\/kbcx\/[A-Za-z_]{2,64}(?:\.jsp|\.action)?$/.test(url.pathname) ? url.pathname : null;
  let names = [];
  // Never inspect an authentication request body, even when it is blocked.
  if (businessPath) {
    names = [...url.searchParams.keys()];
    const body = request.method() === "POST" ? request.postData() : null;
    if (body && Buffer.byteLength(body) <= 8192 && /^application\/x-www-form-urlencoded/i.test(request.headers()["content-type"] || "")) names.push(...new URLSearchParams(body).keys());
  }
  return { method: ["GET", "HEAD", "POST"].includes(request.method()) ? request.method() : "OTHER", type: request.resourceType(), businessPath, parameterNames: [...new Set(names)].filter(safeName).slice(0, 24) };
}
function inspectPage(term) {
  const safe = name => /^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(name || "") && !/password|passwd|cookie|token|secret|ticket|execution|account|username|student|authorization|session|captcha|signature/i.test(name);
  const allowedTypes = new Set(["text", "hidden", "search", "button", "submit", "checkbox", "radio", "number"]);
  const all = Array.from(document.querySelectorAll("select[name],input[name],button[name]"));
  return {
    controls: all.filter(input => safe(input.name)).slice(0, 64).map(input => ({
      tag: input.tagName.toLowerCase(), name: input.name,
      type: input.tagName === "SELECT" ? "select" : allowedTypes.has(input.type) ? input.type : "other",
      disabled: Boolean(input.disabled), hasChangeHandler: Boolean(input.onchange || input.getAttribute("onchange")),
      ...(input.tagName === "SELECT" ? { optionCount: input.options.length,
        usableOptionCount: Array.from(input.options).filter(o => o.value && !/^(?:请选择|全部|不限|所有|--)/.test(String(o.textContent || "").trim())).length,
        ...(input.name === "xnxqh" ? { termAvailable: Array.from(input.options).some(o => o.value === term), termSelected: input.value === term } : {}) } : {}),
    })),
    omittedControlCount: all.filter(input => !safe(input.name)).length,
    credentialControlPresent: Boolean(document.querySelector('input[type="password"],input[name="password"]')),
    blockedBrowserFeatures: Array.from(globalThis.__fosuDiagnosticBlockedFeatures || []).filter(name => ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport", "Worker", "SharedWorker"].includes(name)),
    tableCount: document.querySelectorAll("table").length,
    iframeCount: document.querySelectorAll("iframe").length,
  };
}
async function observe(context, options) {
  const { origin, classify, settle = ms => new Promise(resolve => setTimeout(resolve, ms)) } = options;
  const observations = [], blocked = []; let documents = 0, relevantBlocked = false, fatal;
  const onPopup = page => { fatal = "SCHOOL_RESOURCE_DIAGNOSTIC_POPUP_BLOCKED"; page.close().catch(() => {}); };
  // RTC/STUN and worker-owned transports can bypass HTTP routing/ledger.
  // Diagnose the document in a restricted context, never silently release them.
  await context.addInitScript(() => {
    const blocked = new Set();
    Object.defineProperty(globalThis, "__fosuDiagnosticBlockedFeatures", { get: () => Object.freeze([...blocked]), configurable: false });
    for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport", "Worker", "SharedWorker"]) {
      Object.defineProperty(globalThis, name, { value: class { constructor() { blocked.add(name); throw new DOMException("Diagnostic network scope", "NotAllowedError"); } }, writable: false, configurable: false });
    }
  });
  if (typeof context.routeWebSocket !== "function") throw fail("SCHOOL_RESOURCE_WEBSOCKET_GUARD_UNAVAILABLE");
  await context.routeWebSocket("**/*", socket => {
    relevantBlocked = true;
    if (blocked.length < 32) blocked.push({ method: "WEBSOCKET", type: "websocket", businessPath: null, parameterNames: [] });
    socket.close({ code: 1008, reason: "diagnostic scope" });
  });
  // This guard is above the installed Collector guard. Only released requests
  // fall through to its durable, serial RequestLedger and redirect/TLS policy.
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), type = request.resourceType();
    if (["image", "font", "media"].includes(type)) return route.abort("blockedbyclient");
    const teaching = url.origin === origin && !url.username && !url.password;
    const document = teaching && type === "document" && request.method() === "GET" && url.pathname === PAGE && !url.search && !url.hash && documents === 0;
    const asset = teaching && ["script", "stylesheet"].includes(type) && request.method() === "GET" && /\.(?:js|css)$/i.test(url.pathname) && !/_ifr(?:\b|_)/i.test(url.pathname);
    if (!document && !asset) {
      relevantBlocked = true;
      if (url.origin === "https://authserver.fosu.edu.cn") fatal = "SCHOOL_SESSION_EXPIRED";
      if (blocked.length < 32) blocked.push(teaching ? requestShape(request) : { method: "BLOCKED", type, businessPath: null, parameterNames: [] });
      return route.abort("blockedbyclient");
    }
    if (document) documents++;
    if (options.checkAccess) { try { options.checkAccess(); } catch(error) { fatal=error.code; return route.abort("blockedbyclient"); } }
    return route.fallback();
  });
  const page = await context.newPage();
  context.on("page", onPopup);
  try {
    const response = await page.goto(origin + PAGE, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (!response) throw fail("SCHOOL_PROTECTED_RESPONSE_REJECTED");
    if ([401, 403].includes(response.status())) throw fail(response.status() === 401 ? "SCHOOL_SESSION_EXPIRED" : "SCHOOL_ACCESS_DENIED");
    if (response.status() === 429) throw fail("SCHOOL_RATE_LIMITED");
    if (response.status() !== 200) throw fail("SCHOOL_PROTECTED_RESPONSE_REJECTED");
    const capture = async stage => {
      const url = new URL(page.url());
      if (url.origin !== origin || url.pathname !== PAGE || url.search) throw fail("SCHOOL_TLS_OR_ORIGIN_REJECTED");
      const body = await page.evaluate(() => document.body?.innerText || "");
      const code = classify(body);
      if (code) throw fail(code);
      if (fatal) throw fail(fatal);
      const snapshot = await page.evaluate(inspectPage, TERM);
      if (snapshot.credentialControlPresent) throw fail("SCHOOL_SESSION_EXPIRED");
      if (snapshot.blockedBrowserFeatures.length) relevantBlocked = true;
      observations.push({ stage, ...snapshot }); return snapshot;
    };
    await capture("initial");
    await settle(1000);
    const ready = await capture("after-initialization");
    const term = ready.controls.find(c => c.tag === "select" && c.name === "xnxqh");
    // A blocked business call is evidence for review, never permission to try it.
    if (!relevantBlocked && term?.termAvailable && !term.termSelected) {
      await page.selectOption('select[name="xnxqh"]', TERM);
      await settle(1500); await capture("after-term-selection");
    }
    return { status: relevantBlocked ? "REVIEW_REQUIRED" : "OBSERVED", code: relevantBlocked ? "SCHOOL_RESOURCE_REQUEST_SCOPE_REVIEW" : "SCHOOL_RESOURCE_PAGE_STRUCTURE_OBSERVED", observations, blockedRequests: blocked, pageDocuments: documents };
  } catch(error) {
    const code=fatal || error.code;
    if(code==="SCHOOL_SESSION_EXPIRED") throw fail("AUTH_REQUIRED");
    if(fatal) throw fail(fatal); throw error;
  }
  finally { context.off("page", onPopup); }
}
function installed(root) {
  const real = fs.realpathSync(root), source = path.join(real, "tools/fosu-sync-client/sync.js");
  if (path.basename(real) !== REVISION || fs.lstatSync(source).isSymbolicLink() || crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex") !== WORKER_SHA) throw fail("SCHOOL_RESOURCE_DIAGNOSTIC_SOURCE_CHANGED");
  return real;
}
const {acquireDiagnosticLocks} = require("./resource-diagnostic-locks");
async function main() {
  const directory = path.dirname(__filename), approval = JSON.parse(fs.readFileSync(path.join(directory, "approval.json"), "utf8"));
  if (process.platform !== "linux" || process.geteuid() !== 0 || approval.approved !== true || approval.source !== "teacher" || approval.term !== TERM || approval.requestBudget !== 40 || approval.passwordSubmissionLimit !== 0 || !/^sc-diag-[a-f0-9]{16}$/.test(approval.runId) || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()) throw fail("SCHOOL_ACCESS_NOT_AUTHORIZED");
  const root = installed("/opt/fosuclass/schedule-collector/current"), state = "/var/lib/fosuclass/schedule-collector";
  const pins = JSON.parse(fs.readFileSync(path.join(directory, "source-pins.json"), "utf8"));
  for (const [digest, relative] of pins) {
    if (!/^[a-f0-9]{64}$/.test(digest) || !/^(?:tools\/(?:fosu-sync-client|wyz-schedule-collector)|shared)\/[A-Za-z0-9]+\.js$/.test(relative) || fs.lstatSync(path.join(root, relative)).isSymbolicLink() || crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex") !== digest) throw fail("SCHOOL_RESOURCE_DIAGNOSTIC_SOURCE_CHANGED");
  }
  const runtime = require(root + "/tools/wyz-schedule-collector/browserRuntime");
  if (runtime.runtime(state).mode !== "native") throw fail("SCHOOL_AUTH_NATIVE_BROWSER_REQUIRED");
  const store = require(root + "/tools/wyz-schedule-collector/runStore"), receipt = require(root + "/tools/wyz-schedule-collector/workerReceipt"), auth = require(root + "/tools/wyz-schedule-collector/schoolSession");
  const releases = []; let browser, timer, evidence, protectedStateUnchanged = "UNKNOWN";
  let stopping=false;
  const stop=()=>{ stopping=true; if(browser) browser.close().catch(()=>{}); };
  process.once("SIGTERM",stop); process.once("SIGINT",stop);
  const protectedFiles = [state + "/session.json", state + "/school-credentials.json", state + "/school-auth-state.json"];
  const metadata = () => protectedFiles.map(file => { const s = fs.lstatSync(file); return [s.ino, s.size, s.mtimeMs, s.mode, s.uid]; });
  try {
    // Leave preexisting locks intact, including stale locks requiring review.
    const unlock=acquireDiagnosticLocks(state, store); releases.push(unlock);
    if (!fs.existsSync(state + "/session.json")) throw fail("AUTH_REQUIRED");
    auth.secureFile(state + "/session.json");
    try { auth.validateSession(JSON.parse(fs.readFileSync(state + "/session.json","utf8"))); }
    catch (_) { throw fail("AUTH_REQUIRED"); }
    const before = JSON.stringify(metadata()), sessionHash = crypto.createHash("sha256").update(fs.readFileSync(state + "/session.json")).digest("hex");
    auth.assertSafeRuntime();
    Object.assign(process.env, { FOSU_BASE_URL: "https://100.fosu.edu.cn", FOSU_COLLECTOR_MODE: "1", FOSU_SYNC_HEADLESS: "1", FOSU_SYNC_AUTH_MODE: "playwright-manual", FOSU_COLLECTOR_SESSION: state + "/session.json", FOSU_SYNC_DATA_DIR: directory, FOSU_COLLECTOR_SAMPLE_KIND: "four", FOSU_COLLECTOR_RUN_ID: approval.runId, FOSU_COLLECTOR_TERM: TERM, FOSU_COLLECTOR_REQUEST_BUDGET: "40", FOSU_COLLECTOR_APPROVAL_EXPIRES_AT: approval.expiresAt, FOSU_COLLECTOR_WORKER_SOURCE_HASH: WORKER_SHA, FOSU_COLLECTOR_LOGIN_PROFILE: "mobile-wechat" });
    const sync = require(root + "/tools/fosu-sync-client/sync"), cas = require(root + "/tools/fosu-sync-client/schoolCasPage");
    const active = await sync.initBrowserContext(); browser = active.browser;
    if(stopping) throw fail("COLLECTOR_STOPPED");
    timer = setTimeout(() => browser.close().catch(() => {}), Math.max(1, Date.parse(approval.startedAt) + 90000 - Date.now()));
    try {
      evidence = await observe(active.context, { origin: "https://100.fosu.edu.cn", checkAccess:unlock.check, classify: body => /统一身份认证|密码登录/.test(body) ? "SCHOOL_SESSION_EXPIRED" : cas.explicitChallenge(body) ? "SCHOOL_SECURITY_CHALLENGE" : /没有(?:访问)?权限|无权访问|权限不足|访问被拒绝/.test(body) ? "SCHOOL_ACCESS_DENIED" : null });
      // Allow already released assets to settle; never issue another request.
      const deadline = Date.now() + 3000;
      while (global.COLLECTOR_REQUEST_LEDGER.snapshot().pending && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
      protectedStateUnchanged = before === JSON.stringify(metadata()) && sessionHash === crypto.createHash("sha256").update(fs.readFileSync(state + "/session.json")).digest("hex");
      if (!protectedStateUnchanged) throw fail("SCHOOL_RESOURCE_PROTECTED_STATE_CHANGED");
    }
  } catch (error) { evidence = { status: "BLOCKED", code: stopping ? "COLLECTOR_STOPPED" : error.code==="AUTH_REQUIRED" || /^(SCHOOL|COLLECTOR)_[A-Z0-9_]{1,60}$/.test(error.code || "") ? error.code : "SCHOOL_RESOURCE_DIAGNOSTIC_FAILED" }; }
  finally {
    clearTimeout(timer); if (browser) await browser.close().catch(() => {});
    const ledger = global.COLLECTOR_REQUEST_LEDGER?.snapshot();
    if (global.SCHOOL_REQUEST_FAILURE) evidence = { ...evidence, status: "BLOCKED", code: receipt.normalizeCode({ code: global.SCHOOL_REQUEST_FAILURE }) };
    if (ledger?.pending) evidence = { ...evidence, status: "BLOCKED", code: "COLLECTOR_REQUEST_OUTCOME_UNKNOWN" };
    if (["AUTH_REQUIRED","SCHOOL_SESSION_EXPIRED","SCHOOL_SESSION_INVALID","SESSION_EXPIRED"].includes(evidence?.code)) evidence={...evidence,status:"AUTH_REQUIRED",code:"AUTH_REQUIRED"};
    try { receipt.durable(path.join(directory, "result.json"), { schema: "collector-resource-page-diagnostic.v1", runId: approval.runId, term: TERM, source: "teacher", ...evidence, schoolAccessExecuted:Boolean(ledger?.reserved), ...(ledger ? { requestLedger: { ...ledger, unknown: ledger.pending ? 1 : 0 } } : {}), authenticationSchoolRequests: 0, passwordSubmissions: 0, sessionProbeSchoolRequests: 0, protectedStateUnchanged, sourceUpgrade: false, sessionSaved: false, scheduleRequests: 0, oracleTaskCreated: false, replayAllowed: false }); }
    finally { while (releases.length) releases.pop()(); process.removeListener("SIGTERM",stop); process.removeListener("SIGINT",stop); }
  }
}
module.exports = { observe, inspectPage, requestShape, installed, acquireDiagnosticLocks, REVISION, WORKER_SHA };
if (require.main === module) main().catch(() => { process.exitCode = 2; });

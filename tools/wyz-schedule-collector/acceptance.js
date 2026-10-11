#!/usr/bin/env node
"use strict";
// A receipt evaluator, not a login/collection/deployment driver. Network commands
// require explicit flags: one protected-school-page Session check and two signed
// read-only Oracle APIs. None performs login, task creation, upload or publication.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { execFileSync } = require("child_process");
const STAGES = ["installation", "public-cas", "session", "oracle-sample", "class-sample", "four-sample", "staging"];
const SOURCE = { installation:"wyz-local", "public-cas":"wyz-school", session:"wyz-school", "oracle-sample":"oracle-live", "class-sample":"wyz-school-and-oracle", "four-sample":"wyz-school-and-oracle", staging:"wyz-school-and-oracle" };
const MAX_BYTES = 256 * 1024;
const SESSION_VALIDITY_MAX_AGE_MS = 15 * 60 * 1000;
const VERIFIED_STATES = Object.freeze({ "public-cas":"CAS_PUBLIC_READY", session:"SCHOOL_SESSION_VALID", "oracle-sample":"ORACLE_SAMPLE_API_READY", "class-sample":"CLASS_SAMPLE_PENDING_REVIEW", "four-sample":"FOUR_SOURCE_SAMPLE_PENDING_REVIEW", staging:"STAGING_QUALITY_VERIFIED" });
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => /^[a-f0-9]{64}$/.test(value || "");
const revision = value => /^[a-f0-9]{40}$/.test(value || "");
const runId = value => /^sc-[A-Za-z0-9-]{1,100}$/.test(value || "");
const integer = value => Number.isSafeInteger(value) && value >= 0;
function privatePath(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || process.platform !== "win32" && (stat.uid !== process.getuid() || (stat.mode & 0o077))) fail("ACCEPTANCE_PRIVATE_FILE_REQUIRED");
}
function read(file) {
  privatePath(file); privatePath(path.dirname(file), true);
  if (fs.statSync(file).size > MAX_BYTES) fail("ACCEPTANCE_INPUT_TOO_LARGE");
  return fs.readFileSync(file, "utf8");
}
function write(file, value) {
  // Never overwrite earlier acceptance evidence; use a fresh run directory.
  privatePath(path.dirname(file), true);
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function safeObject(value, depth = 0) {
  if (depth > 12) fail("ACCEPTANCE_INPUT_REJECTED");
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:account|username|studentId|password|cookies?|authorization|headers?|body|postData|token|secret|apiKey|storageState|html|url|path|claimId|leaseId|raw|base64|fileBase64)$/i.test(key)) fail("ACCEPTANCE_SENSITIVE_INPUT_REJECTED");
    safeObject(item, depth + 1);
  }
}
function parseInput(raw) {
  let values;
  try { const item = JSON.parse(raw); values = [item]; }
  catch (_) {
    values = raw.split(/\r?\n/).filter(line => line.trim().startsWith("{")).map(line => { try { return JSON.parse(line); } catch (_) { fail("ACCEPTANCE_INPUT_REJECTED"); } });
  }
  values.forEach(item => safeObject(item));
  return values;
}
function pick(value, keys) { return Object.fromEntries(keys.filter(key => value && value[key] !== undefined).map(key => [key, value[key]])); }
function summary(value) {
  const result = {};
  for (const kind of ["class", "teacher", "classroom", "course"]) if (value && value[kind]) result[kind] = pick(value[kind], ["sourceMode", "discoveredEntities", "requestedEntities", "success", "empty", "failed", "parserErrors", "requestCount", "scheduleDocuments", "courseEvents"]);
  return result;
}
function stable(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
}
function boundarySnapshots(values) {
  const snapshots = values.filter(value => value.schema === "oracle-sample-preflight.v1");
  if (snapshots.length !== 2) return {};
  const safe = value => {
    const files = value.protectedFiles || {};
    return { status:value.status, oracleRevision:value.liveBaseSha, activeSha256:files.active, formalStagingSha256:files["staging-latest.json"], formalStagingObserved:Object.hasOwn(files, "staging-latest.json"), protectedStateSha256:sha256(stable(files)), envSha256:value.envSha256, schoolRequests:value.schoolRequests, configurationChanged:value.configurationChanged };
  };
  return { before:safe(snapshots[0]), after:safe(snapshots[1]) };
}
function normalize(stage, values, raw = "") {
  const last = predicate => values.filter(predicate).at(-1) || {};
  const failure = last(value => value.status === "failed" || value.status === "FAIL" || value.status === "BLOCKED" && value.code);
  let data;
  if (stage === "installation") data = last(value => value.installedRevision);
  else if (stage === "public-cas") {
    const diagnostic = last(value => typeof value.formReady === "boolean");
    data = Object.keys(diagnostic).length ? diagnostic : last(value => value.diagnostic).diagnostic || {};
    data = pick(data, ["formReady", "loginReady", "networkCompatibility", "requiredInitializationComplete", "backgroundPostsBlocked", "noncriticalPostsBlocked", "publicPostsReleased", "passwordSubmissions", "authHistoryChanged", "securityChallenge", "stage"]);
  } else if (stage === "session") {
    data = pick(last(value => ["SESSION_SAVED", "SESSION_REUSED"].includes(value.status)), ["status", "schoolLoginAttempts", "schoolAuthRequests", "sessionChanged", "passwordPersisted", "loginProfile"]);
    const checked = last(value => value.schema === "collector-session-validity.v1");
    if (Object.keys(checked).length) data.validity = pick(checked, ["schema", "status", "code", "source", "liveAttested", "checkedAt", "installedRevision", "checkMethod", "schoolLoginAttempts", "sessionChanged", "credentialsRead", "authHistoryChanged"]);
  }
  else if (stage === "oracle-sample") {
    const value = last(value => value.protocol || value.oracleSampleProtocol);
    data = pick(value, ["protocol", "ready", "code", "sampleKinds", "entityLimit", "maxRequestBudget", "leaseTtlMs", "approvalTtlMs", "sampleOnly", "publishable", "coverageValid", "authenticatedRead", "healthPass", "installedRevision", "rollbackReady"]);
    if (value.oracleSampleProtocol) Object.assign(data, { protocol:value.oracleSampleProtocol, ready:value.oracleSampleReady, code:value.oracleSampleCode, sampleKinds:value.oracleSampleKinds });
  }
  else if (["class-sample", "four-sample"].includes(stage)) {
    const inspection = last(value => value.lastSample);
    const directLocal = last(value => value.runId && value.sampleKind);
    const local = Object.keys(directLocal).length ? directLocal : inspection.lastSample || {};
    const directReview = last(value => value.review);
    const reviewWrapper = Object.keys(directReview).length ? directReview : { review:inspection.oracleSampleReview, authenticatedRead:inspection.oracleSampleReview?.authenticatedRead };
    data = { local:pick(local, ["runId", "term", "mode", "sampleKind", "result", "schoolRequestCount", "published", "canonicalHash", "uploadId"]), oracle:pick(reviewWrapper.review, ["runId", "uploadId", "canonicalHash", "sampleKind", "term", "schoolRequestCount", "requestBudget", "result", "sampleOnly", "publishable", "coverageValid", "stagingState", "releaseState", "runtimeState", "formalStagingUnchanged", "activePointerUnchanged", "ownershipConfirmed"]) };
    data.local.directSourceSummary = summary(local.directSourceSummary);
    data.oracle.directSourceSummary = summary(reviewWrapper.review && reviewWrapper.review.directSourceSummary);
    data.oracle.authenticatedRead = reviewWrapper.authenticatedRead === true;
    data.boundary = boundarySnapshots(values);
  } else data = pick(last(value => value.coverageValid !== undefined), ["sampleOnly", "fullCollectionApproved", "allowDerived", "coverageValid", "schemaValid", "canonicalHashValid", "sourceCountsVerified", "administrativeClassIdentityVerified", "duplicateCount", "crossSourceMismatchCount", "reviewedEventCount", "manualMismatchCount", "countDropFraction", "formalStagingUnchanged", "activePointerUnchanged", "runId", "canonicalHash"]);
  if (stage === "installation") {
    data = pick(data, ["installedRevision", "expectedRevision", "heartbeatGate", "collector", "personalAgent", "execute", "timer", "timerActive", "schoolRequests"]);
    if (raw.includes("HEARTBEAT_GATE_FAILED")) data.heartbeatGate = false;
  }
  if (failure.code && /^[A-Z0-9_]{1,80}$/.test(failure.code)) data.failureCode = failure.code;
  return data;
}
function result(stage, status, code, evidence = {}) { return { stage, status, code, evidence }; }
function evaluate(stage, evidence, context = {}) {
  if (!STAGES.includes(stage)) fail("ACCEPTANCE_STAGE_REJECTED");
  safeObject(evidence);
  if (context.source !== SOURCE[stage] || context.liveAttested !== true) return result(stage, "BLOCKED", "REAL_RUNTIME_EVIDENCE_REQUIRED", evidence);
  const blocked = code => result(stage, "BLOCKED", code, evidence);
  const failed = code => result(stage, "FAIL", code, evidence);
  const pass = () => result(stage, "PASS", "VERIFIED_WITH_LIVE_EVIDENCE", evidence);
  if (evidence.failureCode) {
    const knownBlock = /REVIEW_REQUIRED|NOT_AUTHORIZED|API_UNAVAILABLE|SESSION_EXPIRED|COOLDOWN|DAILY_LIMIT|MANUAL_ACTION_REQUIRED|SECURITY_CHALLENGE|COLLECTOR_LOCKED|COLLECTOR_STOPPED/.test(evidence.failureCode) || evidence.failureCode === "SCHOOL_PUBLIC_AUDIT_FAILED";
    return (knownBlock ? blocked : failed)(evidence.failureCode);
  }
  if (!Object.keys(evidence).length) return blocked("EVIDENCE_MISSING");
  if (stage === "installation") {
    if (!revision(evidence.installedRevision) || !revision(evidence.expectedRevision)) return blocked("INSTALL_REVISION_EVIDENCE_REQUIRED");
    if (evidence.installedRevision !== evidence.expectedRevision) return failed("INSTALL_REVISION_MISMATCH");
    if (evidence.heartbeatGate !== true) return failed("HEARTBEAT_ONLY_GATE_NOT_PASSED");
    if (evidence.collector !== "active" || evidence.personalAgent !== "active" || evidence.execute !== 0 || evidence.timer !== "disabled" || evidence.timerActive !== "inactive" || evidence.schoolRequests !== 0) return failed("INSTALL_SERVICE_BOUNDARY_MISMATCH");
    return pass();
  }
  if (stage === "public-cas") {
    if (evidence.passwordSubmissions !== 0 || evidence.authHistoryChanged !== false) return failed("PUBLIC_PAGE_AUTH_STATE_CHANGED");
    if (evidence.networkCompatibility === "REVIEW_REQUIRED") return blocked("CAS_PUBLIC_POST_PURPOSE_REVIEW_REQUIRED");
    if (evidence.formReady !== true) return failed("CAS_FORM_NOT_READY");
    if (evidence.securityChallenge === true) return blocked("SCHOOL_SECURITY_CHALLENGE");
    const compatible = evidence.networkCompatibility === "COMPATIBLE" && evidence.backgroundPostsBlocked === 0 || evidence.networkCompatibility === "COMPATIBLE_WITH_NONCRITICAL_BLOCKS" && integer(evidence.noncriticalPostsBlocked) && evidence.noncriticalPostsBlocked > 0 && evidence.noncriticalPostsBlocked === evidence.backgroundPostsBlocked;
    if (!compatible || evidence.loginReady !== true || evidence.requiredInitializationComplete !== true) return blocked("CAS_REQUIRED_INITIALIZATION_UNVERIFIED");
    return pass();
  }
  if (stage === "session") {
    if (evidence.status === "SESSION_REUSED" || evidence.status === "SESSION_VALID") return blocked("ONE_LOGIN_AND_SAVE_EVIDENCE_REQUIRED");
    if (evidence.status !== "SESSION_SAVED") return blocked("SESSION_NOT_SAVED");
    if (evidence.passwordPersisted !== false || evidence.schoolLoginAttempts !== 1 || evidence.sessionChanged !== true) return failed("SINGLE_LOGIN_SESSION_BOUNDARY_MISMATCH");
    // The save proves the original single login, not the Session's validity now.
    const validity = evidence.validity;
    if (validity?.status === "BLOCKED" && /^(?:SCHOOL_[A-Z_]+|COLLECTOR_STOPPED)$/.test(validity.code || "")) return blocked(validity.code);
    if (validity?.status === "SESSION_EXPIRED") return blocked("SCHOOL_SESSION_EXPIRED");
    if (!validity || validity.schema !== "collector-session-validity.v1" || validity.status !== "SESSION_VALID" || validity.checkMethod !== "protected-page") return blocked("CURRENT_PROTECTED_SESSION_CHECK_REQUIRED");
    if (validity.source !== SOURCE.session || validity.liveAttested !== true) return blocked("REAL_RUNTIME_EVIDENCE_REQUIRED");
    if (!revision(validity.installedRevision) || validity.installedRevision !== context.candidateRevision) return blocked("SESSION_CHECK_CANDIDATE_REVISION_MISMATCH");
    if (validity.schoolLoginAttempts !== 0 || validity.sessionChanged !== false || validity.credentialsRead !== false || validity.authHistoryChanged !== false) return failed("SESSION_CHECK_AUTH_BOUNDARY_MISMATCH");
    const checkedAt = Date.parse(validity.checkedAt), nowMs = context.nowMs === undefined ? Date.now() : context.nowMs;
    if (!Number.isFinite(checkedAt) || !Number.isFinite(nowMs) || checkedAt > nowMs + 30000 || nowMs - checkedAt > SESSION_VALIDITY_MAX_AGE_MS) return blocked("CURRENT_SESSION_CHECK_EXPIRED");
    return pass();
  }
  if (stage === "oracle-sample") {
    if (evidence.protocol !== "collector-manual.v1" || evidence.ready !== true) return blocked("ORACLE_SAMPLE_API_NOT_READY");
    if (evidence.authenticatedRead !== true) return blocked("SIGNED_ORACLE_READ_EVIDENCE_REQUIRED");
    if (evidence.sampleOnly !== true || evidence.publishable !== false || evidence.coverageValid !== false || evidence.entityLimit !== 1 || evidence.maxRequestBudget !== 120 || evidence.leaseTtlMs !== 120000 || evidence.approvalTtlMs !== 1800000 || JSON.stringify(evidence.sampleKinds) !== JSON.stringify(["class", "four"])) return failed("ORACLE_SAMPLE_CONTRACT_MISMATCH");
    return pass();
  }
  if (["class-sample", "four-sample"].includes(stage)) {
    const local = evidence.local || {}, oracle = evidence.oracle || {}, kind = stage === "class-sample" ? "class" : "four";
    if (!runId(local.runId) || !local.uploadId || !hash(local.canonicalHash) || !oracle.runId) return blocked("LOCAL_AND_ORACLE_SAMPLE_RECEIPTS_REQUIRED");
    if (oracle.authenticatedRead !== true || oracle.ownershipConfirmed !== true) return blocked("SIGNED_ORACLE_REVIEW_REQUIRED");
    if (["runId", "uploadId", "canonicalHash", "sampleKind", "schoolRequestCount"].some(key => local[key] !== oracle[key]) || local.sampleKind !== kind) return failed("SAMPLE_ORACLE_RECEIPT_MISMATCH");
    if (local.mode !== "sample" || local.result !== "PENDING SAMPLE REVIEW" || oracle.result !== "PENDING SAMPLE REVIEW" || local.published !== false || oracle.sampleOnly !== true || oracle.publishable !== false || oracle.coverageValid !== false || oracle.stagingState !== "sample-review" || oracle.releaseState !== "not-built" || oracle.runtimeState !== "inactive") return failed("SAMPLE_PUBLICATION_BOUNDARY_MISMATCH");
    const before = evidence.boundary && evidence.boundary.before, after = evidence.boundary && evidence.boundary.after;
    if (!before || !after || [before, after].some(value => value.status !== "PASS" || !revision(value.oracleRevision) || !hash(value.activeSha256) || !hash(value.protectedStateSha256) || !hash(value.envSha256) || value.formalStagingObserved !== true || !(value.formalStagingSha256 === null || hash(value.formalStagingSha256)) || value.schoolRequests !== 0 || value.configurationChanged !== false)) return blocked("FORMAL_STATE_BEFORE_AFTER_EVIDENCE_REQUIRED");
    if (["oracleRevision", "activeSha256", "formalStagingSha256", "protectedStateSha256", "envSha256"].some(key => before[key] !== after[key])) return failed("SAMPLE_FORMAL_STATE_CHANGED");
    if (!integer(oracle.requestBudget) || oracle.requestBudget < 1 || oracle.requestBudget > 120 || !integer(local.schoolRequestCount) || local.schoolRequestCount < 1 || local.schoolRequestCount > oracle.requestBudget) return failed("SAMPLE_REQUEST_BUDGET_MISMATCH");
    const kinds = kind === "class" ? ["class"] : ["class", "teacher", "classroom", "course"];
    if (JSON.stringify(local.directSourceSummary) !== JSON.stringify(oracle.directSourceSummary)) return failed("DIRECT_SOURCE_SUMMARY_MISMATCH");
    if (Object.keys(local.directSourceSummary || {}).some(key => !kinds.includes(key))) return failed("SAMPLE_SCOPE_EXCEEDED");
    for (const source of kinds) {
      const stat = local.directSourceSummary && local.directSourceSummary[source];
      if (!stat || ["discoveredEntities", "requestedEntities", "requestCount", "success", "empty", "failed", "parserErrors", "scheduleDocuments", "courseEvents"].some(key => !integer(stat[key])) || stat.sourceMode !== "network-direct" || stat.discoveredEntities !== 1 || stat.requestedEntities !== 1 || stat.requestCount !== 1 || stat.success + stat.empty !== 1 || stat.failed !== 0 || stat.parserErrors !== 0 || stat.scheduleDocuments < 1 || stat.scheduleDocuments > (source === "class" ? 500 : 1)) return failed("SAMPLE_DIRECT_SOURCE_INVALID");
    }
    return pass();
  }
  if (evidence.sampleOnly === true) return blocked("SAMPLE_CANNOT_ESTABLISH_FULL_COVERAGE");
  if (evidence.fullCollectionApproved !== true) return blocked("SEPARATE_FULL_COLLECTION_APPROVAL_REQUIRED");
  if (evidence.allowDerived !== false || evidence.coverageValid !== true || evidence.schemaValid !== true || evidence.canonicalHashValid !== true || evidence.sourceCountsVerified !== true || evidence.administrativeClassIdentityVerified !== true) return blocked("FULL_STAGING_ACCURACY_COVERAGE_EVIDENCE_REQUIRED");
  if (evidence.duplicateCount !== 0 || evidence.crossSourceMismatchCount !== 0 || evidence.manualMismatchCount !== 0) return failed("STAGING_DATA_MISMATCH");
  if (!integer(evidence.reviewedEventCount) || evidence.reviewedEventCount < 1) return blocked("REAL_SCHOOL_MANUAL_COMPARISON_REQUIRED");
  if (!Number.isFinite(evidence.countDropFraction) || evidence.countDropFraction < 0) return blocked("PRIOR_COUNTS_COMPARISON_REQUIRED");
  if (evidence.countDropFraction > 0.1) return blocked("COUNT_DROP_REQUIRES_REVIEW");
  if (evidence.formalStagingUnchanged !== true || evidence.activePointerUnchanged !== true) return failed("UNAPPROVED_FORMAL_STATE_CHANGE");
  return pass();
}
function receipt(stage, data, context) {
  return { schema:"collector-closure-acceptance.v1", recordedAt:new Date().toISOString(), candidateRevision:context.candidateRevision, source:context.source, liveAttested:context.liveAttested === true, evidenceSha256:context.evidenceSha256, ...evaluate(stage, data, context) };
}
function report(receipts) {
  const requirements = { installation:[], "public-cas":["installation"], session:["installation", "public-cas"], "oracle-sample":[], "class-sample":["installation", "session", "oracle-sample"], "four-sample":["class-sample"], staging:["four-sample"] };
  const stages = [];
  for (const stage of STAGES) {
    const item = receipts.find(value => value.stage === stage);
    let check = item ? evaluate(stage, item.evidence || {}, item) : result(stage, "BLOCKED", "EVIDENCE_MISSING");
    if (item && (item.schema !== "collector-closure-acceptance.v1" || !revision(item.candidateRevision) || !hash(item.evidenceSha256) || !Number.isFinite(Date.parse(item.recordedAt)))) check = result(stage, "BLOCKED", "RECEIPT_PROVENANCE_REQUIRED");
    if (check.status === "PASS") {
      const unmet = requirements[stage].find(prior => stages.find(value => value.stage === prior).status !== "PASS");
      if (unmet) check = result(stage, "BLOCKED", "PREREQUISITE_" + unmet.toUpperCase().replace(/-/g, "_") + "_NOT_PASSED");
      else {
        const sameHost = requirements[stage].filter(prior => !["oracle-sample"].includes(prior));
        if (sameHost.some(prior => receipts.find(value => value.stage === prior).candidateRevision !== item.candidateRevision)) check = result(stage, "BLOCKED", "WYZ_CANDIDATE_REVISION_MISMATCH");
        if (["class-sample", "four-sample"].includes(stage) && item.evidence?.boundary?.before?.oracleRevision !== receipts.find(value => value.stage === "oracle-sample")?.candidateRevision) check = result(stage, "BLOCKED", "ORACLE_CANDIDATE_REVISION_MISMATCH");
      }
    }
    stages.push({ stage, status:check.status, code:check.code, ...(check.status === "PASS" && VERIFIED_STATES[stage] ? { verifiedState:VERIFIED_STATES[stage] } : {}) });
  }
  const validationStatus = stages.some(value => value.status === "FAIL") ? "FAIL" : stages.some(value => value.status === "BLOCKED") ? "BLOCKED" : "PASS";
  // Technical readiness cannot approve publication. The complete workflow stays
  // blocked until a separately authorised release is verified by future tooling.
  const status = validationStatus === "FAIL" ? "FAIL" : "BLOCKED";
  const publication = { state:"PUBLICATION_NOT_APPROVED", status:"BLOCKED", code:"SEPARATE_PUBLICATION_APPROVAL_REQUIRED", approved:false, published:false };
  return { schema:"collector-closure-report.v1", status, validationStatus, stages, verifiedStates:stages.flatMap(value => value.verifiedState ? [value.verifiedState] : []), publication, sessionValidityMaxAgeMs:SESSION_VALIDITY_MAX_AGE_MS, realRuntimeVerification:"Receipts require live PAM evidence; operator attestation is not independent cryptographic proof. Session validity expires after 15 minutes; it is not proof of future validity.", schoolRequests:0, productionWrites:0 };
}
function rootRequired() { if (process.platform !== "linux" || process.getuid() !== 0) fail("LINUX_ROOT_REQUIRED"); }
function collectInstallation(expectedRevision, deps = {}) {
  if (!revision(expectedRevision)) fail("ACCEPTANCE_REVISION_REQUIRED");
  const resolved = (deps.realpath || fs.realpathSync)("/opt/fosuclass/schedule-collector/current");
  if (!/^\/opt\/fosuclass\/schedule-collector\/releases\/[a-f0-9]{40}$/.test(resolved)) fail("ACCEPTANCE_INSTALL_PATH_REJECTED");
  const exec = deps.exec || execFileSync;
  let gate;
  try { gate = exec("python3", [path.join(resolved, "deploy/wyz/check-heartbeat-service.py"), "--state", "active", "--health"], { encoding:"utf8", timeout:20000, stdio:["ignore", "pipe", "pipe"] }); }
  catch (error) {
    const match = String(error.stderr || "").trim().match(/^HEARTBEAT_GATE_FAILED gate=([A-Z_]{1,50})$/);
    fail(match ? "ACCEPTANCE_HEARTBEAT_" + match[1] : "ACCEPTANCE_HEARTBEAT_GATE_FAILED");
  }
  if (!/^HEARTBEAT_GATE_PASS state=active execute=0 runner=heartbeat-only personal=independent timer=disabled\/inactive health=local-stable-5s\s*$/.test(gate)) fail("ACCEPTANCE_HEARTBEAT_GATE_REJECTED");
  return { installedRevision:path.basename(resolved), expectedRevision, heartbeatGate:true, collector:"active", personalAgent:"active", execute:0, timer:"disabled", timerActive:"inactive", schoolRequests:0 };
}
async function oracleRead(stage, selectedRunId, deps = {}) {
  if (!["oracle-sample", "class-sample", "four-sample"].includes(stage) || stage !== "oracle-sample" && !runId(selectedRunId)) fail("ACCEPTANCE_ORACLE_SCOPE_REJECTED");
  let close = () => {};
  try {
    let request = deps.request;
    if (!request) {
      const collector = require("./collector"), env = require("./credentials").readEnvFile("/etc/fosuclass/full-sync.env"), cfg = collector.config(env);
      const fetcher = cfg.transport.mode === "cloudflare-default" ? fetch : require("./oracleTransport").createFetcher(cfg.transport);
      close = () => { if (fetcher.close) fetcher.close(); };
      request = collector.client(cfg, fetcher, { timeoutMs:15000 });
    }
    const endpoint = stage === "oracle-sample" ? "/api/full-sync/v1/sample/readiness" : "/api/full-sync/v1/runs/" + selectedRunId + "/sample-review";
    const data = await request("GET", endpoint);
    safeObject(data);
    if (!data || data.protocol !== "collector-manual.v1") fail("ACCEPTANCE_ORACLE_PROTOCOL_MISMATCH");
    return { ...data, authenticatedRead:true };
  } finally { close(); }
}
async function collectSessionValidity(deps = {}) {
  if (deps.approved !== true) fail("ACCEPTANCE_SCHOOL_READ_NOT_AUTHORIZED");
  const resolved = (deps.realpath || fs.realpathSync)("/opt/fosuclass/schedule-collector/current");
  if (!/^\/opt\/fosuclass\/schedule-collector\/releases\/[a-f0-9]{40}$/.test(resolved)) fail("ACCEPTANCE_INSTALL_PATH_REJECTED");
  const auth = deps.auth || require("./schoolSession");
  const cfg = { dataRoot:"/var/lib/fosuclass/schedule-collector", sessionPath:"/var/lib/fosuclass/schedule-collector/session.json", loginProfile:"mobile", ...(deps.cfg || {}) };
  // Hashes are used only for equality, never emitted. Authentication history and
  // the existing Session are not rewritten to make a new receipt look valid.
  const snapshot = deps.snapshot || (() => ["school-auth-state.json", "session.json"].map(name => {
    const file = path.join(cfg.dataRoot, name);
    if (!fs.existsSync(file)) return null;
    auth.secureFile(file);
    return sha256(fs.readFileSync(file));
  }));
  const before = snapshot();
  const checked = await auth.checkSession(cfg, { ...(deps.authDeps || {}), approved:true, ...(deps.signal ? { signal:deps.signal } : {}) });
  const after = snapshot();
  if (stable(before) !== stable(after) || checked.schoolLoginAttempts !== 0 || checked.sessionChanged !== false) fail("ACCEPTANCE_SESSION_CHECK_AUTH_STATE_CHANGED");
  if (!["SESSION_VALID", "SESSION_EXPIRED"].includes(checked.status)) fail("ACCEPTANCE_SESSION_CHECK_REJECTED");
  return { schema:"collector-session-validity.v1", status:checked.status, source:SOURCE.session, liveAttested:true, checkedAt:new Date(deps.nowMs === undefined ? Date.now() : deps.nowMs).toISOString(), installedRevision:path.basename(resolved), checkMethod:"protected-page", schoolLoginAttempts:0, sessionChanged:false, credentialsRead:false, authHistoryChanged:false };
}
function parse(args) {
  const command = args[0], values = {};
  if (!["record", "report", "installation", "session-check", "oracle-readiness", "oracle-review"].includes(command)) fail("ACCEPTANCE_COMMAND_REJECTED");
  for (const arg of args.slice(1)) {
    if (["--attest-live", "--approve-oracle-read", "--approve-school-read"].includes(arg)) { if (values[arg]) fail("ACCEPTANCE_ARGUMENT_REJECTED"); values[arg] = true; continue; }
    const match = arg.match(/^--(stage|input|output|directory|candidate-revision|source|run-id|oracle-review|session-check|before|after)=(.+)$/);
    if (!match || values[match[1]]) fail("ACCEPTANCE_ARGUMENT_REJECTED");
    values[match[1]] = match[2];
  }
  const allowed = { record:["stage", "input", "output", "candidate-revision", "source", "--attest-live", "oracle-review", "session-check", "before", "after"], report:["directory", "session-check"], installation:["output", "candidate-revision"], "session-check":["output", "--approve-school-read"], "oracle-readiness":["output", "--approve-oracle-read"], "oracle-review":["output", "run-id", "--approve-oracle-read"] }[command];
  if (Object.keys(values).some(key => !allowed.includes(key))) fail("ACCEPTANCE_ARGUMENT_REJECTED");
  return { command, values };
}
async function main(args = process.argv.slice(2)) {
  const { command, values } = parse(args);
  if (command === "report") {
    if (!values.directory) fail("ACCEPTANCE_DIRECTORY_REQUIRED");
    privatePath(values.directory, true);
    const receipts = STAGES.map(stage => path.join(values.directory, stage + ".receipt.json")).filter(file => fs.existsSync(file)).map(file => JSON.parse(read(file)));
    let sessionCheckSha256;
    if (values["session-check"]) {
      const raw = read(values["session-check"]), validity = normalize("session", parseInput(raw)).validity;
      if (!validity) fail("ACCEPTANCE_SESSION_CHECK_REQUIRED");
      sessionCheckSha256 = sha256(raw);
      const index = receipts.findIndex(value => value.stage === "session");
      if (index >= 0) receipts[index] = { ...receipts[index], evidence:{ ...receipts[index].evidence, validity }, evidenceSha256:sha256(stable({ originalEvidenceSha256:receipts[index].evidenceSha256, sessionCheckSha256 })) };
    }
    return { ...report(receipts), ...(sessionCheckSha256 ? { sessionCheckSha256 } : {}) };
  }
  if (!values.output) fail("ACCEPTANCE_OUTPUT_REQUIRED");
  if (command === "session-check") {
    if (!values["--approve-school-read"]) fail("ACCEPTANCE_SCHOOL_READ_NOT_AUTHORIZED");
    rootRequired();
    privatePath(path.dirname(values.output), true);
    if (fs.existsSync(values.output)) fail("ACCEPTANCE_OUTPUT_EXISTS");
    let output;
    const control = new AbortController(), stop = () => control.abort();
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    const timeout = setTimeout(stop, 45000);
    try { output = await collectSessionValidity({ approved:true, signal:control.signal }); }
    catch (error) {
      if (!/^(?:SCHOOL_[A-Z_]+|COLLECTOR_STOPPED)$/.test(error.code || "")) throw error;
      output = { schema:"collector-session-validity.v1", status:"BLOCKED", code:error.code, checkedAt:new Date().toISOString() };
    }
    finally { clearTimeout(timeout); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    write(values.output, output);
    return { status:output.status === "SESSION_VALID" ? "READ_COMPLETED" : "BLOCKED", code:output.code || (output.status === "SESSION_VALID" ? "PROTECTED_SESSION_VALID" : "SCHOOL_SESSION_EXPIRED"), schoolLoginAttempts:0, productionWrites:0 };
  }
  if (command === "installation") {
    rootRequired();
    if (!revision(values["candidate-revision"])) fail("ACCEPTANCE_REVISION_REQUIRED");
    let data;
    try { data = collectInstallation(values["candidate-revision"]); }
    catch (error) { data = { expectedRevision:values["candidate-revision"], failureCode:/^ACCEPTANCE_[A-Z_]{1,65}$/.test(error.code || "") ? error.code : "ACCEPTANCE_INSTALL_OBSERVATION_FAILED" }; }
    const output = receipt("installation", data, { source:SOURCE.installation, liveAttested:true, candidateRevision:values["candidate-revision"], evidenceSha256:sha256(JSON.stringify(data)) });
    write(values.output, output); return pick(output, ["stage", "status", "code"]);
  }
  if (command === "oracle-readiness" || command === "oracle-review") {
    if (!values["--approve-oracle-read"]) fail("ACCEPTANCE_ORACLE_READ_NOT_AUTHORIZED");
    rootRequired();
    const data = await oracleRead(command === "oracle-readiness" ? "oracle-sample" : "class-sample", values["run-id"]);
    // Save only the endpoint's known summary; never arbitrary server fields.
    const output = command === "oracle-readiness" ? normalize("oracle-sample", [data]) : { protocol:data.protocol, authenticatedRead:true, review:pick(data.review, ["runId", "uploadId", "canonicalHash", "sampleKind", "term", "schoolRequestCount", "requestBudget", "result", "sampleOnly", "publishable", "coverageValid", "stagingState", "releaseState", "runtimeState", "formalStagingUnchanged", "activePointerUnchanged", "ownershipConfirmed", "directSourceSummary"]) };
    write(values.output, output); return { status:"READ_COMPLETED", schoolRequests:0, productionWrites:0 };
  }
  const stage = values.stage;
  if (!STAGES.includes(stage) || !values.input || !revision(values["candidate-revision"])) fail("ACCEPTANCE_ARGUMENT_REJECTED");
  if (!["class-sample", "four-sample"].includes(stage) && ["oracle-review", "before", "after"].some(key => values[key])) fail("ACCEPTANCE_ARGUMENT_REJECTED");
  if (stage !== "session" && values["session-check"]) fail("ACCEPTANCE_ARGUMENT_REJECTED");
  const raw = [values.input, values["oracle-review"], values["session-check"], values.before, values.after].filter(Boolean).map(read);
  const data = normalize(stage, raw.flatMap(parseInput), raw.join("\n"));
  const output = receipt(stage, data, { source:values.source, liveAttested:values["--attest-live"] === true, candidateRevision:values["candidate-revision"], evidenceSha256:sha256(stable(raw)) });
  write(values.output, output); return pick(output, ["stage", "status", "code"]);
}
if (require.main === module) main().then(value => { console.log(JSON.stringify(value, null, 2)); if (["BLOCKED", "FAIL"].includes(value.status)) process.exitCode = value.status === "BLOCKED" ? 2 : 1; }).catch(error => { console.error(JSON.stringify({ status:"FAIL", code:/^ACCEPTANCE_[A-Z_]+$/.test(error.code || "") || error.code === "LINUX_ROOT_REQUIRED" ? error.code : "ACCEPTANCE_OPERATION_FAILED" })); process.exitCode = 1; });
module.exports = { STAGES, SOURCE, VERIFIED_STATES, SESSION_VALIDITY_MAX_AGE_MS, evaluate, normalize, parseInput, parse, receipt, report, collectInstallation, collectSessionValidity, oracleRead, main };

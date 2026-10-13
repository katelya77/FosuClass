"use strict";
const WYZ_REVISION = "0af13014d4e937e3395a2e7d35ac2b32b3d7deff";
const ORACLE_REVISION = "7ad3b2708ce553e6fff099fd881a4b9c86ebea39";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const runId = value => /^sc-[A-Za-z0-9-]{1,100}$/.test(value || "");
const hash = value => /^[a-f0-9]{64}$/.test(value || "");
function validateApproval(value, now = Date.now()) {
  const keys = ["schema", "runId", "kind", "term", "requestBudget", "entityLimit", "allowOneLogin", "approvedAt", "expiresAt", "wyzRevision", "oracleRevision", "oraclePreflightSha256", "classRunId", "classCanonicalHash"];
  if (!value || Object.keys(value).some(key => !keys.includes(key)) || value.schema !== "collector-school-window.v1" || !runId(value.runId) || !["class", "four"].includes(value.kind) || !/^\d{4}-\d{4}-[12]$/.test(value.term || "") || !Number.isInteger(value.requestBudget) || value.requestBudget < 1 || value.requestBudget > 120 || value.entityLimit !== 1 || typeof value.allowOneLogin !== "boolean" || value.wyzRevision !== WYZ_REVISION || value.oracleRevision !== ORACLE_REVISION || !hash(value.oraclePreflightSha256)) fail("CLOSURE_APPROVAL_INVALID");
  const approved = Date.parse(value.approvedAt), expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(approved) || !Number.isFinite(expires) || approved > now + 60000 || expires <= now || expires - approved > 1800000 || expires <= approved) fail("CLOSURE_APPROVAL_EXPIRED");
  if (value.kind === "four" && (value.allowOneLogin || !runId(value.classRunId) || !hash(value.classCanonicalHash) || value.classRunId === value.runId)) fail("CLOSURE_CLASS_REVIEW_REQUIRED");
  if (value.kind === "class" && (value.classRunId !== undefined || value.classCanonicalHash !== undefined)) fail("CLOSURE_APPROVAL_INVALID");
  return value;
}
function validateOracleEvidence(evidence, now = Date.now()) {
  if (!evidence || evidence.schema !== "oracle-sample-preflight.v1" || evidence.status !== "PASS" || evidence.liveBaseSha !== ORACLE_REVISION || evidence.personalBrokerReady !== true || evidence.schoolRequests !== 0 || evidence.configurationChanged !== false || !Number.isFinite(Date.parse(evidence.at)) || Date.parse(evidence.at) > now + 60000 || now - Date.parse(evidence.at) > 1800000) fail("CLOSURE_ORACLE_LIVE_EVIDENCE_REQUIRED");
}
function validateReadiness(value) {
  if (!value || value.protocol !== "collector-manual.v1" || value.ready !== true || value.sampleOnly !== true || value.publishable !== false || value.coverageValid !== false || value.entityLimit !== 1 || value.maxRequestBudget !== 120 || value.leaseTtlMs !== 120000 || value.approvalTtlMs !== 1800000 || JSON.stringify(value.sampleKinds) !== JSON.stringify(["class", "four"])) fail("CLOSURE_ORACLE_SAMPLE_NOT_READY");
}
function validateQueued(value, approval, now = Date.now()) {
  if (value?.protocol !== "collector-manual.v1" || value.status?.enabled !== true || value.status.stopForDay || value.status.sessionExpired) fail("CLOSURE_ORACLE_ACCESS_STOPPED");
  const run = value.status.current;
  if (!run || run.id !== approval.runId || run.mode !== "sample" || run.stage !== "idle" || run.finishedAt || run.term !== approval.term || run.samplePolicy?.kind !== approval.kind || run.samplePolicy?.entityLimit !== 1 || run.samplePolicy?.requestBudget !== approval.requestBudget || run.sampleOnly !== true || run.publishable !== false || run.coverageValid !== false || !Number.isFinite(Date.parse(run.approvalExpiresAt)) || Date.parse(run.approvalExpiresAt) < Date.parse(approval.expiresAt) || Date.parse(run.approvalExpiresAt) <= now) fail("CLOSURE_QUEUED_SCOPE_MISMATCH");
  if (approval.kind === "four") {
    const prior = (value.status.recent || []).find(item => item.id === approval.classRunId);
    if (!prior || prior.mode !== "sample" || prior.samplePolicy?.kind !== "class" || prior.term !== approval.term || prior.result !== "PENDING SAMPLE REVIEW" || prior.canonicalHash !== approval.classCanonicalHash || prior.sampleHumanReview?.decision !== "confirmed" || prior.sampleHumanReview.comparisonAttested !== true || prior.sampleHumanReview.canonicalHash !== approval.classCanonicalHash) fail("CLOSURE_CLASS_REVIEW_REQUIRED");
  }
  return run;
}
function validateResult(local, remote, approval) {
  const review = remote?.review;
  if (remote?.protocol !== "collector-manual.v1" || !review || review.ownershipConfirmed !== true || !hash(local?.canonicalHash) || !/^stg_[A-Za-z0-9_-]+$/.test(local?.uploadId || "") || local.runId !== approval.runId || local.sampleKind !== approval.kind || local.term !== approval.term || local.mode !== "sample" || local.published !== false || local.result !== "PENDING SAMPLE REVIEW" || review.result !== local.result || ["runId", "uploadId", "canonicalHash", "sampleKind", "term", "schoolRequestCount"].some(key => local[key] !== review[key]) || review.requestBudget !== approval.requestBudget || review.sampleOnly !== true || review.publishable !== false || review.coverageValid !== false || review.stagingState !== "sample-review" || review.releaseState !== "not-built" || review.runtimeState !== "inactive" || !Number.isInteger(local.schoolRequestCount) || local.schoolRequestCount < 1 || local.schoolRequestCount > approval.requestBudget) fail("CLOSURE_ORACLE_RECEIPT_MISMATCH");
  // Keep only shared integer metrics: the two runtime revisions have additive summary fields.
  const kinds = approval.kind === "class" ? ["class"] : ["class", "teacher", "classroom", "course"];
  if (Object.keys(local.directSourceSummary || {}).some(kind => !kinds.includes(kind)) || Object.keys(review.directSourceSummary || {}).some(kind => !kinds.includes(kind))) fail("CLOSURE_SAMPLE_SCOPE_EXCEEDED");
  const directSourceSummary = {};
  for (const kind of kinds) {
    const a = local.directSourceSummary?.[kind], b = review.directSourceSummary?.[kind];
    const metrics = ["discoveredEntities", "requestedEntities", "success", "empty", "failed", "parserErrors", "requestCount", "scheduleDocuments", "courseEvents"];
    if (!a || !b || a.sourceMode !== "network-direct" || b.sourceMode !== a.sourceMode || metrics.some(key => !Number.isInteger(a[key]) || a[key] < 0 || a[key] !== b[key]) || a.discoveredEntities !== 1 || a.requestedEntities !== 1 || a.requestCount !== 1 || a.success + a.empty !== 1 || a.failed || a.parserErrors || a.scheduleDocuments < 1 || a.scheduleDocuments > (kind === "class" ? 500 : 1)) fail("CLOSURE_DIRECT_SOURCE_INVALID");
    directSourceSummary[kind] = { sourceMode: "network-direct", ...Object.fromEntries(metrics.map(key => [key, a[key]])) };
  }
  return { schema: "collector-school-result.v1", status: "PENDING_REVIEW", result: "PENDING SAMPLE REVIEW", runId: local.runId, term: local.term, sampleKind: local.sampleKind, uploadId: local.uploadId, canonicalHash: local.canonicalHash, collectionSchoolRequests: local.schoolRequestCount, requestBudget: approval.requestBudget, directSourceSummary, signedOracleReceiptMatched: true, sampleOnly: true, publishable: false, coverageValid: false, rawResponseComparison: "PENDING", crossSourceConsistency: "PENDING", activeReleaseUnchanged: "PENDING_ORACLE_BEFORE_AFTER_CHECK" };
}
async function execute(approval, deps) {
  validateApproval(approval, deps.now?.() || Date.now());
  await deps.localGate("before");
  validateReadiness(await deps.request("GET", "/api/full-sync/v1/sample/readiness"));
  validateQueued(await deps.request("GET", "/api/full-sync/v1/status"), approval, deps.now?.() || Date.now());
  // Durable one-shot reservation precedes any school request. A crash never replays login.
  await deps.reserve();
  let login;
  try {
    if (approval.allowOneLogin) {
      login = await deps.cli(["login", "--login-profile=mobile-wechat", "--credential-source=protected-file", "--approve-school-access"]);
      if (!["SESSION_SAVED", "SESSION_REUSED"].includes(login?.status) || !Number.isInteger(login.schoolLoginAttempts) || login.schoolLoginAttempts < 0 || login.schoolLoginAttempts > 1) fail("CLOSURE_LOGIN_OUTCOME_REJECTED");
    }
    // Recheck the exact task after login; expired/changed approval stops before collection.
    validateApproval(approval, deps.now?.() || Date.now());
    validateReadiness(await deps.request("GET", "/api/full-sync/v1/sample/readiness"));
    validateQueued(await deps.request("GET", "/api/full-sync/v1/status"), approval, deps.now?.() || Date.now());
    const local = await deps.cli(["manual-sync", "--mode=sample", "--sample-kind=" + approval.kind, "--run-id=" + approval.runId, "--login-profile=mobile-wechat", "--approve-school-access"]);
    const result = validateResult(local, await deps.request("GET", "/api/full-sync/v1/runs/" + approval.runId + "/sample-review"), approval);
    result.passwordSubmissions = login?.schoolLoginAttempts || 0;
    result.authenticationSchoolRequests = Number.isInteger(login?.schoolAuthRequests) ? login.schoolAuthRequests : "NOT_COUNTED_BY_EXISTING_CLI";
    result.sessionProbeSchoolRequests = "NOT_COUNTED_BY_EXISTING_CLI";
    return result;
  } finally { await deps.localGate("after"); }
}
module.exports = { WYZ_REVISION, ORACLE_REVISION, validateApproval, validateOracleEvidence, validateReadiness, validateQueued, validateResult, execute };

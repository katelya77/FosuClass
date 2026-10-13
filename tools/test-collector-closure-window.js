"use strict";
const assert = require("node:assert/strict");
const contract = require("../deploy/collector-closure/contract");
const { parsePrepare } = require("../deploy/collector-closure/wyz-sample");
const NOW = Date.parse("2026-10-12T04:00:00.000Z"), HASH = "a".repeat(64);
const approval = (kind = "class") => ({ schema: "collector-school-window.v1", runId: "sc-fixture-current", kind, term: "2026-2027-1", requestBudget: 40, entityLimit: 1, allowOneLogin: kind === "class", approvedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 600000).toISOString(), wyzRevision: contract.WYZ_REVISION, oracleRevision: contract.ORACLE_REVISION, oraclePreflightSha256: HASH, ...(kind === "four" ? { classRunId: "sc-fixture-prior", classCanonicalHash: HASH } : {}) });
const ready = () => ({ protocol: "collector-manual.v1", ready: true, sampleOnly: true, publishable: false, coverageValid: false, entityLimit: 1, maxRequestBudget: 120, leaseTtlMs: 120000, approvalTtlMs: 1800000, sampleKinds: ["class", "four"] });
function queued(a) { return { protocol: "collector-manual.v1", status: { enabled: true, stopForDay: false, sessionExpired: false, current: { id: a.runId, mode: "sample", stage: "idle", term: a.term, samplePolicy: { kind: a.kind, entityLimit: 1, requestBudget: a.requestBudget }, approvalExpiresAt: a.expiresAt, sampleOnly: true, publishable: false, coverageValid: false }, recent: [{ id: "sc-fixture-prior", mode: "sample", samplePolicy: { kind: "class" }, term: a.term, result: "PENDING SAMPLE REVIEW", canonicalHash: HASH, sampleHumanReview: { decision: "confirmed", comparisonAttested: true, canonicalHash: HASH } }] } }; }
function sample(a) {
  const stat = { sourceMode: "network-direct", discoveredEntities: 1, requestedEntities: 1, success: 1, empty: 0, failed: 0, parserErrors: 0, requestCount: 1, scheduleDocuments: 1, courseEvents: 2 };
  const summary = Object.fromEntries((a.kind === "class" ? ["class"] : ["class", "teacher", "classroom", "course"]).map(kind => [kind, { ...stat }]));
  return { runId: a.runId, sampleKind: a.kind, term: a.term, mode: "sample", published: false, result: "PENDING SAMPLE REVIEW", canonicalHash: HASH, uploadId: "stg_fixture", schoolRequestCount: 12, directSourceSummary: summary };
}
const review = (local, a) => ({ protocol: "collector-manual.v1", review: { ...local, ownershipConfirmed: true, requestBudget: a.requestBudget, sampleOnly: true, publishable: false, coverageValid: false, stagingState: "sample-review", releaseState: "not-built", runtimeState: "inactive" } });
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }
function rejectsCode(fn, code) { assert.throws(fn, error => error.code === code); }
test("approval binds immutable revisions and finite sample scope", () => assert.equal(contract.validateApproval(approval(), NOW).kind, "class"));
for (const [field, value] of [["kind", "full"], ["requestBudget", 121], ["entityLimit", 2], ["wyzRevision", "0".repeat(40)], ["oracleRevision", "0".repeat(40)], ["password", "fixture-do-not-log"]]) test("reject approval field " + field, () => rejectsCode(() => contract.validateApproval({ ...approval(), [field]: value }, NOW), "CLOSURE_APPROVAL_INVALID"));
test("expired approval stops", () => rejectsCode(() => contract.validateApproval(approval(), NOW + 600001), "CLOSURE_APPROVAL_EXPIRED"));
test("future and unbounded approval stops", () => rejectsCode(() => contract.validateApproval({ ...approval(), expiresAt: new Date(NOW + 1800001).toISOString() }, NOW), "CLOSURE_APPROVAL_EXPIRED"));
test("four cannot submit password", () => rejectsCode(() => contract.validateApproval({ ...approval("four"), allowOneLogin: true }, NOW), "CLOSURE_CLASS_REVIEW_REQUIRED"));
test("four requires explicit prior class fingerprint", () => rejectsCode(() => contract.validateApproval({ ...approval("four"), classCanonicalHash: null }, NOW), "CLOSURE_CLASS_REVIEW_REQUIRED"));
test("Oracle CI/fixture claim lacks production snapshot", () => rejectsCode(() => contract.validateOracleEvidence({ status: "PASS", liveBaseSha: contract.ORACLE_REVISION }, NOW), "CLOSURE_ORACLE_LIVE_EVIDENCE_REQUIRED"));
test("fresh production preflight accepted", () => contract.validateOracleEvidence({ schema: "oracle-sample-preflight.v1", status: "PASS", liveBaseSha: contract.ORACLE_REVISION, personalBrokerReady: true, schoolRequests: 0, configurationChanged: false, at: new Date(NOW).toISOString() }, NOW));
test("historical production preflight rejected", () => rejectsCode(() => contract.validateOracleEvidence({ schema: "oracle-sample-preflight.v1", status: "PASS", liveBaseSha: contract.ORACLE_REVISION, personalBrokerReady: true, schoolRequests: 0, configurationChanged: false, at: new Date(NOW - 1800001).toISOString() }, NOW), "CLOSURE_ORACLE_LIVE_EVIDENCE_REQUIRED"));
for (const [field, value] of [["ready", false], ["publishable", true], ["leaseTtlMs", 90000], ["entityLimit", 2]]) test("readiness contract " + field, () => rejectsCode(() => contract.validateReadiness({ ...ready(), [field]: value }), "CLOSURE_ORACLE_SAMPLE_NOT_READY"));
for (const [field, value] of [["id", "sc-another"], ["term", "2025-2026-1"], ["mode", "full"], ["stage", "auth-check"], ["publishable", true]]) test("exact queued binding " + field, () => { const a = approval(), q = queued(a); q.status.current[field] = value; rejectsCode(() => contract.validateQueued(q, a, NOW), "CLOSURE_QUEUED_SCOPE_MISMATCH"); });
test("school authentication stop cannot be cleared", () => { const a = approval(), q = queued(a); q.status.sessionExpired = true; rejectsCode(() => contract.validateQueued(q, a, NOW), "CLOSURE_ORACLE_ACCESS_STOPPED"); });
test("four requires persisted human class review", () => { const a = approval("four"), q = queued(a); q.status.recent[0].sampleHumanReview.decision = "pending"; rejectsCode(() => contract.validateQueued(q, a, NOW), "CLOSURE_CLASS_REVIEW_REQUIRED"); });
test("signed local/Oracle fingerprints agree without claiming full coverage", () => { const a = approval(), local = sample(a), result = contract.validateResult(local, review(local, a), a); assert.equal(result.status, "PENDING_REVIEW"); assert.equal(result.coverageValid, false); assert.equal(result.rawResponseComparison, "PENDING"); });
test("unknown additive fields do not obscure core source mismatch", () => { const a = approval(), local = sample(a), r = review(local, a); r.review.directSourceSummary = structuredClone(local.directSourceSummary); r.review.directSourceSummary.class.requestCount = 2; rejectsCode(() => contract.validateResult(local, r, a), "CLOSURE_DIRECT_SOURCE_INVALID"); });
test("extra source cannot be uploaded in class sample", () => { const a = approval(), local = sample(a); local.directSourceSummary.teacher = local.directSourceSummary.class; rejectsCode(() => contract.validateResult(local, review(local, a), a), "CLOSURE_SAMPLE_SCOPE_EXCEEDED"); });
test("mismatched Oracle upload receipt rejected", () => { const a = approval(), local = sample(a), r = review(local, a); r.review.uploadId = "stg_other"; rejectsCode(() => contract.validateResult(local, r, a), "CLOSURE_ORACLE_RECEIPT_MISMATCH"); });
test("CLI refuses omitted explicit school window approval", () => rejectsCode(() => parsePrepare(["--kind=class", "--oracle-preflight=/root/fixture.json"]), "CLOSURE_EXPLICIT_APPROVAL_REQUIRED"));
test("CLI rejects arbitrary credential arguments", () => rejectsCode(() => parsePrepare(["--approve-school-window", "--oracle-preflight=/root/fixture.json", "--password=fixture"]), "CLOSURE_ARGUMENT_REJECTED"));
async function flowTest(name, patch = {}, expected) {
  const a = approval(), calls = [];
  const deps = { now: () => NOW, localGate: async stage => calls.push("gate:" + stage), request: async (method, route) => { calls.push(route); if (route.endsWith("readiness")) return ready(); if (route.endsWith("status")) return queued(a); return review(sample(a), a); }, reserve: async () => calls.push("reserve"), cli: async args => { calls.push(args[0]); return args[0] === "login" ? { status: "SESSION_SAVED", schoolLoginAttempts: 1, schoolAuthRequests: 6 } : sample(a); }, ...patch };
  if (expected) await assert.rejects(contract.execute(a, deps), error => error.code === expected);
  else { const result = await contract.execute(a, deps); assert.equal(result.passwordSubmissions, 1); assert.equal(result.collectionSchoolRequests, 12); assert.equal(result.sessionProbeSchoolRequests, "NOT_COUNTED_BY_EXISTING_CLI"); }
  passed++; console.log("PASS " + name); return calls;
}
(async () => {
  const success = await flowTest("one login then one exact sample, after both Oracle gates");
  assert.equal(success.filter(call => call === "login").length, 1); assert(success.indexOf("reserve") < success.indexOf("login")); assert.equal(success.at(-1), "gate:after");
  let logins = 0;
  const stopped = await flowTest("failed authentication has zero retries and no collection", { cli: async () => { logins++; throw Object.assign(new Error("fixture"), { code: "SCHOOL_SECURITY_CHALLENGE" }); } }, "SCHOOL_SECURITY_CHALLENGE");
  assert.equal(logins, 1); assert.equal(stopped.at(-1), "gate:after");
  let schoolCalls = 0;
  await flowTest("unavailable Oracle stops before reservation or school", { request: async () => ({ ...ready(), ready: false }), reserve: async () => { schoolCalls++; }, cli: async () => { schoolCalls++; } }, "CLOSURE_ORACLE_SAMPLE_NOT_READY");
  assert.equal(schoolCalls, 0);
  await flowTest("durable prior reservation blocks all password replay", { reserve: async () => { throw Object.assign(new Error("fixture"), { code: "CLOSURE_PREVIOUS_ATTEMPT_REVIEW_REQUIRED" }); }, cli: async () => { schoolCalls++; } }, "CLOSURE_PREVIOUS_ATTEMPT_REVIEW_REQUIRED");
  assert.equal(schoolCalls, 0);
  let current = NOW, commands = [];
  await flowTest("expired approval after login cannot collect", { now: () => current, cli: async args => { commands.push(args[0]); current = NOW + 600001; return { status: "SESSION_SAVED", schoolLoginAttempts: 1 }; } }, "CLOSURE_APPROVAL_EXPIRED");
  assert.deepEqual(commands, ["login"]);
  console.log("COLLECTOR_CLOSURE_WINDOW_TESTS=" + passed + " fixtureOnly=true schoolRequests=0 productionWrites=0");
})().catch(error => { console.error(error); process.exitCode = 1; });

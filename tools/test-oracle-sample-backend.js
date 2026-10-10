"use strict";
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto"), zlib = require("zlib");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-oracle-sample-"));
process.env.FOSU_STORAGE_DIR = path.join(root, "storage");
process.env.FOSU_DATA_DIR = path.join(root, "data");
process.env.SCHEDULE_COLLECTOR_DIR = path.join(root, "control");
process.env.FULL_SYNC_AGENT_TOKEN = crypto.randomBytes(32).toString("hex");
process.env.FULL_SYNC_SIGNING_SECRET = crypto.randomBytes(32).toString("hex");
process.env.FULL_SYNC_AGENT_ID = "wyz-schedule-collector";
process.env.ADMIN_TOKEN = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_API_TOKEN = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_SERVICE_TOKENS = JSON.stringify([{ name: "read-only-fixture", token: "fixture-read-token-01234567890123456789", scopes: ["static:verify"] }]);
delete process.env.FOSU_COLLECTOR_TIMER_VERIFIED;
const contract = require("../server/src/shared/sampleCollectionContract");
const control = require("../server/src/services/scheduleCollectorService");
const uploads = require("../server/src/services/stagingUploadService");
const signatures = require("../server/src/security/fullSyncSignature");
const fingerprint = require("../server/src/utils/stagingFingerprint").calculateFingerprint;
const express = require("../server/node_modules/express");
const term = "2026-2027-1", agent = process.env.FULL_SYNC_AGENT_ID;
let server, origin;
function sample(kind = "four") {
  const data = require("./fixtures/four-direct-source")();
  data.meta.sampleOnly = true; data.meta.sampleKind = kind; data.meta.requireFourDirectSources = false;
  data.meta.actualNetworkRequestCount = kind === "four" ? 12 : 5;
  for (const source of Object.values(data.directSourceSummary)) source.requestCount = 1;
  if (kind === "class") {
    data.resources = {}; data.meta.includeScopes = ["classSchedules"];
    for (const k of ["teacher", "classroom", "course"]) { delete data.directSourceSummary[k]; delete data.scopeSources[k + "Schedules"]; }
  }
  data.canonicalHash = fingerprint(data).canonicalHash;
  return data;
}
function signedInput(method, pathname, value, binary = false) {
  const body = binary ? value : Buffer.from(JSON.stringify(value || {}));
  const timestamp = String(Date.now()), nonce = crypto.randomBytes(18).toString("hex");
  return { method, headers: {
    authorization: "Bearer " + process.env.FULL_SYNC_AGENT_TOKEN,
    "content-type": binary ? "application/octet-stream" : "application/json",
    "x-full-sync-agent-id": agent, "x-full-sync-timestamp": timestamp, "x-full-sync-nonce": nonce,
    "x-full-sync-signature": signatures.signRequest(process.env.FULL_SYNC_SIGNING_SECRET, { method, path: pathname, timestamp, nonce, body: method === "GET" ? Buffer.alloc(0) : body }),
  }, body: method === "GET" ? undefined : body };
}
async function request(method, pathname, value, binary = false) {
  const response = await fetch(origin + pathname, signedInput(method, pathname, value, binary));
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
async function api(method, pathname, value, binary = false) {
  const response = await request(method, pathname, value, binary);
  if (response.status >= 400) throw Object.assign(new Error(response.data?.code || "HTTP_" + response.status), { code: response.data?.code, status: response.status });
  return response.data;
}
async function admin(value, token = process.env.ADMIN_API_TOKEN) {
  const response = await fetch(origin + "/api/admin/schedule-collector/actions/sample", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json", "x-fosu-client": "service" }, body: JSON.stringify(value) });
  return { status: response.status, data: await response.json() };
}
async function claimed(kind, options = {}) {
  const queued = control.requestRun("sample", "fixture-approved", Date.now(), { term, sampleKind: kind, requestBudget: 40, ...options }).run;
  const response = await api("POST", "/api/full-sync/v1/runs/claim", { mode: "sample", runId: queued.id });
  return response.run;
}
function metadata(run, data, chunkSize = 100) {
  const raw = Buffer.from(JSON.stringify(data)), bytes = zlib.gzipSync(raw);
  return { raw, bytes, value: { claimId: run.claimId, term, canonicalHash: data.canonicalHash, contentEncoding: "gzip", originalSize: raw.length, originalSha256: crypto.createHash("sha256").update(raw).digest("hex"), uploadSize: bytes.length, uploadSha256: crypto.createHash("sha256").update(bytes).digest("hex"), chunkSize, totalChunks: Math.ceil(bytes.length / chunkSize) } };
}
before(async () => {
  require("../server/src/services/termRegistryService").createPlannedTerm({ term, semesterText: term, termStartDate: "2026-09-07", totalWeeks: 20, weekStart: "monday" });
  const app = express();
  app.use(express.json({ verify(req, res, buf) { req.rawBody = buf; } }));
  app.use("/api/full-sync/v1", require("../server/src/routes/fullSyncAgent"));
  app.use("/api/admin", require("../server/src/modules/schedule-collector/routes"));
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  origin = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + "fosu-oracle-sample-")) fs.rmSync(root, { recursive: true, force: true });
});

test("policy bounds and both sample scopes remain nonpublishable", () => {
  for (const kind of ["class", "four"]) {
    const data = sample(kind), summary = contract.assertSample(data, term, contract.policy(kind, 40));
    assert.equal(summary.publishable, false); assert.equal(summary.coverageValid, false);
    assert.equal(require("../server/src/shared/fourDirectSourceContract").validateFourSources(data, term).valid, false);
    assert.equal(require("../server/src/services/stagingSafetyService").validateStagingData(data).valid, false);
  }
  for (const [kind, budget] of [["full", 40], ["four", 0], ["four", 121], ["class", 1.5]]) assert.throws(() => contract.policy(kind, budget), /SAMPLE_POLICY_REJECTED/);
});
for (const [name, mutate, code] of [
  ["derived source", d => d.directSourceSummary.teacher.sourceMode = "derived-current-run", "SAMPLE_SOURCE_INCOMPLETE"],
  ["request budget", d => d.meta.actualNetworkRequestCount = 41, "SCHOOL_REQUEST_BUDGET_EXCEEDED"],
  ["underreported request count", d => d.meta.actualNetworkRequestCount = 1, "SAMPLE_REQUEST_COUNT_INVALID"],
  ["invalid weeks", d => d.classSchedules[0].courses[0].weeks = [999], "SAMPLE_DATA_INVALID"],
  ["invalid weekday", d => d.classSchedules[0].courses[0].weekday = 8, "SAMPLE_DATA_INVALID"],
  ["parser errors", d => d.directSourceSummary.class.parserErrors = 1, "SAMPLE_SOURCE_INCOMPLETE"],
  ["failed source", d => d.directSourceSummary.course.failed = 1, "SAMPLE_SOURCE_INCOMPLETE"],
  ["full directory", d => d.resources.teachers.push({ id: "extra", teacherName: "第二测试教师" }), "SAMPLE_DIRECTORY_EXCEEDED"],
  ["directory identity mismatch", d => d.resources.teachers[0].teacherName = "不匹配的测试教师", "SAMPLE_DIRECTORY_MISMATCH"],
  ["two class request groups", d => { d.classSchedules.push({ ...d.classSchedules[0], classId: "other", majorCode: "other" }); d.directSourceSummary.class.scheduleDocuments = 2; }, "SAMPLE_REQUEST_GROUP_EXCEEDED"],
  ["sensitive material", d => d.resources.teacherSchedules[0].password = "synthetic", "STAGING_SENSITIVE"],
  ["forged hash", d => d.canonicalHash = "0".repeat(64), "CANONICAL_HASH_MISMATCH"],
]) test("reject " + name, () => { const data = sample(); mutate(data); assert.throws(() => contract.assertSample(data, term, contract.policy("four", 40)), error => error.code === code); });

test("class sample rejects independent source data", () => { const data = sample("class"); data.resources.teacherSchedules = [{ id: "extra" }]; assert.throws(() => contract.assertSample(data, term, contract.policy("class", 40)), /SAMPLE_SCOPE_EXCEEDED/); });
test("sample term configuration must match the approved registry record", () => {
  const data = sample("class");
  assert.throws(() => contract.assertSample(data, term, contract.policy("class", 40), { ...data.termConfig, totalWeeks: 21 }), /SAMPLE_TERM_CONFIG_MISMATCH/);
});
test("force publish and active hash shortcut cannot publish a Sample", async () => {
  fs.writeFileSync(path.join(process.env.FOSU_STORAGE_DIR, "staging-latest.json"), JSON.stringify(sample()));
  await assert.rejects(require("../server/src/services/stagingPublishService").runStagingPublish({ force: true }), error => error.code === "SAMPLE_NOT_PUBLISHABLE");
});
test("one class group can return multiple administrative classes", () => { const data = sample("class"); data.classSchedules.push({ ...data.classSchedules[0], classId: "second", className: "26测试2班" }); data.directSourceSummary.class.scheduleDocuments = 2; data.directSourceSummary.class.courseEvents = 2; data.canonicalHash = fingerprint(data).canonicalHash; assert.equal(contract.assertSample(data, term, contract.policy("class", 40)).directSourceSummary.class.entityUnit, "major-request-group"); });

test("signed readiness, nonce replay and forged body protection", async () => {
  control.resetForTests();
  const ready = await api("GET", "/api/full-sync/v1/sample/readiness"); assert.equal(ready.ready, true); assert.equal(ready.protocol, "collector-manual.v1"); assert.equal(ready.publishable, false);
  const req = signedInput("GET", "/api/full-sync/v1/sample/readiness");
  assert.equal((await fetch(origin + "/api/full-sync/v1/sample/readiness", req)).status, 200);
  assert.equal((await fetch(origin + "/api/full-sync/v1/sample/readiness", req)).status, 403);
  const tampered = signedInput("POST", "/api/full-sync/v1/runs/claim", {}); tampered.body = Buffer.from('{"mode":"sample"}');
  assert.equal((await fetch(origin + "/api/full-sync/v1/runs/claim", tampered)).status, 403);
});
test("readiness reports missing signing configuration, disabled worker and expired approval", () => {
  control.resetForTests();
  const secret = process.env.FULL_SYNC_SIGNING_SECRET;
  process.env.FULL_SYNC_SIGNING_SECRET = ""; assert.equal(control.sampleReadiness().code, "SAMPLE_SIGNATURE_NOT_CONFIGURED");
  process.env.FULL_SYNC_SIGNING_SECRET = secret;
  process.env.FOSU_RELEASE_WORKER_ENABLED = "false"; assert.equal(control.sampleReadiness().code, "RELEASE_WORKER_DISABLED");
  delete process.env.FOSU_RELEASE_WORKER_ENABLED;
  const now = Date.now(); control.requestRun("sample", "fixture", now, { term });
  assert.equal(control.sampleReadiness(now + contract.APPROVAL_TTL_MS + 1).code, "SAMPLE_APPROVAL_EXPIRED");
});
test("admin sample creation is authenticated, scoped, strict and idempotent", async () => {
  control.resetForTests(); const value = { term, sampleKind: "class", requestBudget: 40, idempotencyKey: "fixture-one-class" };
  assert.equal((await admin(value, "wrong-fixture-token")).status, 401);
  assert.equal((await admin(value, "fixture-read-token-01234567890123456789")).status, 403);
  assert.equal((await admin({ ...value, publish: true })).status, 400);
  assert.equal((await admin({ term, sampleKind: "class" })).status, 400);
  const created = await admin(value), repeated = await admin(value);
  assert.equal(created.status, 200); assert.equal(repeated.data.queued.reason, "idempotent-replay");
  assert.equal(created.data.queued.run.id, repeated.data.queued.run.id); assert.equal(created.data.queued.run.approvalExpiresAt, repeated.data.queued.run.approvalExpiresAt);
  assert.equal((await admin({ ...value, sampleKind: "four" })).data.code, "SAMPLE_IDEMPOTENCY_CONFLICT");
});
test("Sample creation preserves 20 legacy runs and every earlier Sample idempotency reference", () => {
  control.resetForTests();
  const now = Date.now(), legacy = Array.from({ length: 20 }, (_, index) => ({ id: "sc-legacy-" + index, mode: index % 2 ? "routine" : "full", term, stage: "idle", result: "FAILED", failureCode: "NETWORK", startedAt: new Date(now - 86400000 - index).toISOString(), finishedAt: new Date(now - 86400000).toISOString() }));
  const file = path.join(process.env.SCHEDULE_COLLECTOR_DIR, "state.json");
  fs.writeFileSync(file, JSON.stringify({ paused: false, runs: legacy, current: null, lock: null, failureCount: 0, sessionExpired: false, stopForDay: false }));
  control.load(); let first;
  for (let index = 0; index < 25; index++) {
    const approval = control.requestRun("sample", "fixture-approved", now + index, { term, sampleKind: "class", requestBudget: 40, idempotencyKey: "fixture-preserved-sample-" + index });
    if (!first) first = approval.run;
    control.cancelCurrent();
  }
  const stored = control.load();
  assert.equal(stored.runs.length, 45);
  for (const old of legacy) assert.deepEqual(stored.runs.find(run => run.id === old.id), old);
  assert.equal(stored.sampleRequests.length, 25);
  const repeated = control.requestRun("sample", "fixture-approved", now + 26, { term, sampleKind: "class", requestBudget: 40, idempotencyKey: "fixture-preserved-sample-0" });
  assert.equal(repeated.reason, "idempotent-replay"); assert.equal(repeated.run.id, first.id);
  assert.equal(repeated.run.approvalExpiresAt, first.approvalExpiresAt);
  assert.equal(control.load().runs.length, 45);
});
test("lease requires exact approved run, mode, owner and an unexpired approval", () => {
  control.resetForTests(); const now = Date.now();
  const queued = control.requestRun("sample", "fixture", now, { term }).run;
  assert.equal(control.claim(agent, now), null); assert.equal(control.claim(agent, now, { mode: "sample", runId: "sc-wrong" }), null);
  const run = control.claim(agent, now, { mode: "sample", runId: queued.id });
  assert.throws(() => control.requireRun(run.id, "other-agent", run.claimId, now), /RUN_LEASE_REJECTED/);
  const reclaimed = control.claim(agent, now + control.LEASE_TTL_MS + 1, { mode: "sample", runId: run.id });
  assert.notEqual(reclaimed.claimId, run.claimId); assert.throws(() => control.requireRun(run.id, agent, run.claimId, now + control.LEASE_TTL_MS + 1), /RUN_LEASE_REJECTED/);
  assert.equal(control.claim(agent, now + contract.APPROVAL_TTL_MS + 1, { mode: "sample", runId: run.id }), null);
});
test("sample approval never clears an authentication stop or budget", () => {
  control.resetForTests(); const now = Date.now(); const queued = control.requestRun("sample", "fixture", now, { term }).run;
  const run = control.claim(agent, now, { mode: "sample", runId: queued.id });
  control.applyReport(run.id, { claimId: run.claimId, failureCode: "SCHOOL_SECURITY_CHALLENGE" }, agent, now);
  const before = fs.readFileSync(path.join(process.env.SCHEDULE_COLLECTOR_DIR, "state.json"));
  assert.throws(() => control.requestRun("sample", "fixture", now, { term }), /SAMPLE_AUTH_REVIEW_REQUIRED/);
  assert.deepEqual(fs.readFileSync(path.join(process.env.SCHEDULE_COLLECTOR_DIR, "state.json")), before);
  assert.equal(control.sampleReadiness().ready, false); assert.equal(control.snapshot().sessionExpired, true);
});
test("sample reports cannot enter publish/mirror or exceed the approved budget", async () => {
  control.resetForTests(); const run = await claimed("class"), base = "/api/full-sync/v1/runs/" + run.id;
  for (const stage of ["publish", "mirror"]) assert.equal((await request("POST", base + "/report", { claimId: run.claimId, stage })).data.code, "SAMPLE_NOT_PUBLISHABLE");
  assert.equal((await request("POST", base + "/report", { claimId: run.claimId, schoolRequestCount: 41 })).data.code, "SCHOOL_REQUEST_BUDGET_EXCEEDED");
  assert.equal((await request("POST", base + "/report", { claimId: run.claimId, noChange: true, complete: true })).data.code, "SAMPLE_FINALIZE_REQUIRED");
});

for (const kind of ["class", "four"]) test(kind + " sample signed chunk resume/finalize/review keeps formal state unchanged", async () => {
  control.resetForTests(); const idempotencyKey = "fixture-complete-" + kind;
  const run = await claimed(kind, { idempotencyKey }), data = sample(kind), meta = metadata(run, data), base = "/api/full-sync/v1/runs/" + run.id;
  const latest = path.join(process.env.FOSU_STORAGE_DIR, "staging-latest.json"), active = path.join(process.env.FOSU_STORAGE_DIR, "active-release.json");
  fs.writeFileSync(latest, '{"previousStaging":"fixture"}'); fs.writeFileSync(active, '{"previousActive":"fixture"}');
  const beforeLatest = fs.readFileSync(latest), beforeActive = fs.readFileSync(active);
  const init = await api("POST", base + "/upload/init", meta.value), uploadId = init.upload.uploadId;
  const chunkUrl = index => base + "/upload/" + uploadId + "/chunks/" + index + "/" + run.claimId;
  const first = meta.bytes.subarray(0, meta.value.chunkSize);
  await api("POST", chunkUrl(0), first, true); await api("POST", chunkUrl(0), first, true);
  const bad = Buffer.from(first); bad[0] ^= 1; assert.equal((await request("POST", chunkUrl(0), bad, true)).data.code, "SAMPLE_CHUNK_CONFLICT");
  const resume = await api("POST", base + "/upload/init", meta.value); assert.deepEqual(resume.upload.receivedChunks, [0]);
  assert.equal((await request("POST", base + "/upload/init", { ...meta.value, canonicalHash: "0".repeat(64) })).data.code, "UPLOAD_RESUME_MISMATCH");
  for (let index = 1; index < meta.value.totalChunks; index++) await api("POST", chunkUrl(index), meta.bytes.subarray(index * meta.value.chunkSize, (index + 1) * meta.value.chunkSize), true);
  const job = await api("POST", base + "/upload/finalize", { claimId: run.claimId, uploadId });
  const duplicateJob = await api("POST", base + "/upload/finalize", { claimId: run.claimId, uploadId }); assert.equal(duplicateJob.job.id, job.job.id);
  let finalized;
  for (let attempt = 0; attempt < 100; attempt++) { finalized = await api("GET", base + "/upload/status/" + run.claimId); if (["success", "failed"].includes(finalized.status)) break; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(finalized.status, "success"); assert.equal(finalized.result.canonicalHash, data.canonicalHash);
  const complete = { claimId: run.claimId, complete: true, uploadId, canonicalHash: data.canonicalHash };
  assert.equal((await api("POST", base + "/report", complete)).run.result, "PENDING SAMPLE REVIEW");
  assert.equal((await api("POST", base + "/report", complete)).run.result, "PENDING SAMPLE REVIEW");
  const review = (await api("GET", base + "/sample-review")).review;
  assert.equal(review.runId, run.id); assert.equal(review.uploadId, uploadId); assert.equal(review.canonicalHash, data.canonicalHash);
  assert.equal(review.ownershipConfirmed, true); assert.equal(review.requestBudget, 40); assert.equal(review.publishable, false); assert.equal(review.coverageValid, false); assert.equal(review.stagingState, "sample-review");
  if (kind === "class") {
    // The deployed regular twenty-run retention still applies, independently
    // of Sample ownership/approval history needed by private audit reads.
    for (let index = 0; index < 25; index++) {
      control.requestRun(index % 2 ? "full" : "routine", "fixture-regular", Date.now(), { term });
      control.cancelCurrent();
    }
    const stored = control.load();
    assert.equal(stored.runs.filter(item => item.mode !== "sample").length, 20);
    assert.equal(stored.runs.filter(item => item.mode === "sample").length, 1);
    const historic = (await api("GET", base + "/sample-review")).review;
    assert.equal(historic.uploadId, uploadId); assert.equal(historic.canonicalHash, data.canonicalHash); assert.equal(historic.ownershipConfirmed, true);
    const replay = control.requestRun("sample", "fixture-approved", Date.now(), { term, sampleKind: kind, requestBudget: 40, idempotencyKey });
    assert.equal(replay.reason, "idempotent-replay"); assert.equal(replay.run.id, run.id); assert.equal(replay.run.result, "PENDING SAMPLE REVIEW");
    assert.equal((await api("POST", base + "/report", complete)).run.result, "PENDING SAMPLE REVIEW");
  }
  assert.equal(uploads.markUploadPublished(uploadId, "fixture-release", { active: true }), null);
  assert.equal(uploads.reconcileWithReleaseState({ activeRelease: { version: "fixture-release", canonicalHash: data.canonicalHash }, uploadId }).matched, 0);
  assert.equal(uploads.getUploadStatus(uploadId, { type: "full-sync", id: run.id }).status, "pending-review");
  assert.deepEqual(fs.readFileSync(latest), beforeLatest); assert.deepEqual(fs.readFileSync(active), beforeActive);
  assert.equal(control.snapshot().lastSuccessAt, null);
  assert.throws(() => control.sampleRun(run.id, "other-agent"), /SAMPLE_REVIEW_REJECTED/);
});

test("sample upload cap rejects oversized init and compressed expansion", async () => {
  control.resetForTests(); const run = await claimed("class"), meta = metadata(run, sample("class")), base = "/api/full-sync/v1/runs/" + run.id;
  assert.equal((await request("POST", base + "/upload/init", { ...meta.value, originalSize: contract.MAX_ORIGINAL_BYTES + 1 })).data.code, "SAMPLE_UPLOAD_SIZE_EXCEEDED");
  const bytes = zlib.gzipSync(Buffer.alloc(1024, 32));
  const upload = uploads.initUpload({ source: "wyz-schedule-sample", contentEncoding: "gzip", uploadSize: bytes.length, uploadSha256: crypto.createHash("sha256").update(bytes).digest("hex"), originalSize: 100, chunkSize: bytes.length, totalChunks: 1 }, { type: "full-sync", id: run.id });
  uploads.writeChunk(upload.uploadId, 0, bytes, { type: "full-sync", id: run.id });
  await assert.rejects(uploads.finalizeUploadFiles(upload.uploadId, { type: "full-sync", id: run.id }), error => error.code === "SAMPLE_UPLOAD_SIZE_EXCEEDED");
});
test("failed source quality retains its upload checkpoint and reports the exact safe failure code", async () => {
  control.resetForTests(); const run = await claimed("four"), data = sample("four");
  data.directSourceSummary.teacher.parserErrors = 1;
  const meta = metadata(run, data), base = "/api/full-sync/v1/runs/" + run.id;
  const uploadId = (await api("POST", base + "/upload/init", meta.value)).upload.uploadId;
  for (let index = 0; index < meta.value.totalChunks; index++) await api("POST", base + "/upload/" + uploadId + "/chunks/" + index + "/" + run.claimId, meta.bytes.subarray(index * meta.value.chunkSize, (index + 1) * meta.value.chunkSize), true);
  await api("POST", base + "/upload/finalize", { claimId: run.claimId, uploadId });
  let result;
  for (let attempt = 0; attempt < 100; attempt++) { result = await api("GET", base + "/upload/status/" + run.claimId); if (["success", "failed"].includes(result.status)) break; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(result.status, "failed"); assert.equal(result.code, "SAMPLE_SOURCE_INCOMPLETE");
  const upload = uploads.getUploadStatus(uploadId, { type: "full-sync", id: run.id });
  assert.equal(upload.status, "failed"); assert.equal(upload.receivedCount, meta.value.totalChunks);
  assert.equal((await request("GET", base + "/sample-review")).data.code, "SAMPLE_REVIEW_PENDING");
  assert.equal((await request("POST", base + "/report", { claimId: run.claimId, complete: true, uploadId, canonicalHash: data.canonicalHash })).data.code, "SAMPLE_FINALIZE_REQUIRED");
});
test("corrupt existing state fails closed without overwriting it; baseline state remains readable", () => {
  control.resetForTests(); const file = path.join(process.env.SCHEDULE_COLLECTOR_DIR, "state.json");
  fs.writeFileSync(file, '{"broken":'); const before = fs.readFileSync(file);
  assert.throws(() => control.load(), error => error.code === "COLLECTOR_STATE_REVIEW_REQUIRED" && error.statusCode === 503);
  assert.throws(() => control.sampleReadiness(), /COLLECTOR_STATE_REVIEW_REQUIRED/); assert.deepEqual(fs.readFileSync(file), before);
  fs.writeFileSync(file, JSON.stringify({ paused: false, runs: [], current: null, lock: null, failureCount: 2, sessionExpired: false, stopForDay: false }));
  assert.equal(control.load().failureCount, 2); assert.equal(control.sampleReadiness().ready, true);
});

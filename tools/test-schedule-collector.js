const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.SCHEDULE_COLLECTOR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-collector-"));
process.env.FULL_SYNC_AGENT_TOKEN = "full-sync-token-0123456789abcdef";
process.env.FULL_SYNC_SIGNING_SECRET = "full-sync-secret-0123456789abcdef";
process.env.FULL_SYNC_AGENT_ID = "wyz-schedule-collector";
process.env.CAMPUS_AGENT_TOKEN = "campus-agent-token-0123456789abcd";
process.env.CAMPUS_AGENT_SIGNING_SECRET = "campus-agent-secret-0123456789abc";

const collector = require("../server/src/services/scheduleCollectorService");
const signature = require("../server/src/security/fullSyncSignature");

collector.resetForTests();
const now = Date.parse("2026-09-25T00:00:00.000Z");
const schedule = collector.nextSchedule(now);
assert.strictEqual(schedule.routineAt, "2026-09-25T20:30:00.000Z");
assert.strictEqual(schedule.fullAt, "2026-09-26T21:00:00.000Z");

const first = collector.backoffFor(1, "NETWORK");
const second = collector.backoffFor(2, "NETWORK");
const third = collector.backoffFor(3, "NETWORK");
const fourth = collector.backoffFor(4, "NETWORK");
assert.strictEqual(first.delayMs, 30 * 60 * 1000);
assert.strictEqual(second.delayMs, 2 * 60 * 60 * 1000);
assert.strictEqual(third.delayMs, 6 * 60 * 60 * 1000);
assert.strictEqual(fourth.stop, true);
assert.strictEqual(collector.backoffFor(1, "SESSION_EXPIRED").message, "校内采集会话已失效，请人工刷新");

const command = collector.collectorCommand("routine");
assert.strictEqual(command.publishesRelease, false);
assert.ok(command.concurrency <= 2);
assert.ok(!command.script.includes("fosu-publisher"));
assert.deepStrictEqual(collector.findSensitive({ cookie: "a" }), ["cookie"]);
assert.deepStrictEqual(collector.findSensitive({ note: "ok" }), []);

const same = collector.classifyRelease({ canonicalHash: "abc", counts: { class: 10 } }, { canonicalHash: "abc", counts: { class: 10 } });
assert.strictEqual(same.result, "NO CHANGE");
const drop = collector.classifyRelease({ canonicalHash: "abc", counts: { class: 100 } }, { canonicalHash: "def", counts: { class: 10 }, coverageValid: true });
assert.strictEqual(drop.result, "PENDING REVIEW");
assert.ok(drop.reasons.includes("class-drop"));

const queued = collector.requestRun("routine", "admin", now);
assert.strictEqual(queued.skipped, false);
const claimed = collector.claim("wyz-schedule-collector", now);
assert.ok(claimed);
assert.strictEqual(collector.claim("wyz-schedule-collector", now), null);
collector.applyReport(claimed.id, { failureCode: "SESSION_EXPIRED" });
assert.strictEqual(collector.snapshot(now).sessionExpired, true);

collector.resetForTests();
const again = collector.requestRun("full", "admin", now);
collector.claim("wyz-schedule-collector", now);
const finished = collector.applyReport(again.run.id, {
  complete: true,
  canonicalHash: "same",
  counts: { class: 10, teacher: 10, classroom: 10, course: 10 },
  term: "2026-2027-1",
  sourceMode: "school",
  coverageValid: true,
});
assert.strictEqual(finished.result, "PENDING REVIEW");
assert.strictEqual(finished.recommendation, "AUTO SAFE PUBLISH");
assert.throws(() => collector.applyReport(again.run.id, { password: "no" }), (error) => error.code === "STAGING_SENSITIVE");

const body = Buffer.from("{}");
const stamp = String(now);
const nonce = "nonce-1";
const signed = signature.signRequest(process.env.FULL_SYNC_SIGNING_SECRET, {
  method: "POST",
  path: "/api/full-sync/v1/heartbeat",
  timestamp: stamp,
  nonce,
  body,
});
function request(extra) {
  return Object.assign({
    method: "POST",
    originalUrl: "/api/full-sync/v1/heartbeat",
    rawBody: body,
    headers: {
      authorization: "Bearer " + process.env.FULL_SYNC_AGENT_TOKEN,
      "x-full-sync-agent-id": "wyz-schedule-collector",
      "x-full-sync-timestamp": stamp,
      "x-full-sync-nonce": nonce,
      "x-full-sync-signature": signed,
    },
  }, extra || {});
}
signature.resetNonces();
assert.strictEqual(signature.verifySignedRequest(request(), now).ok, true);
assert.strictEqual(signature.verifySignedRequest(request(), now).ok, false);
signature.resetNonces();
assert.strictEqual(signature.verifySignedRequest(request({
  headers: { authorization: "Bearer " + process.env.CAMPUS_AGENT_TOKEN },
}), now).status, 404);
console.log("schedule-collector PASS");

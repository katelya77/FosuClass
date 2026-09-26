const assert = require("assert");
const ops = require("../server/src/services/campusSyncOpsService");

const safety = ops.queueSafety(8000);
assert.strictEqual(safety.workerConcurrency, 1);
assert.ok(safety.jobTtlMs >= 30000);
assert.strictEqual(safety.estimatedWorstTailMs, Math.max(0, safety.globalActiveCap - 1) * 8000);
const action = ops.recommendation({ agentOnline: false, circuit: "CLOSED", systemFailureRate: 0, tailExceedsTtl: false });
assert.strictEqual(action.label, "需处理");
const watch = ops.recommendation({ agentOnline: true, circuit: "CLOSED", systemFailureRate: 6, rateLimited: 0, tailExceedsTtl: false });
assert.strictEqual(watch.label, "观察");
const normal = ops.recommendation({ agentOnline: true, circuit: "CLOSED", systemFailureRate: 1, credentialFailureRate: 0, rateLimited: 0, tailExceedsTtl: false });
assert.strictEqual(normal.label, "正常");
const snap = JSON.stringify(ops.criticalSnapshot());
["password", "studentId", "studentName", "openid", "cookie", "ticket", "courseName"].forEach((key) => {
  assert.ok(!snap.includes(key), key);
});
console.log("campus-sync-queue-safety PASS");

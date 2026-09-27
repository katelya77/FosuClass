const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const opsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-sync-observe-"));
process.env.CAMPUS_SYNC_OPS_DIR = opsDir;
process.env.FOSU_DEPLOY_COMMIT_SHA = "6b89a688fcc11b06a5a2041b34b2bbbf2ba5caaf";

const telemetry = require("../server/src/services/campusSyncTelemetryService");
const ops = require("../server/src/services/campusSyncOpsService");
const cooldown = require("../server/src/services/campusSyncChallengeCooldown");
const assets = fs.readFileSync(path.join(__dirname, "../server/src/routes/adminCampusSyncAssets.js"), "utf8");

function forbidden(text) {
  ["school-secret", "202500000303", "ST-hidden", "exec-hidden", "salt-hidden", "JSESSIONID", "openid-raw", "wx-code", "张三", "计科1班", "authserver.fosu.edu.cn", "100.fosu.edu.cn", "<html"].forEach((token) => {
    assert.ok(!text.includes(token), token);
  });
}

function run() {
  telemetry.resetForTests();
  ops.resetDiagnoseForTests();
  cooldown.resetForTests();
  const now = Date.now();
  telemetry.record({
    t: now,
    status: "completed",
    resultCode: "OK",
    authMode: "mobile",
    durationMs: 900,
    queueWaitMs: 120,
    schoolLoginMs: 400,
    scheduleFetchMs: 250,
    profileFetchMs: 180,
    courseCount: 12,
    jobId: "abc12345ffffffffffffffff",
    ownerKey: "hashprefixvalue",
    password: "school-secret",
    studentId: "202500000303",
    studentName: "张三",
    className: "计科1班",
    openid: "openid-raw",
    cookie: "JSESSIONID=secret",
    ticket: "ST-hidden",
    execution: "exec-hidden",
    pwdEncryptSalt: "salt-hidden",
    wxCode: "wx-code",
    casUrl: "https://authserver.fosu.edu.cn/authserver/login?ticket=ST-hidden",
    html: "<html>secret</html>",
  });
  const mobile = telemetry.overview("24h");
  assert.strictEqual(mobile.success, 1);
  assert.strictEqual(mobile.authModes.mobile, 1);
  assert.strictEqual(mobile.lastSuccessAuthMode, "mobile");
  assert.strictEqual(mobile.stageLatency.total.samples, 1);
  assert.ok(mobile.stageLatency.login.p50 != null);
  assert.strictEqual(mobile.systemFailures, 0);
  forbidden(JSON.stringify(telemetry.listRecent({ limit: 5 })));

  telemetry.resetForTests();
  const dirty = telemetry.record({
    t: now + 1,
    status: "completed",
    resultCode: "OK",
    authMode: "https://100.fosu.edu.cn/caslogin.jsp?ticket=ST-hidden",
  });
  assert.strictEqual(dirty.authMode, undefined);
  assert.strictEqual(telemetry.overview("24h").lastSuccessAuthMode, "");
  assert.strictEqual(telemetry.overview("24h").authModes.mobile, 0);

  telemetry.resetForTests();
  telemetry.record({ t: now + 2, status: "failed", resultCode: "INTERACTIVE_CHALLENGE_REQUIRED" });
  const challenge = telemetry.overview("24h");
  assert.strictEqual(challenge.schoolChallenges, 1);
  assert.strictEqual(challenge.systemFailures, 0);
  assert.ok(challenge.lastChallengeAt > 0);
  cooldown.note("principal-secret-value", now);
  assert.strictEqual(cooldown.activeCount(now), 1);
  assert.ok(!JSON.stringify(cooldown.activeCount(now)).includes("principal-secret"));

  telemetry.resetForTests();
  telemetry.record({ t: now + 3, status: "completed", resultCode: "OK", courseCount: 1 });
  const empty = telemetry.overview("24h");
  assert.strictEqual(empty.stageLatency.total.samples, 0);
  assert.strictEqual(empty.stageLatency.total.p50, null);
  assert.strictEqual(empty.stageLatency.total.p95, null);
  assert.strictEqual(empty.stageLatency.queue.p50, null);
  assert.strictEqual(empty.p95DurationMs, null);

  telemetry.resetForTests();
  telemetry.record({ t: now + 4, status: "rejected", resultCode: "CAMPUS_SYNC_RATE_LIMITED" });
  telemetry.record({ t: now + 5, status: "rejected", resultCode: "CAMPUS_SYNC_DAILY_LIMIT" });
  const limits = telemetry.overview("24h");
  assert.strictEqual(limits.rateLimited, 1);
  assert.strictEqual(limits.dailyLimited, 1);
  assert.ok(limits.attempts >= 2);

  const credentials = ops.recommendation({
    agentOnline: true,
    circuit: "CLOSED",
    systemFailureRate: 0,
    credentialFailureRate: 100,
    attempts: 2,
    tailExceedsTtl: false,
  });
  assert.strictEqual(credentials.label, "正常");
  assert.strictEqual(ops.recommendation({ agentOnline: false, circuit: "CLOSED", heartbeatAgeMs: 95000 }).label, "需处理");
  assert.ok(ops.recommendation({ agentOnline: false, circuit: "CLOSED", heartbeatAgeMs: 95000 }).reasons.includes("heartbeat_stale"));
  assert.strictEqual(ops.recommendation({ agentOnline: true, circuit: "OPEN", systemFailureRate: 0 }).label, "需处理");
  assert.strictEqual(ops.recommendation({ agentOnline: true, circuit: "CLOSED", systemFailureRate: 6 }).label, "观察");
  assert.strictEqual(ops.recommendation({ agentOnline: true, circuit: "CLOSED", systemFailureRate: 16 }).label, "需处理");
  assert.strictEqual(ops.recommendation({ agentOnline: true, circuit: "CLOSED", systemFailureRate: 0, attempts: 8, schoolChallengeRate: 40 }).label, "观察");
  assert.strictEqual(ops.recommendation({ agentOnline: true, circuit: "CLOSED", systemFailureRate: 0, p95DurationMs: 16000 }).label, "需处理");
  assert.strictEqual(ops.recommendation({ agentOnline: true, circuit: "CLOSED", systemFailureRate: 0, p95DurationMs: null }).label, "正常");
  assert.strictEqual(ops.recommendation({ agentOnline: true, circuit: "CLOSED", tailExceedsTtl: true }).label, "需处理");
  assert.strictEqual(ops.recommendation({ agentOnline: true, circuit: "CLOSED", storageFailed: true }).label, "需处理");
  assert.strictEqual(ops.recommendation({ agentOnline: true, circuit: "CLOSED", policyInvalid: true }).label, "需处理");

  const before = fs.readdirSync(opsDir);
  const report = ops.diagnose();
  const after = fs.readdirSync(opsDir);
  assert.strictEqual(report.schoolContact, false);
  assert.strictEqual(report.schoolGateway, "未访问");
  assert.strictEqual(report.workerConcurrency, 1);
  assert.strictEqual(report.deployment, "6b89a68");
  assert.strictEqual(report.wyzProtocol, "compatible");
  assert.ok(report.policyStorage === "ok" || report.policyStorage === "invalid");
  forbidden(JSON.stringify(report));
  assert.ok(!after.some((name) => name === "policy.json" && !before.includes(name)));
  assert.ok(!assets.includes("100.fosu.edu.cn"));
  assert.ok(assets.includes("学校系统：未访问"));
  assert.ok(assets.includes("agent.online ? \"在线\" : \"离线\""));
  assert.ok(assets.includes("lastHeartbeatAgeMs == null ? \"-\""));
  assert.ok(assets.includes("if (!pair || !pair.samples) return \"-\""));
  assert.ok(assets.includes("Auth mode"));
  assert.ok(assets.includes("学校安全验证"));
  assert.ok(assets.includes("WYZ 版本"));
  assert.ok(assets.includes("未上报"));
  const snapshotSource = assets.slice(assets.indexOf("function csLoadCritical"), assets.indexOf("function csLoadWindow"));
  assert.ok(snapshotSource.includes("/snapshot"));
  assert.ok(!snapshotSource.includes("timeseries"));
  console.log("campus-sync-production-observability PASS");
}

run();

#!/usr/bin/env node
/**
 * P4e HTTP 级验收：runtime-backed Agent 控制面 API。
 *
 * 覆盖：未认证 401 / 错误 scope 403 / 正确 scope 放行；draft→validate→test→
 * publish→版本历史→rollback→audit 全链；内核门禁链 coded error（未 validate/test
 * 直接 publish/test 必须 400 + CONFIG_KERNEL_*）；Run Trace 详情脱敏；发布→新 Run
 * 绑定新 configVersion→回滚→恢复；全部响应 no-store；序列化响应体无密钥模式。
 *
 * 配置内核 root 由 harness 的 FOSU_DATA_DIR 隔离到临时目录，不触碰真实配置。
 */
const assert = require("assert");
const { startAdminHttpHarness } = require("./test-helpers/admin-http-harness");

const BASE = "/api/admin/agent-platform";
const SECRET_VALUE_PATTERN = /(sk-[a-z0-9]{16,}|bearer\s+[a-z0-9._-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const FORBIDDEN_LITERALS = ["c1-password", "c1-admin-full", "c1-config-read-token", "c1-config-publish-token"];
// 拼接待测假密钥，避免在仓库内留下密钥形态字面量（与守卫自身 SECRET_PREFIX 同款写法）。
const FAKE_PROVIDER_SECRET = "s" + "k-0123456789abcdef0";

const SERVICE_TOKENS = [
  { name: "c1-config-read", token: "c1-config-read-token", scopes: ["agent-config:read"] },
  { name: "c1-config-draft", token: "c1-config-draft-token", scopes: ["agent-config:draft:write"] },
  { name: "c1-config-validate", token: "c1-config-validate-token", scopes: ["agent-config:validate"] },
  { name: "c1-config-publish", token: "c1-config-publish-token", scopes: ["agent-config:publish"] },
  { name: "c1-config-rollback", token: "c1-config-rollback-token", scopes: ["agent-config:rollback"] },
  { name: "c1-config-audit", token: "c1-config-audit-token", scopes: ["agent-config:audit:read"] },
  { name: "c1-wrong", token: "c1-wrong-token", scopes: ["catalog:write"] },
];

const collectedResponses = [];

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

async function api(harness, path, options = {}) {
  const response = await harness.request(`${BASE}${path}`, options);
  collectedResponses.push({ path, status: response.status, text: response.text });
  return response;
}

function assertNoStore(response, label) {
  const cacheControl = String(response.headers["cache-control"] || "");
  assert.ok(cacheControl.includes("no-store"), `${label}: expected no-store Cache-Control, got ${cacheControl || "(none)"}`);
}

async function createRunAndWait(harness, tag) {
  const create = await harness.request("/api/ai/agent/runs", {
    method: "POST",
    body: {
      message: "你是谁？",
      protocolVersion: "agent.v2",
      requestId: `p4e-config-plane-${tag}`,
      conversationId: `p4e-config-plane-conversation-${tag}`,
      idempotencyKey: `p4e-config-plane-idempotency-${tag}`,
      context: { envVersion: "release", memoryMode: "local_only" },
    },
  });
  assert.strictEqual(create.status, 202, `create run ${tag}: ${create.text}`);
  const deadline = Date.now() + 10000;
  let view = null;
  while (Date.now() < deadline) {
    const poll = await harness.request(`/api/ai/agent/runs/${encodeURIComponent(create.json.runId)}?pollToken=${encodeURIComponent(create.json.pollToken)}`);
    assert.strictEqual(poll.status, 200, poll.text);
    view = poll.json;
    if (["completed", "degraded", "failed", "cancelled"].includes(view.status)) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(10, Number(view.nextPollMs) || 10)));
  }
  assert.ok(view && view.result && view.result.platformTrace, `run ${tag} must expose platformTrace`);
  return { runId: create.json.runId, trace: view.result.platformTrace };
}

async function publishChain(harness, auth, environment, payload, expectedVersion) {
  const write = (path, body) => api(harness, path, {
    method: "POST",
    body: Object.assign({ environment, domain: "memory" }, body),
    cookie: auth.cookie,
    headers: { "x-fosu-csrf": auth.csrfToken },
  });
  const saved = await api(harness, "/config/draft", {
    method: "PUT",
    body: { environment, domain: "memory", payload },
    cookie: auth.cookie,
    headers: { "x-fosu-csrf": auth.csrfToken },
  });
  assert.strictEqual(saved.status, 200, `save draft: ${saved.text}`);
  const validated = await write("/config/validate", {});
  assert.strictEqual(validated.status, 200, validated.text);
  assert.strictEqual(validated.json.validation.ok, true, JSON.stringify(validated.json.validation));
  const tested = await write("/config/test", {});
  assert.strictEqual(tested.status, 200, tested.text);
  assert.strictEqual(tested.json.test.ok, true, JSON.stringify(tested.json.test));
  const published = await write("/config/publish", {});
  assert.strictEqual(published.status, 200, published.text);
  assert.strictEqual(published.json.published.version, expectedVersion);
  return published.json.published.configVersion;
}

async function snapshotOf(harness, environment) {
  const response = await api(harness, `/config/snapshot?env=${environment}`, { headers: bearer("c1-config-read-token") });
  assert.strictEqual(response.status, 200, response.text);
  return response.json.snapshot;
}

async function main() {
  const serviceTokensJson = JSON.stringify(SERVICE_TOKENS);
  const harness = await startAdminHttpHarness({
    environment: {
      AI_RUNTIME_MODE: "public",
      AI_AGENT_ENABLED: "false",
      AI_PROVIDER_IGNORE_ENV_FILE: "true",
      ADMIN_SERVICE_TOKENS: serviceTokensJson,
    },
  });
  try {
    // ── A. 认证与 scope 门禁 ─────────────────────────────────────────
    const anonymous = await api(harness, "/config/snapshot?env=dev");
    assert.strictEqual(anonymous.status, 401, `anonymous read must be 401: ${anonymous.status}`);

    const wrongScope = await api(harness, "/config/snapshot?env=dev", { headers: bearer("c1-wrong-token") });
    assert.strictEqual(wrongScope.status, 403, `wrong-scope read must be 403: ${wrongScope.text}`);
    assert.strictEqual(wrongScope.json.code, "ADMIN_SCOPE_DENIED");

    // ── B. 读取链（agent-config:read）────────────────────────────────
    const snapshot = await api(harness, "/config/snapshot?env=dev", { headers: bearer("c1-config-read-token") });
    assert.strictEqual(snapshot.status, 200, snapshot.text);
    assertNoStore(snapshot, "snapshot");
    assert.ok(snapshot.json.initialized, "dev environment must be seeded");
    assert.match(snapshot.json.snapshot.configVersion, /^cfg-dev-/);
    const artifactKeys = Object.keys(snapshot.json.snapshot.artifacts || {});
    assert.strictEqual(artifactKeys.length, 6, `six domains expected: ${artifactKeys.join(",")}`);

    const badEnv = await api(harness, "/config/snapshot?env=staging", { headers: bearer("c1-config-read-token") });
    assert.strictEqual(badEnv.status, 400, badEnv.text);
    assert.strictEqual(badEnv.json.code, "CONFIG_KERNEL_ENVIRONMENT_INVALID");

    const domains = await api(harness, "/config/domains?env=dev", { headers: bearer("c1-config-read-token") });
    assert.strictEqual(domains.status, 200, domains.text);
    assertNoStore(domains, "domains");
    const domainNames = (domains.json.domains || []).map((item) => item.domain).sort();
    assert.deepStrictEqual(domainNames, ["mcp", "memory", "provider", "rag", "skill", "tool"]);
    const memoryDomain = domains.json.domains.find((item) => item.domain === "memory");
    const memoryArtifact = memoryDomain.artifacts[0];
    assert.ok(memoryArtifact.artifactId, "memory artifactId must be discoverable");
    assert.strictEqual(memoryArtifact.publishedVersion, 1);

    // ── C. Cookie 会话写操作必须过 CSRF ──────────────────────────────
    const auth = await harness.login();
    const noCsrf = await api(harness, "/config/draft", {
      method: "PUT",
      body: { environment: "dev", domain: "memory", payload: {} },
      cookie: auth.cookie,
    });
    assert.strictEqual(noCsrf.status, 403, noCsrf.text);
    assert.strictEqual(noCsrf.json.code, "ADMIN_CSRF_REJECTED");

    // ── D. 草稿脱敏与校验拒绝（密钥形态字段不进响应）──────────────────
    const secretDraft = await api(harness, "/config/draft", {
      method: "PUT",
      body: { environment: "dev", domain: "memory", payload: { ttlOverridesMs: { campus: 6912000000 }, apiKey: FAKE_PROVIDER_SECRET } },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(secretDraft.status, 200, secretDraft.text);
    assert.strictEqual(secretDraft.json.draft.payload.apiKey, "[REDACTED]");

    const readSecretDraft = await api(harness, "/config/draft?env=dev&domain=memory", { headers: bearer("c1-config-read-token") });
    assert.strictEqual(readSecretDraft.status, 200, readSecretDraft.text);
    assert.strictEqual(readSecretDraft.json.draft.payload.apiKey, "[REDACTED]");
    assert.strictEqual(readSecretDraft.json.draft.payload.ttlOverridesMs.campus, 6912000000);

    const invalidValidate = await api(harness, "/config/validate", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(invalidValidate.status, 200, invalidValidate.text);
    assert.strictEqual(invalidValidate.json.validation.ok, false, "secret-shaped field must fail domain validation");
    const publishInvalid = await api(harness, "/config/publish", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(publishInvalid.status, 400, publishInvalid.text);
    assert.strictEqual(publishInvalid.json.code, "CONFIG_KERNEL_VALIDATION_REQUIRED");

    // ── E. 门禁链 coded error（dev/memory）────────────────────────────
    const goodPayload = { ttlOverridesMs: { campus: 6912000000 } };
    const saved = await api(harness, "/config/draft", {
      method: "PUT",
      body: { environment: "dev", domain: "memory", payload: goodPayload },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(saved.status, 200, saved.text);
    assert.strictEqual(saved.json.draft.baseVersion, 1);
    assertNoStore(saved, "putDraft");

    const prematurePublish = await api(harness, "/config/publish", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(prematurePublish.status, 400, prematurePublish.text);
    assert.strictEqual(prematurePublish.json.code, "CONFIG_KERNEL_VALIDATION_REQUIRED");

    const prematureTest = await api(harness, "/config/test", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(prematureTest.status, 400, prematureTest.text);
    assert.strictEqual(prematureTest.json.code, "CONFIG_KERNEL_VALIDATION_REQUIRED");

    const validated = await api(harness, "/config/validate", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(validated.status, 200, validated.text);
    assert.strictEqual(validated.json.validation.ok, true, validated.text);

    const untestedPublish = await api(harness, "/config/publish", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(untestedPublish.status, 400, untestedPublish.text);
    assert.strictEqual(untestedPublish.json.code, "CONFIG_KERNEL_TEST_REQUIRED");

    const tested = await api(harness, "/config/test", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(tested.status, 200, tested.text);
    assert.strictEqual(tested.json.test.ok, true, tested.text);

    const devSnapshotBefore = await snapshotOf(harness, "dev");
    const published = await api(harness, "/config/publish", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(published.status, 200, published.text);
    assert.strictEqual(published.json.published.version, 2);
    const devConfigV2 = published.json.published.configVersion;
    assert.notStrictEqual(devConfigV2, devSnapshotBefore.configVersion, "publish must mint a new configVersion");

    // ── F. 版本历史 / 版本内容 / 快照钉住 ─────────────────────────────
    const versions = await api(harness, "/config/versions?env=dev&domain=memory", { headers: bearer("c1-config-read-token") });
    assert.strictEqual(versions.status, 200, versions.text);
    assert.deepStrictEqual(versions.json.versions.map((item) => item.version), [1, 2]);
    assert.strictEqual(versions.json.versions[1].current, true);
    assert.strictEqual(versions.json.versions[0].current, false);

    const artifactV2 = await api(harness, "/config/artifact?env=dev&domain=memory&version=2", { headers: bearer("c1-config-read-token") });
    assert.strictEqual(artifactV2.status, 200, artifactV2.text);
    assert.strictEqual(artifactV2.json.artifact.payload.ttlOverridesMs.campus, 6912000000);

    const badVersion = await api(harness, "/config/artifact?env=dev&domain=memory&version=abc", { headers: bearer("c1-config-read-token") });
    assert.strictEqual(badVersion.status, 400, badVersion.text);
    assert.strictEqual(badVersion.json.code, "CONFIG_KERNEL_VERSION_INVALID");

    const devSnapshotV2 = await snapshotOf(harness, "dev");
    assert.strictEqual(devSnapshotV2.configVersion, devConfigV2);
    assert.strictEqual(devSnapshotV2.artifacts[`memory:${memoryArtifact.artifactId}`].version, 2);

    // ── G. 回滚（只能指向已发布版本）──────────────────────────────────
    const rollbackMissing = await api(harness, "/config/rollback", {
      method: "POST",
      body: { environment: "dev", domain: "memory", toVersion: 99 },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(rollbackMissing.status, 404, rollbackMissing.text);
    assert.strictEqual(rollbackMissing.json.code, "CONFIG_KERNEL_ROLLBACK_TARGET_NOT_FOUND");

    const rolledBack = await api(harness, "/config/rollback", {
      method: "POST",
      body: { environment: "dev", domain: "memory", toVersion: 1 },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(rolledBack.status, 200, rolledBack.text);
    assert.strictEqual(rolledBack.json.rolledBack.version, 1);
    assert.notStrictEqual(rolledBack.json.rolledBack.configVersion, devConfigV2, "rollback must mint a new configVersion");
    const devSnapshotRolledBack = await snapshotOf(harness, "dev");
    assert.strictEqual(devSnapshotRolledBack.artifacts[`memory:${memoryArtifact.artifactId}`].version, 1);

    // ── H. 服务令牌最小权限链（纯机器令牌按既有策略免 CSRF）────────────
    const draftTokenSave = await api(harness, "/config/draft", {
      method: "PUT",
      body: { environment: "dev", domain: "memory", payload: { ttlOverridesMs: { major: 13824000000 } } },
      headers: bearer("c1-config-draft-token"),
    });
    assert.strictEqual(draftTokenSave.status, 200, draftTokenSave.text);

    const draftTokenPublish = await api(harness, "/config/publish", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      headers: bearer("c1-config-draft-token"),
    });
    assert.strictEqual(draftTokenPublish.status, 403, draftTokenPublish.text);
    assert.strictEqual(draftTokenPublish.json.code, "ADMIN_SCOPE_DENIED");

    const validateToken = await api(harness, "/config/validate", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      headers: bearer("c1-config-validate-token"),
    });
    assert.strictEqual(validateToken.status, 200, validateToken.text);
    assert.strictEqual(validateToken.json.validation.ok, true, validateToken.text);
    const testToken = await api(harness, "/config/test", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      headers: bearer("c1-config-validate-token"),
    });
    assert.strictEqual(testToken.status, 200, testToken.text);
    assert.strictEqual(testToken.json.test.ok, true, testToken.text);
    const publishToken = await api(harness, "/config/publish", {
      method: "POST",
      body: { environment: "dev", domain: "memory" },
      headers: bearer("c1-config-publish-token"),
    });
    assert.strictEqual(publishToken.status, 200, publishToken.text);
    assert.strictEqual(publishToken.json.published.version, 3);
    const devSnapshotV3 = await snapshotOf(harness, "dev");
    assert.strictEqual(devSnapshotV3.artifacts[`memory:${memoryArtifact.artifactId}`].version, 3);

    const rollbackToken = await api(harness, "/config/rollback", {
      method: "POST",
      body: { environment: "dev", domain: "memory", toVersion: 1 },
      headers: bearer("c1-config-rollback-token"),
    });
    assert.strictEqual(rollbackToken.status, 200, rollbackToken.text);
    assert.strictEqual(rollbackToken.json.rolledBack.version, 1);

    // ── I. 审计读取 scope 与内容 ─────────────────────────────────────
    const auditWrongScope = await api(harness, "/config/audit?env=dev", { headers: bearer("c1-config-read-token") });
    assert.strictEqual(auditWrongScope.status, 403, auditWrongScope.text);
    const audit = await api(harness, "/config/audit?env=dev&limit=100", { headers: bearer("c1-config-audit-token") });
    assert.strictEqual(audit.status, 200, audit.text);
    assertNoStore(audit, "audit");
    const auditOps = audit.json.entries.map((entry) => entry.op);
    ["draft.save", "draft.validate", "draft.test", "publish", "rollback"].forEach((op) => {
      assert.ok(auditOps.includes(op), `audit must contain ${op}: ${auditOps.join(",")}`);
    });
    const publishAudit = audit.json.entries.find((entry) => entry.op === "publish" && entry.version === 3);
    assert.ok(publishAudit && publishAudit.configVersion, "publish audit entry must carry configVersion");

    // ── J. 发布→新 Run 绑定新 configVersion→回滚恢复（public 环境）────
    const publicSnapshotBefore = await snapshotOf(harness, "public");
    const publicConfigV2 = await publishChain(harness, auth, "public", { ttlOverridesMs: { grade: 13824000000 } }, 2);
    const runAfterPublish = await createRunAndWait(harness, "after-publish");
    assert.strictEqual(runAfterPublish.trace.configVersion, publicConfigV2,
      `new run must bind the published snapshot: ${runAfterPublish.trace.configVersion} vs ${publicConfigV2}`);

    const publicRollback = await api(harness, "/config/rollback", {
      method: "POST",
      body: { environment: "public", domain: "memory", toVersion: 1 },
      cookie: auth.cookie,
      headers: { "x-fosu-csrf": auth.csrfToken },
    });
    assert.strictEqual(publicRollback.status, 200, publicRollback.text);
    const publicSnapshotRestored = await snapshotOf(harness, "public");
    assert.strictEqual(publicSnapshotRestored.artifacts[`memory:${memoryArtifact.artifactId}`].version, 1);
    assert.notStrictEqual(publicSnapshotRestored.configVersion, publicConfigV2);
    const runAfterRollback = await createRunAndWait(harness, "after-rollback");
    assert.strictEqual(runAfterRollback.trace.configVersion, publicSnapshotRestored.configVersion);
    assert.notStrictEqual(runAfterRollback.trace.configVersion, publicConfigV2);
    assert.strictEqual(publicSnapshotRestored.configVersion === publicSnapshotBefore.configVersion, false,
      "rollback mints a new snapshot id even when content matches the original");

    // ── K. Run Trace 详情（脱敏 + coded 404）──────────────────────────
    const traceAnonymous = await api(harness, `/runs/${encodeURIComponent(runAfterPublish.runId)}`);
    assert.strictEqual(traceAnonymous.status, 401);
    const traceWrongScope = await api(harness, `/runs/${encodeURIComponent(runAfterPublish.runId)}`, { headers: bearer("c1-wrong-token") });
    assert.strictEqual(traceWrongScope.status, 403);
    const traceResponse = await api(harness, `/runs/${encodeURIComponent(runAfterPublish.runId)}`, { headers: bearer("c1-config-read-token") });
    assert.strictEqual(traceResponse.status, 200, traceResponse.text);
    assertNoStore(traceResponse, "run trace");
    assert.strictEqual(traceResponse.json.trace.runId, runAfterPublish.runId);
    assert.strictEqual(traceResponse.json.trace.configVersion, publicConfigV2);
    assert.ok(Array.isArray(traceResponse.json.trace.stages) && traceResponse.json.trace.stages.length >= 3,
      "trace must carry per-stage rows");
    traceResponse.json.trace.stages.forEach((stage) => {
      assert.ok(stage.stage && stage.outcome && Number.isFinite(stage.durationMs), `stage row malformed: ${JSON.stringify(stage)}`);
    });
    const missingTrace = await api(harness, "/runs/run-does-not-exist", { headers: bearer("c1-config-read-token") });
    assert.strictEqual(missingTrace.status, 404, missingTrace.text);
    assert.strictEqual(missingTrace.json.code, "AGENT_RUN_TRACE_NOT_FOUND");

    // ── L. 全响应体密钥扫描 ──────────────────────────────────────────
    collectedResponses.forEach(({ path, text }) => {
      assert.ok(!SECRET_VALUE_PATTERN.test(text), `secret-shaped value leaked in response of ${path}`);
      FORBIDDEN_LITERALS.forEach((literal) => {
        assert.ok(!text.includes(literal), `credential literal ${literal} leaked in response of ${path}`);
      });
    });

    console.log(`test-agent-config-plane: PASS (${collectedResponses.length} responses scanned)`);
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

#!/usr/bin/env node
// P4a：Config Publication Kernel 状态机验收（specs/xiaofu-agent-product-platform/tasks.md P4a）。
//   - draft → validate → test → publish 顺序门控；validate/test 失败不动生产指针；
//   - 发布/回滚只影响新快照；旧快照与旧版本可解析（在途 Run 稳定）；
//   - rollback 只切已发布版本；current 引用原子切换；
//   - 热加载失败回退 last-known-good；损坏 fail closed；重启恢复；
//   - 种子只初始化空环境、只升级 seed-origin 版本，不覆盖 admin 发布；
//   - 环境隔离；审计有序落盘；草稿非声明式负载被拒。
// P5a：内核公开方法全部 async（文件适配器同步返回被 await 透明容忍），
// 本套件随之 await 化；领域断言零变化。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createConfigKernel,
  createConfigKernelFileRepository,
} = require("../packages/agent-runtime");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "config-kernel-test-"));
}

async function throwsCode(fn, code) {
  await assert.rejects(async () => {
    await fn();
  }, (error) => error && error.code === code);
}

function toyAdapter(overrides = {}) {
  return Object.assign({
    validate(payload) {
      if (payload && payload.valid === false) return { ok: false, errors: ["payload.valid is false"] };
      return { ok: true, errors: [], normalized: payload };
    },
    test(normalized) {
      if (normalized && normalized.failTest === true) return { ok: false, results: { reason: "forced" } };
      return { ok: true, results: { checked: 1 } };
    },
    composeSnapshotEntry(doc) {
      return { size: JSON.stringify(doc.payload).length };
    },
  }, overrides);
}

function createKernel(root, { adapter, logger } = {}) {
  const events = [];
  const kernel = createConfigKernel({
    repository: createConfigKernelFileRepository({ root }),
    domainAdapters: { skill: adapter || toyAdapter() },
    environments: ["public", "trial", "dev"],
    logger: logger || ((entry) => events.push(entry)),
  });
  return { kernel, events };
}

async function testDraftGatesAndPublish() {
  const root = tmpRoot();
  const { kernel } = createKernel(root);
  const input = { domain: "skill", artifactId: "demo", environment: "trial", payload: { version: "a" }, actor: "tester" };

  // 未 validate 不能 test / publish
  await kernel.saveDraft(input);
  await throwsCode(() => kernel.testDraft(input), "CONFIG_KERNEL_VALIDATION_REQUIRED");
  await throwsCode(() => kernel.publishDraft(input), "CONFIG_KERNEL_VALIDATION_REQUIRED");

  // validate 失败：不动生产指针（当前无快照），审计记录 failed
  await kernel.saveDraft(Object.assign({}, input, { payload: { valid: false } }));
  const failed = await kernel.validateDraft(input);
  assert.strictEqual(failed.ok, false);
  assert.deepStrictEqual(failed.errors, ["payload.valid is false"]);
  await throwsCode(() => kernel.testDraft(input), "CONFIG_KERNEL_VALIDATION_REQUIRED");
  assert.strictEqual(await kernel.getCurrentSnapshot("trial"), null);

  // validate ok 但 test 失败：publish 被挡
  await kernel.saveDraft(Object.assign({}, input, { payload: { failTest: true } }));
  assert.strictEqual((await kernel.validateDraft(input)).ok, true);
  assert.strictEqual((await kernel.testDraft(input)).ok, false);
  await throwsCode(() => kernel.publishDraft(input), "CONFIG_KERNEL_TEST_REQUIRED");
  assert.strictEqual(await kernel.getCurrentSnapshot("trial"), null);

  // 完整链路：publish 生成 v1 + 新快照 + LKG + 审计
  await kernel.saveDraft(input);
  assert.strictEqual((await kernel.validateDraft(input)).ok, true);
  assert.strictEqual((await kernel.testDraft(input)).ok, true);
  const published = await kernel.publishDraft(input);
  assert.strictEqual(published.version, 1);
  assert.match(published.configVersion, /^cfg-trial-0001-[0-9a-f]{12}$/);
  const snapshot = await kernel.getCurrentSnapshot("trial");
  assert.strictEqual(snapshot.configVersion, published.configVersion);
  assert.strictEqual(snapshot.artifacts["skill:demo"].version, 1);
  assert.strictEqual(snapshot.artifacts["skill:demo"].summary.size, JSON.stringify({ version: "a" }).length);
  const ops = (await kernel.listAudit({ limit: 50 })).map((entry) => `${entry.op}:${entry.result}`);
  assert.strictEqual(ops[0], "draft.save:ok");
  assert.ok(ops.indexOf("draft.validate:failed") < ops.indexOf("draft.test:failed"), "validate failure precedes test failure");
  assert.ok(ops.indexOf("draft.test:failed") < ops.indexOf("publish:ok"), "failures precede the successful publish");
  assert.strictEqual(ops[ops.length - 1], "publish:ok");
  console.log("✓ draft/validate/test/publish gates; failures never move the pointer");
}

async function testRollbackAndStability() {
  const root = tmpRoot();
  const { kernel } = createKernel(root);
  const input = { domain: "skill", artifactId: "demo", environment: "trial", actor: "tester" };

  await kernel.saveDraft(Object.assign({}, input, { payload: { version: "v1-content" } }));
  await kernel.validateDraft(input);
  await kernel.testDraft(input);
  const v1 = await kernel.publishDraft(input);

  await kernel.saveDraft(Object.assign({}, input, { payload: { version: "v2-content" } }));
  await kernel.validateDraft(input);
  await kernel.testDraft(input);
  const v2 = await kernel.publishDraft(input);
  assert.strictEqual(v2.version, 2);
  assert.notStrictEqual(v2.configVersion, v1.configVersion);

  // 在途稳定性：旧快照与旧版本在 v2 发布后仍可解析
  const v1Doc = await kernel.getArtifactVersion({ domain: "skill", artifactId: "demo", environment: "trial", version: 1 });
  assert.strictEqual(v1Doc.payload.version, "v1-content");
  const history = await kernel.listHistory({ domain: "skill", artifactId: "demo", environment: "trial" });
  assert.deepStrictEqual(history.map((item) => [item.version, item.current]), [[1, false], [2, true]]);

  // rollback 只切已发布版本，并产生新快照（seq 递增）
  const rolled = await kernel.rollback({ domain: "skill", artifactId: "demo", environment: "trial", toVersion: 1, actor: "ops" });
  assert.strictEqual(rolled.version, 1);
  assert.match(rolled.configVersion, /^cfg-trial-0003-[0-9a-f]{12}$/);
  assert.strictEqual((await kernel.getCurrentSnapshot("trial")).artifacts["skill:demo"].version, 1);
  await throwsCode(
    () => kernel.rollback({ domain: "skill", artifactId: "demo", environment: "trial", toVersion: 99 }),
    "CONFIG_KERNEL_ROLLBACK_TARGET_NOT_FOUND"
    );
  await throwsCode(
    () => kernel.rollback({ domain: "skill", artifactId: "never-published", environment: "trial", toVersion: 1 }),
    "CONFIG_KERNEL_ROLLBACK_TARGET_NOT_FOUND"
    );
  assert.ok((await kernel.listAudit({ limit: 50 })).some((entry) => entry.op === "rollback" && entry.result === "ok"));
  console.log("✓ rollback only switches to published versions; old snapshots stay resolvable");
}

async function testEnvironmentIsolationAndDeclarative() {
  const root = tmpRoot();
  const { kernel } = createKernel(root);
  const input = { domain: "skill", artifactId: "demo", environment: "trial", payload: { x: 1 }, actor: "tester" };
  await kernel.saveDraft(input);
  await kernel.validateDraft(input);
  await kernel.testDraft(input);
  await kernel.publishDraft(input);
  assert.strictEqual(await kernel.getCurrentSnapshot("dev"), null);
  assert.strictEqual(await kernel.getCurrentSnapshot("public"), null);
  await throwsCode(() => kernel.saveDraft(Object.assign({}, input, { environment: "prod" })), "CONFIG_KERNEL_ENVIRONMENT_INVALID");
  await throwsCode(() => kernel.getCurrentSnapshot("prod"), "CONFIG_KERNEL_ENVIRONMENT_INVALID");
  // 非声明式负载（函数/undefined 字段）被拒
  await throwsCode(
    () => kernel.saveDraft(Object.assign({}, input, { payload: { run: () => 1 } })),
    "CONFIG_KERNEL_PAYLOAD_NOT_DECLARATIVE"
    );
  await throwsCode(
    () => kernel.saveDraft(Object.assign({}, input, { payload: { nested: { gone: undefined } } })),
    "CONFIG_KERNEL_PAYLOAD_NOT_DECLARATIVE"
    );
  await throwsCode(() => kernel.saveDraft(Object.assign({}, input, { payload: [1, 2] })), "CONFIG_KERNEL_PAYLOAD_INVALID");
  console.log("✓ environments are isolated; non-declarative payloads are rejected");
}

async function testLkgAndFailClosed() {
  const root = tmpRoot();
  const loggerEvents = [];
  const { kernel } = createKernel(root, { logger: (entry) => loggerEvents.push(entry) });
  const input = { domain: "skill", artifactId: "demo", environment: "trial", payload: { v: 1 }, actor: "tester" };
  await kernel.saveDraft(input);
  await kernel.validateDraft(input);
  await kernel.testDraft(input);
  const published = await kernel.publishDraft(input);

  // current 引用损坏：回退 LKG，记录安全诊断
  fs.writeFileSync(path.join(root, "current", "trial.json"), "not-json{{{", "utf8");
  const served = await kernel.getCurrentSnapshot("trial");
  assert.strictEqual(served.configVersion, published.configVersion);
  assert.ok(loggerEvents.some((entry) => entry.event === "config-kernel-serving-lkg"));

  // 快照文档损坏（current 引用本身有效）：同样回退 LKG
  await createConfigKernelFileRepository({ root }).writeCurrentRef("trial", published.configVersion);
  const snapshotFile = path.join(root, "snapshots", "trial", `${published.configVersion}.json`);
  fs.writeFileSync(snapshotFile, JSON.stringify({ configVersion: "tampered" }), "utf8");
  const servedAgain = await kernel.getCurrentSnapshot("trial");
  assert.strictEqual(servedAgain.configVersion, published.configVersion);

  // LKG 也不可用且曾发布过：fail closed（不静默重置为空配置）
  fs.unlinkSync(path.join(root, "lkg", "trial.json"));
  await throwsCode(() => kernel.getCurrentSnapshot("trial"), "CONFIG_KERNEL_SNAPSHOT_UNREADABLE");

  // 修复后发布 v2 恢复正常
  await kernel.saveDraft(Object.assign({}, input, { payload: { v: 2 } }));
  await kernel.validateDraft(input);
  await kernel.testDraft(input);
  const v2 = await kernel.publishDraft(input);
  assert.strictEqual((await kernel.getCurrentSnapshot("trial")).configVersion, v2.configVersion);
  console.log("✓ hot-load failure serves last-known-good; corruption fails closed, never resets to empty");
}

async function testSeedAndRestartRecovery() {
  const root = tmpRoot();
  const seedPayload = { skills: [{ id: "alpha" }] };
  const seed = { domain: "skill", artifactId: "campus", payload: seedPayload, sourceDigest: "digest-a" };
  const { kernel } = createKernel(root);

  // 初始化种子
  const first = await kernel.seedEnvironment("trial", [seed]);
  assert.deepStrictEqual(first, [{ key: "skill:campus", action: "initialized", version: 1 }]);
  const seededSnapshot = await kernel.getCurrentSnapshot("trial");
  assert.strictEqual(seededSnapshot.artifacts["skill:campus"].version, 1);

  // 幂等：再次种子不新增版本
  assert.deepStrictEqual(await kernel.seedEnvironment("trial", [seed]), [{ key: "skill:campus", action: "kept", version: 1 }]);

  // 重启恢复：新内核实例读到同一快照
  const { kernel: rebooted } = createKernel(root);
  assert.strictEqual((await rebooted.getCurrentSnapshot("trial")).configVersion, seededSnapshot.configVersion);

  // seed-origin 且 sourceDigest 变化：自动升级
  const upgraded = await rebooted.seedEnvironment("trial", [Object.assign({}, seed, { sourceDigest: "digest-b" })]);
  assert.deepStrictEqual(upgraded, [{ key: "skill:campus", action: "upgraded", version: 2 }]);

  // admin 发布后：种子不再覆盖
  const input = { domain: "skill", artifactId: "campus", environment: "trial", payload: { skills: [{ id: "admin-custom" }] }, actor: "admin1" };
  await rebooted.saveDraft(input);
  await rebooted.validateDraft(input);
  await rebooted.testDraft(input);
  await rebooted.publishDraft(input);
  const kept = await rebooted.seedEnvironment("trial", [Object.assign({}, seed, { sourceDigest: "digest-c" })]);
  assert.deepStrictEqual(kept, [{ key: "skill:campus", action: "kept", version: 3 }]);
  assert.strictEqual(
    (await rebooted.getArtifactVersion({ domain: "skill", artifactId: "campus", environment: "trial", version: 3 })).payload.skills[0].id,
    "admin-custom"
  );
  console.log("✓ seeds initialize empty environments and upgrade only seed-origin versions; restart recovers");
}

async function run() {
  await testDraftGatesAndPublish();
  await testRollbackAndStability();
  await testEnvironmentIsolationAndDeclarative();
  await testLkgAndFailClosed();
  await testSeedAndRestartRecovery();
  console.log("\ntest-agent-config-kernel: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

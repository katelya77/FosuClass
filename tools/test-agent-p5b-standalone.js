#!/usr/bin/env node
// P5b WS-A：standalone 核心运行时回归（regression runner 按 test-agent-* 自动纳入）。
//
// 结构（与 test-agent-p5a-consumer-wiring.js 同型：父进程编排 + 子进程隔离 env）：
//
// 1) 父进程离线段（任何环境都执行）：
//    - 角色分发单测：resolveRole 默认 server / 四角色 / 非法值 coded
//      AGENT_PLATFORM_ROLE_INVALID（谓词断言）；worker 构造守卫（file 后端
//      AGENT_WORKER_BACKEND_REQUIRED；postgres 但无 AGENT_REDIS_URL →
//      TASK_QUEUE_REDIS_CONFIG_REQUIRED）；
//    - 子进程 role-invalid：真实 node agentServerMain.js + 非法角色 → exit 1
//      且结构化日志含 errorClass=AGENT_PLATFORM_ROLE_INVALID；
//    - 子进程 migrate-dead：死 PG → exit 1 且日志含 migrate-failed。
//
// 2) 子进程 offline（死 PG，任何环境都执行）：
//    - app 可启动（live 200）；startup 如实 failed（AGENT_PLATFORM_INIT_FAILED）；
//    - readiness 九项细分齐全：postgres/migration/artifactRepository/
//      configSnapshot/ragBackend/publishedConfigVersion 如实 not_ready，
//      redis/workerQueue 未配置 unknown，provider not_ready
//      PROVIDER_NOT_CONFIGURED 且 blocking=false，整体 503 但进程健康；
//    - capabilities.publicDeterministic=true / strictModelFirstReady=false；
//    - config-plane：无令牌 401 / scope 不足 403 / 全权令牌经 init 门 503 coded；
//    - fosu 接缝 501 FOSU_CAMPUS_NOT_ENABLED（offline-fosu 子进程 env=1 →
//      FOSU_CAMPUS_ASSEMBLY_NOT_IMPLEMENTED）；Admin 静态页 200；
//    - require.cache 无 fosu-campus/platformComposition/providerChainService/
//      releaseService/capabilityManifestService/cloudbase/routes/ai。
//
// 3) PG+Redis 段（AGENT_TEST_PG_URL/AGENT_TEST_REDIS_URL 或 docker 临时容器；
//    不可用 → 该段 UNVERIFIED exit 0）：closed-loop 子进程跑无 fosu-campus
//    启动闭环（migrate→server 启动→Skill 草稿→validate/test/publish→Tool/MCP
//    发布→KB 发布→Run 绑定 configVersion→RunEvent→内置只读示例 Skill→worker
//    完成异步索引→RAG 查询真实引用→未知 kind dead-letter→重启持久→rollback
//    新 Run 用旧版本→public 外部 Provider 调用 0）；serve/worker-graceful
//    子进程验证四角色入口与 SIGTERM 优雅退出（exit 0）。
//
// 纪律：断言 assert.throws/rejects 第二参一律谓词函数；子进程退出前
// closeForTests()/closePool() 与 queue.close()。

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHILD_MODE = String(process.env.P5B_CHILD || "");
const R = (p) => require(path.join(ROOT, p));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetJson(base, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${urlPath}`, { method: "GET", headers: headers || {} }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function httpJson(base, method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${urlPath}`, {
      method,
      headers: Object.assign({ "content-type": "application/json" }, headers || {}),
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject);
    req.end(JSON.stringify(body || {}));
  });
}

async function listenApp(app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function assertNoFosuLoaded() {
  const forbidden = Object.keys(require.cache).filter((p) => /fosu-campus|platformComposition|providerChainService|releaseService|capabilityManifestService|cloudbase|routes[\\/]ai\.js|releaseWorkerManager|runtimePointerService/i.test(p));
  assert.deepStrictEqual(forbidden, [], `standalone 不得加载 Fosu 模块: ${forbidden.join(", ")}`);
}

const EXPECTED_READY_ITEMS = [
  "postgres", "redis", "migration", "artifactRepository", "configSnapshot",
  "workerQueue", "ragBackend", "provider", "publishedConfigVersion",
];

// ---------- 子进程：offline（死 PG 全表面）----------
async function runOfflineChild() {
  const { createStandaloneApp } = R("server/src/standalone/createStandaloneApp");
  const { app, composition } = createStandaloneApp({ role: "server", logger: () => {} });
  composition.start().catch(() => {});
  const server = await listenApp(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const live = await httpGetJson(base, "/health/live");
    assert.strictEqual(live.status, 200, JSON.stringify(live.json));
    assert.strictEqual(live.json.status, "alive");
    assert.strictEqual(live.json.serviceRole, "server");

    await assert.rejects(
      () => composition.start(),
      (error) => error && error.code === "AGENT_PLATFORM_INIT_FAILED"
    );
    const startup = await httpGetJson(base, "/health/startup");
    assert.strictEqual(startup.status, 503, JSON.stringify(startup.json));
    assert.strictEqual(startup.json.status, "failed");
    assert.strictEqual(startup.json.code, "AGENT_PLATFORM_INIT_FAILED");

    const ready = await httpGetJson(base, "/health/ready");
    assert.strictEqual(ready.status, 503, JSON.stringify(ready.json));
    assert.strictEqual(ready.json.status, "not_ready");
    assert.deepStrictEqual(Object.keys(ready.json.items).sort(), EXPECTED_READY_ITEMS.slice().sort(),
      "readiness 必须细分九项");
    assert.strictEqual(ready.json.items.provider.status, "not_ready");
    assert.strictEqual(ready.json.items.provider.reason, "PROVIDER_NOT_CONFIGURED");
    assert.strictEqual(ready.json.items.provider.blocking, false);
    assert.strictEqual(ready.json.items.redis.status, "unknown");
    assert.strictEqual(ready.json.items.redis.reason, "REDIS_NOT_CONFIGURED");
    assert.strictEqual(ready.json.items.workerQueue.status, "unknown");
    assert.strictEqual(ready.json.items.postgres.status, "not_ready");
    assert.strictEqual(ready.json.items.migration.status, "not_ready");
    assert.strictEqual(ready.json.items.publishedConfigVersion.reason, "CONFIG_VERSION_NOT_PUBLISHED");
    assert.strictEqual(ready.json.capabilities.publicDeterministic, true);
    assert.strictEqual(ready.json.capabilities.strictModelFirstReady, false);
    assert.strictEqual(ready.json.capabilities.externalProviderCallsInPublic, 0);
    console.log("✓ offline：三探针 + readiness 九项细分（provider 未配置不拖垮进程）");

    const noAuth = await httpGetJson(base, "/api/admin/agent-platform/config/snapshot?env=public");
    assert.strictEqual(noAuth.status, 401, JSON.stringify(noAuth.json));
    assert.strictEqual(noAuth.json.code, "AGENT_AUTH_REQUIRED");
    const noScope = await httpJson(base, "PUT", "/api/admin/agent-platform/config/draft", { environment: "public", domain: "skill", payload: {} }, { authorization: "Bearer p5b-read-token" });
    assert.strictEqual(noScope.status, 403, JSON.stringify(noScope.json));
    assert.strictEqual(noScope.json.code, "AGENT_AUTH_SCOPE_DENIED");
    const gated = await httpGetJson(base, "/api/admin/agent-platform/config/snapshot?env=public", { authorization: "Bearer p5b-admin-token" });
    assert.strictEqual(gated.status, 503, JSON.stringify(gated.json));
    assert.strictEqual(gated.json.code, "AGENT_PLATFORM_INIT_FAILED");
    console.log("✓ offline：config-plane 鉴权 401/403 + init 门 503 coded");

    const seam = await httpGetJson(base, "/api/agent/integrations/fosu-campus");
    assert.strictEqual(seam.status, 501, JSON.stringify(seam.json));
    const expectedSeamCode = process.env.AGENT_PLATFORM_ENABLE_FOSU === "1"
      ? "FOSU_CAMPUS_ASSEMBLY_NOT_IMPLEMENTED"
      : "FOSU_CAMPUS_NOT_ENABLED";
    assert.strictEqual(seam.json.code, expectedSeamCode);
    assert.strictEqual(seam.json.assembled, false);

    const adminPage = await httpGetJson(base, "/admin/agent-platform/");
    assert.strictEqual(adminPage.status, 200, "admin 静态页必须可打开");
    assert.ok(adminPage.text.includes("<html") || adminPage.text.includes("Agent"), "admin 静态页内容异常");
    const runtimeConfig = await httpGetJson(base, "/admin/agent-platform/runtime-config.js");
    assert.strictEqual(runtimeConfig.status, 200);
    assert.ok(runtimeConfig.text.includes("AGENT_ADMIN_RUNTIME_CONFIG"));
    console.log(`✓ offline：fosu 接缝 501 ${expectedSeamCode}；Admin 静态页 200`);

    assertNoFosuLoaded();
    console.log("✓ offline：require.cache 无 fosu-campus/Fosu 路由/CloudBase 模块");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await composition.close();
    await R("server/src/services/ai/persistence/pgPersistenceService").closeForTests();
  }
  console.log("P5B-OFFLINE PASS");
}

// ---------- 子进程：closed-loop（真实 PG+Redis 闭环）----------
async function runClosedLoopChild() {
  const admin = { authorization: "Bearer p5b-admin-token" };
  const env = process.env;
  const { createStandaloneApp } = R("server/src/standalone/createStandaloneApp");
  const { createWorkerRuntime } = R("server/src/standalone/workerMain");
  const { runMigrate } = R("server/src/standalone/migrateMain");
  const pgPersistenceService = R("server/src/services/ai/persistence/pgPersistenceService");

  const migrateCode = await runMigrate({ logger: () => {} });
  assert.strictEqual(migrateCode, 0, "migrate 必须 exit 0");
  console.log("✓ closed-loop：migrate 角色跑通（exit 0）");

  const { app, composition } = createStandaloneApp({ role: "server", logger: () => {} });
  composition.start().catch(() => {});
  const worker = createWorkerRuntime({ env, logger: () => {} });
  const workerRun = worker.start().catch((error) => ({ failed: String(error && error.code || error) }));
  const server = await listenApp(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  async function pollStartup() {
    const deadline = Date.now() + 60000;
    for (;;) {
      const res = await httpGetJson(base, "/health/startup");
      if (res.status === 200) return;
      if (Date.now() > deadline) throw new Error(`startup 未就绪: ${JSON.stringify(res.json)}`);
      await sleep(250);
    }
  }
  async function createRun(message, requestId) {
    const created = await httpJson(base, "POST", "/api/agent/runs", {
      message,
      requestId: requestId || `p5b-${crypto.randomBytes(4).toString("hex")}`,
      conversationId: "p5b-loop-conv",
      context: {},
    }, null);
    assert.strictEqual(created.status, 202, JSON.stringify(created.json));
    const deadline = Date.now() + 30000;
    for (;;) {
      const view = await httpGetJson(base, `/api/agent/runs/${encodeURIComponent(created.json.runId)}?pollToken=${encodeURIComponent(created.json.pollToken)}`);
      assert.strictEqual(view.status, 200, JSON.stringify(view.json));
      if (["completed", "degraded", "failed", "cancelled"].includes(view.json.status)) {
        return { accepted: created.json, view: view.json };
      }
      if (Date.now() > deadline) throw new Error(`run 未收敛: ${JSON.stringify(view.json)}`);
      await sleep(150);
    }
  }

  try {
    await pollStartup();
    const ready = await httpGetJson(base, "/health/ready");
    assert.strictEqual(ready.status, 200, JSON.stringify(ready.json));
    assert.strictEqual(ready.json.status, "ready");
    EXPECTED_READY_ITEMS.forEach((name) => assert.ok(ready.json.items[name], `readiness 缺项 ${name}`));
    ["postgres", "redis", "migration", "artifactRepository", "configSnapshot", "workerQueue", "ragBackend", "publishedConfigVersion"]
      .forEach((name) => assert.strictEqual(ready.json.items[name].status, "ok", `${name}: ${JSON.stringify(ready.json.items[name])}`));
    assert.strictEqual(ready.json.items.provider.status, "not_ready");
    assert.strictEqual(ready.json.items.provider.reason, "PROVIDER_NOT_CONFIGURED");
    assert.strictEqual(ready.json.items.provider.blocking, false);
    assert.strictEqual(ready.json.capabilities.publicDeterministic, true);
    assert.strictEqual(ready.json.capabilities.strictModelFirstReady, false);
    console.log("✓ closed-loop：startup 200 + readiness ready（provider 如实 not_ready 不阻断）");

    // ---- 声明式 Skill 草稿 → validate/test/publish ----
    async function publishDomain(domain, payload, label) {
      const put = await httpJson(base, "PUT", "/api/admin/agent-platform/config/draft", {
        environment: "public", domain, artifactId: "standalone-core", payload,
      }, admin);
      assert.strictEqual(put.status, 200, `${label} putDraft: ${put.text}`);
      const validated = await httpJson(base, "POST", "/api/admin/agent-platform/config/validate", { environment: "public", domain, artifactId: "standalone-core" }, admin);
      assert.strictEqual(validated.status, 200, `${label} validate: ${validated.text}`);
      assert.strictEqual(validated.json.validation && validated.json.validation.ok, true, `${label} validation: ${validated.text}`);
      const tested = await httpJson(base, "POST", "/api/admin/agent-platform/config/test", { environment: "public", domain, artifactId: "standalone-core" }, admin);
      assert.strictEqual(tested.status, 200, `${label} test: ${tested.text}`);
      assert.strictEqual(tested.json.test && tested.json.test.ok, true, `${label} test report: ${tested.text}`);
      const published = await httpJson(base, "POST", "/api/admin/agent-platform/config/publish", { environment: "public", domain, artifactId: "standalone-core" }, admin);
      assert.strictEqual(published.status, 200, `${label} publish: ${published.text}`);
      return published.json.published;
    }

    const seedSkillPayload = JSON.parse(JSON.stringify(composition.domainAdapters.skill.seedPayload()));
    seedSkillPayload.skills = seedSkillPayload.skills.map((skill) => (skill.id === "platform.time"
      ? Object.assign({}, skill, { description: "P5b acceptance: report the server clock." })
      : skill));
    const publishedSkill = await publishDomain("skill", seedSkillPayload, "skill");
    assert.strictEqual(publishedSkill && publishedSkill.version, 2);
    console.log("✓ closed-loop：声明式 Skill 草稿→validate/test/publish（v2）");

    // ---- 受控 Tool / MCP 发布 ----
    const publishedTool = await publishDomain("tool", { tools: [{ id: "platform.clock", enabled: true }] }, "tool");
    assert.strictEqual(publishedTool && publishedTool.version, 2);
    const publishedMcp = await publishDomain("mcp", { servers: [] }, "mcp");
    assert.ok(publishedMcp && publishedMcp.version >= 1, JSON.stringify(publishedMcp));
    console.log("✓ closed-loop：受控 Tool overlay（v2）+ MCP 空注册表发布");

    // ---- KB 上传发布（RAG 域 v2）----
    const kbPayload = {
      kbId: "platform-example",
      documents: [{
        docId: "p5b-acceptance",
        title: "P5b 验收文档",
        kind: "note",
        tags: ["p5b", "acceptance"],
        text: "Standalone 平台包含 server、worker、admin、migrate 四个角色。配置发布采用草稿、校验、测试、发布四段流程，回滚把发布指针切回历史版本。",
      }],
    };
    const publishedKb = await publishDomain("rag", kbPayload, "rag");
    assert.strictEqual(publishedKb && publishedKb.version, 2);
    const publishedConfigVersion = publishedKb.configVersion;
    console.log("✓ closed-loop：KB 上传发布（rag v2）");

    // ---- Run：内置只读示例 Skill（platform.time），绑定发布 configVersion ----
    const timeRun = await createRun("现在几点了？");
    assert.strictEqual(timeRun.view.status, "completed", JSON.stringify(timeRun.view).slice(0, 400));
    const timeResult = timeRun.view.result;
    assert.ok(timeResult && timeResult.platformTrace, "Run 结果必须含 platformTrace");
    assert.strictEqual(timeResult.platformTrace.configVersion, publishedConfigVersion, "Run 必须绑定创建时发布的 configVersion");
    assert.ok(String(timeResult.answer || "").includes("UTC"), `time skill 应答异常: ${timeResult.answer}`);
    assert.strictEqual(timeResult.externalProviderUsed, false);
    assert.strictEqual(timeResult.provider, "");
    assert.ok(timeResult.ui && Array.isArray(timeResult.ui.blocks) && timeResult.ui.blocks.length, "通用 UI Schema blocks 必须生成");
    const eventTypes = (timeRun.view.events || []).map((event) => event.type);
    ["run.accepted", "runtime.entered", "stage.started", "stage.completed", "runtime.completed", "run.completed"]
      .forEach((type) => assert.ok(eventTypes.includes(type), `缺 RunEvent ${type}: ${eventTypes.join(",")}`));
    console.log("✓ closed-loop：Run 绑定 configVersion + RunEvent 全链 + 内置只读示例 Skill（platform.time）+ UI blocks");

    // ---- RAG：worker 异步索引 → 查询返回真实引用 ----
    let kbRun = null;
    const kbDeadline = Date.now() + 45000;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      kbRun = await createRun("配置发布流程是怎样的？");
      const citations = kbRun.view.result && kbRun.view.result.citations || [];
      if (citations.some((item) => item.docId === "p5b-acceptance")) break;
      if (Date.now() > kbDeadline) {
        throw new Error(`KB Run 未返回真实引用: ${JSON.stringify(kbRun.view.result && kbRun.view.result.answer)}`);
      }
      await sleep(1500);
    }
    const kbCitations = kbRun.view.result.citations;
    assert.ok(kbCitations.some((item) => item.docId === "p5b-acceptance"), `引用必须含 p5b-acceptance: ${JSON.stringify(kbCitations)}`);
    assert.ok(String(kbRun.view.result.answer || "").includes("配置发布"), "KB 应答必须基于真实命中");
    assert.strictEqual(kbRun.view.result.externalProviderUsed, false);
    const indexJob = await composition.getQueue().get("rag:public:platform-example:v2");
    assert.ok(indexJob && indexJob.status === "done", `worker 必须完成异步索引任务: ${JSON.stringify(indexJob)}`);
    console.log("✓ closed-loop：worker 完成异步索引任务（job done）+ RAG 查询返回真实引用");

    // ---- 未知 kind：明确 reject 进 dead-letter（绝不执行任意 shell）----
    const bogusJobId = `p5b-unknown-${crypto.randomBytes(4).toString("hex")}`;
    await composition.getQueue().enqueue({ jobId: bogusJobId, kind: "shell.exec", payload: { command: "echo pwned" } });
    const deadDeadline = Date.now() + 30000;
    for (;;) {
      const dead = await composition.getQueue().listDead();
      const hit = dead.find((entry) => entry.jobId === bogusJobId);
      if (hit) {
        assert.strictEqual(hit.errorClass, "TASK_QUEUE_JOB_KIND_UNSUPPORTED", JSON.stringify(hit));
        break;
      }
      if (Date.now() > deadDeadline) throw new Error("未知 kind 未进入 dead-letter");
      await sleep(300);
    }
    console.log("✓ closed-loop：未知 kind(shell.exec) 明确 reject 进 dead-letter，未进任何执行链");

    // ---- 重启持久：新组合实例（同一 PG/Redis）数据仍在 ----
    const { createStandaloneComposition } = R("server/src/standalone/standaloneComposition");
    const composition2 = createStandaloneComposition({ env, logger: () => {} });
    await composition2.initPlatform();
    const snapshot2 = await composition2.configKernel.getCurrentSnapshot("public");
    assert.ok(snapshot2 && snapshot2.configVersion === publishedConfigVersion,
      `重启后 configVersion 必须保持: ${snapshot2 && snapshot2.configVersion} vs ${publishedConfigVersion}`);
    assert.strictEqual(snapshot2.artifacts["rag:standalone-core"] && snapshot2.artifacts["rag:standalone-core"].version, 2);
    const indexStatus2 = await composition2.ragIndexService.getIndexStatus({ environment: "public", kbId: "platform-example" });
    assert.strictEqual(indexStatus2.lkgVersion, 2, `重启后索引必须仍在（PG 事实源）: ${JSON.stringify(indexStatus2)}`);
    await composition2.runRepository.persistenceReady;
    const oldView = composition2.runRepository.getRunView(timeRun.accepted.runId, { pollToken: timeRun.accepted.pollToken });
    assert.ok(oldView && oldView.ok === true && oldView.status === "completed", `重启后 Run 记录必须可读: ${JSON.stringify(oldView).slice(0, 200)}`);
    const deadAfterRestart = await composition2.getQueue().listDead();
    assert.ok(deadAfterRestart.some((entry) => entry.jobId === bogusJobId), "重启后 dead-letter 必须仍在");
    await composition2.close();
    console.log("✓ closed-loop：重启后 configVersion/KB 索引/Run 记录/dead-letter 全部仍在");

    // ---- rollback：新 Run 用旧版本 ----
    const rollback = await httpJson(base, "POST", "/api/admin/agent-platform/config/rollback", {
      environment: "public", domain: "skill", artifactId: "standalone-core", toVersion: 1,
    }, admin);
    assert.strictEqual(rollback.status, 200, JSON.stringify(rollback.json));
    const rolledBackConfigVersion = rollback.json.rolledBack && rollback.json.rolledBack.configVersion;
    assert.ok(rolledBackConfigVersion && rolledBackConfigVersion !== publishedConfigVersion);
    const snapshotAfterRollback = await httpGetJson(base, "/api/admin/agent-platform/config/snapshot?env=public", admin);
    assert.strictEqual(snapshotAfterRollback.json.snapshot.artifacts["skill:standalone-core"].version, 1, "rollback 后 skill 指针必须回到 v1");
    const rerun = await createRun("现在几点了？");
    assert.strictEqual(rerun.view.result.platformTrace.configVersion, rolledBackConfigVersion, "rollback 后新 Run 必须使用旧版本快照");
    console.log("✓ closed-loop：rollback 后新 Run 绑定旧版本（skill v1）");

    // ---- public 外部 Provider 调用为 0（模块级证据 + 应答字段双重）----
    [timeRun, kbRun, rerun].forEach((run) => {
      assert.strictEqual(run.view.result.externalProviderUsed, false);
      assert.strictEqual(run.view.result.provider, "");
    });
    assertNoFosuLoaded();
    console.log("✓ closed-loop：public 外部 Provider 调用为 0（无 Provider 模块加载，externalProviderUsed=false）");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await composition.close();
    await worker.stop(5000);
    const workerOutcome = await workerRun;
    assert.ok(!(workerOutcome && workerOutcome.failed), `worker 运行异常: ${JSON.stringify(workerOutcome)}`);
    await pgPersistenceService.closeForTests();
  }
  console.log("P5B-CLOSED-LOOP PASS");
}

// ---------- 子进程：serve-graceful（真实 agentServerMain server 角色 + SIGTERM）----------
async function runServeGracefulChild() {
  const port = Number(process.env.P5B_HTTP_PORT);
  const { main } = R("server/src/standalone/agentServerMain");
  const mainPromise = main(Object.assign({}, process.env, {
    AGENT_PLATFORM_ROLE: "server",
    AGENT_PLATFORM_PORT: String(port),
    AGENT_PLATFORM_HOST: "127.0.0.1",
    AGENT_PLATFORM_SHUTDOWN_GRACE_MS: "1500",
  }));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const res = await httpGetJson(base, "/health/startup");
      if (res.status === 200) break;
    } catch (_) {
      // 监听尚未就绪
    }
    if (Date.now() > deadline) throw new Error("server 角色 startup 未就绪");
    await sleep(300);
  }
  const ready = await httpGetJson(base, "/health/ready");
  assert.strictEqual(ready.status, 200, JSON.stringify(ready.json));
  console.log("✓ serve-graceful：真实 agentServerMain server 角色启动并就绪（含自动迁移）");
  process.emit("SIGTERM");
  const code = await mainPromise;
  assert.strictEqual(code, 0, `SIGTERM 后必须 exit 0，实际 ${code}`);
  await R("server/src/services/ai/persistence/pgPersistenceService").closeForTests();
  console.log("P5B-SERVE-GRACEFUL PASS");
}

// ---------- 子进程：worker-graceful（真实 agentServerMain worker 角色 + SIGTERM）----------
async function runWorkerGracefulChild() {
  const port = Number(process.env.P5B_HTTP_PORT);
  const { main } = R("server/src/standalone/agentServerMain");
  const mainPromise = main(Object.assign({}, process.env, {
    AGENT_PLATFORM_ROLE: "worker",
    AGENT_PLATFORM_WORKER_HEALTH_PORT: String(port),
    AGENT_WORKER_CLAIM_BLOCK_MS: "300",
    AGENT_WORKER_RECLAIM_MIN_IDLE_MS: "0",
    AGENT_WORKER_MIGRATION_WAIT_MS: "90000",
  }));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const res = await httpGetJson(base, "/health/startup");
      if (res.status === 200) break;
    } catch (_) {
      // 健康端口尚未就绪
    }
    if (Date.now() > deadline) throw new Error("worker 角色 startup 未就绪");
    await sleep(300);
  }
  const ready = await httpGetJson(base, "/health/ready");
  assert.strictEqual(ready.status, 200, JSON.stringify(ready.json));
  assert.strictEqual(ready.json.items.provider.status, "unknown");
  console.log("✓ worker-graceful：真实 agentServerMain worker 角色启动并就绪（localhost 健康探针）");
  process.emit("SIGTERM");
  const code = await mainPromise;
  assert.strictEqual(code, 0, `SIGTERM 后必须 exit 0，实际 ${code}`);
  await R("server/src/services/ai/persistence/pgPersistenceService").closeForTests();
  console.log("P5B-WORKER-GRACEFUL PASS");
}

// ---------- 父进程 ----------
function spawnChild(mode, extraEnv, timeoutMs) {
  return spawnSync(process.execPath, [__filename], {
    env: Object.assign({}, process.env, extraEnv, { P5B_CHILD: mode }),
    encoding: "utf8",
    timeout: timeoutMs || 300000,
    windowsHide: true,
  });
}

function assertChildOk(result, marker, label) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.strictEqual(result.status, 0, `${label} 子进程退出码必须为 0，实际 ${result.status}（${result.error ? result.error.message : "no spawn error"}）`);
  assert.ok(String(result.stdout || "").includes(marker), `${label} 子进程输出必须含 ${marker}`);
}

function runParentUnitSection() {
  const { resolveRole, ROLES } = R("server/src/standalone/agentServerMain");
  assert.strictEqual(resolveRole(undefined), "server");
  assert.strictEqual(resolveRole(""), "server");
  ROLES.forEach((role) => assert.strictEqual(resolveRole(role), role));
  assert.throws(
    () => resolveRole("bogus"),
    (error) => error && error.code === "AGENT_PLATFORM_ROLE_INVALID"
  );
  console.log("✓ 父进程：角色分发单测（默认 server / 四角色 / 非法 coded）");

  const { createWorkerRuntime } = R("server/src/standalone/workerMain");
  assert.throws(
    () => createWorkerRuntime({ env: { FOSU_AGENT_REPOSITORY_BACKEND: "file", AGENT_REDIS_URL: "redis://127.0.0.1:1" }, logger: () => {} }),
    (error) => error && error.code === "AGENT_WORKER_BACKEND_REQUIRED"
  );
  assert.throws(
    () => createWorkerRuntime({ env: { FOSU_AGENT_REPOSITORY_BACKEND: "postgres", AGENT_PG_URL: "postgres://postgres:x@127.0.0.1:1/postgres" }, logger: () => {} }),
    (error) => error && error.code === "TASK_QUEUE_REDIS_CONFIG_REQUIRED"
  );
  console.log("✓ 父进程：worker 构造守卫（integrated file 模式拒绝启动；无 Redis 配置 coded）");

  const { sanitizeValue } = R("server/src/standalone/standaloneLogger");
  const sanitized = sanitizeValue({ apiKey: "fake-redact-me", nested: { password: "x" }, note: "ok" });
  assert.strictEqual(sanitized.apiKey, "[REDACTED]");
  assert.strictEqual(sanitized.nested.password, "[REDACTED]");
  assert.strictEqual(sanitized.note, "ok");
  console.log("✓ 父进程：结构化日志密钥字段脱敏");
}

async function findFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

(async () => {
  if (CHILD_MODE === "offline") {
    await runOfflineChild();
    return;
  }
  if (CHILD_MODE === "closed-loop") {
    await runClosedLoopChild();
    return;
  }
  if (CHILD_MODE === "serve-graceful") {
    await runServeGracefulChild();
    return;
  }
  if (CHILD_MODE === "worker-graceful") {
    await runWorkerGracefulChild();
    return;
  }

  // 父进程：固定离线环境再触达任何 standalone 模块。
  process.env.NODE_ENV = "test";
  delete process.env.FOSU_AGENT_REPOSITORY_BACKEND;
  delete process.env.AGENT_PG_URL;
  delete process.env.AGENT_REDIS_URL;

  runParentUnitSection();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p5b-standalone-"));
  const offlineEnv = {
    NODE_ENV: "test",
    FOSU_AGENT_REPOSITORY_BACKEND: "postgres",
    AGENT_PG_URL: "postgres://postgres:x@127.0.0.1:1/postgres",
    AGENT_PLATFORM_ADMIN_TOKEN: "p5b-admin-token",
    AGENT_PLATFORM_SERVICE_TOKENS: JSON.stringify([{ name: "reader", token: "p5b-read-token", scopes: ["agent-config:read"] }]),
    AGENT_PLATFORM_DATA_DIR: path.join(tempRoot, "offline-data"),
  };
  try {
    // 角色分发子进程（真实入口文件）。
    const roleInvalid = spawnSync(process.execPath, [path.join(ROOT, "server/src/standalone/agentServerMain.js")], {
      env: Object.assign({}, process.env, offlineEnv, { AGENT_PLATFORM_ROLE: "bogus" }),
      encoding: "utf8",
      timeout: 60000,
      windowsHide: true,
    });
    assert.strictEqual(roleInvalid.status, 1, `非法角色必须 exit 1: ${roleInvalid.stdout}${roleInvalid.stderr}`);
    assert.ok(String(roleInvalid.stdout || "").includes("AGENT_PLATFORM_ROLE_INVALID"), `日志必须含 errorClass: ${roleInvalid.stdout}`);
    console.log("✓ 子进程 role-invalid：exit 1 + 结构化日志 errorClass");

    const migrateDead = spawnSync(process.execPath, [path.join(ROOT, "server/src/standalone/agentServerMain.js")], {
      env: Object.assign({}, process.env, offlineEnv, { AGENT_PLATFORM_ROLE: "migrate" }),
      encoding: "utf8",
      timeout: 90000,
      windowsHide: true,
    });
    assert.strictEqual(migrateDead.status, 1, `死 PG migrate 必须 exit 1: ${migrateDead.stdout}${migrateDead.stderr}`);
    assert.ok(String(migrateDead.stdout || "").includes("migrate-failed"), `日志必须含 migrate-failed: ${migrateDead.stdout}`);
    console.log("✓ 子进程 migrate-dead：exit 1 + migrate-failed");

    assertChildOk(spawnChild("offline", offlineEnv, 120000), "P5B-OFFLINE PASS", "offline");
    assertChildOk(spawnChild("offline", Object.assign({}, offlineEnv, { AGENT_PLATFORM_ENABLE_FOSU: "1" }), 120000), "P5B-OFFLINE PASS", "offline-fosu");

    // PG+Redis 段：ensure 设施；不可用 → UNVERIFIED exit 0。
    const { ensurePg, redactUrl } = R("tools/test-helpers/pg-test-env");
    const { ensureRedis } = R("tools/test-helpers/redis-test-env");
    let pgReason = "no PostgreSQL available";
    const pgEnv = await ensurePg({ image: "pgvector/pgvector:pg16", onReason: (text) => { pgReason = text; } });
    let redisReason = "no Redis available";
    const redisEnv = pgEnv ? await ensureRedis({ onReason: (text) => { redisReason = text; } }) : null;
    if (!pgEnv || !redisEnv) {
      console.log(`\ntest-agent-p5b-standalone: offline PASS; PG/Redis 段 UNVERIFIED (${!pgEnv ? pgReason : redisReason})`);
      process.exit(0);
    }
    console.log(`pg-test-env: ${pgEnv.owned ? `docker container ${pgEnv.containerName}` : "external"} (${redactUrl(pgEnv.url)}); redis-test-env: ${redisEnv.owned ? `docker container ${redisEnv.containerName}` : "external"}`);

    const { createPgPool, closePool, query } = R("packages/agent-runtime");
    const adminPool = createPgPool({ connectionString: pgEnv.url, max: 2 });
    const mainDb = `agent_p5b_main_${crypto.randomBytes(4).toString("hex")}`;
    const serveDb = `agent_p5b_serve_${crypto.randomBytes(4).toString("hex")}`;
    const streamPrefix = `p5b-tasks-${process.pid}-${Date.now().toString(36)}`;
    try {
      await query(adminPool, `CREATE DATABASE ${mainDb}`);
      await query(adminPool, `CREATE DATABASE ${serveDb}`);
      const dbUrl = (name) => {
        const url = new URL(pgEnv.url);
        url.pathname = `/${name}`;
        return url.toString();
      };
      const sharedEnv = {
        NODE_ENV: "test",
        FOSU_AGENT_REPOSITORY_BACKEND: "postgres",
        AGENT_REDIS_URL: redisEnv.url,
        AGENT_PLATFORM_ADMIN_TOKEN: "p5b-admin-token",
        AGENT_PLATFORM_SERVICE_TOKENS: JSON.stringify([{ name: "reader", token: "p5b-read-token", scopes: ["agent-config:read"] }]),
        AGENT_PLATFORM_DATA_DIR: path.join(tempRoot, "pg-data"),
        AGENT_WORKER_CLAIM_BLOCK_MS: "300",
        AGENT_WORKER_RECLAIM_MIN_IDLE_MS: "0",
        AGENT_WORKER_MIGRATION_WAIT_MS: "90000",
      };

      assertChildOk(spawnChild("closed-loop", Object.assign({}, sharedEnv, {
        AGENT_PG_URL: dbUrl(mainDb),
        AGENT_REDIS_STREAM: `${streamPrefix}-loop`,
      }), 300000), "P5B-CLOSED-LOOP PASS", "closed-loop");

      assertChildOk(spawnChild("serve-graceful", Object.assign({}, sharedEnv, {
        AGENT_PG_URL: dbUrl(serveDb),
        AGENT_REDIS_STREAM: `${streamPrefix}-serve`,
        P5B_HTTP_PORT: String(await findFreePort()),
      }), 240000), "P5B-SERVE-GRACEFUL PASS", "serve-graceful");

      assertChildOk(spawnChild("worker-graceful", Object.assign({}, sharedEnv, {
        AGENT_PG_URL: dbUrl(serveDb),
        AGENT_REDIS_STREAM: `${streamPrefix}-work`,
        P5B_HTTP_PORT: String(await findFreePort()),
      }), 240000), "P5B-WORKER-GRACEFUL PASS", "worker-graceful");
    } finally {
      await query(adminPool, `DROP DATABASE IF EXISTS ${mainDb} WITH (FORCE)`);
      await query(adminPool, `DROP DATABASE IF EXISTS ${serveDb} WITH (FORCE)`);
      await closePool(adminPool);
      await redisEnv.cleanup();
      await pgEnv.cleanup();
    }
    console.log("\ntest-agent-p5b-standalone: PASS");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

#!/usr/bin/env node
// P5a WS6：postgres 后端四条消费链（会话 / 记忆 / durable 任务 / 知识幂等审计）
// 的接线验证。三层结构：
//
// 1) 离线段（本进程，file 后端，任何环境都执行）：
//    - facade 默认仍选 file 实现（FileConversationRepository / FileMemoryDocumentStore /
//      KnowledgeAuditService / IdempotencyStore / defaultDurableTaskStore 共享实例）；
//    - 全部消费链方法同步直返（非 thenable）——maybe-async 化不得改变 file 后端
//      的同步契约；
//    - 路由同步回归守卫：POST /agent/durable/resume 与 GET /agent/conversations
//      的最终 handler 同步调用后 res.payload 立即就绪（不等微任务；防止 handler
//      被改回 async/await 非 thenable 而推迟响应）。
//
// 2) 死后端子进程（P5A_WIRING_CHILD=dead，postgres 后端指向 127.0.0.1:1）：
//    - require 期不抛错（lazy pool 不触网）；
//    - facade 选 PG 实现（PgConversationRepository / PgMemoryDocumentStoreAdapter /
//      PgKnowledgeAuditService / PgIdempotencyStore / durable 共享实例 ≠ file 单例）；
//    - coded 拒绝：经 agent-runtime query() 的（会话 / KB 审计 / 幂等）→
//      PG_QUERY_FAILED；适配器入口直接 await 就绪门的（偏好 / durable）→
//      AGENT_PLATFORM_INIT_FAILED；fail-soft 读链（loadForChat）降级不抛；
//    - express 最小挂载：GET /api/admin/agent-platform/config/snapshot（Bearer
//      service token）→ 503 AGENT_PLATFORM_INIT_FAILED；
//      GET /api/ai/agent/capabilities（optionalSessionGuard）→ 200。
//
// 3) PG 段子进程（P5A_WIRING_CHILD=pg；AGENT_TEST_PG_URL 或 docker 临时容器，
//    不可用 → UNVERIFIED exit 0）：
//    - initPlatform 迁移后，会话云同步全链（setMemoryPolicy → loadForChat →
//      persistAfterSuccess → list/get → 新仓储实例跨实例可读）；
//    - UserPreferenceService upsert/getObject/listMemoryItems/setMemoryPolicy/
//      getManagementSnapshot/clear 全链；
//    - UserMemoryStore commit（cloud_sync 写入）+ load 读回；
//    - MemoryController load/commit（commit 后 memory.persisted === true）；
//    - durable registerWaitEvent → resumeDurableTask（resumed）+
//      registerReminderReceiptWait → completeReminderReceiptWait（completed）；
//    - KB createDraft 同 idempotencyKey 两次（第二次命中缓存同 item.id）+
//      auditService.list 含 create_draft。

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHILD_MODE = String(process.env.P5A_WIRING_CHILD || "");
const R = (p) => require(path.join(ROOT, p));

function isThenable(value) {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SERVER_SESSION = {
  openidHash: "w6-wiring-openid-hash",
  sessionIdHash: "w6-wiring-session-hash",
  appid: "wx-wiring-test",
};
const PRINCIPAL = {
  principalType: "wechat",
  principalKey: "w6-wiring-principal-0001",
  authenticated: true,
  runtimeMode: "public",
};

// ---------- 子进程：死后端 ----------
async function runDeadChild() {
  // 类型断言：facade 在 postgres 后端选 PG 实现（require 期不触网、不抛错）。
  const conversationFacade = R("server/src/services/ai/conversation/conversationRepository");
  const { FileConversationRepository } = R("server/src/services/ai/conversation/fileConversationRepository");
  const { PgConversationRepository } = R("server/src/services/ai/conversation/pgConversationRepository");
  const repo = conversationFacade.createConversationRepository();
  assert.ok(repo instanceof PgConversationRepository, "postgres 后端必须选 PgConversationRepository");
  assert.ok(!(repo instanceof FileConversationRepository), "postgres 后端不得选文件实现");

  const { UserPreferenceService } = R("server/src/services/ai/conversation/userPreferenceService");
  const { PgMemoryDocumentStoreAdapter } = R("server/src/services/ai/conversation/pgMemoryDocumentStoreAdapter");
  const prefs = new UserPreferenceService({ secret: "w6-dead-secret-32bytes-padding" });
  assert.ok(prefs.documentStore instanceof PgMemoryDocumentStoreAdapter, "偏好文档存储必须为 PG adapter");

  const { getSharedDurableTaskStore } = R("server/src/services/ai/durable/sharedTaskStore");
  const { defaultDurableTaskStore } = R("server/src/services/ai/durable/taskStore");
  assert.ok(getSharedDurableTaskStore() !== defaultDurableTaskStore, "postgres 后端 durable 共享实例不得是 file 单例");

  const {
    createKnowledgeControlPlane,
    KnowledgeAuditService,
    IdempotencyStore,
  } = R("server/src/services/ai/knowledgeControlPlane");
  const { PgKnowledgeAuditService } = R("server/src/services/ai/persistence/pgKnowledgeAuditService");
  const { PgIdempotencyStore } = R("server/src/services/ai/persistence/pgIdempotencyStore");
  const plane = createKnowledgeControlPlane();
  assert.ok(plane.auditService instanceof PgKnowledgeAuditService, "KB 审计必须为 PG 实现");
  assert.ok(!(plane.auditService instanceof KnowledgeAuditService), "KB 审计不得为文件实现");
  assert.ok(plane.idempotency instanceof PgIdempotencyStore, "KB 幂等必须为 PG 实现");
  assert.ok(!(plane.idempotency instanceof IdempotencyStore), "KB 幂等不得为文件实现");
  console.log("✓ dead 子进程：require 不抛错，四条消费链 facade 均选 PG 实现");

  // coded 拒绝（谓词断言）。
  await assert.rejects(
    () => repo.list(PRINCIPAL.principalKey),
    (error) => error && error.code === "PG_QUERY_FAILED"
  );
  await assert.rejects(
    () => prefs.getManagementSnapshot({ principal: PRINCIPAL }),
    (error) => error && error.code === "AGENT_PLATFORM_INIT_FAILED"
  );
  await assert.rejects(
    () => prefs.getObject({ principal: PRINCIPAL }),
    (error) => error && error.code === "AGENT_PLATFORM_INIT_FAILED"
  );
  const { registerWaitEvent } = R("server/src/services/ai/durable/waitForEvent");
  await assert.rejects(
    () => registerWaitEvent({
      kind: "approval",
      waitEvent: "approval_decision",
      principal: PRINCIPAL,
      expiresAt: Date.now() + 60000,
    }),
    (error) => error && error.code === "AGENT_PLATFORM_INIT_FAILED"
  );
  const { resumeDurableTask } = R("server/src/services/ai/durable/resume");
  await assert.rejects(
    () => resumeDurableTask({ resumeToken: "x".repeat(32), principal: PRINCIPAL }),
    (error) => error && error.code === "AGENT_PLATFORM_INIT_FAILED"
  );
  await assert.rejects(
    () => plane.auditService.list(5),
    (error) => error && (error.code === "PG_QUERY_FAILED" || error.code === "AGENT_PLATFORM_INIT_FAILED")
  );
  await assert.rejects(
    () => plane.idempotency.get("w6-dead-key", { type: "doc", input: {} }),
    (error) => error && (error.code === "PG_QUERY_FAILED" || error.code === "AGENT_PLATFORM_INIT_FAILED")
  );
  const platformComposition = R("server/src/services/ai/platformComposition");
  await assert.rejects(
    () => platformComposition.platformReady(),
    (error) => error && error.code === "AGENT_PLATFORM_INIT_FAILED"
  );
  console.log("✓ dead 子进程：coded 拒绝（PG_QUERY_FAILED / AGENT_PLATFORM_INIT_FAILED，fail closed）");

  // fail-soft 读链：存储故障降级为无服务端状态，不得把拒绝抛给对话主链。
  const { defaultMemoryService } = R("server/src/services/ai/conversation/conversationMemoryService");
  const degraded = await defaultMemoryService.loadForChat({
    serverSession: SERVER_SESSION,
    conversationId: "w6-dead-conv",
  });
  assert.ok(degraded && degraded.state === null, "loadForChat 存储故障必须降级为无服务端状态");
  assert.strictEqual(degraded.memory && degraded.memory.persisted, false);
  console.log("✓ dead 子进程：loadForChat fail-soft 降级（state=null, persisted=false）");

  // express 最小挂载：init 失败 → config-plane 503 coded；capabilities 不挂 init 门 → 200。
  const express = R("server/node_modules/express");
  const http = require("http");
  const app = express();
  app.use(express.json());
  app.use("/api/admin", R("server/src/modules/agent-platform/routes"));
  app.use("/api/ai", R("server/src/routes/ai"));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const requestJson = (urlPath, options = {}) => new Promise((resolve, reject) => {
      const req = http.request(`${base}${urlPath}`, {
        method: options.method || "GET",
        headers: Object.assign({ accept: "application/json" }, options.headers || {}),
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
      req.end();
    });

    const snapshot = await requestJson("/api/admin/agent-platform/config/snapshot", {
      headers: { authorization: "Bearer w6-read-token" },
    });
    assert.strictEqual(snapshot.status, 503, `init 失败必须 503，实际 ${snapshot.status} ${snapshot.text}`);
    assert.ok(snapshot.json && snapshot.json.code === "AGENT_PLATFORM_INIT_FAILED",
      `503 必须携带 coded AGENT_PLATFORM_INIT_FAILED，实际 ${snapshot.text}`);
    assert.strictEqual(snapshot.json.success, false);

    const capabilities = await requestJson("/api/ai/agent/capabilities");
    assert.strictEqual(capabilities.status, 200, `capabilities 不得被 init 门击落，实际 ${capabilities.status} ${capabilities.text}`);
    assert.strictEqual(capabilities.json && capabilities.json.success, true);
    console.log("✓ dead 子进程：config snapshot 503+AGENT_PLATFORM_INIT_FAILED；capabilities 200");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await R("server/src/services/ai/persistence/pgPersistenceService").closeForTests();
  console.log("WIRING-DEAD PASS");
}

// ---------- 子进程：真实 PG ----------
async function runPgChild() {
  const platformComposition = R("server/src/services/ai/platformComposition");
  const init = await platformComposition.initPlatform();
  assert.strictEqual(init.backend, "postgres", "initPlatform 必须报告 postgres 后端");
  console.log("✓ pg 子进程：initPlatform 迁移+种子完成（backend=postgres）");

  // ---- 会话云同步全链 ----
  const conversationFacade = R("server/src/services/ai/conversation/conversationRepository");
  const { resolvePrincipal } = R("server/src/services/ai/conversation/conversationPrincipalService");
  const { defaultMemoryService } = R("server/src/services/ai/conversation/conversationMemoryService");
  const conversationId = "w6-pg-conv-1";

  const policy = await defaultMemoryService.setMemoryPolicy({
    serverSession: SERVER_SESSION,
    conversationId,
    mode: "cloud_sync",
    title: "WS6 接线会话",
  });
  assert.strictEqual(policy.success, true, JSON.stringify(policy));

  const bundle = await defaultMemoryService.loadForChat({
    serverSession: SERVER_SESSION,
    conversationId,
    memoryMode: "cloud_sync",
    context: { cloudSyncEnabled: true },
    message: "帮我查一下明天 C7 的课",
  });
  assert.strictEqual(bundle.memory && bundle.memory.mode, "cloud_sync", `loadForChat 必须解析 cloud_sync，实际 ${JSON.stringify(bundle.memory)}`);

  const saved = await defaultMemoryService.persistAfterSuccess({
    serverSession: SERVER_SESSION,
    conversationId,
    memoryMode: "cloud_sync",
    cloudSyncEnabled: true,
    state: bundle.state,
    message: "帮我查一下明天 C7 的课",
    answer: "明天 C7-203 有动物解剖学。",
    intentName: "query_course",
    status: "completed",
  });
  assert.strictEqual(saved.persisted, true, `persistAfterSuccess 必须落盘，实际 ${JSON.stringify(saved)}`);

  const listed = await defaultMemoryService.listConversations({ serverSession: SERVER_SESSION });
  assert.ok(listed.items.some((item) => item.conversationId === conversationId), "listConversations 必须含新会话");
  const fetched = await defaultMemoryService.getConversation({ serverSession: SERVER_SESSION, conversationId });
  assert.strictEqual(fetched.success, true);
  assert.strictEqual(fetched.conversation && fetched.conversation.conversationId, conversationId);

  // 跨实例可读（跨设备语义）：新仓储实例直读同一 PG。
  conversationFacade.resetConversationRepositoryForTests();
  const freshRepo = conversationFacade.createConversationRepository();
  const principal = resolvePrincipal({ serverSession: SERVER_SESSION });
  const freshList = await freshRepo.list(principal.principalKey);
  assert.ok(freshList.some((item) => item.conversationId === conversationId), "新仓储实例必须读到既有会话（PG 为事实源）");
  console.log("✓ pg 子进程：会话云同步全链（policy→load→persist→list/get→跨实例可读）");

  // ---- UserPreferenceService 全链 ----
  const { UserPreferenceService } = R("server/src/services/ai/conversation/userPreferenceService");
  const prefs = new UserPreferenceService({ secret: "w6-pg-secret-32bytes-paddingg" });
  const prefPrincipal = { authenticated: true, principalKey: "w6-pg-pref-principal", principalType: "wechat" };
  const upserted = await prefs.upsertMemory({
    principal: prefPrincipal,
    memoryMode: "cloud_sync",
    explicit: true,
    entry: {
      kind: "stable_preference",
      key: "preferredName",
      content: "preferredName=阿佛",
      normalizedValue: "阿佛",
      provenance: { type: "user_explicit" },
      confidence: 0.98,
      scope: "user",
    },
  });
  assert.strictEqual(upserted.persisted, true, JSON.stringify(upserted));
  const values = await prefs.getObject({ principal: prefPrincipal });
  assert.strictEqual(values.preferredName, "阿佛");
  const items = await prefs.listMemoryItems({ principal: prefPrincipal });
  assert.ok(items.total >= 1 && items.items.some((item) => item.key === "preferredName"));
  const paused = await prefs.setMemoryPolicy({ principal: prefPrincipal, patch: { paused: true } });
  assert.strictEqual(paused.policy && paused.policy.paused, true);
  await prefs.setMemoryPolicy({ principal: prefPrincipal, patch: { paused: false } });
  const snapshot = await prefs.getManagementSnapshot({ principal: prefPrincipal });
  assert.strictEqual(snapshot.success, true);
  assert.ok(snapshot.items.some((item) => item.key === "preferredName"));
  const cleared = await prefs.clear({ principal: prefPrincipal });
  assert.strictEqual(cleared.success, true);
  const afterClear = await prefs.getObject({ principal: prefPrincipal });
  assert.ok(!afterClear.preferredName, "clear 后偏好必须为空");
  console.log("✓ pg 子进程：UserPreferenceService upsert/getObject/list/policy/snapshot/clear 全链");

  // ---- UserMemoryStore（默认偏好服务 → PG adapter）----
  const { defaultUserMemoryStore } = R("server/src/services/ai/memory/userMemory");
  const memPrincipal = { authenticated: true, principalKey: "w6-pg-user-memory", principalType: "wechat" };
  const committed = await defaultUserMemoryStore.commit({
    principal: memPrincipal,
    memoryMode: "cloud_sync",
    candidates: [{ key: "campus", value: "仙溪校区", confidence: 0.95, source: "explicit_user", scope: "user" }],
  });
  assert.strictEqual(committed.persisted, true, JSON.stringify(committed));
  const memLoaded = await defaultUserMemoryStore.load({ principal: memPrincipal, memoryMode: "cloud_sync" });
  assert.strictEqual(memLoaded.values && memLoaded.values.campus, "仙溪校区", "commit 后 load 必须读回");
  console.log("✓ pg 子进程：UserMemoryStore commit（cloud_sync）+ load 读回");

  // ---- MemoryController load/commit ----
  const { defaultMemoryController } = R("server/src/services/ai/memory/memoryController");
  const mcConversationId = "w6-pg-conv-mc";
  const mcBundle = await defaultMemoryController.load({
    serverSession: SERVER_SESSION,
    conversationId: mcConversationId,
    memoryMode: "cloud_sync",
    context: { cloudSyncEnabled: true },
    message: "明天 C7 有课吗",
  });
  assert.strictEqual(mcBundle.memory && mcBundle.memory.mode, "cloud_sync");
  const mcCommitted = await defaultMemoryController.commit({
    memoryBundle: mcBundle,
    conversationId: mcConversationId,
    memoryMode: "cloud_sync",
    message: "明天 C7 有课吗",
    answer: "明天 C7-203 有课。",
    intentName: "query_classroom",
    status: "completed",
  });
  assert.strictEqual(mcCommitted.memory && mcCommitted.memory.persisted, true,
    `MemoryController.commit 后 memory.persisted 必须为 true，实际 ${JSON.stringify(mcCommitted.memory)}`);
  console.log("✓ pg 子进程：MemoryController load/commit（persisted=true）");

  // ---- durable 任务链 ----
  const { registerWaitEvent, registerReminderReceiptWait } = R("server/src/services/ai/durable/waitForEvent");
  const { resumeDurableTask, completeReminderReceiptWait } = R("server/src/services/ai/durable/resume");
  const registered = await registerWaitEvent({
    kind: "approval",
    waitEvent: "approval_decision",
    principal: PRINCIPAL,
    expiresAt: Date.now() + 60000,
    context: { approvalId: "w6-pg-appr", scope: "kb_publish" },
  });
  assert.strictEqual(registered.task.status, "waiting");
  const resumed = await resumeDurableTask({
    taskId: registered.task.taskId,
    resumeToken: registered.resumeToken,
    principal: PRINCIPAL,
  });
  assert.strictEqual(resumed.task.status, "resumed");

  const receiptWait = await registerReminderReceiptWait({
    pendingAction: {
      status: "awaiting_receipt",
      command: "createCourseReminder",
      runId: "w6-pg-run",
      target: { type: "reminder", detailId: "w6-pg-detail" },
      expiresAt: Date.now() + 60000,
    },
    principal: PRINCIPAL,
  });
  assert.ok(receiptWait && receiptWait.task, "registerReminderReceiptWait 必须登记任务");
  const completed = await completeReminderReceiptWait({
    command: "createCourseReminder",
    runId: "w6-pg-run",
    detailId: "w6-pg-detail",
    principal: PRINCIPAL,
  });
  assert.strictEqual(completed.completed, true, JSON.stringify(completed));
  console.log("✓ pg 子进程：durable register→resume（resumed）+ receipt_wait→complete（completed）");

  // ---- KB 幂等 + 审计 ----
  const { createKnowledgeControlPlane } = R("server/src/services/ai/knowledgeControlPlane");
  const plane = createKnowledgeControlPlane();
  const draftInput = {
    title: "WS6 wiring doc",
    body: "图书馆开放时间说明。",
    keywords: ["图书馆"],
    scope: ["public"],
    sourceUrl: "https://example.edu/library",
    sourceTitle: "图书馆公告",
    sourcePublisher: "图书馆",
    authorityLevel: "school_department",
  };
  const idemKey = "w6-pg-idem-1";
  const first = await plane.repository.createDraft("doc", draftInput, { operatorName: "w6", idempotencyKey: idemKey });
  assert.ok(first && first.item && first.item.id, "首次 createDraft 必须返回条目");
  // _cacheIdempotency 为 best-effort 异步写：轮询等其落库，再断言第二次命中同一缓存响应。
  let cached = null;
  for (let attempt = 0; attempt < 50 && !cached; attempt += 1) {
    cached = await plane.idempotency.get(idemKey, { type: "doc", input: draftInput });
    if (!cached) await sleep(100);
  }
  assert.ok(cached && cached.item && cached.item.id === first.item.id, "幂等缓存必须可在 PG 读回");
  const second = await plane.repository.createDraft("doc", draftInput, { operatorName: "w6", idempotencyKey: idemKey });
  assert.strictEqual(second.item && second.item.id, first.item.id, "同 idempotencyKey 第二次必须命中缓存（同 item.id）");
  let audits = [];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    audits = await plane.auditService.list(50);
    if (audits.some((entry) => entry.action === "create_draft")) break;
    await sleep(100);
  }
  assert.ok(audits.some((entry) => entry.action === "create_draft" && entry.success === true),
    "审计必须含 create_draft 成功记录");
  console.log("✓ pg 子进程：KB createDraft 幂等命中（同 item.id）+ 审计 create_draft 落库");

  await R("server/src/services/ai/persistence/pgPersistenceService").closeForTests();
  console.log("WIRING-PG PASS");
}

// ---------- 父进程：离线段（file 后端零回归）----------
function runOfflineSection(tempDir) {
  const conversationFacade = R("server/src/services/ai/conversation/conversationRepository");
  const { FileConversationRepository } = R("server/src/services/ai/conversation/fileConversationRepository");
  const { PgConversationRepository } = R("server/src/services/ai/conversation/pgConversationRepository");
  const fileRepo = conversationFacade.createConversationRepository();
  assert.ok(fileRepo instanceof FileConversationRepository, "file 后端必须选 FileConversationRepository");
  assert.ok(!(fileRepo instanceof PgConversationRepository), "file 后端不得加载 PG 实现");

  // 消费链同步直返（非 thenable）。
  const { defaultMemoryService } = R("server/src/services/ai/conversation/conversationMemoryService");
  const syncBundle = defaultMemoryService.loadForChat({ serverSession: SERVER_SESSION, conversationId: "w6-file-c1" });
  assert.ok(!isThenable(syncBundle), "file 后端 loadForChat 必须同步直返");
  assert.ok(syncBundle && syncBundle.memory, "loadForChat 必须返回 bundle");
  const syncList = defaultMemoryService.listConversations({ serverSession: SERVER_SESSION });
  assert.ok(!isThenable(syncList) && syncList.success === true, "file 后端 listConversations 必须同步直返");

  const { defaultMemoryController } = R("server/src/services/ai/memory/memoryController");
  const mcLoad = defaultMemoryController.load({ serverSession: SERVER_SESSION, conversationId: "w6-file-c1", message: "你好" });
  assert.ok(!isThenable(mcLoad), "file 后端 MemoryController.load 必须同步直返");

  const { defaultUserMemoryStore } = R("server/src/services/ai/memory/userMemory");
  const umLoad = defaultUserMemoryStore.load({ principal: PRINCIPAL, memoryMode: "cloud_sync" });
  assert.ok(!isThenable(umLoad), "file 后端 UserMemoryStore.load 必须同步直返");

  const { UserPreferenceService } = R("server/src/services/ai/conversation/userPreferenceService");
  const { FileMemoryDocumentStore } = R("server/src/services/ai/conversation/fileMemoryDocumentStore");
  const prefs = new UserPreferenceService({ secret: "w6-file-secret-32bytes-padding", dataDir: path.join(tempDir, "prefs") });
  assert.ok(prefs.documentStore instanceof FileMemoryDocumentStore, "file 后端偏好文档存储必须是文件实现");
  const upserted = prefs.upsertMemory({
    principal: PRINCIPAL,
    memoryMode: "cloud_sync",
    explicit: true,
    entry: {
      kind: "stable_preference",
      key: "preferredName",
      content: "preferredName=阿佛",
      normalizedValue: "阿佛",
      provenance: { type: "user_explicit" },
      confidence: 0.98,
      scope: "user",
    },
  });
  assert.ok(!isThenable(upserted) && upserted.persisted === true, "file 后端 upsertMemory 必须同步直返");
  const snapshot = prefs.getManagementSnapshot({ principal: PRINCIPAL });
  assert.ok(!isThenable(snapshot) && snapshot.success === true, "file 后端 getManagementSnapshot 必须同步直返");

  const {
    createKnowledgeControlPlane,
    KnowledgeAuditService,
    IdempotencyStore,
  } = R("server/src/services/ai/knowledgeControlPlane");
  const plane = createKnowledgeControlPlane();
  assert.ok(plane.auditService instanceof KnowledgeAuditService, "file 后端 KB 审计必须是文件实现");
  assert.ok(plane.idempotency instanceof IdempotencyStore, "file 后端 KB 幂等必须是文件实现");
  const draft = plane.repository.createDraft("doc", {
    title: "WS6 file doc",
    body: "文件后端幂等链路。",
    keywords: ["wiring"],
    scope: ["public"],
    sourceUrl: "https://example.edu/wiring",
    sourceTitle: "wiring",
    sourcePublisher: "wiring",
    authorityLevel: "school_department",
  }, { operatorName: "w6", idempotencyKey: "w6-file-idem" });
  assert.ok(!isThenable(draft) && draft.item && draft.item.id, "file 后端 createDraft 必须同步直返");

  const { getSharedDurableTaskStore } = R("server/src/services/ai/durable/sharedTaskStore");
  const { defaultDurableTaskStore } = R("server/src/services/ai/durable/taskStore");
  assert.strictEqual(getSharedDurableTaskStore(), defaultDurableTaskStore, "file 后端 durable 共享实例必须是既有单例");
  defaultDurableTaskStore.clearAll();
  const { registerWaitEvent } = R("server/src/services/ai/durable/waitForEvent");
  const registered = registerWaitEvent({
    kind: "approval",
    waitEvent: "approval_decision",
    principal: PRINCIPAL,
    expiresAt: Date.now() + 60000,
    context: { approvalId: "w6-file-appr" },
  });
  assert.ok(!isThenable(registered) && registered.task.status === "waiting", "file 后端 registerWaitEvent 必须同步直返");
  const { resumeDurableTask } = R("server/src/services/ai/durable/resume");
  const resumed = resumeDurableTask({
    taskId: registered.task.taskId,
    resumeToken: registered.resumeToken,
    principal: PRINCIPAL,
  });
  assert.ok(!isThenable(resumed) && resumed.task.status === "resumed", "file 后端 resumeDurableTask 必须同步直返");
  console.log("✓ 离线段：file 后端四条消费链全部同步直返（非 thenable），facade 默认 file 实现");

  // 路由同步回归守卫：最终 handler 同步调用后 res.payload 立即就绪（不等微任务）。
  const aiRouter = R("server/src/routes/ai");
  const runtimeModeService = R("server/src/services/ai/runtimeModeService");
  const { resolvePrincipal } = R("server/src/services/ai/conversation/conversationPrincipalService");
  const findRouteLayer = (router, method, routePath) => {
    const layer = (router.stack || []).find((item) => item && item.route
      && item.route.path === routePath
      && item.route.methods && item.route.methods[method]);
    assert.ok(layer, `route ${method} ${routePath} must exist`);
    return layer;
  };
  const makeMockRes = () => ({
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    send(payload) { this.payload = payload; return this; },
  });
  const endpointPrincipal = resolvePrincipal({
    serverSession: SERVER_SESSION,
    runtimeMode: runtimeModeService.resolveRuntimeMode({
      context: { envVersion: "", miniprogramVersion: "" },
      serverSession: SERVER_SESSION,
    }).runtimeMode,
  });
  assert.strictEqual(endpointPrincipal.authenticated, true);

  const endpointTask = registerWaitEvent({
    kind: "approval",
    waitEvent: "approval_decision",
    principal: endpointPrincipal,
    expiresAt: Date.now() + 60000,
    context: { approvalId: "w6-file-endpoint" },
  });
  const resumeLayer = findRouteLayer(aiRouter, "post", "/agent/durable/resume");
  const resumeHandler = resumeLayer.route.stack[resumeLayer.route.stack.length - 1].handle;
  const resumeRes = makeMockRes();
  resumeHandler({
    body: { taskId: endpointTask.task.taskId, resumeToken: endpointTask.resumeToken },
    headers: {},
    query: {},
    fosuSession: SERVER_SESSION,
  }, resumeRes);
  assert.strictEqual(resumeRes.statusCode, 200, JSON.stringify(resumeRes.payload));
  assert.ok(resumeRes.payload && resumeRes.payload.success === true && resumeRes.payload.task.status === "resumed",
    "durable/resume handler 必须同步写出响应（file 后端）");

  const listLayer = findRouteLayer(aiRouter, "get", "/agent/conversations");
  const listHandler = listLayer.route.stack[listLayer.route.stack.length - 1].handle;
  const listRes = makeMockRes();
  listHandler({ headers: {}, query: {}, body: {}, fosuSession: SERVER_SESSION }, listRes);
  assert.ok(listRes.payload && listRes.payload.success === true && Array.isArray(listRes.payload.items),
    "GET conversations handler 必须同步写出响应（file 后端）");
  console.log("✓ 离线段：路由同步守卫（durable/resume + conversations 响应不等微任务）");
}

// ---------- 父进程主流程 ----------
function spawnChild(mode, extraEnv, timeoutMs) {
  return spawnSync(process.execPath, [__filename], {
    env: Object.assign({}, process.env, extraEnv, { P5A_WIRING_CHILD: mode }),
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });
}

function assertChildOk(result, marker, label) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.strictEqual(result.status, 0, `${label} 子进程退出码必须为 0，实际 ${result.status}（${result.error ? result.error.message : "no spawn error"}）`);
  assert.ok(String(result.stdout || "").includes(marker), `${label} 子进程输出必须含 ${marker}`);
}

(async () => {
  if (CHILD_MODE === "dead") {
    await runDeadChild();
    return;
  }
  if (CHILD_MODE === "pg") {
    await runPgChild();
    return;
  }

  // 父进程：先固定 file 后端环境再触达任何服务模块。
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p5a-wiring-file-"));
  process.env.NODE_ENV = "test";
  process.env.AI_RUNTIME_MODE = "public";
  process.env.AI_AGENT_ENABLED = "false";
  process.env.FOSU_DATA_DIR = path.join(tempDir, "data");
  process.env.FOSU_AI_DURABLE_STORE_PATH = path.join(tempDir, "durable-tasks.json");
  process.env.FOSU_AGENT_REMINDER_SECRET = "w6-reminder-secret-32-bytes-xxx";
  process.env.FOSU_AGENT_MEMORY_SECRET = "w6-memory-secret-32-bytes-xxxx";
  delete process.env.FOSU_AGENT_REPOSITORY_BACKEND;
  delete process.env.AGENT_PG_URL;

  try {
    runOfflineSection(tempDir);

    // 死后端子进程（不依赖真实 PG，任何环境都执行）。
    const deadDir = fs.mkdtempSync(path.join(os.tmpdir(), "p5a-wiring-dead-"));
    try {
      const dead = spawnChild("dead", {
        NODE_ENV: "test",
        AI_RUNTIME_MODE: "public",
        AI_AGENT_ENABLED: "false",
        FOSU_AGENT_REPOSITORY_BACKEND: "postgres",
        AGENT_PG_URL: "postgres://postgres:x@127.0.0.1:1/postgres",
        FOSU_DATA_DIR: path.join(deadDir, "data"),
        FOSU_AGENT_MEMORY_SECRET: "test-w6-dead-memory-secret-pad",
        FOSU_AGENT_REMINDER_SECRET: "test-w6-dead-reminder-secret",
        ADMIN_PASSWORD: "w6-dead-admin-password",
        ADMIN_API_TOKEN: "w6-dead-admin-token",
        ADMIN_SERVICE_TOKENS: JSON.stringify([
          { name: "w6-read", token: "w6-read-token", scopes: ["agent-config:read"] },
        ]),
      }, 180000);
      assertChildOk(dead, "WIRING-DEAD PASS", "dead");
    } finally {
      fs.rmSync(deadDir, { recursive: true, force: true });
    }

    // PG 段：真实库（AGENT_TEST_PG_URL 或 docker 临时容器）；不可用 → UNVERIFIED exit 0。
    const { ensurePg, redactUrl } = R("tools/test-helpers/pg-test-env");
    let reason = "no PostgreSQL available";
    const env = await ensurePg({ image: "pgvector/pgvector:pg16", onReason: (text) => { reason = text; } });
    if (!env) {
      console.log(`\ntest-agent-p5a-consumer-wiring: offline+dead PASS; postgres UNVERIFIED (${reason})`);
      process.exit(0);
    }
    console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
    const { createPgPool, closePool, query } = R("packages/agent-runtime");
    const adminPool = createPgPool({ connectionString: env.url, max: 2 });
    const dbName = `agent_p5a_wiring_${crypto.randomBytes(5).toString("hex")}`;
    const pgDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "p5a-wiring-pg-"));
    try {
      await query(adminPool, `CREATE DATABASE ${dbName}`);
      const url = new URL(env.url);
      url.pathname = `/${dbName}`;
      const pg = spawnChild("pg", {
        NODE_ENV: "test",
        AI_RUNTIME_MODE: "public",
        AI_AGENT_ENABLED: "false",
        FOSU_AGENT_REPOSITORY_BACKEND: "postgres",
        AGENT_PG_URL: url.toString(),
        FOSU_DATA_DIR: pgDataDir,
        FOSU_AGENT_MEMORY_SECRET: "test-w6-pg-memory-secret-padd",
        FOSU_AGENT_REMINDER_SECRET: "test-w6-pg-reminder-secret-pa",
      }, 300000);
      assertChildOk(pg, "WIRING-PG PASS", "pg");
    } finally {
      await query(adminPool, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await closePool(adminPool);
      await env.cleanup();
      fs.rmSync(pgDataDir, { recursive: true, force: true });
    }
    console.log("\ntest-agent-p5a-consumer-wiring: PASS");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

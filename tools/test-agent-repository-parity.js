#!/usr/bin/env node
// P5a WS4a：file / postgres 双后端行为 parity 验证（真实 PostgreSQL，不经 mock）。
//
// 同一套行为场景对两类后端各跑一遍，断言可观测结果深度一致
// （时间戳 / 随机 id / 序列等表层差异在投影中剔除）：
//   - 会话：create→get→update(revision 递增)→过期 expectedRevision 冲突→
//     list→归属隔离→createIfMissing→v1 文档读取迁移→TTL prune→delete→clearPrincipal；
//   - durable task：状态机全态 / 非法流转错误码 / 惰性过期与翻转落盘 /
//     sweepExpired / findWaitingByEvent / 崩溃恢复（save 后新实例 load 回读）；
//   - kb audit：record→list 顺序与 limit / 重开实例可读 / 脱敏；
//     idempotency：写入→命中→指纹冲突→过期失效。
// 另外验证 facade 后端选择（FOSU_AGENT_REPOSITORY_BACKEND）。
//
// postgres 段：AGENT_TEST_PG_URL 优先，否则 docker 临时容器（test-helpers/pg-test-env）；
// 不可用 → 打印 UNVERIFIED 该段并继续 file 段，exit 0（诚实标记）。
// file 段：mkdtemp 独立目录，跑完即删；postgres 段：随机库，跑完 DROP。

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ensurePg, redactUrl } = require("./test-helpers/pg-test-env");

process.env.NODE_ENV = "test";

const { FileConversationRepository } = require("../server/src/services/ai/conversation/fileConversationRepository");
const { PgConversationRepository } = require("../server/src/services/ai/conversation/pgConversationRepository");
const conversationFacade = require("../server/src/services/ai/conversation/conversationRepository");
const { principalShard } = require("../server/src/services/ai/conversation/conversationPrincipalService");
const { hashConversationId } = require("../server/src/services/ai/conversation/conversationSchema");
const {
  DurableTaskStore,
  SCHEMA_VERSION: DURABLE_SCHEMA_VERSION,
  createDurableTaskStore,
} = require("../server/src/services/ai/durable/taskStore");
const { createPgDurableTaskStoreAdapter } = require("../server/src/services/ai/durable/pgDurableTaskStoreAdapter");
const {
  IdempotencyStore,
  KnowledgeAuditService,
  createKnowledgeControlPlane,
} = require("../server/src/services/ai/knowledgeControlPlane");
const { PgKnowledgeAuditService } = require("../server/src/services/ai/persistence/pgKnowledgeAuditService");
const { PgIdempotencyStore } = require("../server/src/services/ai/persistence/pgIdempotencyStore");
const { createPgPool, closePool, query } = require("../packages/agent-runtime");

// ---------- 投影：剔除时间戳 / 随机 id 等表层差异 ----------
function projectConversation(state) {
  if (!state) return state;
  const clone = JSON.parse(JSON.stringify(state));
  delete clone.createdAt;
  delete clone.updatedAt;
  delete clone.expiresAt;
  delete clone.lastAccessedAt;
  if (clone.memoryPolicy) delete clone.memoryPolicy.updatedAt;
  if (clone.pendingClarification) {
    delete clone.pendingClarification.createdAt;
    delete clone.pendingClarification.expiresAt;
  }
  (clone.recentTurns || []).forEach((turn) => delete turn.at);
  (clone.evidenceRefs || []).forEach((ref) => delete ref.checkedAt);
  if (clone.lastRun) delete clone.lastRun.at;
  return clone;
}

function projectConversationView(view) {
  if (!view) return view;
  const clone = JSON.parse(JSON.stringify(view));
  delete clone.createdAt;
  delete clone.updatedAt;
  delete clone.expiresAt;
  if (clone.lastRun) delete clone.lastRun.at;
  return clone;
}

function projectTask(task) {
  if (!task) return task;
  const clone = JSON.parse(JSON.stringify(task));
  delete clone.taskId; // 随机生成，跨后端不可比
  delete clone.createdAt;
  delete clone.updatedAt;
  delete clone.resumedAt;
  delete clone.completedAt;
  return clone;
}

function projectAuditEntry(entry) {
  if (!entry) return entry;
  const clone = JSON.parse(JSON.stringify(entry));
  delete clone.auditId; // 随机生成
  delete clone.createdAt;
  return clone;
}

function sortTasks(tasks) {
  return tasks.slice().sort((a, b) => {
    const left = `${a.kind}|${a.waitEvent}|${a.resumeTokenHash}`;
    const right = `${b.kind}|${b.waitEvent}|${b.resumeTokenHash}`;
    return left.localeCompare(right);
  });
}

async function errorCode(fn) {
  try {
    await fn();
  } catch (error) {
    return (error && error.code) || "NO_CODE";
  }
  return "NO_THROW";
}

// ---------- 场景：会话仓储 ----------
async function conversationScenario(h) {
  const out = {};
  const repo = h.makeConversationRepo();
  // 前 16 字符必须不同：文件后端按 principalKey 前 16 字符分 shard，
  // 同前缀会共享目录（真实 principalKey 为 HMAC，前缀天然唯一）。
  const p1 = "parity-a-principal-0001";
  const p2 = "parity-b-principal-0002";

  out.created = projectConversation(await repo.create(p1, {
    conversationId: "c-1",
    runtimeMode: "public",
    memoryMode: "session_state",
    title: "班级课表",
  }));
  out.got = projectConversation(await repo.get(p1, "c-1"));
  out.updated1 = projectConversation(await repo.update(p1, "c-1", { title: "A" }));
  out.conflict = await errorCode(() => repo.update(p1, "c-1", { title: "X" }, { expectedRevision: 0 }));
  out.updated2 = projectConversation(await repo.update(p1, "c-1", { title: "B" }, { expectedRevision: out.updated1.revision }));
  out.createAgain = projectConversation(await repo.create(p1, { conversationId: "c-1" }));
  out.listAfterCreate = (await repo.list(p1)).map(projectConversationView);
  out.crossGet = await repo.get(p2, "c-1");
  out.crossUpdate = await errorCode(() => repo.update(p2, "c-1", { title: "steal" }));

  // 归属错乱文档（键在 p1 名下、doc.principalKey 属他人）：get → null，update → FORBIDDEN。
  await h.writeRawConversationDoc(p1, "c-foreign", {
    schemaVersion: "conversation-state.v2",
    clientConversationId: "c-foreign",
    principalKey: "other-principal",
    title: "外来文档",
  });
  out.foreignGet = await repo.get(p1, "c-foreign");
  out.foreignUpdate = await errorCode(() => repo.update(p1, "c-foreign", { title: "x" }));
  await h.deleteRawConversationDoc(p1, "c-foreign");

  out.missingUpdate = await errorCode(() => repo.update(p1, "c-missing", { title: "x" }));
  out.createdViaUpdate = projectConversation(await repo.update(p1, "c-via-update", { title: "fresh" }, { createIfMissing: true }));
  out.emptyPrincipalCreate = await errorCode(() => repo.create("", { conversationId: "c-x" }));
  out.badIdCreate = await errorCode(() => repo.create(p1, { conversationId: "x".repeat(81) }));
  out.emptyPrincipalGet = await repo.get("", "c-1");
  out.emptyPrincipalList = await repo.list("");
  out.emptyPrincipalDelete = await repo.delete("", "c-1");

  // v1 文档读取即迁移到 v2（同一 migrateConversationState，不复制迁移逻辑）。
  await h.writeRawConversationDoc(p1, "c-legacy", {
    schemaVersion: "conversation-state.v1",
    clientConversationId: "c-legacy",
    principalKey: p1,
    title: "旧会话",
    contextSlots: { lastWeek: "3" },
  });
  out.legacy = projectConversation(await repo.get(p1, "c-legacy"));
  // 迁移后回写（revision 0 → 1），同时让文件后端的 index 覆盖该文档，保证后续计数可比。
  out.legacyMigrated = projectConversation(await repo.update(p1, "c-legacy", {}, { expectedRevision: 0 }));

  // TTL prune。
  const ttl = await repo.create(p1, { conversationId: "c-ttl", runtimeMode: "public" });
  await repo.update(p1, "c-ttl", { expiresAt: new Date(Date.now() - 1000).toISOString() }, { expectedRevision: ttl.revision });
  out.pruned = await repo.pruneExpired(p1);
  out.getAfterPrune = await repo.get(p1, "c-ttl");

  // delete / clearPrincipal。
  out.delete = await repo.delete(p1, "c-1");
  out.getAfterDelete = await repo.get(p1, "c-1");
  out.deleteAgain = await repo.delete(p1, "c-1");
  await repo.create(p1, { conversationId: "c-a", runtimeMode: "public" });
  await repo.create(p1, { conversationId: "c-b", runtimeMode: "public" });
  out.cleared = await repo.clearPrincipal(p1);
  out.listAfterClear = await repo.list(p1);
  return out;
}

// ---------- 场景：durable task ----------
async function durableScenario(h) {
  const out = {};
  const store = h.makeTaskStore();
  const principalKey = "parity-durable-principal";
  const FUTURE = 4102444800000; // 2100-01-01，固定值保证双后端可比
  const PAST = 1000;

  out.badKind = await errorCode(() => store.create({
    kind: "workflow", waitEvent: "x", expiresAt: FUTURE, resumeTokenHash: "a".repeat(64),
  }));
  out.noWaitEvent = await errorCode(() => store.create({
    kind: "approval", expiresAt: FUTURE, resumeTokenHash: "a".repeat(64),
  }));
  out.noExpiry = await errorCode(() => store.create({
    kind: "approval", waitEvent: "x", resumeTokenHash: "a".repeat(64),
  }));
  out.badTokenHash = await errorCode(() => store.create({
    kind: "approval", waitEvent: "x", expiresAt: FUTURE, resumeTokenHash: "zz",
  }));

  const t1 = await store.create({
    kind: "approval", waitEvent: "approval_decision", principalKey,
    expiresAt: FUTURE, resumeTokenHash: "b".repeat(64),
    context: { approvalId: "ap-1", scope: "kb_publish" }, note: "note-1",
  });
  out.created = projectTask(t1);
  out.got = projectTask(await store.get(t1.taskId));
  out.badStatus = await errorCode(() => store.transition(t1.taskId, ["pending"], "bogus"));
  out.missingTask = await errorCode(() => store.transition("dt_missing", ["pending"], "waiting"));
  out.conflict = await errorCode(() => store.markResumed(t1.taskId));
  out.waiting = projectTask(await store.markWaiting(t1.taskId));
  out.resumed = projectTask(await store.markResumed(t1.taskId));
  out.done = projectTask(await store.markDone(t1.taskId, "ok"));
  out.doneAgain = await errorCode(() => store.markDone(t1.taskId));

  // 惰性过期：getEffective 显示翻转（不落盘）；流转触发翻转落盘并拒绝。
  const t2 = await store.create({
    kind: "reminder", waitEvent: "reminder_fire", principalKey,
    expiresAt: PAST, resumeTokenHash: "c".repeat(64), context: {},
  });
  out.effectiveExpired = projectTask(await store.getEffective(t2.taskId));
  out.expiredTransition = await errorCode(() => store.markWaiting(t2.taskId));
  out.afterExpiredFlip = projectTask(await store.get(t2.taskId));

  // sweepExpired 只翻转非终态过期任务。
  await store.create({
    kind: "reminder", waitEvent: "reminder_fire", principalKey,
    expiresAt: PAST, resumeTokenHash: "d".repeat(64), context: {},
  });
  out.swept = await store.sweepExpired();

  // findWaitingByEvent：上下文精确匹配。
  const t4 = await store.create({
    kind: "receipt_wait", waitEvent: "action_receipt", principalKey,
    expiresAt: FUTURE, resumeTokenHash: "e".repeat(64),
    context: { command: "createCourseReminder", runId: "run-1", detailId: "d-1" },
  });
  await store.markWaiting(t4.taskId);
  out.found = projectTask(await store.findWaitingByEvent({
    kind: "receipt_wait", waitEvent: "action_receipt", principalKey,
    contextMatch: { runId: "run-1" },
  }));
  out.foundMiss = await store.findWaitingByEvent({
    kind: "receipt_wait", waitEvent: "action_receipt", principalKey,
    contextMatch: { runId: "nope" },
  });

  // 崩溃恢复：新实例从同一存储 load 回读。
  const reloaded = h.makeTaskStoreAgain();
  out.reloaded = projectTask(await reloaded.get(t1.taskId));
  out.listAll = sortTasks((await reloaded.list({ principalKey })).map(projectTask));
  out.clearAll = await reloaded.clearAll();
  out.afterClear = await reloaded.list();
  return out;
}

// ---------- 场景：kb audit + idempotency ----------
async function kbScenario(h) {
  const out = {};
  const audit = h.makeAuditService();
  out.record1 = projectAuditEntry(await audit.record({
    requestId: "req-1", action: "create_draft", targetType: "doc", targetId: "kb-1",
    afterVersion: "1", operatorType: "admin", operatorName: "op-a",
    scopes: ["assistant-kb:draft:write"], authMethod: "token",
    clientName: "admin-ui", idempotencyKey: "idem-1", success: true,
  }));
  // 含 Bearer 痕迹的 tokenName 必须被脱敏（双后端共用同一 buildAuditEntry）。
  out.record2 = projectAuditEntry(await audit.record({
    action: "publish", targetType: "version", targetId: "v1",
    beforeVersion: "v0", afterVersion: "v1", operatorName: "op-a",
    tokenName: "Bearer test-parity-token", success: true,
  }));
  out.record3 = projectAuditEntry(await audit.record({
    action: "rollback", targetType: "version", targetId: "v1",
    success: false, errorCode: "ROLLBACK_FAILED",
  }));
  out.listAll = (await audit.list()).map(projectAuditEntry);
  out.listLimited = (await audit.list(2)).map(projectAuditEntry);
  const auditReloaded = h.makeAuditServiceAgain();
  out.listReloaded = (await auditReloaded.list(10)).map(projectAuditEntry);

  const idem = h.makeIdempotencyStore();
  out.idemMiss = await idem.get("key-1", { a: 1 });
  await idem.set("key-1", { a: 1 }, { ok: true, n: 1 });
  out.idemHit = await idem.get("key-1", { a: 1 });
  out.idemConflict = await errorCode(() => idem.get("key-1", { a: 2 }));
  await h.backdateIdempotency("key-1");
  const idemReloaded = h.makeIdempotencyStoreAgain();
  out.idemExpired = await idemReloaded.get("key-1", { a: 1 });
  return out;
}

// ---------- 后端 harness ----------
function createFileHarness(baseDir) {
  const convDir = path.join(baseDir, "conversations");
  const durablePath = path.join(baseDir, "durable-tasks.json");
  const auditPath = path.join(baseDir, "kb-audit.jsonl");
  const idemPath = path.join(baseDir, "kb-idempotency.json");
  return {
    kind: "file",
    makeConversationRepo: () => new FileConversationRepository({ dataDir: convDir }),
    async writeRawConversationDoc(principalKey, conversationId, doc) {
      const dir = path.join(convDir, principalShard(principalKey));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${hashConversationId(conversationId)}.json`), JSON.stringify(doc));
    },
    async deleteRawConversationDoc(principalKey, conversationId) {
      const filePath = path.join(convDir, principalShard(principalKey), `${hashConversationId(conversationId)}.json`);
      try {
        fs.unlinkSync(filePath);
      } catch (_) {
        // 不存在则无需清理
      }
    },
    makeTaskStore: () => new DurableTaskStore({ storePath: durablePath }),
    makeTaskStoreAgain: () => new DurableTaskStore({ storePath: durablePath }),
    makeAuditService: () => new KnowledgeAuditService({ persistPath: auditPath }),
    makeAuditServiceAgain: () => new KnowledgeAuditService({ persistPath: auditPath }),
    makeIdempotencyStore: () => new IdempotencyStore({ filePath: idemPath }),
    makeIdempotencyStoreAgain: () => new IdempotencyStore({ filePath: idemPath }),
    async backdateIdempotency(key) {
      const raw = JSON.parse(fs.readFileSync(idemPath, "utf8"));
      raw.entries[key].expiresAt = 1;
      fs.writeFileSync(idemPath, JSON.stringify(raw));
    },
    async cleanup() {
      fs.rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

function createPgHarness(pool) {
  return {
    kind: "pg",
    makeConversationRepo: () => new PgConversationRepository({ pool }),
    async writeRawConversationDoc(principalKey, conversationId, doc) {
      await query(
        pool,
        "INSERT INTO agent_conversations (principal_key, conversation_id, doc, revision) VALUES ($1, $2, $3, $4)",
        [principalKey, conversationId, JSON.stringify(doc), Number(doc.revision || 0) || 0]
      );
    },
    async deleteRawConversationDoc(principalKey, conversationId) {
      await query(
        pool,
        "DELETE FROM agent_conversations WHERE principal_key = $1 AND conversation_id = $2",
        [principalKey, conversationId]
      );
    },
    makeTaskStore: () => new DurableTaskStore({
      store: createPgDurableTaskStoreAdapter({ pool, schemaVersion: DURABLE_SCHEMA_VERSION }),
    }),
    makeTaskStoreAgain: () => new DurableTaskStore({
      store: createPgDurableTaskStoreAdapter({ pool, schemaVersion: DURABLE_SCHEMA_VERSION }),
    }),
    makeAuditService: () => new PgKnowledgeAuditService({ pool }),
    makeAuditServiceAgain: () => new PgKnowledgeAuditService({ pool }),
    makeIdempotencyStore: () => new PgIdempotencyStore({ pool }),
    makeIdempotencyStoreAgain: () => new PgIdempotencyStore({ pool }),
    async backdateIdempotency(key) {
      const current = await query(pool, "SELECT entry FROM agent_kb_idempotency WHERE key = $1", [key]);
      const entry = current.rows[0] && current.rows[0].entry;
      entry.expiresAt = 1;
      await query(
        pool,
        "UPDATE agent_kb_idempotency SET entry = $2, expires_at = $3 WHERE key = $1",
        [key, JSON.stringify(entry), new Date(1)]
      );
    },
    async truncate() {
      await query(pool, "TRUNCATE agent_conversations, agent_durable_tasks, agent_kb_audit, agent_kb_idempotency");
    },
    async cleanup() {
      // 库由 withPgDatabase 统一 DROP，这里无需逐表清理。
    },
  };
}

async function runSuites(h) {
  const results = {};
  results.conversation = await conversationScenario(h);
  if (h.truncate) await h.truncate();
  results.durable = await durableScenario(h);
  if (h.truncate) await h.truncate();
  results.kb = await kbScenario(h);
  return results;
}

// ---------- facade 后端选择 ----------
function checkFileFacadeSelection(baseDir) {
  conversationFacade.resetConversationRepositoryForTests();
  delete process.env.FOSU_AGENT_REPOSITORY_BACKEND;
  const byDefault = conversationFacade.createConversationRepository({ dataDir: path.join(baseDir, "facade-default") });
  assert.ok(byDefault instanceof FileConversationRepository, "缺省后端必须是 file 实现");
  process.env.FOSU_AGENT_REPOSITORY_BACKEND = "file";
  const byEnv = conversationFacade.createConversationRepository({ dataDir: path.join(baseDir, "facade-file") });
  assert.ok(byEnv instanceof FileConversationRepository, "env=file 必须是 file 实现");
  process.env.FOSU_AGENT_REPOSITORY_BACKEND = "not-a-backend";
  const byUnknown = conversationFacade.createConversationRepository({ dataDir: path.join(baseDir, "facade-unknown") });
  assert.ok(byUnknown instanceof FileConversationRepository, "未识别值必须回落 file");
  process.env.FOSU_AGENT_REPOSITORY_BACKEND = "file";
  const fileTaskStore = createDurableTaskStore({ storePath: path.join(baseDir, "facade-durable.json") });
  assert.strictEqual(fileTaskStore.storeAdapter.kind, "file", "env=file 时 durable 工厂必须给文件 adapter");
  const plane = createKnowledgeControlPlane({ memoryOnly: true });
  assert.ok(plane.auditService instanceof KnowledgeAuditService, "env=file 时审计必须是文件实现");
  assert.ok(plane.idempotency instanceof IdempotencyStore, "env=file 时幂等必须是文件实现");
  // 单例缓存与 reset。
  conversationFacade.resetConversationRepositoryForTests();
  const first = conversationFacade.getConversationRepository({ dataDir: path.join(baseDir, "facade-cache") });
  const second = conversationFacade.getConversationRepository();
  assert.strictEqual(first, second, "getConversationRepository 必须缓存默认实例");
  conversationFacade.resetConversationRepositoryForTests();
  const third = conversationFacade.getConversationRepository({ dataDir: path.join(baseDir, "facade-cache") });
  assert.notStrictEqual(first, third, "resetConversationRepositoryForTests 必须失效缓存");
  delete process.env.FOSU_AGENT_REPOSITORY_BACKEND;
  console.log("✓ facade 后端选择（file 默认 / env 覆盖 / 未识别回落 / 缓存重置）");
}

function checkPgFacadeSelection() {
  process.env.FOSU_AGENT_REPOSITORY_BACKEND = "postgres";
  conversationFacade.resetConversationRepositoryForTests();
  const repo = conversationFacade.createConversationRepository();
  assert.ok(repo instanceof PgConversationRepository, "env=postgres 必须是 PG 实现");
  const cached = conversationFacade.getConversationRepository();
  assert.ok(cached instanceof PgConversationRepository, "postgres 模式默认实例必须是 PG 实现");
  conversationFacade.resetConversationRepositoryForTests();
  const taskStore = createDurableTaskStore();
  assert.strictEqual(taskStore.storeAdapter.kind, "pg", "env=postgres 时 durable 工厂必须给 PG adapter");
  const plane = createKnowledgeControlPlane();
  assert.ok(plane.auditService instanceof PgKnowledgeAuditService, "env=postgres 时审计必须是 PG 实现");
  assert.ok(plane.idempotency instanceof PgIdempotencyStore, "env=postgres 时幂等必须是 PG 实现");
  console.log("✓ facade 后端选择（postgres：会话 / durable / 审计 / 幂等）");
}

// ---------- postgres 段：随机库 + 真实迁移 ----------
async function withPgDatabase(env, fn) {
  const adminPool = createPgPool({ connectionString: env.url, max: 2 });
  const dbName = `agent_p5a_parity_${crypto.randomBytes(5).toString("hex")}`;
  await query(adminPool, `CREATE DATABASE ${dbName}`);
  const url = new URL(env.url);
  url.pathname = `/${dbName}`;
  process.env.AGENT_PG_URL = url.toString();
  // 注意：必须在设置 AGENT_PG_URL 之后首次触达 pgPersistenceService。
  const pgPersistenceService = require("../server/src/services/ai/persistence/pgPersistenceService");
  try {
    const migrated = await pgPersistenceService.runMigrations();
    // 聚合列表随 workstream 追加（0002 config kernel / 0004 user memory）：
    // 断言「空库应用全部已知版本且按版本序」，不锁死精确序列。
    const expectedVersions = pgPersistenceService.getMigrationList().map((migration) => migration.version);
    assert.ok(
      expectedVersions.includes(1) && expectedVersions.includes(3) && expectedVersions.includes(4),
      `聚合 migration 列表必须含 0001/0003/0004，实际 [${expectedVersions.join(", ")}]`
    );
    assert.deepStrictEqual(
      migrated,
      { applied: expectedVersions, alreadyApplied: [], schemaVersion: Math.max(...expectedVersions) },
      "空库迁移必须按版本序应用全部已知 migration"
    );
    await fn(pgPersistenceService.getPool());
  } finally {
    await pgPersistenceService.closeForTests();
    delete process.env.AGENT_PG_URL;
    await query(adminPool, `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await closePool(adminPool);
  }
}

(async () => {
  // ---------- file 段（始终执行） ----------
  const fileDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-p5a-parity-file-"));
  let fileResults;
  try {
    checkFileFacadeSelection(fileDir);
    const fileHarness = createFileHarness(fileDir);
    fileResults = await runSuites(fileHarness);
  } finally {
    fs.rmSync(fileDir, { recursive: true, force: true });
  }
  console.log("✓ file 段：会话 / durable / kb 场景完成");

  // ---------- postgres 段（不可用则诚实标记） ----------
  let reason = "no PostgreSQL available";
  const env = await ensurePg({ onReason: (text) => {
    reason = text;
  } });
  if (!env) {
    console.log(`\ntest-agent-repository-parity: file PASS; postgres UNVERIFIED (${reason})`);
    process.exit(0);
  }
  console.log(`pg-test-env: ${env.owned ? `docker container ${env.containerName}` : "external AGENT_TEST_PG_URL"} (${redactUrl(env.url)})`);
  let pgResults;
  try {
    await withPgDatabase(env, async (pool) => {
      checkPgFacadeSelection();
      const pgHarness = createPgHarness(pool);
      pgResults = await runSuites(pgHarness);
    });
  } finally {
    delete process.env.FOSU_AGENT_REPOSITORY_BACKEND;
    await env.cleanup();
  }
  console.log("✓ postgres 段：会话 / durable / kb 场景完成");

  // ---------- 双后端深度一致 ----------
  assert.deepStrictEqual(pgResults.conversation, fileResults.conversation, "会话场景双后端结果必须一致");
  assert.deepStrictEqual(pgResults.durable, fileResults.durable, "durable 场景双后端结果必须一致");
  assert.deepStrictEqual(pgResults.kb, fileResults.kb, "kb 场景双后端结果必须一致");
  console.log("✓ file 与 postgres 可观测结果深度一致（时间戳/随机 id 已投影剔除）");

  console.log("\ntest-agent-repository-parity: PASS");
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

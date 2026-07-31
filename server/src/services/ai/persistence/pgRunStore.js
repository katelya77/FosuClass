/**
 * P5a WS3：standalone（postgres 后端）Run/Event/Trace store。
 *
 * 架构约束：agentRunEventService 的 12 函数 repository surface 是同步 API
 * （createRunHandlers / fosuTurnPorts 零改动目标），而 pg 全异步。因此本 store
 * 采用「内存投影为权威 + 有序异步写队列」：
 *   - 服务层同步推进内存投影并把变更委托给本 store；
 *   - 全部写操作进入单 promise 链（构造时以 hydrate 为链头），保证 per-run
 *     顺序与「重放先于写入」；单操作失败只记录（safeLog + getLastWriteError），
 *     不断链、不影响内存投影与在线 API；
 *   - 崩溃可能丢失队列尾部（毫秒级窗口）——需要同步耐久性的部署用一体化
 *     journal store（file 后端默认）。本文件如实声明该权衡；
 *   - options.beforeStart（可选启动门）：水合与全部写操作排在门后——
 *     standalone 模式下由 platformComposition 注入 initPlatform，保证
 *     migration 先于任何读写（init 失败语义与 WS2 一致）。
 *
 * design.md §8.1 落点：
 *   - appendEvent 与 run.status 推进在同一事务：onEvent 经 withTransaction
 *     执行 INSERT agent_run_events + UPDATE agent_runs（同生共死）；
 *   - event_id 使用确定性 `${runId}#${sequence}`（幂等重放 ON CONFLICT DO
 *     NOTHING，不发明随机 id）；(run_id, sequence) 唯一键见 migration 0006；
 *   - afterSequence 查询：listEventsAfter（读也入队 → read-your-writes）；
 *   - (principal_key, idempotency_key) 唯一键由 migration 保证；服务层另有
 *     内存幂等索引做第一防线（重复键重放既有 Run，不二次落库）；
 *   - 保留窗口：hygiene DELETE（runs 按 doc.expiresAtMs、traces 按
 *     created_at + 条数上限），随写操作顺带执行（PgIdempotencyStore 同规）。
 *
 * 启动水合：hydrate() 返回 Promise（链头），服务层 adopt 恢复 accepted/running
 * 并追加 RUN_EXECUTOR_LOST 中断标记；doc jsonb 列是水合事实源（携带
 * pollTokenHash / expiresAtMs / runtimeMode 等 brief §4 列之外的运行必需字段，
 * 与 0003 agent_conversations / agent_durable_tasks 的 key+doc 屋型一致）。
 */

const { query, withTransaction } = require("../../../../../packages/agent-runtime");
const { resolveRunRetentionMs, resolveTraceMaxEntries, resolveTraceRetentionMs } = require("./runRetentionPolicy");

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function logStoreEvent(entry) {
  try {
    // 延迟加载，避免循环依赖；仅安全字段（操作名 + 错误码），不含任何负载。
    const { safeLog } = require("../../../utils/safeLogger");
    safeLog("agent-run-store-pg", entry);
  } catch (_) {
    // 可观测性不得影响持久化链路。
  }
}

function traceOutcome(trace) {
  if (trace && trace.errorCode) return "failed";
  if (trace && trace.fallbackLayer && trace.fallbackLayer !== "none") return "degraded";
  return "completed";
}

function createPgRunStore(options = {}) {
  const pool = options.pool || null;
  if (!pool) {
    throw codedError("PG_CONFIG_REQUIRED", "pg pool required for PgRunStore");
  }
  const retentionMs = resolveRunRetentionMs(options.retentionMs);
  const traceRetentionMs = resolveTraceRetentionMs(options.traceRetentionMs, options.manifestTraceRetentionMs);
  const traceMaxEntries = resolveTraceMaxEntries(options.traceMaxEntries, options.manifestTraceMaxEntries);

  let chain = Promise.resolve().then(() =>
    // 启动门（可选）：standalone 模式下水合/写入必须排在 migration 之后——
    // platformComposition 注入 initPlatform（AGENT_PLATFORM_INIT_FAILED 语义
    // 沿既有链传播）；测试在迁移完成后构造，无需门。
    (typeof options.beforeStart === "function" ? options.beforeStart() : null)
  );
  let lastWriteError = null;

  // 全部操作经同一 promise 链串行化；op 失败记录后链继续（不断链）。
  // 返回值是 op 自身的结果 promise（调用方可 await 传播），链本身永不拒绝。
  function enqueue(label, op) {
    const result = chain.then(op);
    chain = result.catch((error) => {
      lastWriteError = error;
      logStoreEvent({ op: label, code: String((error && error.code) || "UNKNOWN").slice(0, 80) });
    });
    return result;
  }

  async function hygiene() {
    await query(pool, "DELETE FROM agent_runs WHERE (doc->>'expiresAtMs')::numeric < $1", [Date.now()]);
    await query(pool, "DELETE FROM agent_run_traces WHERE created_at < $1", [new Date(Date.now() - traceRetentionMs)]);
    await query(
      pool,
      "DELETE FROM agent_run_traces WHERE trace_id NOT IN (" +
        "SELECT trace_id FROM agent_run_traces ORDER BY created_at DESC LIMIT $1" +
        ")",
      [traceMaxEntries]
    );
  }

  function upsertRunRow(doc) {
    return query(
      pool,
      "INSERT INTO agent_runs (run_id, principal_key, idempotency_key, status, deadline_at, final_result, doc) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7) " +
        "ON CONFLICT (run_id) DO UPDATE SET " +
        "status = EXCLUDED.status, final_result = EXCLUDED.final_result, doc = EXCLUDED.doc, updated_at = now()",
      [
        String(doc.runId || ""),
        String(doc.principalFp || "anonymous"),
        doc.idempotencyKey ? String(doc.idempotencyKey) : null, // NULL 参与唯一键互斥判定时互不相同
        String(doc.status || "queued"),
        Number(doc.deadlineAtMs) ? new Date(Number(doc.deadlineAtMs)) : null,
        doc.result != null ? JSON.stringify(doc.result) : null,
        JSON.stringify(doc),
      ]
    );
  }

  // 链头：启动水合（重放保留窗口内的 Run 与 trace）。失败以 coded error 拒绝，
  // 服务层 persistenceReady 可观测；后续写操作仍按序尝试（见文件头权衡）。
  const hydration = enqueue("hydrate", async () => {
    const now = Date.now();
    const runRows = await query(
      pool,
      "SELECT doc FROM agent_runs WHERE (doc->>'expiresAtMs')::numeric >= $1 ORDER BY created_at ASC",
      [now]
    );
    const traceRows = await query(
      pool,
      "SELECT safe_details FROM agent_run_traces WHERE created_at >= $1 ORDER BY created_at ASC LIMIT $2",
      [new Date(now - traceRetentionMs), traceMaxEntries]
    );
    return {
      runs: (runRows.rows || []).map((row) => row.doc).filter(Boolean),
      traces: (traceRows.rows || []).map((row) => row.safe_details).filter(Boolean),
    };
  });

  return {
    kind: "pg",
    retentionMs,
    terminalRetentionMs: retentionMs,
    onRunCreated(doc) {
      return enqueue("run_created", async () => {
        await upsertRunRow(doc);
        await hygiene();
      });
    },
    onEvent(runId, event, doc) {
      return enqueue("event_appended", async () => {
        // design.md §8.1：事件追加与 run.status 推进同一事务。
        await withTransaction(pool, async (client) => {
          await client.query(
            "INSERT INTO agent_run_events (event_id, run_id, sequence, type, protocol_version, public_payload) " +
              "VALUES ($1, $2, $3, $4, $5, $6) " +
              "ON CONFLICT (run_id, sequence) DO NOTHING",
            [
              `${String(runId)}#${Number(event.sequence) || 0}`,
              String(runId || ""),
              Number(event.sequence) || 0,
              String(event.type || ""),
              event.protocolVersion ? String(event.protocolVersion).slice(0, 32) : null,
              JSON.stringify(event),
            ]
          );
          await client.query(
            "UPDATE agent_runs SET status = $2, doc = $3, updated_at = now() WHERE run_id = $1",
            [String(runId || ""), String(doc && doc.status || ""), JSON.stringify(doc)]
          );
        });
        await hygiene();
      });
    },
    onRunUpdated(doc) {
      return enqueue("run_updated", async () => {
        await upsertRunRow(doc);
        await hygiene();
      });
    },
    onRunsPruned(runIds) {
      const ids = (Array.isArray(runIds) ? runIds : []).map((id) => String(id || "")).filter(Boolean);
      if (!ids.length) return Promise.resolve();
      return enqueue("runs_pruned", () =>
        query(pool, "DELETE FROM agent_runs WHERE run_id = ANY($1::text[])", [ids])
      );
    },
    onTrace(trace) {
      return enqueue("trace_recorded", async () => {
        await query(
          pool,
          "INSERT INTO agent_run_traces (trace_id, run_id, stage, duration_ms, outcome, provider_id, fallback, safe_details) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) " +
            "ON CONFLICT (trace_id) DO NOTHING",
          [
            String(trace.traceId || ""),
            trace.runId ? String(trace.runId) : null,
            "turn",
            Math.max(0, Number(trace.totalDurationMs || 0) || 0),
            traceOutcome(trace),
            null, // 脱敏 trace 不记录 Provider 实现名（safe_details 内同样没有）
            Boolean(trace.fallbackLayer && trace.fallbackLayer !== "none"),
            JSON.stringify(trace),
          ]
        );
        await hygiene();
      });
    },
    onTracesCleared() {
      return enqueue("traces_cleared", () => query(pool, "DELETE FROM agent_run_traces"));
    },
    hydrate() {
      return hydration;
    },
    listEventsAfter(runId, afterSequence) {
      return enqueue("events_after", async () => {
        const result = await query(
          pool,
          "SELECT public_payload FROM agent_run_events WHERE run_id = $1 AND sequence > $2 ORDER BY sequence ASC",
          [String(runId || ""), Math.max(0, Number(afterSequence || 0) || 0)]
        );
        return (result.rows || []).map((row) => row.public_payload).filter(Boolean);
      });
    },
    resetForTests() {
      return enqueue("reset", async () => {
        await query(pool, "DELETE FROM agent_run_events");
        await query(pool, "DELETE FROM agent_run_traces");
        await query(pool, "DELETE FROM agent_runs");
      });
    },
    async closeForTests() {
      await chain; // 排空写队列；连接池归 pgPersistenceService 生命周期管理
    },
    whenIdle() {
      return chain;
    },
    getLastWriteError() {
      return lastWriteError;
    },
  };
}

module.exports = Object.freeze({
  createPgRunStore,
});

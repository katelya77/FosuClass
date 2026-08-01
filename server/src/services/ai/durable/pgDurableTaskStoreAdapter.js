/**
 * P5a WS4a：DurableTaskStore 的 PostgreSQL 存储 adapter。
 *
 * 契约（与文件 adapter 相同）：{ load(), save(collection) }——
 *   - load：SELECT 全表，按 doc.taskId 重组成 { schemaVersion, updatedAt, tasks } 集合；
 *   - save：单事务内 upsert 集合全部任务 + 删除已消失行（集合 ≤ maxTasks，
 *     量小可接受），与文件实现的"整文件原子写"同语义。
 * 领域规则（状态机/惰性过期/裁剪）不在此处——全部留在 DurableTaskStore 一份。
 * 方法为 async；DurableTaskStore 检测到 thenable 后以 Promise 形式透传。
 */

const { query, withTransaction } = require("../../../../../packages/agent-runtime");

function typedError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function toTimestamp(ms) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? new Date(value) : null;
}

/**
 * @param {object} options { pool, schemaVersion }——schemaVersion 由 taskStore 工厂
 *   注入 taskStore.SCHEMA_VERSION（权威来源）；省略时的缺省值须与其保持一致。
 */
function createPgDurableTaskStoreAdapter(options = {}) {
  const pool = options.pool || null;
  if (!pool) {
    throw typedError("pg pool required for durable task store adapter", "PG_CONFIG_REQUIRED", 500);
  }
  const schemaVersion = String(options.schemaVersion || "ai-durable-tasks.v1");

  return {
    kind: "pg",
    async load() {
      const result = await query(
        pool,
        'SELECT task_id AS "taskId", doc, updated_at AS "updatedAt" FROM agent_durable_tasks'
      );
      const tasks = {};
      let updatedAt = "";
      result.rows.forEach((row) => {
        const doc = row.doc && typeof row.doc === "object" ? row.doc : null;
        if (!doc) return;
        const taskId = String(doc.taskId || row.taskId || "");
        if (!taskId) return;
        tasks[taskId] = doc;
        const iso = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt || "");
        if (iso > updatedAt) updatedAt = iso;
      });
      return {
        schemaVersion,
        updatedAt: updatedAt || new Date().toISOString(),
        tasks,
      };
    },
    async save(collection) {
      const tasks = collection && collection.tasks && typeof collection.tasks === "object"
        ? collection.tasks
        : {};
      const ids = Object.keys(tasks);
      await withTransaction(pool, async (client) => {
        for (const taskId of ids) {
          const doc = tasks[taskId];
          await client.query(
            "INSERT INTO agent_durable_tasks (task_id, status, expires_at, doc, updated_at) VALUES ($1, $2, $3, $4, now()) " +
              "ON CONFLICT (task_id) DO UPDATE SET status = EXCLUDED.status, expires_at = EXCLUDED.expires_at, " +
              "doc = EXCLUDED.doc, updated_at = now()",
            [taskId, String(doc && doc.status || ""), toTimestamp(doc && doc.expiresAt), JSON.stringify(doc || {})]
          );
        }
        if (ids.length) {
          await client.query("DELETE FROM agent_durable_tasks WHERE NOT (task_id = ANY($1::text[]))", [ids]);
        } else {
          await client.query("DELETE FROM agent_durable_tasks");
        }
      });
    },
  };
}

module.exports = {
  createPgDurableTaskStoreAdapter,
};

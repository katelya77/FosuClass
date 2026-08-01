// P5a WS2：Config Kernel 的 PostgreSQL Repository（standalone 模式适配器）。
// 与文件适配器（fileRepository）实现同一 REPOSITORY_METHODS 契约，共用
// repositoryConformance 契约测试；schema 由 server 侧 migration 0002
// （config_kernel_stores）建立，本包不内嵌 DDL、不读取任何环境变量。
//
// 语义逐一对齐文件实现：
//   - 同一套输入校验与错误码（PATH_SEGMENT_INVALID / VERSION_INVALID /
//     VERSION_EXISTS / STORAGE_CORRUPT），校验助手直接从 fileRepository 复用；
//   - 不可变文档（versions/snapshots/lkg）读回时双校验 digest：doc 内部 digest
//     自校验 + digest 列与 doc.digest 一致，任一不符抛 CONFIG_KERNEL_STORAGE_CORRUPT；
//   - putVersion 冲突（ON CONFLICT DO NOTHING 未插入）→ CONFIG_KERNEL_VERSION_EXISTS；
//   - listVersions 升序；readPointers 缺省 {environment, seq:0, artifacts:{}}；
//   - listAudit 尾部 limit（ORDER BY id DESC LIMIT 后反转为时间升序），上限 500。
//
// 跨进程写互斥：文件实现依赖 single-writer 假设；PG 适配器在每个写方法
// （putDraft/putVersion/writePointers/putSnapshot/writeCurrentRef/writeLkg/
// appendAudit）的事务内取 pg_advisory_xact_lock(lockId)，把同等互斥提升到
// 数据库级（多实例共享同一库时写操作串行）。锁只覆盖单个写方法的事务边界，
// 内核级 read-modify-write 序列仍遵循 single-writer 部署约束。
//
// 错误纪律：读路径经 pgClient.query（coded + 密码脱敏）；事务内的语句失败
// 经本地 wrap 为 PG_UNAVAILABLE / PG_QUERY_FAILED，message 剔除 password= 片段。

const { sha256Digest } = require("./canonical");
const { codedError } = require("./errors");
const { safeConfigKernelSegment, safeConfigKernelVersion } = require("./fileRepository");
const { query, withTransaction } = require("../persistence/pgClient");

const DEFAULT_LOCK_ID = 918273;
const AUDIT_LIMIT_MAX = 500;

// 与 pgClient 同源的连接失败判定（pgClient 未导出该分类器；保持最小副本，
// 仅用于事务内语句失败的 coded 归类）。
const CONNECTION_ERRNOS = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

function wrapTxError(error) {
  const unavailable = Boolean(
    error && (CONNECTION_ERRNOS.has(error.code)
      || /timeout exceeded when trying to connect|connection terminated|server closed the connection|could not connect/i.test(String(error.message || "")))
  );
  const message = String((error && error.message) || error || "unknown pg error").replace(/\s*password=\S*/gi, "");
  const wrapped = codedError(unavailable ? "PG_UNAVAILABLE" : "PG_QUERY_FAILED", message);
  // cause 只挂脱敏副本（与 pgClient.wrapPgError 同纪律）。
  const safeCause = new Error(message);
  if (error && error.code) safeCause.code = error.code;
  wrapped.cause = safeCause;
  return wrapped;
}

async function txQuery(client, text, params) {
  try {
    return await client.query(text, params);
  } catch (error) {
    throw wrapTxError(error);
  }
}

// 不可变文档读回校验：doc 内部 digest 自校验 + digest 列一致（列被单独篡改
// 与 doc 被篡改都按存储损坏 fail closed）。
function verifyDigestDoc(doc, digestColumn, what) {
  if (!doc || typeof doc !== "object") {
    throw codedError("CONFIG_KERNEL_STORAGE_CORRUPT", `stored document is not an object: ${what}`);
  }
  const content = Object.assign({}, doc);
  const expected = content.digest;
  delete content.digest;
  if (typeof expected !== "string" || sha256Digest(content) !== expected || expected !== digestColumn) {
    throw codedError("CONFIG_KERNEL_STORAGE_CORRUPT", `stored document digest mismatch: ${what}`);
  }
  return doc;
}

function createConfigKernelPgRepository(options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    throw codedError("PG_CONFIG_REQUIRED", "a pg pool (query/connect) is required");
  }
  const lockId = options.lockId === undefined ? DEFAULT_LOCK_ID : options.lockId;
  if (!Number.isSafeInteger(lockId)) {
    throw codedError("PG_LOCK_ID_INVALID", "advisory lock id must be a safe integer");
  }

  // 写互斥：单连接事务 + 事务级 advisory lock（锁随 COMMIT/ROLLBACK 释放）。
  async function withWriteLock(fn) {
    return withTransaction(pool, async (client) => {
      await txQuery(client, "SELECT pg_advisory_xact_lock($1)", [String(lockId)]);
      return fn(client);
    });
  }

  return Object.freeze({
    kind: "postgres",

    async putDraft(draft) {
      const environment = safeConfigKernelSegment(draft.environment, "environment");
      const domain = safeConfigKernelSegment(draft.domain, "domain");
      const artifactId = safeConfigKernelSegment(draft.artifactId, "artifactId");
      await withWriteLock((client) => txQuery(
        client,
        "INSERT INTO config_drafts (environment, domain, artifact_id, doc) VALUES ($1, $2, $3, $4) " +
          "ON CONFLICT (environment, domain, artifact_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()",
        [environment, domain, artifactId, JSON.stringify(draft)]
      ));
      return draft;
    },

    async getDraft(domain, artifactId, env) {
      const result = await query(
        pool,
        "SELECT doc FROM config_drafts WHERE environment = $1 AND domain = $2 AND artifact_id = $3",
        [safeConfigKernelSegment(env, "environment"), safeConfigKernelSegment(domain, "domain"), safeConfigKernelSegment(artifactId, "artifactId")]
      );
      return result.rows.length ? result.rows[0].doc : null;
    },

    async putVersion(doc) {
      const environment = safeConfigKernelSegment(doc.environment, "environment");
      const domain = safeConfigKernelSegment(doc.domain, "domain");
      const artifactId = safeConfigKernelSegment(doc.artifactId, "artifactId");
      const version = safeConfigKernelVersion(doc.version);
      const result = await withWriteLock((client) => txQuery(
        client,
        "INSERT INTO config_versions (environment, domain, artifact_id, version, digest, doc) VALUES ($1, $2, $3, $4, $5, $6) " +
          "ON CONFLICT (environment, domain, artifact_id, version) DO NOTHING",
        [environment, domain, artifactId, version, String(doc.digest || ""), JSON.stringify(doc)]
      ));
      if (!result.rowCount) {
        throw codedError("CONFIG_KERNEL_VERSION_EXISTS", "artifact versions are immutable");
      }
      return doc;
    },

    async getVersion(domain, artifactId, env, version) {
      const result = await query(
        pool,
        "SELECT digest, doc FROM config_versions WHERE environment = $1 AND domain = $2 AND artifact_id = $3 AND version = $4",
        [
          safeConfigKernelSegment(env, "environment"),
          safeConfigKernelSegment(domain, "domain"),
          safeConfigKernelSegment(artifactId, "artifactId"),
          safeConfigKernelVersion(version),
        ]
      );
      if (!result.rows.length) return null;
      const row = result.rows[0];
      return verifyDigestDoc(row.doc, row.digest, `${domain}:${artifactId}#v${safeConfigKernelVersion(version)}`);
    },

    async listVersions(domain, artifactId, env) {
      const result = await query(
        pool,
        "SELECT version FROM config_versions WHERE environment = $1 AND domain = $2 AND artifact_id = $3 ORDER BY version ASC",
        [safeConfigKernelSegment(env, "environment"), safeConfigKernelSegment(domain, "domain"), safeConfigKernelSegment(artifactId, "artifactId")]
      );
      return result.rows.map((row) => Number(row.version));
    },

    async readPointers(env) {
      const environment = safeConfigKernelSegment(env, "environment");
      const result = await query(pool, "SELECT seq, artifacts, updated_at AS \"updatedAt\" FROM config_pointers WHERE environment = $1", [environment]);
      if (!result.rows.length) return { environment, seq: 0, artifacts: {} };
      const row = result.rows[0];
      // 已写入的指针行逐字往返（含 updatedAt 键，即使为空串），对齐文件实现
      // 「存什么读什么」的 deepStrictEqual 语义；缺省行才不带 updatedAt。
      return {
        environment,
        seq: Number(row.seq) || 0,
        artifacts: row.artifacts && typeof row.artifacts === "object" ? row.artifacts : {},
        updatedAt: row.updatedAt || "",
      };
    },

    async writePointers(doc) {
      const environment = safeConfigKernelSegment(doc.environment, "environment");
      await withWriteLock((client) => txQuery(
        client,
        "INSERT INTO config_pointers (environment, seq, artifacts, updated_at) VALUES ($1, $2, $3, $4) " +
          "ON CONFLICT (environment) DO UPDATE SET seq = EXCLUDED.seq, artifacts = EXCLUDED.artifacts, updated_at = EXCLUDED.updated_at",
        [environment, Number(doc.seq) || 0, JSON.stringify(doc.artifacts && typeof doc.artifacts === "object" ? doc.artifacts : {}), String(doc.updatedAt || "")]
      ));
      return doc;
    },

    async putSnapshot(doc) {
      const environment = safeConfigKernelSegment(doc.environment, "environment");
      const configVersion = safeConfigKernelSegment(doc.configVersion, "configVersion");
      await withWriteLock((client) => txQuery(
        client,
        "INSERT INTO config_snapshots (environment, config_version, digest, doc) VALUES ($1, $2, $3, $4) " +
          "ON CONFLICT (environment, config_version) DO UPDATE SET digest = EXCLUDED.digest, doc = EXCLUDED.doc",
        [environment, configVersion, String(doc.digest || ""), JSON.stringify(doc)]
      ));
      return doc;
    },

    async getSnapshot(env, configVersion) {
      const environment = safeConfigKernelSegment(env, "environment");
      const version = safeConfigKernelSegment(configVersion, "configVersion");
      const result = await query(
        pool,
        "SELECT digest, doc FROM config_snapshots WHERE environment = $1 AND config_version = $2",
        [environment, version]
      );
      if (!result.rows.length) return null;
      return verifyDigestDoc(result.rows[0].doc, result.rows[0].digest, `snapshot:${version}`);
    },

    async listSnapshots(env) {
      const result = await query(
        pool,
        "SELECT config_version AS \"configVersion\" FROM config_snapshots WHERE environment = $1 ORDER BY config_version ASC",
        [safeConfigKernelSegment(env, "environment")]
      );
      return result.rows.map((row) => row.configVersion);
    },

    async readCurrentRef(env) {
      const result = await query(
        pool,
        "SELECT config_version AS \"configVersion\", updated_at AS \"updatedAt\" FROM config_current WHERE environment = $1",
        [safeConfigKernelSegment(env, "environment")]
      );
      if (!result.rows.length) return null;
      const row = result.rows[0];
      return { environment: safeConfigKernelSegment(env, "environment"), configVersion: row.configVersion, updatedAt: row.updatedAt };
    },

    async writeCurrentRef(env, configVersion) {
      const doc = {
        environment: safeConfigKernelSegment(env, "environment"),
        configVersion: safeConfigKernelSegment(configVersion, "configVersion"),
        updatedAt: new Date().toISOString(),
      };
      await withWriteLock((client) => txQuery(
        client,
        "INSERT INTO config_current (environment, config_version, updated_at) VALUES ($1, $2, $3) " +
          "ON CONFLICT (environment) DO UPDATE SET config_version = EXCLUDED.config_version, updated_at = EXCLUDED.updated_at",
        [doc.environment, doc.configVersion, doc.updatedAt]
      ));
      return doc;
    },

    async writeLkg(env, snapshot) {
      const environment = safeConfigKernelSegment(env, "environment");
      await withWriteLock((client) => txQuery(
        client,
        "INSERT INTO config_lkg (environment, digest, doc) VALUES ($1, $2, $3) " +
          "ON CONFLICT (environment) DO UPDATE SET digest = EXCLUDED.digest, doc = EXCLUDED.doc, updated_at = now()",
        [environment, String(snapshot && snapshot.digest || ""), JSON.stringify(snapshot)]
      ));
      return snapshot;
    },

    async readLkg(env) {
      const environment = safeConfigKernelSegment(env, "environment");
      const result = await query(pool, "SELECT digest, doc FROM config_lkg WHERE environment = $1", [environment]);
      if (!result.rows.length) return null;
      return verifyDigestDoc(result.rows[0].doc, result.rows[0].digest, `lkg:${environment}`);
    },

    async appendAudit(entry) {
      await withWriteLock((client) => txQuery(client, "INSERT INTO config_audit (entry) VALUES ($1)", [JSON.stringify(entry)]));
      return entry;
    },

    async listAudit(options2 = {}) {
      const limit = Math.max(1, Math.min(AUDIT_LIMIT_MAX, Number(options2.limit) || 100));
      // 尾部 limit 条：先按 id 降序取最新 N 条，再反转为时间升序（对齐文件实现
      // entries.slice(-limit) 的语义）。
      const result = await query(pool, "SELECT entry FROM config_audit ORDER BY id DESC LIMIT $1", [limit]);
      return result.rows.map((row) => row.entry).reverse();
    },
  });
}

module.exports = Object.freeze({
  createConfigKernelPgRepository,
});

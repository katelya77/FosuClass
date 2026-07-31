// P5a：版本化 schema migration runner（PostgreSQL standalone 模式的地基）。
//
// 语义：
//   - migrations 为 [{version:int>=1, name, statements:[string,...]}]，工厂时校验
//     （版本严格递增唯一、name 合法、statements 非空），违例抛
//     MIGRATION_DEFINITION_INVALID——定义问题在启动期就爆炸，不进运行期；
//   - migrate() 在 advisory lock（默认 lockId 728391）内执行，多实例并发安全；
//   - 已应用版本以 sha256(statements 拼接) 校验历史不可变：不一致抛
//     MIGRATION_CHECKSUM_MISMATCH（错误只带 version+name，不带 SQL 内容）；
//   - DB 已应用版本高于代码已知最大版本 → MIGRATION_SCHEMA_TOO_NEW
//     （拒绝启动语义：旧代码不得跑在新 schema 上）；
//   - 每条 migration 一个事务（statements + 记录行同生共死），失败抛
//     MIGRATION_FAILED 且不留半态；重复执行 = 幂等 no-op。

const crypto = require("crypto");
const { codedError } = require("../configKernel/errors");
const { query, withAdvisoryLock } = require("./pgClient");

const DEFAULT_TABLE_NAME = "schema_migrations";
const DEFAULT_LOCK_ID = 728391;

const MIGRATION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/i;
// tableName 会插值进 SQL 标识符位置，必须是安全的裸标识符（禁止 schema 限定、引号）。
const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,60}$/i;

function invalid(message) {
  return codedError("MIGRATION_DEFINITION_INVALID", message);
}

function validateMigrations(migrations) {
  if (!Array.isArray(migrations)) {
    throw invalid("migrations must be an array of {version, name, statements}");
  }
  let previous = 0;
  const seen = new Set();
  migrations.forEach((migration, index) => {
    if (!migration || typeof migration !== "object" || Array.isArray(migration)) {
      throw invalid(`migration[${index}] must be an object {version, name, statements}`);
    }
    const version = Number(migration.version);
    if (!Number.isInteger(version) || version < 1) {
      throw invalid(`migration[${index}] version must be an integer >= 1`);
    }
    if (seen.has(version)) {
      throw invalid(`migration version ${version} is defined more than once`);
    }
    if (version <= previous) {
      throw invalid(`migration versions must be strictly increasing (${version} after ${previous})`);
    }
    seen.add(version);
    previous = version;
    if (!MIGRATION_NAME_PATTERN.test(String(migration.name || ""))) {
      throw invalid(`migration ${version} has an invalid name (expected ${MIGRATION_NAME_PATTERN})`);
    }
    if (!Array.isArray(migration.statements) || migration.statements.length === 0) {
      throw invalid(`migration ${version} must declare at least one statement`);
    }
    migration.statements.forEach((statement, statementIndex) => {
      if (typeof statement !== "string" || !statement.trim()) {
        throw invalid(`migration ${version} statement[${statementIndex}] must be a non-empty string`);
      }
    });
  });
}

// 校验和覆盖 statements 的拼接文本：任何对历史 migration 的内容编辑都会改变
// sha256，从而在 migrate 时 fail closed。
function checksumOf(migration) {
  return crypto.createHash("sha256").update(migration.statements.join("\n"), "utf8").digest("hex");
}

/**
 * @param {object} options { pool, migrations, tableName = "schema_migrations", lockId = 728391 }
 */
function createMigrationRunner(options = {}) {
  const pool = options.pool;
  const tableName = options.tableName === undefined ? DEFAULT_TABLE_NAME : String(options.tableName);
  const lockId = options.lockId === undefined ? DEFAULT_LOCK_ID : options.lockId;
  if (!TABLE_NAME_PATTERN.test(tableName)) {
    throw invalid(`tableName must be a safe identifier (got ${JSON.stringify(tableName)})`);
  }
  if (!Number.isSafeInteger(lockId)) {
    throw invalid("lockId must be a safe integer");
  }
  const migrations = (options.migrations === undefined ? [] : options.migrations).map((migration) =>
    Object.freeze({
      version: migration && migration.version,
      name: migration && migration.name,
      statements: Object.freeze(Array.isArray(migration && migration.statements) ? migration.statements.slice() : migration && migration.statements),
    })
  );
  validateMigrations(migrations);
  const maxKnownVersion = migrations.length ? migrations[migrations.length - 1].version : 0;

  async function ensureTable(queryable) {
    await queryable.query(
      `CREATE TABLE IF NOT EXISTS ${tableName} (` +
        "version integer PRIMARY KEY, " +
        "name text NOT NULL, " +
        "sha256 text NOT NULL, " +
        "applied_at timestamptz NOT NULL DEFAULT now()" +
      ")"
    );
  }

  // 表不存在视为「未初始化」（applied 为空），getStatus/assertCompatible 保持只读。
  async function readAppliedRows(queryable) {
    const reg = await queryable.query("SELECT to_regclass($1) AS reg", [tableName]);
    if (!reg.rows[0] || !reg.rows[0].reg) return [];
    const result = await queryable.query(
      `SELECT version, name, sha256, applied_at AS "appliedAt" FROM ${tableName} ORDER BY version ASC`
    );
    return result.rows.map((row) => ({
      version: Number(row.version),
      name: row.name,
      sha256: row.sha256,
      appliedAt: row.appliedAt instanceof Date ? row.appliedAt.toISOString() : String(row.appliedAt),
    }));
  }

  function assertNotTooNew(appliedRows) {
    if (!appliedRows.length) return;
    const maxApplied = Math.max(...appliedRows.map((row) => row.version));
    if (maxApplied > maxKnownVersion) {
      throw codedError(
        "MIGRATION_SCHEMA_TOO_NEW",
        `database schema version ${maxApplied} is newer than the highest known migration ${maxKnownVersion}; refusing to start`,
        { dbVersion: maxApplied, codeVersion: maxKnownVersion }
      );
    }
  }

  function assertChecksums(appliedRows) {
    const known = new Map(migrations.map((migration) => [migration.version, migration]));
    appliedRows.forEach((row) => {
      const migration = known.get(row.version);
      if (!migration) return; // 高于代码版本的行由 too-new 检查兜底
      if (row.sha256 !== checksumOf(migration)) {
        throw codedError(
          "MIGRATION_CHECKSUM_MISMATCH",
          `migration ${row.version} (${row.name}) checksum mismatch; applied history was modified, refusing to continue`,
          { version: row.version, name: row.name }
        );
      }
    });
  }

  async function applyMigration(client, migration) {
    await client.query("BEGIN");
    try {
      for (const statement of migration.statements) {
        await client.query(statement); // 同一条 migration 内按序执行
      }
      await client.query(`INSERT INTO ${tableName} (version, name, sha256) VALUES ($1, $2, $3)`, [
        migration.version,
        migration.name,
        checksumOf(migration),
      ]);
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
        // 连接已断时事务随会话销毁，尽力而为。
      }
      const detail = error && error.message ? `: ${error.message}` : "";
      throw codedError("MIGRATION_FAILED", `migration ${migration.version} (${migration.name}) failed${detail}`, {
        version: migration.version,
        name: migration.name,
      });
    }
  }

  async function migrate() {
    return withAdvisoryLock(pool, lockId, async (client) => {
      await ensureTable(client);
      const appliedRows = await readAppliedRows(client);
      assertNotTooNew(appliedRows);
      assertChecksums(appliedRows);
      const appliedVersions = new Set(appliedRows.map((row) => row.version));
      const alreadyApplied = migrations.filter((migration) => appliedVersions.has(migration.version)).map((migration) => migration.version);
      const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
      const applied = [];
      for (const migration of pending) {
        await applyMigration(client, migration); // migration 必须按版本序逐条应用
        applied.push(migration.version);
      }
      const schemaVersion = Math.max(0, ...appliedRows.map((row) => row.version), ...applied);
      return { applied, alreadyApplied, schemaVersion };
    });
  }

  async function getStatus() {
    const appliedRows = await readAppliedRows({ query: (text, params) => query(pool, text, params) });
    const appliedVersions = new Set(appliedRows.map((row) => row.version));
    const pending = migrations
      .filter((migration) => !appliedVersions.has(migration.version))
      .map((migration) => ({ version: migration.version, name: migration.name }));
    const schemaVersion = appliedRows.length ? Math.max(...appliedRows.map((row) => row.version)) : 0;
    return { schemaVersion, applied: appliedRows, pending };
  }

  // 独立的「拒绝启动」检查（服务启动序列中先行调用）；migrate 内部走同一判定。
  async function assertCompatible() {
    const appliedRows = await readAppliedRows({ query: (text, params) => query(pool, text, params) });
    assertNotTooNew(appliedRows);
  }

  return Object.freeze({
    assertCompatible,
    getStatus,
    migrate,
  });
}

module.exports = Object.freeze({
  createMigrationRunner,
});

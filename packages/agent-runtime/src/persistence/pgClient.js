// P5a：PostgreSQL 持久化地基——连接池与 coded error 纪律。
//
// 配置解析（显式 options 优先，其次环境变量）：
//   connectionString  ← options.connectionString → AGENT_PG_URL
//   离散字段          ← options.host/port/user/password/database/ssl
//                       → AGENT_PG_HOST/PORT/USER/PASSWORD/DATABASE/SSL
// 两者皆无 → PG_CONFIG_REQUIRED。连接池为 lazy：createPgPool 不建立任何连接，
// 首次 query/connect 才触网（构造一个指向坏地址的 pool 本身不会抛错）。
//
// 错误纪律（与 configKernel 一致：对外失败必须带稳定 code）：
//   - 连接失败/超时 → PG_UNAVAILABLE；其余语句级失败 → PG_QUERY_FAILED；
//   - 错误 message 保留 pg 原生信息（允许含主机），但剔除任何 password= 片段，
//     且对建池时解析出的密码做全文脱敏——错误对象绝不携带连接串/密码；
//   - withTransaction/withAdvisoryLock 中 fn 抛出的错误原样 rethrow（业务错误
//     可能已是 coded），只有池/锁/BEGIN/COMMIT 自身的失败才被包装。
//
// advisory lock 为 PG 会话级锁：unlock 失败的连接必须销毁（client.release(err)），
// 防止持锁会话泄漏回池。

const { Pool } = require("pg");
const { codedError } = require("../configKernel/errors");

const DEFAULT_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;

// 建池时解析出的密码（可能来自 password 字段或 connectionString），用于错误脱敏；
// WeakMap 不阻止 pool 被 GC，也不出现在任何序列化输出里。
const POOL_SECRETS = new WeakMap();

function secretsOf(pool) {
  return (pool && POOL_SECRETS.get(pool)) || [];
}

function stringOr(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function intOr(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.floor(num);
}

function parsePort(value) {
  if (value === undefined || value === null || value === "") return 5432;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    throw codedError("PG_CONFIG_INVALID", "pg port must be an integer between 1 and 65535");
  }
  return num;
}

// AGENT_PG_SSL：true/1/require → 放宽校验的 TLS（托管库常见自签证书）；
// false/0/空 → 不启用。显式 options.ssl 原样透传（boolean 或对象）。
function parseSslEnv(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "false" || text === "0") return undefined;
  if (text === "true" || text === "1" || text === "require") return { rejectUnauthorized: false };
  return { rejectUnauthorized: false };
}

function collectSecrets(config) {
  const secrets = [];
  if (typeof config.password === "string" && config.password.length >= 4) {
    secrets.push(config.password);
  }
  const text = config.connectionString;
  if (typeof text === "string" && text) {
    // postgres://user:<password>@host 形式
    try {
      const parsed = new URL(text);
      const password = decodeURIComponent(parsed.password || "");
      if (password.length >= 4) secrets.push(password);
    } catch (_) {
      // 非 URL 形式（key=value 连接串）走下面的正则。
    }
    const match = text.match(/(?:^|\s)password=([^\s]+)/i);
    if (match && match[1].length >= 4) secrets.push(match[1]);
  }
  return secrets;
}

function sanitizeMessage(error, secrets) {
  let message = String((error && error.message) || error || "unknown pg error");
  message = message.replace(/\s*password=\S*/gi, "");
  secrets.forEach((secret) => {
    if (secret && message.includes(secret)) {
      message = message.split(secret).join("<redacted>");
    }
  });
  return message;
}

// 连接层失败：errno（ECONNREFUSED 等）、SQLSTATE 08xxx 连接异常类、
// 57P01/57P03（服务端关闭/暂不接受连接）、53300（连接数耗尽），
// 以及 pg 连接超时的固定文案。
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
const CONNECTION_SQLSTATES = new Set([
  "08000",
  "08001",
  "08002",
  "08003",
  "08004",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
  "53300",
]);

function isConnectionFailure(error) {
  if (!error) return false;
  if (error.code && CONNECTION_ERRNOS.has(error.code)) return true;
  if (error.code && CONNECTION_SQLSTATES.has(error.code)) return true;
  const message = String(error.message || "");
  return /timeout exceeded when trying to connect|connection terminated|server closed the connection|could not connect/i.test(message);
}

function wrapPgError(error, secrets) {
  const unavailable = isConnectionFailure(error);
  const code = unavailable ? "PG_UNAVAILABLE" : "PG_QUERY_FAILED";
  const wrapped = codedError(code, sanitizeMessage(error, secrets));
  wrapped.cause = error;
  return wrapped;
}

/**
 * 创建 lazy pg 连接池。无连接串且无 host 时抛 PG_CONFIG_REQUIRED。
 * @param {object} [options] connectionString 或 host/port/user/password/database/ssl，
 *   以及 max/idleTimeoutMillis/connectionTimeoutMillis 池参数。
 * @returns {Pool}
 */
function createPgPool(options = {}) {
  const env = process.env || {};
  const connectionString = stringOr(options.connectionString, env.AGENT_PG_URL);
  const host = stringOr(options.host, env.AGENT_PG_HOST);
  if (!connectionString && !host) {
    throw codedError(
      "PG_CONFIG_REQUIRED",
      "pg configuration required: provide options.connectionString/options.host or AGENT_PG_URL/AGENT_PG_HOST"
    );
  }

  const config = {
    max: intOr(options.max, DEFAULT_MAX),
    idleTimeoutMillis: intOr(options.idleTimeoutMillis, DEFAULT_IDLE_TIMEOUT_MS),
    connectionTimeoutMillis: intOr(options.connectionTimeoutMillis, DEFAULT_CONNECTION_TIMEOUT_MS),
  };
  if (connectionString) {
    config.connectionString = connectionString;
  } else {
    config.host = host;
    config.port = parsePort(options.port !== undefined ? options.port : env.AGENT_PG_PORT);
    const user = stringOr(options.user, env.AGENT_PG_USER);
    const password = options.password !== undefined ? options.password : env.AGENT_PG_PASSWORD;
    const database = stringOr(options.database, env.AGENT_PG_DATABASE);
    const ssl = options.ssl !== undefined ? options.ssl : parseSslEnv(env.AGENT_PG_SSL);
    if (user) config.user = user;
    if (typeof password === "string" && password) config.password = password;
    if (database) config.database = database;
    if (ssl !== undefined) config.ssl = ssl;
  }

  const pool = new Pool(config);
  POOL_SECRETS.set(pool, collectSecrets(config));
  // pg Pool 会在空闲客户端被服务端断开时向池本身发 'error'（容器停库 57P01、
  // DROP DATABASE ... FORCE、连接超时回收等拆除期竞态）；EventEmitter 对无监听的
  // 'error' 直接抛未处理异常击落宿主进程。业务路径的错误一律经 query/connect
  // 逐调用包装为 coded error 传播，池级空闲错误不承载可行动信息，挂空监听。
  pool.on("error", () => {});
  return pool;
}

/**
 * 执行语句并包装 coded error（PG_UNAVAILABLE / PG_QUERY_FAILED）。
 */
async function query(pool, text, params) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    throw wrapPgError(error, secretsOf(pool));
  }
}

async function connectWrapped(pool) {
  try {
    return await pool.connect();
  } catch (error) {
    throw wrapPgError(error, secretsOf(pool));
  }
}

/**
 * 在单连接事务内执行 fn：BEGIN → fn(client) → COMMIT；
 * fn 抛错则 ROLLBACK 后原样 rethrow（不包装业务错误）；
 * BEGIN/COMMIT 自身的 pg 失败包装为 coded error。
 */
async function withTransaction(pool, fn) {
  const client = await connectWrapped(pool);
  let ownFailure = null; // BEGIN/COMMIT 的原始 pg 错误（需包装）
  try {
    try {
      await client.query("BEGIN");
    } catch (error) {
      ownFailure = error;
      throw error;
    }
    const result = await fn(client);
    try {
      await client.query("COMMIT");
    } catch (error) {
      ownFailure = error;
      throw error;
    }
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // 连接已断时 ROLLBACK 会失败，事务随会话销毁，尽力而为。
    }
    throw ownFailure ? wrapPgError(ownFailure, secretsOf(pool)) : error;
  } finally {
    client.release();
  }
}

/**
 * 持有 PG 会话级 advisory lock 执行 fn（finally 中配对 unlock）。
 * @param {Pool} pool
 * @param {number} lockId bigint 安全整数（Number.isSafeInteger）
 * @param {(client) => Promise<any>} fn
 */
async function withAdvisoryLock(pool, lockId, fn) {
  if (!Number.isSafeInteger(lockId)) {
    throw codedError("PG_LOCK_ID_INVALID", "advisory lock id must be a safe integer");
  }
  const client = await connectWrapped(pool);
  let locked = false;
  let releaseError = null;
  try {
    try {
      await client.query("SELECT pg_advisory_lock($1)", [String(lockId)]);
      locked = true;
    } catch (error) {
      throw wrapPgError(error, secretsOf(pool));
    }
    return await fn(client);
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [String(lockId)]);
      } catch (error) {
        // unlock 失败的会话可能仍持锁：销毁连接，防止锁泄漏回池。
        releaseError = error;
      }
    }
    client.release(releaseError || undefined);
  }
}

/**
 * 活性探测：成功 {ok:true, latencyMs, serverVersion}；失败 {ok:false, code}。
 */
async function probe(pool) {
  const started = Date.now();
  try {
    const result = await pool.query("SELECT current_setting('server_version') AS version");
    const row = (result.rows && result.rows[0]) || {};
    return { ok: true, latencyMs: Date.now() - started, serverVersion: row.version };
  } catch (error) {
    return { ok: false, code: wrapPgError(error, secretsOf(pool)).code };
  }
}

/**
 * 关闭连接池（等待在途客户端归还）。
 */
async function closePool(pool) {
  if (pool && typeof pool.end === "function") {
    await pool.end();
  }
}

module.exports = Object.freeze({
  closePool,
  createPgPool,
  probe,
  query,
  withAdvisoryLock,
  withTransaction,
});

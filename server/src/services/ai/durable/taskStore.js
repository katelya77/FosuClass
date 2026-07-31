/**
 * M6-T4 轻量 Durable Execution 层：step-like 持久任务存储。
 *
 * 定位：提醒/审批/等待客户端回执等"等待事件"任务的持久化兜底——进程重启后
 * 等待中的任务可凭 resumeToken 恢复，不丢状态。同步对话链保持轻量，
 * 不引外部队列/工作流服务（Inngest 等仅借鉴原语，自研轻量落地）。
 *
 * 存储选型（P5a WS4a 起可注入）：构造函数接受可选 store adapter
 * { load(), save(collection) }——
 *   - 默认文件实现（原行为原样抽取）：单文件 + 原子写（tmp+rename），
 *     路径裁定 FOSU_AI_DURABLE_STORE_PATH > FOSU_DATA_DIR/ai/durable-tasks.json，
 *     同步方法，行为零变化；
 *   - pgDurableTaskStoreAdapter：PostgreSQL 实现（异步方法），
 *     经 createDurableTaskStore 工厂按 FOSU_AGENT_REPOSITORY_BACKEND 注入。
 * 状态机 / 惰性过期 / 扫描 / 视图裁剪等领域规则只在本类一份，双后端共用；
 * adapter 为 async 时同名方法返回 Promise（调用方 await），领域语义不变。
 * 并发安全从简：文件模式单进程原子写；PG 模式整集合事务写（见 adapter 注释），
 * 均不承诺跨实例互斥。
 *
 * 不落敏感信息：resumeToken 只存 SHA-256 哈希（明文仅注册时返回一次），
 * principal 只存 principalKey 的 SHA-256 哈希（与 proactiveCooldownStore 同口径）。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { resolveRepositoryBackend } = require("../persistence/repositoryBackend");

const SCHEMA_VERSION = "ai-durable-tasks.v1";
const TASK_KINDS = ["reminder", "approval", "receipt_wait"];
const TASK_STATUSES = ["pending", "waiting", "resumed", "done", "expired"];
const TERMINAL_STATUSES = ["done", "expired"];
const DEFAULT_MAX_TASKS = 2000;

function createStoreError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isThenable(value) {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

function getDefaultStorePath() {
  return path.join(
    process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../../data"),
    "ai",
    "durable-tasks.json"
  );
}

function hashToken(resumeToken) {
  return crypto.createHash("sha256").update(String(resumeToken || "")).digest("hex");
}

function hashPrincipalKey(principalKey) {
  return crypto.createHash("sha256").update(String(principalKey || "anon").slice(0, 128)).digest("hex");
}

function generateResumeToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function generateTaskId() {
  return `dt_${crypto.randomBytes(12).toString("hex")}`;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), tasks: {} };
}

/** 上下文裁剪：小而安全的任务上下文（字符串截断、限深限量、丢弃函数/undefined）。 */
function sanitizeContext(value, depth = 0) {
  if (value === null) return null;
  const type = typeof value;
  if (type === "string") return value.slice(0, 200);
  if (type === "number") return Number.isFinite(value) ? value : null;
  if (type === "boolean") return value;
  if (type !== "object" || depth >= 3) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 20)
      .map((item) => sanitizeContext(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  const output = {};
  Object.keys(value).slice(0, 24).forEach((rawKey) => {
    const key = String(rawKey).slice(0, 48);
    if (!key) return;
    const sanitized = sanitizeContext(value[rawKey], depth + 1);
    if (sanitized !== undefined) output[key] = sanitized;
  });
  return output;
}

/** 默认文件 adapter：P5a 之前的存储行为原样抽取（缺文件/坏文件 → 空集合；原子写）。 */
function createFileDurableTaskStoreAdapter(options = {}) {
  const resolvePath = options.resolvePath;
  return {
    kind: "file",
    load() {
      const filePath = resolvePath();
      if (!fs.existsSync(filePath)) return emptyData();
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (!raw || typeof raw !== "object" || !raw.tasks || typeof raw.tasks !== "object") return emptyData();
        return {
          schemaVersion: SCHEMA_VERSION,
          updatedAt: raw.updatedAt || new Date().toISOString(),
          tasks: raw.tasks,
        };
      } catch (_) {
        return emptyData();
      }
    },
    save(data) {
      writeJsonAtomic(resolvePath(), data);
    },
  };
}

class DurableTaskStore {
  constructor(options = {}) {
    this.explicitPath = options.storePath ? path.resolve(String(options.storePath)) : "";
    this.maxTasks = Math.max(100, Number(options.maxTasks || DEFAULT_MAX_TASKS) || DEFAULT_MAX_TASKS);
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.storeAdapter = options.store || createFileDurableTaskStoreAdapter({
      resolvePath: () => this.getStorePath(),
    });
  }

  getStorePath() {
    return this.explicitPath
      || path.resolve(process.env.FOSU_AI_DURABLE_STORE_PATH || getDefaultStorePath());
  }

  load() {
    return this.storeAdapter.load();
  }

  save(data) {
    data.updatedAt = new Date().toISOString();
    return this.storeAdapter.save(data);
  }

  /** save 后返回值；adapter 为 async 时等待落盘后取 thunk 结果。 */
  _saveThen(data, thunk) {
    const saved = this.save(data);
    if (isThenable(saved)) return saved.then(thunk);
    return thunk();
  }

  /** save 后抛错（惰性过期翻转落盘语义）；adapter 为 async 时落盘后 reject。 */
  _saveThenThrow(data, error) {
    const saved = this.save(data);
    if (isThenable(saved)) return saved.then(() => { throw error; });
    throw error;
  }

  /** 惰性过期：非终态且已过 expiresAt 的任务视为 expired（不落盘，落盘由流转/sweep 负责）。 */
  effectiveStatus(task, now = this.now()) {
    if (!task || TERMINAL_STATUSES.indexOf(task.status) >= 0) return task && task.status;
    return now > Number(task.expiresAt || 0) ? "expired" : task.status;
  }

  pruneTerminal(tasks) {
    const keys = Object.keys(tasks);
    if (keys.length <= this.maxTasks) return tasks;
    const terminalKeys = keys
      .filter((key) => TERMINAL_STATUSES.indexOf(tasks[key] && tasks[key].status) >= 0)
      .sort((a, b) => Number(tasks[a].expiresAt || 0) - Number(tasks[b].expiresAt || 0));
    const drop = keys.length - this.maxTasks;
    terminalKeys.slice(0, drop).forEach((key) => { delete tasks[key]; });
    return tasks;
  }

  /**
   * 创建任务（status=pending）。expiresAt 必填（毫秒时间戳）。
   * resumeToken 明文不落盘：只存哈希，调用方负责一次性下发。
   */
  create(input = {}) {
    const kind = String(input.kind || "");
    if (TASK_KINDS.indexOf(kind) < 0) {
      throw createStoreError(`未知的 durable 任务类型：${kind || "(空)"}`, "DURABLE_KIND_INVALID", 400);
    }
    const waitEvent = String(input.waitEvent || "").trim().slice(0, 64);
    if (!waitEvent) {
      throw createStoreError("durable 任务必须声明等待事件（waitEvent）。", "DURABLE_WAIT_EVENT_REQUIRED", 400);
    }
    const expiresAt = Number(input.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      throw createStoreError("durable 任务必须携带有效过期时间（expiresAt）。", "DURABLE_EXPIRES_AT_REQUIRED", 400);
    }
    const resumeTokenHash = String(input.resumeTokenHash || "");
    if (!/^[a-f0-9]{64}$/.test(resumeTokenHash)) {
      throw createStoreError("durable 任务必须携带 resumeToken 哈希。", "DURABLE_TOKEN_HASH_REQUIRED", 400);
    }
    const nowIso = new Date().toISOString();
    const task = {
      taskId: generateTaskId(),
      kind,
      status: "pending",
      waitEvent,
      resumeTokenHash,
      principalKeyHash: hashPrincipalKey(input.principalKey),
      context: sanitizeContext(input.context && typeof input.context === "object" ? input.context : {}) || {},
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt,
      resumedAt: "",
      completedAt: "",
      resumeCount: 0,
      note: String(input.note || "").slice(0, 120),
    };
    const data = this.load();
    if (isThenable(data)) return data.then((loaded) => this._createLoaded(loaded, task));
    return this._createLoaded(data, task);
  }

  _createLoaded(data, task) {
    data.tasks[task.taskId] = task;
    data.tasks = this.pruneTerminal(data.tasks);
    return this._saveThen(data, () => Object.assign({}, task));
  }

  get(taskId) {
    const data = this.load();
    if (isThenable(data)) return data.then((loaded) => this._getLoaded(loaded, taskId));
    return this._getLoaded(data, taskId);
  }

  _getLoaded(data, taskId) {
    const task = data.tasks[String(taskId || "")];
    return task ? Object.assign({}, task) : null;
  }

  getEffective(taskId, now = this.now()) {
    const task = this.get(taskId);
    if (isThenable(task)) return task.then((resolved) => this._effectiveView(resolved, now));
    return this._effectiveView(task, now);
  }

  _effectiveView(task, now) {
    if (!task) return null;
    task.status = this.effectiveStatus(task, now);
    return task;
  }

  list(filter = {}, now = this.now()) {
    const data = this.load();
    if (isThenable(data)) return data.then((loaded) => this._listLoaded(loaded, filter, now));
    return this._listLoaded(data, filter, now);
  }

  _listLoaded(data, filter, now) {
    const tasks = data.tasks;
    return Object.keys(tasks).map((key) => {
      const task = Object.assign({}, tasks[key]);
      task.status = this.effectiveStatus(task, now);
      return task;
    }).filter((task) => {
      if (filter.kind && task.kind !== filter.kind) return false;
      if (filter.status && task.status !== filter.status) return false;
      if (filter.waitEvent && task.waitEvent !== filter.waitEvent) return false;
      if (filter.principalKey && task.principalKeyHash !== hashPrincipalKey(filter.principalKey)) return false;
      return true;
    });
  }

  /**
   * 状态流转核心：惰性过期优先（过期任务只能转 expired，不得复活）。
   * expectedFrom 为允许的起始有效状态；命中 expired 且目标非 expired → TASK_EXPIRED。
   */
  transition(taskId, expectedFrom, to, patch = {}) {
    if (TASK_STATUSES.indexOf(to) < 0) {
      throw createStoreError(`未知的 durable 任务状态：${to}`, "DURABLE_STATUS_INVALID", 500);
    }
    const data = this.load();
    if (isThenable(data)) return data.then((loaded) => this._transitionLoaded(loaded, taskId, expectedFrom, to, patch));
    return this._transitionLoaded(data, taskId, expectedFrom, to, patch);
  }

  _transitionLoaded(data, taskId, expectedFrom, to, patch) {
    const key = String(taskId || "");
    const task = data.tasks[key];
    if (!task) {
      throw createStoreError("durable 任务不存在。", "DURABLE_TASK_NOT_FOUND", 404);
    }
    const now = this.now();
    const current = this.effectiveStatus(task, now);
    if (current === "expired" && to !== "expired") {
      if (task.status !== "expired") {
        task.status = "expired";
        task.updatedAt = new Date().toISOString();
        return this._saveThenThrow(data, createStoreError("durable 任务已过期，不能恢复。", "DURABLE_TASK_EXPIRED", 410));
      }
      throw createStoreError("durable 任务已过期，不能恢复。", "DURABLE_TASK_EXPIRED", 410);
    }
    if (expectedFrom.indexOf(current) < 0) {
      throw createStoreError(
        `durable 任务状态不允许该流转（${current} → ${to}）。`,
        "DURABLE_STATUS_CONFLICT",
        409
      );
    }
    task.status = to;
    task.updatedAt = new Date().toISOString();
    Object.keys(patch || {}).forEach((patchKey) => {
      const value = patch[patchKey];
      task[patchKey] = typeof value === "function" ? value(task) : value;
    });
    data.tasks = this.pruneTerminal(data.tasks);
    return this._saveThen(data, () => Object.assign({}, task));
  }

  markWaiting(taskId) {
    return this.transition(taskId, ["pending"], "waiting");
  }

  markResumed(taskId) {
    return this.transition(taskId, ["waiting"], "resumed", {
      resumedAt: new Date().toISOString(),
      resumeCount: (task) => Number(task.resumeCount || 0) + 1,
    });
  }

  markDone(taskId, note = "") {
    return this.transition(taskId, ["pending", "waiting", "resumed"], "done", {
      completedAt: new Date().toISOString(),
      note: String(note || "").slice(0, 120),
    });
  }

  /** 批量过期标记：把所有非终态且已过期任务落盘为 expired，返回翻转数量。 */
  sweepExpired(now = this.now()) {
    const data = this.load();
    if (isThenable(data)) return data.then((loaded) => this._sweepLoaded(loaded, now));
    return this._sweepLoaded(data, now);
  }

  _sweepLoaded(data, now) {
    let flipped = 0;
    Object.keys(data.tasks).forEach((key) => {
      const task = data.tasks[key];
      if (TERMINAL_STATUSES.indexOf(task.status) >= 0) return;
      if (now > Number(task.expiresAt || 0)) {
        task.status = "expired";
        task.updatedAt = new Date().toISOString();
        flipped += 1;
      }
    });
    if (flipped > 0) return this._saveThen(data, () => flipped);
    return flipped;
  }

  /** 按等待事件 + 上下文精确匹配查找等待中的任务（回执置 done 用）。 */
  findWaitingByEvent(query = {}, now = this.now()) {
    const waitEvent = String(query.waitEvent || "");
    const contextMatch = query.contextMatch && typeof query.contextMatch === "object" ? query.contextMatch : {};
    const listed = this.list({ kind: query.kind, waitEvent, principalKey: query.principalKey }, now);
    const pick = (tasks) => {
      const matches = tasks
        .filter((task) => task.status === "waiting" || task.status === "pending")
        .filter((task) => Object.keys(contextMatch).every((key) => {
          const context = task.context && typeof task.context === "object" ? task.context : {};
          return String(context[key] || "") === String(contextMatch[key] || "");
        }))
        .sort((a, b) => Number(b.expiresAt || 0) - Number(a.expiresAt || 0));
      return matches.length ? matches[0] : null;
    };
    if (isThenable(listed)) return listed.then(pick);
    return pick(listed);
  }

  /** 测试辅助：清空全部任务。 */
  clearAll() {
    const saved = this.save(emptyData());
    if (isThenable(saved)) return saved.then(() => true);
    return true;
  }
}

/**
 * P5a WS4a：按 FOSU_AGENT_REPOSITORY_BACKEND 注入存储后端的工厂。
 * file（默认）→ 文件 adapter（同步方法，与直接 new DurableTaskStore 相同）；
 * postgres → pgDurableTaskStoreAdapter（异步方法，pool 默认取 pgPersistenceService 单例）。
 */
function createDurableTaskStore(options = {}) {
  if (resolveRepositoryBackend(options.repositoryBackend) === "postgres") {
    // lazy require：file 模式不加载 pg 依赖链。
    const { getPool } = require("../persistence/pgPersistenceService");
    const { createPgDurableTaskStoreAdapter } = require("./pgDurableTaskStoreAdapter");
    return new DurableTaskStore(Object.assign({}, options, {
      store: options.store || createPgDurableTaskStoreAdapter({
        pool: options.pool || getPool(),
        schemaVersion: SCHEMA_VERSION,
      }),
    }));
  }
  return new DurableTaskStore(options);
}

// 默认实例固定文件后端：现有同步消费链（waitForEvent/resume/routes）零变化；
// postgres 模式的消费方一律经 createDurableTaskStore 工厂获取异步实例。
const defaultDurableTaskStore = new DurableTaskStore();

/** 对外展示视图：剥离 resumeTokenHash / principalKeyHash，绝不回传哈希。 */
function publicTaskView(task) {
  if (!task) return null;
  return {
    taskId: task.taskId,
    kind: task.kind,
    status: task.status,
    waitEvent: task.waitEvent,
    context: task.context && typeof task.context === "object" ? task.context : {},
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    expiresAt: task.expiresAt,
    resumedAt: task.resumedAt || "",
    completedAt: task.completedAt || "",
  };
}

module.exports = {
  DurableTaskStore,
  defaultDurableTaskStore,
  createDurableTaskStore,
  createFileDurableTaskStoreAdapter,
  createStoreError,
  generateResumeToken,
  getDefaultStorePath,
  hashPrincipalKey,
  hashToken,
  publicTaskView,
  sanitizeContext,
  SCHEMA_VERSION,
  TASK_KINDS,
  TASK_STATUSES,
  TERMINAL_STATUSES,
};

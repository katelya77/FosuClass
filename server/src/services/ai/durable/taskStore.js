/**
 * M6-T4 轻量 Durable Execution 层：step-like 持久任务存储。
 *
 * 定位：提醒/审批/等待客户端回执等"等待事件"任务的持久化兜底——进程重启后
 * 等待中的任务可凭 resumeToken 恢复，不丢状态。同步对话链保持轻量，
 * 不引外部队列/工作流服务（Inngest 等仅借鉴原语，自研轻量落地）。
 *
 * 存储选型：沿用仓库服务端 JSON 文件存储惯例（参照 providerRuntimeConfigStore 的
 * FOSU_AI_PROVIDER_CONFIG_PATH 模式），单文件 + 原子写（tmp+rename）。
 * 路径裁定：FOSU_AI_DURABLE_STORE_PATH > FOSU_DATA_DIR/ai/durable-tasks.json。
 * 并发安全从简：单进程原子写文件即可（无跨进程锁）。
 *
 * 不落敏感信息：resumeToken 只存 SHA-256 哈希（明文仅注册时返回一次），
 * principal 只存 principalKey 的 SHA-256 哈希（与 proactiveCooldownStore 同口径）。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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

class DurableTaskStore {
  constructor(options = {}) {
    this.explicitPath = options.storePath ? path.resolve(String(options.storePath)) : "";
    this.maxTasks = Math.max(100, Number(options.maxTasks || DEFAULT_MAX_TASKS) || DEFAULT_MAX_TASKS);
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
  }

  getStorePath() {
    return this.explicitPath
      || path.resolve(process.env.FOSU_AI_DURABLE_STORE_PATH || getDefaultStorePath());
  }

  load() {
    const filePath = this.getStorePath();
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
  }

  save(data) {
    data.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.getStorePath(), data);
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
    data.tasks[task.taskId] = task;
    data.tasks = this.pruneTerminal(data.tasks);
    this.save(data);
    return Object.assign({}, task);
  }

  get(taskId) {
    const task = this.load().tasks[String(taskId || "")];
    return task ? Object.assign({}, task) : null;
  }

  getEffective(taskId, now = this.now()) {
    const task = this.get(taskId);
    if (!task) return null;
    task.status = this.effectiveStatus(task, now);
    return task;
  }

  list(filter = {}, now = this.now()) {
    const tasks = this.load().tasks;
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
        this.save(data);
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
    this.save(data);
    return Object.assign({}, task);
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
    if (flipped > 0) this.save(data);
    return flipped;
  }

  /** 按等待事件 + 上下文精确匹配查找等待中的任务（回执置 done 用）。 */
  findWaitingByEvent(query = {}, now = this.now()) {
    const waitEvent = String(query.waitEvent || "");
    const contextMatch = query.contextMatch && typeof query.contextMatch === "object" ? query.contextMatch : {};
    const matches = this.list({ kind: query.kind, waitEvent, principalKey: query.principalKey }, now)
      .filter((task) => task.status === "waiting" || task.status === "pending")
      .filter((task) => Object.keys(contextMatch).every((key) => {
        const context = task.context && typeof task.context === "object" ? task.context : {};
        return String(context[key] || "") === String(contextMatch[key] || "");
      }))
      .sort((a, b) => Number(b.expiresAt || 0) - Number(a.expiresAt || 0));
    return matches.length ? matches[0] : null;
  }

  /** 测试辅助：清空全部任务。 */
  clearAll() {
    this.save(emptyData());
    return true;
  }
}

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

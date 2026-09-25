const fs = require("fs");
const path = require("path");
const { safeLog } = require("../utils/safeLogger");

const FIELDS = {
  rateLimit: { min: 1, max: 20, env: "CAMPUS_SYNC_RATE_LIMIT", fallback: 5 },
  rateWindowSeconds: { min: 60, max: 3600, env: "CAMPUS_SYNC_RATE_WINDOW_SECONDS", fallback: 600 },
  dailyLimit: { min: 1, max: 50, env: "CAMPUS_SYNC_DAILY_LIMIT", fallback: 10 },
  globalActiveCap: { min: 1, max: 30, env: "CAMPUS_SYNC_GLOBAL_ACTIVE_CAP", fallback: 10 },
};
const LOCKED = ["perUserConcurrency", "workerConcurrency"];

let loaded = false;
let override = null;
let meta = { updatedAt: null, updatedBy: "" };

function opsDir() {
  return path.resolve(process.env.CAMPUS_SYNC_OPS_DIR || path.join(__dirname, "../../storage/ops/campus-sync"));
}

function policyPath() {
  return path.join(opsDir(), "policy.json");
}

function envInt(spec) {
  const parsed = Number(process.env[spec.env]);
  if (!Number.isInteger(parsed) || parsed < spec.min || parsed > spec.max) return spec.fallback;
  return parsed;
}

function defaults() {
  return {
    rateLimit: envInt(FIELDS.rateLimit),
    rateWindowSeconds: envInt(FIELDS.rateWindowSeconds),
    dailyLimit: envInt(FIELDS.dailyLimit),
    globalActiveCap: envInt(FIELDS.globalActiveCap),
  };
}

function parseStrictInt(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function inRange(name, value) {
  const parsed = parseStrictInt(value);
  const spec = FIELDS[name];
  return parsed != null && parsed >= spec.min && parsed <= spec.max;
}

function readFile() {
  let raw = "";
  try {
    raw = fs.readFileSync(policyPath(), "utf8");
  } catch (error) {
    override = null;
    meta = { updatedAt: null, updatedBy: "" };
    loaded = true;
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    const next = {};
    Object.keys(FIELDS).forEach((name) => {
      if (!Object.prototype.hasOwnProperty.call(parsed, name)) return;
      if (!inRange(name, parsed[name])) throw new Error(name);
      next[name] = parsed[name];
    });
    override = next;
    meta = {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      updatedBy: String(parsed.updatedBy || "").slice(0, 64),
    };
  } catch (error) {
    override = null;
    meta = { updatedAt: null, updatedBy: "" };
    safeLog("campus-sync-policy-invalid", { fallback: "environment" });
  }
  loaded = true;
}

function ensure() {
  if (!loaded) readFile();
}

function current() {
  ensure();
  return Object.assign(defaults(), override || {});
}

function snapshot() {
  const values = current();
  return Object.assign({
    perUserConcurrency: 1,
    perUserConcurrencyLocked: true,
    workerConcurrency: 1,
    workerConcurrencyLocked: true,
    jobTtlSeconds: Math.max(30, Number(process.env.CAMPUS_SYNC_JOB_TTL_SECONDS || 90) || 90),
    resetTimezone: "Asia/Shanghai",
    resetLabel: "北京时间每日 00:00 重置",
    source: override ? "runtime" : "environment",
    updatedAt: meta.updatedAt,
    updatedBy: override ? meta.updatedBy : "",
    bounds: {
      rateLimit: [FIELDS.rateLimit.min, FIELDS.rateLimit.max],
      rateWindowSeconds: [FIELDS.rateWindowSeconds.min, FIELDS.rateWindowSeconds.max],
      dailyLimit: [FIELDS.dailyLimit.min, FIELDS.dailyLimit.max],
      globalActiveCap: [FIELDS.globalActiveCap.min, FIELDS.globalActiveCap.max],
    },
  }, values);
}

function reject(message) {
  const error = new Error("CAMPUS_SYNC_POLICY_REJECTED");
  error.code = "CAMPUS_SYNC_POLICY_REJECTED";
  error.publicMessage = message || "策略数值不在允许范围内。";
  return error;
}

function write(next, actor) {
  const dir = opsDir();
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: 1,
    rateLimit: next.rateLimit,
    rateWindowSeconds: next.rateWindowSeconds,
    dailyLimit: next.dailyLimit,
    globalActiveCap: next.globalActiveCap,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor || "admin").slice(0, 64),
  };
  const temp = `${policyPath()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload));
  fs.renameSync(temp, policyPath());
  override = {
    rateLimit: payload.rateLimit,
    rateWindowSeconds: payload.rateWindowSeconds,
    dailyLimit: payload.dailyLimit,
    globalActiveCap: payload.globalActiveCap,
  };
  meta = { updatedAt: payload.updatedAt, updatedBy: payload.updatedBy };
  loaded = true;
}

function update(body, actor) {
  ensure();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw reject("策略格式不正确。");
  const keys = Object.keys(body);
  if (keys.some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) {
    throw reject("策略格式不正确。");
  }
  if (keys.some((key) => LOCKED.indexOf(key) >= 0)) throw reject("该项不能在后台修改。");
  if (keys.some((key) => !Object.prototype.hasOwnProperty.call(FIELDS, key))) throw reject("包含不能修改的字段。");
  const before = snapshot();
  const next = current();
  keys.forEach((key) => {
    const parsed = parseStrictInt(body[key]);
    if (!inRange(key, parsed)) throw reject("策略数值不在允许范围内。");
    next[key] = parsed;
  });
  if (!keys.length) throw reject("没有可保存的策略。");
  try {
    write(next, actor);
  } catch (error) {
    safeLog("campus-sync-policy-write-failed", { code: "POLICY_WRITE_FAILED" });
    throw reject("策略暂时无法保存。");
  }
  return { before: pick(before), after: pick(snapshot()) };
}

function pick(item) {
  return {
    rateLimit: item.rateLimit,
    rateWindowSeconds: item.rateWindowSeconds,
    dailyLimit: item.dailyLimit,
    globalActiveCap: item.globalActiveCap,
    source: item.source,
  };
}

function reset(actor) {
  ensure();
  const before = snapshot();
  try {
    fs.rmSync(policyPath(), { force: true });
  } catch (error) {
    safeLog("campus-sync-policy-write-failed", { code: "POLICY_RESET_FAILED" });
  }
  override = null;
  meta = { updatedAt: new Date().toISOString(), updatedBy: String(actor || "admin").slice(0, 64) };
  loaded = true;
  return { before: pick(before), after: pick(snapshot()) };
}

function reload() {
  loaded = false;
  readFile();
  return snapshot();
}

function resetForTests() {
  override = null;
  meta = { updatedAt: null, updatedBy: "" };
  loaded = true;
  try { fs.rmSync(policyPath(), { force: true }); } catch (error) {}
}

module.exports = {
  current,
  reload,
  parseStrictInt,
  reset,
  resetForTests,
  snapshot,
  update,
};

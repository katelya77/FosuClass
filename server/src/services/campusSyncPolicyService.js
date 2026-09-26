const crypto = require("crypto");
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
let storageStatus = "ok";
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

function allowedRecord(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const next = {};
  const names = Object.keys(FIELDS);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (!Object.prototype.hasOwnProperty.call(parsed, name) || !inRange(name, parsed[name])) return null;
    next[name] = parseStrictInt(parsed[name]);
  }
  return next;
}

function readFile() {
  let raw = "";
  try {
    raw = fs.readFileSync(policyPath(), "utf8");
  } catch (error) {
    override = null;
    storageStatus = error && error.code === "ENOENT" ? "ok" : "invalid";
    meta = { updatedAt: null, updatedBy: "" };
    loaded = true;
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    const next = allowedRecord(parsed);
    if (!next) throw new Error("shape");
    override = next;
    storageStatus = "ok";
    meta = {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      updatedBy: String(parsed.updatedBy || "").replace(/[\u0000-\u001F]/g, "").slice(0, 64),
    };
  } catch (error) {
    override = null;
    storageStatus = "invalid";
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
    storageStatus,
    revision: revision(),
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

function revision() {
  const values = Object.assign(defaults(), override || {});
  return crypto.createHash("sha256").update([
    1,
    values.rateLimit,
    values.rateWindowSeconds,
    values.dailyLimit,
    values.globalActiveCap,
    meta.updatedAt || "",
  ].join("|")).digest("hex").slice(0, 16);
}

function write(next, actor) {
  const dir = opsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const payload = {
    version: 1,
    rateLimit: next.rateLimit,
    rateWindowSeconds: next.rateWindowSeconds,
    dailyLimit: next.dailyLimit,
    globalActiveCap: next.globalActiveCap,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor || "admin").replace(/[\u0000-\u001F]/g, "").slice(0, 64),
  };
  const body = JSON.stringify(payload);
  const temp = `${policyPath()}.tmp`;
  fs.writeFileSync(temp, body, { mode: 0o600 });
  fs.renameSync(temp, policyPath());
  try { fs.chmodSync(policyPath(), 0o600); } catch (error) {}
  const saved = allowedRecord(JSON.parse(fs.readFileSync(policyPath(), "utf8")));
  if (!saved || saved.dailyLimit !== payload.dailyLimit || saved.rateLimit !== payload.rateLimit || saved.rateWindowSeconds !== payload.rateWindowSeconds || saved.globalActiveCap !== payload.globalActiveCap) {
    throw new Error("readback");
  }
  const backup = path.join(dir, "policy.last-known-good.json");
  fs.writeFileSync(backup, body, { mode: 0o600 });
  override = saved;
  storageStatus = "ok";
  meta = { updatedAt: payload.updatedAt, updatedBy: payload.updatedBy };
  loaded = true;
}

function conflict() {
  const error = new Error("CAMPUS_SYNC_POLICY_CONFLICT");
  error.code = "CAMPUS_SYNC_POLICY_CONFLICT";
  error.publicMessage = "策略已在其他窗口被修改，请重新加载后再保存。";
  return error;
}

function update(body, actor, expectedRevision) {
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
  if (arguments.length >= 3 && expectedRevision !== before.revision) throw conflict();
  try {
    write(next, actor);
  } catch (error) {
    if (error && error.code === "CAMPUS_SYNC_POLICY_CONFLICT") throw error;
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
  storageStatus = "ok";
  meta = { updatedAt: null, updatedBy: "" };
  loaded = true;
  try { fs.rmSync(policyPath(), { force: true }); } catch (error) {}
}

module.exports = {
  current,
  reload,
  parseStrictInt,
  policyFile: policyPath,
  reset,
  resetForTests,
  snapshot,
  update,
};

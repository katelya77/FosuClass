const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { acquireExclusiveFileLock } = require("../../exclusiveFileLockService");
const { principalShard } = require("../conversation/conversationPrincipalService");
const { clampLead, computeNextOccurrence } = require("./courseReminderPlanner");

const SCHEMA_VERSION = "course-reminders.v1";
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const MAX_REMINDERS = 80;
const MAX_SEND_LOG = 20;
const MAX_IN_APP_EVENTS = 30;
const MAX_AUTHORIZATION_CREDITS = 30;
const IN_APP_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];

function typedError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode || 400;
  return error;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sha(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function deriveKey(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

function encryptState(value, secret, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(String(aad || "")));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptState(value, secret, aad) {
  if (!value || value.algorithm !== "aes-256-gcm") return null;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(value.iv || "", "base64")
  );
  decipher.setAAD(Buffer.from(String(aad || "")));
  decipher.setAuthTag(Buffer.from(value.tag || "", "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext || "", "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plain);
}

function writeAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, filePath);
}

function normalizeSubscriptionStatus(value) {
  const status = String(value || "").toLowerCase();
  if (["accept", "accepted", "reported_granted"].includes(status)) return "reported_granted";
  if (["reject", "rejected"].includes(status)) return "rejected";
  if (["ban", "banned"].includes(status)) return "banned";
  return "not_requested";
}

function sanitizePatch(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = {};
  if (["enabled", "paused"].includes(source.status)) output.status = source.status;
  if (source.leadMinutes !== undefined) output.leadMinutes = clampLead(source.leadMinutes, 20);
  return output;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function publicOccurrence(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    courseName: String(source.courseName || "").slice(0, 60),
    teacherName: String(source.teacherName || "").slice(0, 40),
    classroom: String(source.classroom || "").slice(0, 60),
    campus: String(source.campus || "").slice(0, 20),
    weekday: Math.max(0, Math.min(7, Number(source.weekday || 0) || 0)),
    startSection: Math.max(0, Math.min(14, Number(source.startSection || 0) || 0)),
    endSection: Math.max(0, Math.min(14, Number(source.endSection || source.startSection || 0) || 0)),
    date: String(source.date || "").slice(0, 10),
    startTime: String(source.startTime || "").slice(0, 8),
    endTime: String(source.endTime || "").slice(0, 8),
    durationMinutes: Math.max(0, Math.min(24 * 60, Number(source.durationMinutes || 0) || 0)),
    durationText: String(source.durationText || "").slice(0, 20),
    startsAt: String(source.startsAt || "").slice(0, 40),
    pagePath: "pages/today/today",
  };
}

function publicReminder(value) {
  const source = value && typeof value === "object" ? value : {};
  const legacyCredits = source.authorizationState === "reported_granted" ? 1 : 0;
  const authorizationCredits = Math.min(
    MAX_AUTHORIZATION_CREDITS,
    Math.max(0, Number(source.authorizationCredits === undefined ? legacyCredits : source.authorizationCredits) || 0)
  );
  return {
    id: source.id,
    status: source.status,
    scope: source.scope,
    leadMinutes: source.leadMinutes,
    timezone: "Asia/Shanghai",
    recurrence: source.recurrence,
    eventDriven: source.eventDriven === true,
    pendingEventCount: Array.isArray(source.pendingEvents) ? source.pendingEvents.length : 0,
    channel: source.channel,
    authorizationState: source.authorizationState,
    authorizationCredits,
    nextTriggerAt: source.nextTriggerAt || "",
    nextOccurrence: source.nextOccurrence ? publicOccurrence(source.nextOccurrence) : null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    expiresAt: source.expiresAt,
    attempts: Math.max(0, Number(source.attempts || 0) || 0),
    sendLog: (Array.isArray(source.sendLog) ? source.sendLog : []).slice(-MAX_SEND_LOG).map((item) => ({
      at: item.at,
      status: item.status,
      code: item.code,
      attempt: item.attempt,
    })),
  };
}

function publicInAppEvent(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    id: String(source.id || "").slice(0, 80),
    reminderId: String(source.reminderId || "").slice(0, 80),
    kind: source.kind === "schedule_change" ? "schedule_change" : "course_start",
    occurrence: publicOccurrence(source.occurrence),
    createdAt: String(source.createdAt || "").slice(0, 40),
    expiresAt: String(source.expiresAt || "").slice(0, 40),
    pagePath: "pages/today/today",
  };
}

class CourseReminderService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.dataDir
      || process.env.FOSU_COURSE_REMINDER_DATA_DIR
      || path.join(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../../data"), "ai", "course-reminders")
    );
    this.secret = String(
      options.secret
      || process.env.FOSU_AGENT_REMINDER_SECRET
      || process.env.FOSU_AGENT_MEMORY_SECRET
      || ""
    );
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
  }

  assertReady() {
    if (this.secret.length < 16) {
      throw typedError("Reminder encryption is not configured", "REMINDER_SECRET_UNAVAILABLE", 503);
    }
  }

  assertPrincipal(principal) {
    if (!principal || principal.authenticated !== true || !principal.principalKey) {
      throw typedError("Authenticated principal required", "PRINCIPAL_REQUIRED", 401);
    }
    return String(principal.principalKey);
  }

  filePath(principalKey) {
    return path.join(this.rootDir, principalShard(principalKey), "reminders.json");
  }

  withLock(principalKey, callback) {
    const filePath = this.filePath(principalKey);
    ensureDir(path.dirname(filePath));
    const release = acquireExclusiveFileLock(filePath, {
      lockPath: `${filePath}.lock`,
      codePrefix: "COURSE_REMINDER",
      waitMs: 1500,
      staleMs: 30000,
    });
    try {
      return callback(filePath, principalShard(principalKey));
    } finally {
      release();
    }
  }

  emptyState(principalKey) {
    return {
      principalKey,
      reminders: [],
      operations: [],
      inAppEvents: [],
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  readUnlocked(filePath, shard, expectedPrincipalKey) {
    this.assertReady();
    if (!fs.existsSync(filePath)) return this.emptyState(expectedPrincipalKey || "");
    try {
      const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (envelope.schemaVersion !== SCHEMA_VERSION) return this.emptyState(expectedPrincipalKey || "");
      const state = decryptState(envelope.encrypted, this.secret, shard);
      if (!state || !state.principalKey) return this.emptyState(expectedPrincipalKey || "");
      if (expectedPrincipalKey && state.principalKey !== expectedPrincipalKey) {
        throw typedError("Reminder ownership mismatch", "REMINDER_FORBIDDEN", 403);
      }
      state.reminders = Array.isArray(state.reminders) ? state.reminders : [];
      state.reminders.forEach((reminder) => {
        if (reminder.authorizationCredits === undefined) {
          reminder.authorizationCredits = reminder.authorizationState === "reported_granted" ? 1 : 0;
        }
      });
      state.operations = Array.isArray(state.operations) ? state.operations : [];
      state.inAppEvents = Array.isArray(state.inAppEvents) ? state.inAppEvents : [];
      return state;
    } catch (error) {
      if (error && error.code === "REMINDER_FORBIDDEN") throw error;
      return this.emptyState(expectedPrincipalKey || "");
    }
  }

  writeUnlocked(filePath, shard, state) {
    this.assertReady();
    state.updatedAt = new Date(this.now()).toISOString();
    writeAtomic(filePath, {
      schemaVersion: SCHEMA_VERSION,
      principalShard: shard,
      updatedAt: state.updatedAt,
      encrypted: encryptState(state, this.secret, shard),
    });
  }

  idempotencyHash(principalKey, idempotencyKey) {
    const key = String(idempotencyKey || "").trim();
    if (!key || key.length > 160) throw typedError("Idempotency key required", "IDEMPOTENCY_KEY_REQUIRED", 400);
    return sha(`${principalKey}|${key}`);
  }

  createConfirmation(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    this.assertReady();
    const operation = ["create", "update", "delete"].includes(input.operation) ? input.operation : "";
    if (!operation) throw typedError("Confirmation operation invalid", "REMINDER_OPERATION_INVALID", 400);
    const idempotencyHash = this.idempotencyHash(principalKey, input.idempotencyKey);
    const reminderId = String(input.reminderId || "").slice(0, 80);
    if (operation !== "create") this.get({ principal: input.principal, reminderId });
    const payload = operation === "update" ? sanitizePatch(input.payload) : (input.payload || {});
    const issuedAt = this.now();
    const body = {
      version: 1,
      operation,
      reminderId,
      principalHash: sha(principalKey).slice(0, 32),
      idempotencyHash,
      payload,
      issuedAt,
      expiresAt: issuedAt + CONFIRMATION_TTL_MS,
    };
    const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
    const signature = crypto.createHmac("sha256", this.secret).update(encoded).digest("base64url");
    return {
      token: `${encoded}.${signature}`,
      expiresAt: new Date(body.expiresAt).toISOString(),
      operation,
    };
  }

  verifyConfirmation(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    this.assertReady();
    const token = String(input.confirmationToken || "");
    const parts = token.split(".");
    if (parts.length !== 2) throw typedError("Confirmation required", "REMINDER_CONFIRMATION_REQUIRED", 409);
    const expected = crypto.createHmac("sha256", this.secret).update(parts[0]).digest("base64url");
    const left = Buffer.from(expected);
    const right = Buffer.from(parts[1]);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw typedError("Confirmation invalid", "REMINDER_CONFIRMATION_INVALID", 403);
    }
    let body;
    try {
      body = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    } catch (_) {
      throw typedError("Confirmation invalid", "REMINDER_CONFIRMATION_INVALID", 403);
    }
    const idempotencyHash = this.idempotencyHash(principalKey, input.idempotencyKey);
    if (body.principalHash !== sha(principalKey).slice(0, 32)
      || body.operation !== input.operation
      || body.idempotencyHash !== idempotencyHash
      || Number(body.expiresAt || 0) < this.now()) {
      throw typedError("Confirmation invalid", "REMINDER_CONFIRMATION_INVALID", 403);
    }
    if (input.reminderId && body.reminderId !== input.reminderId) {
      throw typedError("Confirmation invalid", "REMINDER_CONFIRMATION_INVALID", 403);
    }
    if (input.payload !== undefined) {
      const actual = input.operation === "update" ? sanitizePatch(input.payload) : (input.payload || {});
      if (stableJson(actual) !== stableJson(body.payload || {})) {
        throw typedError("Confirmed payload changed", "REMINDER_CONFIRMATION_MISMATCH", 409);
      }
    }
    return body;
  }

  findOperation(state, idempotencyHash, operation) {
    return state.operations.find((item) => item.keyHash === idempotencyHash && item.operation === operation) || null;
  }

  rememberOperation(state, idempotencyHash, operation, reminderId) {
    state.operations = state.operations.filter((item) => item.keyHash !== idempotencyHash);
    state.operations.push({ keyHash: idempotencyHash, operation, reminderId, at: new Date(this.now()).toISOString() });
    state.operations = state.operations.slice(-100);
  }

  create(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const confirmation = this.verifyConfirmation({
      principal: input.principal,
      confirmationToken: input.confirmationToken,
      operation: "create",
      idempotencyKey: input.idempotencyKey,
    });
    const idempotencyHash = confirmation.idempotencyHash;
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const previous = this.findOperation(state, idempotencyHash, "create");
      if (previous) {
        const existing = state.reminders.find((item) => item.id === previous.reminderId);
        if (existing) return { success: true, duplicate: true, reminder: publicReminder(existing) };
      }
      const plan = confirmation.payload && typeof confirmation.payload === "object" ? confirmation.payload : {};
      if (plan.success !== true || plan.operation !== "create" || plan.requiresConfirmation !== true) {
        throw typedError("Reminder plan invalid", "REMINDER_PLAN_INVALID", 400);
      }
      const nowIso = new Date(this.now()).toISOString();
      const authorizationState = normalizeSubscriptionStatus(input.subscriptionStatus);
      const id = `rem_${sha(`${principalKey}|${idempotencyHash}`).slice(0, 18)}`;
      const reminder = {
        id,
        status: "enabled",
        scope: plan.scope,
        leadMinutes: clampLead(plan.leadMinutes, 20),
        timezone: "Asia/Shanghai",
        recurrence: plan.recurrence || "once",
        eventDriven: plan.eventDriven === true,
        channel: authorizationState === "reported_granted" ? "wechat_subscription" : "app_only",
        authorizationState,
        authorizationCredits: authorizationState === "reported_granted" ? 1 : 0,
        scheduleFingerprint: String(plan.scheduleFingerprint || "").slice(0, 80),
        rule: {
          referenceDate: plan.referenceDate,
          referenceWeekday: plan.referenceWeekday,
          referenceTeachingWeek: plan.referenceTeachingWeek,
          termStartDate: plan.termStartDate || "",
          totalWeeks: Math.max(0, Number(plan.totalWeeks || 0) || 0),
          weekStart: plan.weekStart === "sunday" ? "sunday" : "monday",
          targetDate: plan.targetDate || "",
          courseIndex: plan.courseIndex || 1,
          courseTemplates: Array.isArray(plan.courseTemplates) ? plan.courseTemplates.slice(0, 60) : [],
        },
        nextOccurrence: plan.nextOccurrence || null,
        nextTriggerAt: String(plan.nextTriggerAt || ""),
        pendingEvents: [],
        attempts: 0,
        sendLog: [],
        createdAt: nowIso,
        updatedAt: nowIso,
        expiresAt: new Date(this.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      };
      state.reminders.push(reminder);
      if (state.reminders.length > MAX_REMINDERS) state.reminders = state.reminders.slice(-MAX_REMINDERS);
      this.rememberOperation(state, idempotencyHash, "create", id);
      this.writeUnlocked(filePath, shard, state);
      return { success: true, duplicate: false, reminder: publicReminder(reminder) };
    });
  }

  list(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      return {
        success: true,
        items: state.reminders.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(publicReminder),
      };
    });
  }

  get(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const reminderId = String(input.reminderId || "");
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const reminder = state.reminders.find((item) => item.id === reminderId);
      if (!reminder) throw typedError("Reminder not found", "REMINDER_NOT_FOUND", 404);
      return { success: true, reminder: publicReminder(reminder) };
    });
  }

  // 只读查找：按 idempotencyKey 定位 create 操作已落库的提醒（ActionReceipt 目标校验用）。
  // 找不到返回 null，不抛错；空 key 直接返回 null（不触发 IDEMPOTENCY_KEY_REQUIRED）。
  findByIdempotencyKey(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const key = String(input.idempotencyKey || "").trim();
    if (!key || key.length > 160) return null;
    const idempotencyHash = this.idempotencyHash(principalKey, key);
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const operation = this.findOperation(state, idempotencyHash, "create");
      if (!operation) return null;
      const reminder = state.reminders.find((item) => item.id === operation.reminderId);
      return reminder ? publicReminder(reminder) : null;
    });
  }

  grantSubscriptionAuthorization(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const authorizationState = normalizeSubscriptionStatus(input.subscriptionStatus);
    if (authorizationState !== "reported_granted") {
      throw typedError("Subscription authorization was not accepted", "REMINDER_SUBSCRIPTION_NOT_ACCEPTED", 409);
    }
    const reminderId = String(input.reminderId || "").slice(0, 80);
    const idempotencyHash = this.idempotencyHash(principalKey, input.idempotencyKey);
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const reminder = state.reminders.find((item) => item.id === reminderId);
      if (!reminder) throw typedError("Reminder not found", "REMINDER_NOT_FOUND", 404);
      const previous = this.findOperation(state, idempotencyHash, "subscription_grant");
      if (previous) return { success: true, duplicate: true, reminder: publicReminder(reminder) };
      if (!["enabled", "paused"].includes(reminder.status)) {
        throw typedError("Reminder is no longer active", "REMINDER_NOT_ACTIVE", 409);
      }
      reminder.authorizationCredits = Math.min(
        MAX_AUTHORIZATION_CREDITS,
        Math.max(0, Number(reminder.authorizationCredits || 0)) + 1
      );
      reminder.authorizationState = "reported_granted";
      reminder.channel = "wechat_subscription";
      reminder.updatedAt = new Date(this.now()).toISOString();
      this.rememberOperation(state, idempotencyHash, "subscription_grant", reminder.id);
      this.writeUnlocked(filePath, shard, state);
      return { success: true, duplicate: false, reminder: publicReminder(reminder) };
    });
  }

  listInAppEvents(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const limit = Math.min(20, Math.max(1, Number(input.limit || 10) || 10));
    const now = Number(input.now || this.now());
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const before = state.inAppEvents.length;
      state.inAppEvents = state.inAppEvents.filter((item) => {
        const expiresAt = Date.parse(item && item.expiresAt || "");
        return !Number.isFinite(expiresAt) || expiresAt > now;
      });
      if (state.inAppEvents.length !== before) this.writeUnlocked(filePath, shard, state);
      return {
        success: true,
        items: state.inAppEvents
          .slice()
          .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
          .slice(0, limit)
          .map(publicInAppEvent),
      };
    });
  }

  acknowledgeInAppEvent(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const eventId = String(input.eventId || "").slice(0, 80);
    if (!/^inapp_[a-f0-9]{20}$/.test(eventId)) {
      throw typedError("In-app reminder event invalid", "IN_APP_REMINDER_EVENT_INVALID", 400);
    }
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const before = state.inAppEvents.length;
      state.inAppEvents = state.inAppEvents.filter((item) => item.id !== eventId);
      const acknowledged = state.inAppEvents.length < before;
      if (acknowledged) this.writeUnlocked(filePath, shard, state);
      return { success: true, acknowledged, duplicate: !acknowledged };
    });
  }

  update(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    if (!input.confirmationToken) throw typedError("Confirmation required", "REMINDER_CONFIRMATION_REQUIRED", 409);
    const patch = sanitizePatch(input.patch);
    const confirmation = this.verifyConfirmation({
      principal: input.principal,
      confirmationToken: input.confirmationToken,
      operation: "update",
      reminderId: String(input.reminderId || ""),
      idempotencyKey: input.idempotencyKey,
      payload: patch,
    });
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const previous = this.findOperation(state, confirmation.idempotencyHash, "update");
      const reminder = state.reminders.find((item) => item.id === input.reminderId);
      if (!reminder) throw typedError("Reminder not found", "REMINDER_NOT_FOUND", 404);
      if (previous) return { success: true, duplicate: true, reminder: publicReminder(reminder) };
      if (patch.status) reminder.status = patch.status;
      if (patch.leadMinutes) {
        reminder.leadMinutes = patch.leadMinutes;
        if (reminder.nextOccurrence && reminder.nextOccurrence.startsAt) {
          reminder.nextTriggerAt = new Date(Date.parse(reminder.nextOccurrence.startsAt) - patch.leadMinutes * 60000).toISOString();
        }
      }
      reminder.updatedAt = new Date(this.now()).toISOString();
      this.rememberOperation(state, confirmation.idempotencyHash, "update", reminder.id);
      this.writeUnlocked(filePath, shard, state);
      return { success: true, duplicate: false, reminder: publicReminder(reminder) };
    });
  }

  remove(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    if (!input.confirmationToken) throw typedError("Confirmation required", "REMINDER_CONFIRMATION_REQUIRED", 409);
    const confirmation = this.verifyConfirmation({
      principal: input.principal,
      confirmationToken: input.confirmationToken,
      operation: "delete",
      reminderId: String(input.reminderId || ""),
      idempotencyKey: input.idempotencyKey,
      payload: {},
    });
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const previous = this.findOperation(state, confirmation.idempotencyHash, "delete");
      const before = state.reminders.length;
      state.reminders = state.reminders.filter((item) => item.id !== input.reminderId);
      const deleted = state.reminders.length < before;
      if (!deleted && !previous) throw typedError("Reminder not found", "REMINDER_NOT_FOUND", 404);
      this.rememberOperation(state, confirmation.idempotencyHash, "delete", input.reminderId);
      this.writeUnlocked(filePath, shard, state);
      return { success: true, duplicate: Boolean(previous), deleted: deleted || Boolean(previous) };
    });
  }

  queueScheduleChangeEvent(input = {}) {
    const principalKey = this.assertPrincipal(input.principal);
    const change = input.change && typeof input.change === "object" && !Array.isArray(input.change)
      ? input.change
      : {};
    const fields = Array.isArray(change.fields) ? change.fields.map(String) : [];
    if (change.type !== "modified" || !fields.includes("classroom") || !change.after) {
      return { success: true, queued: 0, duplicate: false, items: [], reason: "NO_CLASSROOM_CHANGE" };
    }
    const idempotencyHash = this.idempotencyHash(principalKey, input.idempotencyKey);
    const referenceDate = String(input.referenceDate || "").slice(0, 10);
    const referenceWeekday = Math.max(1, Math.min(7, Number(input.referenceWeekday || 1) || 1));
    const referenceTeachingWeek = Math.max(0, Number(input.referenceTeachingWeek || 0) || 0);
    const eventFingerprint = sha(stableJson({
      type: change.type,
      fields,
      before: publicOccurrence(change.before),
      after: publicOccurrence(change.after),
    })).slice(0, 40);

    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const previous = this.findOperation(state, idempotencyHash, "schedule_change_event");
      if (previous) return { success: true, queued: 0, duplicate: true, items: [] };
      const now = this.now();
      const queued = [];
      state.reminders.forEach((reminder) => {
        if (reminder.status !== "enabled" || reminder.eventDriven !== true || reminder.scope !== "room_change") return;
        const occurrence = computeNextOccurrence({
          courseTemplates: [change.after],
          referenceDate,
          referenceWeekday,
          referenceTeachingWeek,
          leadMinutes: reminder.leadMinutes,
          afterMs: now - 60000,
        });
        if (!occurrence) return;
        const pendingEvents = Array.isArray(reminder.pendingEvents) ? reminder.pendingEvents : [];
        if (pendingEvents.some((item) => item.eventFingerprint === eventFingerprint)) return;
        pendingEvents.push({
          eventFingerprint,
          queuedAt: new Date(now).toISOString(),
          occurrence: publicOccurrence(occurrence),
        });
        reminder.pendingEvents = pendingEvents.slice(-10);
        if (!reminder.nextTriggerAt) {
          reminder.nextOccurrence = reminder.pendingEvents[0].occurrence;
          reminder.nextTriggerAt = new Date(now).toISOString();
          reminder.attempts = 0;
        }
        reminder.updatedAt = new Date(now).toISOString();
        queued.push(publicReminder(reminder));
      });
      this.rememberOperation(state, idempotencyHash, "schedule_change_event", queued.map((item) => item.id).join(","));
      this.writeUnlocked(filePath, shard, state);
      return { success: true, queued: queued.length, duplicate: false, items: queued };
    });
  }

  walkReminderFiles() {
    const output = [];
    if (!fs.existsSync(this.rootDir)) return output;
    fs.readdirSync(this.rootDir, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isDirectory()) return;
      const filePath = path.join(this.rootDir, entry.name, "reminders.json");
      if (fs.existsSync(filePath)) output.push({ filePath, shard: entry.name });
    });
    return output;
  }

  listDue(input = {}) {
    this.assertReady();
    const now = Number(input.now || this.now());
    const limit = Math.min(100, Math.max(1, Number(input.limit || 50) || 50));
    const due = [];
    this.walkReminderFiles().some((file) => {
      let state;
      try {
        const envelope = JSON.parse(fs.readFileSync(file.filePath, "utf8"));
        state = decryptState(envelope.encrypted, this.secret, file.shard);
      } catch (_) {
        state = null;
      }
      if (!state || !state.principalKey) return false;
      (state.reminders || []).forEach((reminder) => {
        if (due.length >= limit || reminder.status !== "enabled") return;
        const trigger = Date.parse(reminder.nextTriggerAt || "");
        if (Number.isFinite(trigger) && trigger <= now) due.push({ principalKey: state.principalKey, reminder });
      });
      return due.length >= limit;
    });
    return due;
  }

  recordDispatch(input = {}) {
    const principalKey = String(input.principalKey || "");
    if (!principalKey) throw typedError("Principal required", "PRINCIPAL_REQUIRED", 401);
    const now = Number(input.now || this.now());
    return this.withLock(principalKey, (filePath, shard) => {
      const state = this.readUnlocked(filePath, shard, principalKey);
      const reminder = state.reminders.find((item) => item.id === input.reminderId);
      if (!reminder) return null;
      const result = input.result || {};
      const success = result.success === true;
      const appOnly = result.code === "APP_ONLY_DUE" || result.fallbackToApp === true;
      const authorizationInvalid = [
        "WECHAT_SUBSCRIPTION_NOT_AUTHORIZED",
        "WECHAT_TEMPLATE_INVALID",
        "WECHAT_RECIPIENT_INVALID",
      ].includes(String(result.code || ""));
      if (appOnly) {
        const occurrence = publicOccurrence(reminder.nextOccurrence);
        const kind = reminder.eventDriven === true ? "schedule_change" : "course_start";
        const eventId = `inapp_${sha(stableJson({
          reminderId: reminder.id,
          kind,
          triggerAt: reminder.nextTriggerAt,
          occurrence,
        })).slice(0, 20)}`;
        state.inAppEvents = Array.isArray(state.inAppEvents) ? state.inAppEvents : [];
        if (!state.inAppEvents.some((item) => item.id === eventId)) {
          state.inAppEvents.push({
            id: eventId,
            reminderId: reminder.id,
            kind,
            occurrence,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + IN_APP_EVENT_TTL_MS).toISOString(),
          });
          state.inAppEvents = state.inAppEvents.slice(-MAX_IN_APP_EVENTS);
        }
      }
      reminder.sendLog = Array.isArray(reminder.sendLog) ? reminder.sendLog : [];
      reminder.sendLog.push({
        at: new Date(now).toISOString(),
        status: success ? "sent" : (appOnly ? "app_only" : "failed"),
        code: String(result.code || (success ? "OK" : "SEND_FAILED")).slice(0, 80),
        attempt: Number(reminder.attempts || 0) + 1,
      });
      reminder.sendLog = reminder.sendLog.slice(-MAX_SEND_LOG);
      reminder.updatedAt = new Date(now).toISOString();

      if (success && reminder.channel === "wechat_subscription") {
        reminder.authorizationCredits = Math.max(0, Number(reminder.authorizationCredits || 0) - 1);
        if (reminder.authorizationCredits < 1) reminder.authorizationState = "authorization_required";
      } else if (authorizationInvalid) {
        reminder.authorizationCredits = 0;
        reminder.authorizationState = result.code === "WECHAT_TEMPLATE_INVALID"
          ? "configuration_required"
          : "authorization_required";
      } else if (result.code === "APP_ONLY_DUE"
        && reminder.channel === "wechat_subscription"
        && Number(reminder.authorizationCredits || 0) < 1) {
        reminder.authorizationState = "authorization_required";
      }

      if (success || appOnly) {
        reminder.attempts = 0;
        if (reminder.recurrence === "once") {
          reminder.status = "expired";
          reminder.nextTriggerAt = "";
        } else if (reminder.recurrence === "weekly") {
          const next = computeNextOccurrence(Object.assign({}, reminder.rule || {}, {
            leadMinutes: reminder.leadMinutes,
            afterMs: now + 60000,
          }));
          reminder.nextOccurrence = next;
          reminder.nextTriggerAt = next && next.triggerAt || "";
          if (!next) reminder.status = "expired";
        } else if (reminder.recurrence === "event") {
          const pendingEvents = Array.isArray(reminder.pendingEvents) ? reminder.pendingEvents.slice(1) : [];
          reminder.pendingEvents = pendingEvents;
          reminder.nextOccurrence = pendingEvents[0] && pendingEvents[0].occurrence || null;
          reminder.nextTriggerAt = pendingEvents.length ? new Date(now + 1000).toISOString() : "";
          reminder.status = "enabled";
        }
      } else {
        reminder.attempts = Number(reminder.attempts || 0) + 1;
        if (reminder.attempts <= RETRY_DELAYS_MS.length && result.retryable !== false) {
          reminder.nextTriggerAt = new Date(now + RETRY_DELAYS_MS[reminder.attempts - 1]).toISOString();
        } else if (reminder.recurrence === "event") {
          const pendingEvents = Array.isArray(reminder.pendingEvents) ? reminder.pendingEvents.slice(1) : [];
          reminder.pendingEvents = pendingEvents;
          reminder.attempts = 0;
          reminder.nextOccurrence = pendingEvents[0] && pendingEvents[0].occurrence || null;
          reminder.nextTriggerAt = pendingEvents.length ? new Date(now + 1000).toISOString() : "";
          reminder.status = "enabled";
        } else {
          reminder.status = "failed";
          reminder.nextTriggerAt = "";
        }
      }
      this.writeUnlocked(filePath, shard, state);
      return publicReminder(reminder);
    });
  }

  pruneExpired(input = {}) {
    const now = Number(input.now || this.now());
    let deleted = 0;
    this.walkReminderFiles().forEach((file) => {
      let state;
      try {
        const envelope = JSON.parse(fs.readFileSync(file.filePath, "utf8"));
        state = decryptState(envelope.encrypted, this.secret, file.shard);
      } catch (_) {
        state = null;
      }
      if (!state || !state.principalKey) return;
      this.withLock(state.principalKey, (filePath, shard) => {
        const current = this.readUnlocked(filePath, shard, state.principalKey);
        const before = current.reminders.length;
        current.reminders = current.reminders.filter((item) => {
          const expires = Date.parse(item.expiresAt || "");
          const updated = Date.parse(item.updatedAt || "");
          if (Number.isFinite(expires) && expires <= now) return false;
          if (["expired", "failed"].includes(item.status) && Number.isFinite(updated) && updated < now - 30 * 24 * 60 * 60 * 1000) return false;
          return true;
        });
        deleted += before - current.reminders.length;
        if (before !== current.reminders.length) this.writeUnlocked(filePath, shard, current);
      });
    });
    return { success: true, deleted };
  }
}

const defaultCourseReminderService = new CourseReminderService();

module.exports = {
  CONFIRMATION_TTL_MS,
  CourseReminderService,
  IN_APP_EVENT_TTL_MS,
  MAX_IN_APP_EVENTS,
  MAX_AUTHORIZATION_CREDITS,
  MAX_REMINDERS,
  RETRY_DELAYS_MS,
  defaultCourseReminderService,
  normalizeSubscriptionStatus,
  publicInAppEvent,
  publicReminder,
  sanitizePatch,
};

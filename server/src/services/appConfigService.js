const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const releaseService = require("./releaseService");
const feedbackService = require("./feedbackService");
const termRegistryService = require("./termRegistryService");
const { safeLog } = require("../utils/safeLogger");
const DEFAULT_DAILY_KNOWLEDGE = require("../content/dailyKnowledgeBuiltin");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../storage"));
const CONFIG_PATH = path.join(STORAGE_DIR, "admin-config.json");
const NOTICES_PATH = path.join(STORAGE_DIR, "notices.json");
const NOTICE_IDEMPOTENCY_PATH = path.join(STORAGE_DIR, "notice-idempotency.json");
const NEWS_PATH = path.join(STORAGE_DIR, "news.json");
const SYNC_META_PATH = path.join(STORAGE_DIR, "sync-meta.json");

const NOTICE_TYPES = new Set(["info", "warning", "success", "update", "maintenance"]);
const NOTICE_PRIORITIES = new Set(["normal", "important", "urgent"]);
const NOTICE_DISPLAY_MODES = new Set(["banner", "modal", "ticker", "card", "daily-tip"]);
const NOTICE_TARGET_PAGES = new Set(["home", "today", "school", "settings", "all"]);
const DAILY_KNOWLEDGE_CATEGORIES = new Set(["mind", "fraud", "campus"]);
const DAILY_KNOWLEDGE_TYPE_BY_CATEGORY = Object.freeze({ mind: "success", fraud: "warning", campus: "info" });
const DAILY_KNOWLEDGE_IMPORT_LIMIT = 1000;
const PRIORITY_SCORE = {
  urgent: 3,
  important: 2,
  normal: 1,
};

const DEFAULT_DISCLAIMER = "课表仅供参考，以任课教师及教务通知为准。";

const DEFAULT_CONFIG = {
  appName: "佛课小表",
  currentSemester: termRegistryService.LEGACY_CURRENT_TERM_CONFIG.term,
  publishStatus: "online",
  appConfig: {
    enableFosuStudentImport: true,
  },
  dataVersion: {
    releaseVersion: "",
    classScheduleUpdatedAt: "",
    teacherScheduleUpdatedAt: "",
    classroomScheduleUpdatedAt: "",
    courseScheduleUpdatedAt: "",
    releaseNote: "全校课表数据已更新",
    dataSourceLabel: "教务系统快照 / 用户反馈修正 / 本地维护",
  },
  disclaimer: DEFAULT_DISCLAIMER,
  updatedAt: "",
};

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return data == null ? fallback : data;
  } catch (error) {
    safeLog("app-config-read-json-failed", { filePath, error: error.message });
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureStorageDir();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath) && process.platform === "win32") {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }
}

function toText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (maxLength && text.length > maxLength) {
    return text.slice(0, maxLength);
  }
  return text;
}

function toBool(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return Boolean(defaultValue);
  }
  return value === true || value === "true" || value === 1 || value === "1";
}

function makeResourceVersion() {
  if (crypto.randomUUID) {
    return `v_${crypto.randomUUID()}`;
  }
  return `v_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function makeId(prefix) {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function mergeConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.assign({}, DEFAULT_CONFIG, source, {
    appConfig: Object.assign({}, DEFAULT_CONFIG.appConfig, source.appConfig || {}),
    dataVersion: Object.assign({}, DEFAULT_CONFIG.dataVersion, source.dataVersion || {}),
  });
}

function getAdminConfig() {
  return mergeConfig(readJsonFile(CONFIG_PATH, {}));
}

function saveAdminConfig(patch) {
  const current = getAdminConfig();
  const source = patch && typeof patch === "object" ? patch : {};
  const next = Object.assign({}, current, {
    appName: toText(source.appName || current.appName, 80) || DEFAULT_CONFIG.appName,
    currentSemester: toText(source.currentSemester || current.currentSemester, 80) || DEFAULT_CONFIG.currentSemester,
    publishStatus: toText(source.publishStatus || current.publishStatus, 40) || "online",
    disclaimer: toText(source.disclaimer !== undefined ? source.disclaimer : current.disclaimer, 1000) || DEFAULT_DISCLAIMER,
    dataVersion: Object.assign({}, current.dataVersion, source.dataVersion || {}),
    appConfig: Object.assign({}, current.appConfig || {}, source.appConfig || {}),
    updatedAt: nowIso(),
  });
  next.dataVersion.releaseVersion = toText(next.dataVersion.releaseVersion, 80);
  next.dataVersion.releaseNote = toText(next.dataVersion.releaseNote, 600);
  next.dataVersion.dataSourceLabel = toText(next.dataVersion.dataSourceLabel, 200);
  [
    "classScheduleUpdatedAt",
    "teacherScheduleUpdatedAt",
    "classroomScheduleUpdatedAt",
    "courseScheduleUpdatedAt",
  ].forEach((key) => {
    next.dataVersion[key] = toText(next.dataVersion[key], 80);
  });
  writeJsonAtomic(CONFIG_PATH, next);
  return next;
}

function readArray(filePath) {
  const data = readJsonFile(filePath, []);
  return Array.isArray(data) ? data : [];
}

function saveArray(filePath, items) {
  writeJsonAtomic(filePath, Array.isArray(items) ? items : []);
}

function normalizeOptionalDate(value) {
  const text = toText(value, 80);
  if (!text) {
    return "";
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  return date.toISOString();
}

function normalizeNotice(payload, existing) {
  const now = nowIso();
  const source = payload || {};
  const base = existing || {};
  let type = NOTICE_TYPES.has(source.type) ? source.type : (NOTICE_TYPES.has(base.type) ? base.type : "info");
  const priority = NOTICE_PRIORITIES.has(source.priority) ? source.priority : (NOTICE_PRIORITIES.has(base.priority) ? base.priority : "normal");
  const displayMode = NOTICE_DISPLAY_MODES.has(source.displayMode) ? source.displayMode : (NOTICE_DISPLAY_MODES.has(base.displayMode) ? base.displayMode : "banner");
  const requestedTargetPage = NOTICE_TARGET_PAGES.has(source.targetPage) ? source.targetPage : (NOTICE_TARGET_PAGES.has(base.targetPage) ? base.targetPage : "all");
  const targetPage = displayMode === "daily-tip" ? "home" : requestedTargetPage;
  const title = toText(source.title !== undefined ? source.title : base.title, 120);
  const content = toText(source.content !== undefined ? source.content : base.content, 3000);
  if (!title) {
    const err = new Error("notice title is required");
    err.statusCode = 400;
    throw err;
  }
  let category = "";
  if (displayMode === "daily-tip") {
    const requestedCategory = toText(source.category !== undefined ? source.category : base.category, 20);
    category = DAILY_KNOWLEDGE_CATEGORIES.has(requestedCategory)
      ? requestedCategory
      : (type === "warning" ? "fraud" : (type === "success" ? "mind" : "campus"));
    type = DAILY_KNOWLEDGE_TYPE_BY_CATEGORY[category];
  }
  return {
    id: base.id || toText(source.id, 80) || makeId("notice"),
    title,
    content,
    type,
    priority,
    displayMode,
    targetPage,
    startAt: normalizeOptionalDate(source.startAt !== undefined ? source.startAt : base.startAt),
    endAt: normalizeOptionalDate(source.endAt !== undefined ? source.endAt : base.endAt),
    enabled: toBool(source.enabled, base.enabled !== undefined ? base.enabled : true),
    closable: toBool(source.closable, base.closable !== undefined ? base.closable : true),
    ...(category ? { category } : {}),
    version: makeResourceVersion(),
    createdAt: base.createdAt || now,
    updatedAt: now,
  };
}

function normalizeNews(payload, existing) {
  const now = nowIso();
  const source = payload || {};
  const base = existing || {};
  const title = toText(source.title !== undefined ? source.title : base.title, 140);
  if (!title) {
    const err = new Error("news title is required");
    err.statusCode = 400;
    throw err;
  }
  return {
    id: base.id || toText(source.id, 80) || makeId("news"),
    title,
    summary: toText(source.summary !== undefined ? source.summary : base.summary, 300),
    detail: toText(source.detail !== undefined ? source.detail : base.detail, 3000),
    tag: toText(source.tag !== undefined ? source.tag : base.tag, 40),
    link: toText(source.link !== undefined ? source.link : base.link, 500),
    date: normalizeOptionalDate(source.date !== undefined ? source.date : base.date) || now,
    enabled: toBool(source.enabled, base.enabled !== undefined ? base.enabled : true),
    version: makeResourceVersion(),
    createdAt: base.createdAt || now,
    updatedAt: now,
  };
}

function ensureItemVersion(item) {
  if (!item || typeof item !== "object") return item;
  if (!item.version) {
    item.version = makeResourceVersion();
  }
  return item;
}

/**
 * @param {object} existing
 * @param {object} options
 * @param {{ requireIfMatch?: boolean, client?: string }} options
 */
function assertVersionMatch(existing, options) {
  const opts = options || {};
  const expected = opts.expectedVersion || opts.ifMatch || opts.version;
  const current = existing && existing.version;
  const requireIfMatch = opts.requireIfMatch === true;

  if (requireIfMatch && (expected == null || expected === "")) {
    const err = new Error("If-Match or expectedVersion is required for this update");
    err.statusCode = 428;
    err.code = "PRECONDITION_REQUIRED";
    err.currentVersion = current || null;
    throw err;
  }

  if (expected == null || expected === "") {
    if (opts.client !== "next") {
      safeLog("content-version-compat-warning", {
        message: "legacy update without If-Match accepted during migration",
        id: existing && existing.id,
      });
    }
    return;
  }

  const stableCurrent = current || null;
  if (!stableCurrent) {
    // Existing record lacked version: assign on write but still accept once
    return;
  }
  if (String(stableCurrent) !== String(expected)) {
    const err = new Error("resource was modified by another request; reload and retry");
    err.statusCode = 409;
    err.code = "CONFLICT";
    err.currentVersion = stableCurrent;
    err.expectedVersion = expected;
    throw err;
  }
}

function listNotices() {
  const items = readArray(NOTICES_PATH).map((item) => ensureItemVersion({ ...item }));
  // Persist missing versions so subsequent editors always have If-Match targets
  let dirty = false;
  const raw = readArray(NOTICES_PATH);
  const withVersions = raw.map((item) => {
    if (item && !item.version) {
      dirty = true;
      return ensureItemVersion({ ...item });
    }
    return item;
  });
  if (dirty) {
    saveArray(NOTICES_PATH, withVersions);
  }
  return withVersions
    .map((item) => ensureItemVersion({ ...item }))
    .sort((left, right) => {
      const scoreDiff = (PRIORITY_SCORE[right.priority] || 0) - (PRIORITY_SCORE[left.priority] || 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    });
}

function noticeBusinessFingerprint(item) {
  return crypto.createHash("sha256").update(JSON.stringify({
    title: item.title,
    content: item.content,
    type: item.type,
    priority: item.priority,
    displayMode: item.displayMode,
    targetPage: item.targetPage,
    startAt: item.startAt,
    endAt: item.endAt,
    enabled: item.enabled,
    closable: item.closable,
    category: item.category || "",
  })).digest("hex");
}

function readNoticeOperations() {
  const value = readJsonFile(NOTICE_IDEMPOTENCY_PATH, { schemaVersion: 1, operations: [] });
  const now = Date.now();
  const operations = (Array.isArray(value && value.operations) ? value.operations : [])
    .filter((item) => item && new Date(item.expiresAt || 0).getTime() > now)
    .slice(-500);
  return { schemaVersion: 1, operations };
}

function findNoticeOperation(idempotencyKey, payloadFingerprint) {
  if (!idempotencyKey) return null;
  const keyHash = crypto.createHash("sha256").update(idempotencyKey).digest("hex");
  const operation = readNoticeOperations().operations.find((item) => item.keyHash === keyHash);
  if (operation && operation.payloadFingerprint !== payloadFingerprint) {
    const err = new Error("操作标识已用于不同内容，请刷新后重试");
    err.statusCode = 409;
    err.code = "IDEMPOTENCY_KEY_CONFLICT";
    throw err;
  }
  return operation || null;
}

function rememberNoticeOperation(idempotencyKey, payloadFingerprint, item) {
  if (!idempotencyKey) return;
  const state = readNoticeOperations();
  const keyHash = crypto.createHash("sha256").update(idempotencyKey).digest("hex");
  const completedAt = nowIso();
  const expiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString();
  state.operations = state.operations.filter((entry) => entry.keyHash !== keyHash);
  state.operations.push({ keyHash, payloadFingerprint, completedAt, expiresAt, receipt: item });
  state.operations = state.operations.slice(-500);
  writeJsonAtomic(NOTICE_IDEMPOTENCY_PATH, state);
}

function createNoticeOperation(payload, options = {}) {
  const items = listNotices();
  const idempotencyKey = toText(options.idempotencyKey, 160);
  const deterministicId = idempotencyKey
    ? `notice_${crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`
    : "";
  const notice = normalizeNotice(deterministicId ? { ...(payload || {}), id: deterministicId } : payload);
  const payloadFingerprint = noticeBusinessFingerprint(notice);
  const operation = findNoticeOperation(idempotencyKey, payloadFingerprint);
  if (operation) return { item: operation.receipt, replayed: true };
  if (deterministicId) {
    const existing = items.find((item) => item.id === deterministicId);
    if (existing) {
      if (noticeBusinessFingerprint(existing) !== payloadFingerprint) {
        const err = new Error("操作标识已用于不同内容，请刷新后重试");
        err.statusCode = 409;
        err.code = "IDEMPOTENCY_KEY_CONFLICT";
        throw err;
      }
      rememberNoticeOperation(idempotencyKey, payloadFingerprint, existing);
      return { item: existing, replayed: true };
    }
  }
  if (typeof options.beforeCreate === "function") options.beforeCreate();
  items.push(notice);
  saveArray(NOTICES_PATH, items);
  rememberNoticeOperation(idempotencyKey, payloadFingerprint, notice);
  return { item: notice, replayed: false };
}

function createNotice(payload, options = {}) {
  return createNoticeOperation(payload, options).item;
}

function dailyKnowledgeImportId(item) {
  const category = DAILY_KNOWLEDGE_CATEGORIES.has(item.category) ? item.category : "campus";
  const externalId = toText(item.externalId || item.importId || item.key, 120);
  const identity = externalId || [category, toText(item.title, 120), toText(item.content || item.text || item.body, 500)].join("|");
  return `daily_import_${crypto.createHash("sha256").update(`${category}|${identity}`).digest("hex").slice(0, 32)}`;
}

function normalizeDailyKnowledgeImportPack(payload) {
  const source = Array.isArray(payload) ? { items: payload } : (payload && typeof payload === "object" ? payload : {});
  const schemaVersion = Number(source.schemaVersion || source.version || 1);
  if (schemaVersion !== 1) {
    const err = new Error("每日知识导入格式版本不受支持，请使用 schemaVersion: 1");
    err.statusCode = 400;
    err.code = "DAILY_KNOWLEDGE_IMPORT_SCHEMA_UNSUPPORTED";
    throw err;
  }
  const rawItems = Array.isArray(source.items) ? source.items : [];
  if (!rawItems.length) {
    const err = new Error("导入内容不能为空");
    err.statusCode = 400;
    err.code = "DAILY_KNOWLEDGE_IMPORT_EMPTY";
    throw err;
  }
  if (rawItems.length > DAILY_KNOWLEDGE_IMPORT_LIMIT) {
    const err = new Error(`单次最多导入 ${DAILY_KNOWLEDGE_IMPORT_LIMIT} 条每日知识`);
    err.statusCode = 400;
    err.code = "DAILY_KNOWLEDGE_IMPORT_TOO_LARGE";
    throw err;
  }
  const ids = new Set();
  const items = rawItems.map((raw, index) => {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const category = DAILY_KNOWLEDGE_CATEGORIES.has(item.category) ? item.category : "campus";
    const defaultTitle = category === "mind" ? "心理小知识" : (category === "fraud" ? "防诈小知识" : "校园小知识");
    const normalized = {
      id: dailyKnowledgeImportId(Object.assign({}, item, { category })),
      title: toText(item.title, 120) || defaultTitle,
      content: toText(item.content || item.text || item.body, 500),
      category,
      type: DAILY_KNOWLEDGE_TYPE_BY_CATEGORY[category],
      priority: "normal",
      displayMode: "daily-tip",
      targetPage: "home",
      startAt: item.startAt || "",
      endAt: item.endAt || "",
      enabled: item.enabled !== false,
      closable: false,
    };
    if (!normalized.content) {
      const err = new Error(`第 ${index + 1} 条每日知识正文为空`);
      err.statusCode = 400;
      err.code = "DAILY_KNOWLEDGE_IMPORT_ITEM_INVALID";
      throw err;
    }
    if (ids.has(normalized.id)) {
      const err = new Error(`第 ${index + 1} 条与导入包内已有内容使用了相同 externalId`);
      err.statusCode = 400;
      err.code = "DAILY_KNOWLEDGE_IMPORT_DUPLICATE_ID";
      throw err;
    }
    ids.add(normalized.id);
    return normalized;
  });
  return { schemaVersion: 1, items };
}

function importDailyKnowledgePack(payload, options = {}) {
  const pack = normalizeDailyKnowledgeImportPack(payload);
  const notices = listNotices();
  const next = notices.slice();
  const indexById = new Map(next.map((item, index) => [item.id, index]));
  const dailyFingerprintIds = new Map(next
    .filter((item) => item && item.displayMode === "daily-tip")
    .map((item) => [noticeBusinessFingerprint(item), item.id]));
  const result = { schemaVersion: 1, total: pack.items.length, created: 0, updated: 0, skipped: 0, dryRun: options.dryRun === true, items: [] };

  pack.items.forEach((source) => {
    const existingIndex = indexById.has(source.id) ? indexById.get(source.id) : -1;
    const existing = existingIndex >= 0 ? next[existingIndex] : null;
    const normalized = normalizeNotice(source, existing || undefined);
    const fingerprint = noticeBusinessFingerprint(normalized);
    const duplicateId = dailyFingerprintIds.get(fingerprint);
    if ((existing && noticeBusinessFingerprint(existing) === fingerprint) || (!existing && duplicateId)) {
      result.skipped += 1;
      result.items.push({ id: existing ? existing.id : duplicateId, title: normalized.title, category: normalized.category, status: "skipped" });
      return;
    }
    if (existing) {
      next[existingIndex] = normalized;
      result.updated += 1;
      result.items.push({ id: normalized.id, title: normalized.title, category: normalized.category, status: "updated" });
    } else {
      indexById.set(normalized.id, next.length);
      next.push(normalized);
      result.created += 1;
      result.items.push({ id: normalized.id, title: normalized.title, category: normalized.category, status: "created" });
    }
    dailyFingerprintIds.set(fingerprint, normalized.id);
  });

  const changed = result.created + result.updated;
  if (changed && options.dryRun !== true) {
    if (typeof options.beforeWrite === "function") options.beforeWrite();
    saveArray(NOTICES_PATH, next);
  }
  return result;
}

function updateNotice(id, payload, options) {
  const items = listNotices();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    const err = new Error("notice not found");
    err.statusCode = 404;
    throw err;
  }
  const opts = Object.assign({}, options || {}, options && options.payload ? {} : {});
  const mergedOpts = Object.assign({}, payload || {}, options || {});
  assertVersionMatch(items[index], mergedOpts);
  const next = normalizeNotice(payload, items[index]);
  next.version = makeResourceVersion();
  items[index] = next;
  saveArray(NOTICES_PATH, items);
  return items[index];
}

function deleteNotice(id) {
  const items = listNotices();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) {
    const err = new Error("notice not found");
    err.statusCode = 404;
    throw err;
  }
  saveArray(NOTICES_PATH, next);
  return { id };
}

function listNews() {
  const raw = readArray(NEWS_PATH);
  let dirty = false;
  const withVersions = raw.map((item) => {
    if (item && !item.version) {
      dirty = true;
      return ensureItemVersion({ ...item });
    }
    return item;
  });
  if (dirty) {
    saveArray(NEWS_PATH, withVersions);
  }
  return withVersions
    .map((item) => ensureItemVersion({ ...item }))
    .sort((left, right) => {
      return String(right.date || right.updatedAt || "").localeCompare(
        String(left.date || left.updatedAt || "")
      );
    });
}

function createNews(payload) {
  const items = listNews();
  const record = normalizeNews(payload);
  items.push(record);
  saveArray(NEWS_PATH, items);
  return record;
}

function updateNews(id, payload, options) {
  const items = listNews();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    const err = new Error("news not found");
    err.statusCode = 404;
    throw err;
  }
  const mergedOpts = Object.assign({}, payload || {}, options || {});
  assertVersionMatch(items[index], mergedOpts);
  const next = normalizeNews(payload, items[index]);
  next.version = makeResourceVersion();
  items[index] = next;
  saveArray(NEWS_PATH, items);
  return items[index];
}

function deleteNews(id) {
  const items = listNews();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) {
    const err = new Error("news not found");
    err.statusCode = 404;
    throw err;
  }
  saveArray(NEWS_PATH, next);
  return { id };
}

function isInDisplayWindow(item, now = new Date()) {
  if (!item || item.enabled !== true) {
    return false;
  }
  const time = now.getTime();
  if (item.startAt) {
    const start = new Date(item.startAt).getTime();
    if (Number.isFinite(start) && time < start) {
      return false;
    }
  }
  if (item.endAt) {
    const end = new Date(item.endAt).getTime();
    if (Number.isFinite(end) && time > end) {
      return false;
    }
  }
  return true;
}

function shanghaiDateKey(now) {
  const timestamp = now instanceof Date ? now.getTime() : Number(now);
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
  return new Date(safeTimestamp + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function selectDailyKnowledge(items, now = new Date()) {
  const managed = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.displayMode === "daily-tip" && ["home", "all"].includes(item.targetPage))
    .slice()
    .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
  const pool = managed.length ? managed : DEFAULT_DAILY_KNOWLEDGE;
  if (!pool.length) return null;
  const date = shanghaiDateKey(now);
  const dayNumber = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const selected = pool[((dayNumber % pool.length) + pool.length) % pool.length];
  return {
    id: toText(selected.id, 80),
    title: toText(selected.title, 120) || "每日小知识",
    content: toText(selected.content, 500),
    type: NOTICE_TYPES.has(selected.type) ? selected.type : "info",
    category: DAILY_KNOWLEDGE_CATEGORIES.has(selected.category)
      ? selected.category
      : (selected.type === "warning" ? "fraud" : (selected.type === "success" ? "mind" : "campus")),
    date,
    version: toText(selected.version, 120) || `builtin:${selected.id}`,
    source: managed.length ? "managed" : "builtin",
  };
}

function getDailyKnowledgeAdminState(now = new Date()) {
  const notices = listNotices();
  const managed = notices
    .filter((item) => item && item.displayMode === "daily-tip" && ["home", "all"].includes(item.targetPage))
    .slice()
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  const activeNotices = notices.filter((notice) => isInDisplayWindow(notice, now));
  const activeManaged = managed.filter((notice) => isInDisplayWindow(notice, now));
  const builtin = DEFAULT_DAILY_KNOWLEDGE.map((item) => ({
    id: item.id,
    title: item.title,
    content: item.content,
    type: item.type,
    category: item.category,
    displayMode: "daily-tip",
    targetPage: "home",
    enabled: true,
    source: "builtin",
  }));
  return {
    mode: activeManaged.length ? "managed" : "builtin",
    selected: selectDailyKnowledge(activeNotices, now),
    managed,
    builtin,
    counts: {
      managed: managed.length,
      active: activeManaged.length,
      builtin: builtin.length,
    },
  };
}

function readSyncMeta() {
  const meta = readJsonFile(SYNC_META_PATH, {});
  return meta && typeof meta === "object" ? meta : {};
}

function getFastReleaseStatus() {
  if (typeof releaseService.getReleaseStatusFast === "function") {
    return releaseService.getReleaseStatusFast();
  }
  const active = releaseService.getActiveReleaseInfoFast
    ? releaseService.getActiveReleaseInfoFast()
    : releaseService.getActiveReleaseInfo();
  return {
    activeReleaseVersion: active?.releaseVersion || active?.version || "",
    activeReleaseUpdatedAt: active?.updatedAt || active?.publishedAt || "",
    activeReleaseActivatedAt: active?.activatedAt || "",
    term: active?.term || active?.semester || "",
    semester: active?.semester || active?.term || "",
    termConfig: active?.termConfig || null,
    counts: active?.counts || {},
    resourceCounts: active?.resourceCounts || null,
    manifest: active?.manifest || null,
  };
}

function resolveDataVersion(config) {
  const meta = readSyncMeta();
  const releaseStatus = getFastReleaseStatus();
  const dataVersion = Object.assign({}, config.dataVersion || {});
  const snapshot = meta.snapshot || {};
  const fallbackUpdatedAt = releaseStatus.activeReleaseUpdatedAt || snapshot.updatedAt || "";
  return {
    releaseVersion: dataVersion.releaseVersion || releaseStatus.activeReleaseVersion || snapshot.version || "",
    classScheduleUpdatedAt: dataVersion.classScheduleUpdatedAt || meta["class-schedules"]?.updatedAt || fallbackUpdatedAt,
    teacherScheduleUpdatedAt: dataVersion.teacherScheduleUpdatedAt || meta["teacher-schedules"]?.updatedAt || fallbackUpdatedAt,
    classroomScheduleUpdatedAt: dataVersion.classroomScheduleUpdatedAt || meta["classroom-schedules"]?.updatedAt || fallbackUpdatedAt,
    courseScheduleUpdatedAt: dataVersion.courseScheduleUpdatedAt || meta["course-schedules"]?.updatedAt || fallbackUpdatedAt,
    releaseNote: dataVersion.releaseNote || DEFAULT_CONFIG.dataVersion.releaseNote,
    dataSourceLabel: dataVersion.dataSourceLabel || DEFAULT_CONFIG.dataVersion.dataSourceLabel,
  };
}

function getActiveTermConfig(config) {
  const activeTerm = termRegistryService.getActiveTerm();
  if (activeTerm) return activeTerm;
  return termRegistryService.normalizeTermRecord(Object.assign({}, termRegistryService.LEGACY_CURRENT_TERM_CONFIG, {
    status: "current",
    releaseVersion: config && config.dataVersion && config.dataVersion.releaseVersion || "",
    dataAvailable: true,
    updatedAt: config && config.updatedAt || new Date().toISOString(),
    source: "legacy-compatibility-fallback",
  }));
}

function getPublicAppConfig() {
  const config = getAdminConfig();
  const dataVersion = resolveDataVersion(config);
  const now = new Date();
  const registry = termRegistryService.readRegistry();
  const activeTerm = getActiveTermConfig(config);
  const availableTerms = termRegistryService.getPublicTerms();
  const registryUpdatedAt = registry && registry.updatedAt || activeTerm.updatedAt || config.updatedAt || "";
  
  const activeNotices = listNotices().filter((notice) => isInDisplayWindow(notice, now));
  const dailyKnowledge = selectDailyKnowledge(activeNotices, now);
  let notices = activeNotices.filter((notice) => notice.displayMode !== "daily-tip");
  
  // 检查当前学期是否已发布数据
  const activeRelease = releaseService.getActiveReleaseInfoFast
    ? releaseService.getActiveReleaseInfoFast()
    : releaseService.getActiveReleaseInfo();
  if (!activeRelease || (activeRelease.term || activeRelease.semester) !== activeTerm.term) {
    notices.unshift({
      id: "temp_new_semester_syncing",
      title: "温馨提示",
      content: "新学期课表正在同步中，请稍后查看。",
      type: "warning",
      priority: "important",
      displayMode: "banner",
      targetPage: "all",
      enabled: true,
      closable: false,
      version: "temp_sync",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  return {
    success: true,
    data: {
      appName: config.appName,
      currentSemester: activeTerm.term,
      termConfig: {
        term: activeTerm.term,
        semesterText: activeTerm.semesterText,
        termStartDate: activeTerm.termStartDate,
        totalWeeks: activeTerm.totalWeeks,
        weekStart: activeTerm.weekStart,
        source: activeTerm.source,
        releaseVersion: activeTerm.releaseVersion || dataVersion.releaseVersion || "",
      },
      availableTerms,
      dataVersion,
      appConfig: Object.assign({
        enableFosuStudentImport: process.env.FOSU_IMPORT_ENABLE !== "false",
      }, config.appConfig || {}),
      notices,
      dailyKnowledge,
      news: listNews().filter((item) => item.enabled === true),
      disclaimer: config.disclaimer || DEFAULT_DISCLAIMER,
      updatedAt: config.updatedAt || "",
      registryUpdatedAt,
      cacheEpoch: registryUpdatedAt ? new Date(registryUpdatedAt).getTime() || Date.now() : Date.now(),
      etag: termRegistryService.getRegistryEtag(registry),
    },
  };
}

function getCounts() {
  const meta = readSyncMeta();
  const releaseStatus = getFastReleaseStatus();
  const counts = releaseStatus.counts || {};
  return {
    classScheduleCount: counts.classScheduleCount || meta["class-schedules"]?.itemCount || 0,
    teacherScheduleCount: counts.teacherScheduleCount || meta["teacher-schedules"]?.itemCount || 0,
    classroomScheduleCount: counts.classroomScheduleCount || meta["classroom-schedules"]?.itemCount || 0,
    courseScheduleCount: counts.courseScheduleCount || meta["course-schedules"]?.itemCount || 0,
  };
}

function getAdminDashboard() {
  const config = getAdminConfig();
  const dataVersion = resolveDataVersion(config);
  const counts = getCounts();
  const feedbackStats = feedbackService.getFeedbackStats();
  const notices = listNotices();
  const registry = termRegistryService.readRegistry();
  const activeTerm = getActiveTermConfig(config);
  return {
    success: true,
    data: {
      appName: config.appName,
      currentSemester: activeTerm.term,
      termConfig: activeTerm,
      availableTerms: termRegistryService.getPublicTerms(),
      termRegistryUpdatedAt: registry && registry.updatedAt || "",
      publishStatus: config.publishStatus,
      dataVersion,
      counts: {
        ...counts,
        feedbackCount: feedbackStats.total,
        openFeedbackCount: feedbackStats.open,
        noticeCount: notices.length,
        enabledNoticeCount: notices.filter((item) => item.enabled).length,
        newsCount: listNews().length,
      },
    },
  };
}

function makeDateReleaseVersion(date, currentVersion) {
  const target = date || new Date();
  const pad = (num) => String(num).padStart(2, "0");
  const prefix = `${target.getFullYear()}.${pad(target.getMonth() + 1)}.${pad(target.getDate())}`;
  const current = String(currentVersion || "");
  const match = current.match(new RegExp(`^${prefix.replace(/\./g, "\\.")}-(\\d+)$`));
  if (match) {
    return `${prefix}-${Number(match[1]) + 1}`;
  }
  return `${prefix}-1`;
}

function touchDataVersionForSyncKey(key, options = {}) {
  const config = getAdminConfig();
  const now = options.updatedAt || nowIso();
  const dataVersion = Object.assign({}, config.dataVersion);
  const fieldMap = {
    "class-schedules": "classScheduleUpdatedAt",
    "teacher-schedules": "teacherScheduleUpdatedAt",
    "classroom-schedules": "classroomScheduleUpdatedAt",
    "course-schedules": "courseScheduleUpdatedAt",
  };

  if (key === "snapshot" || key === "release") {
    Object.values(fieldMap).forEach((field) => {
      dataVersion[field] = now;
    });
  } else if (fieldMap[key]) {
    dataVersion[fieldMap[key]] = now;
  }

  if (options.releaseVersion) {
    dataVersion.releaseVersion = toText(options.releaseVersion, 80);
  } else if (fieldMap[key] || key === "snapshot" || key === "release") {
    dataVersion.releaseVersion = makeDateReleaseVersion(new Date(now), dataVersion.releaseVersion);
  }
  dataVersion.releaseNote = toText(options.releaseNote || dataVersion.releaseNote || "全校课表数据已更新", 600);
  dataVersion.dataSourceLabel = toText(options.dataSourceLabel || dataVersion.dataSourceLabel || DEFAULT_CONFIG.dataVersion.dataSourceLabel, 200);

  const next = Object.assign({}, config, {
    currentSemester: options.semester || config.currentSemester,
    dataVersion,
    updatedAt: now,
  });
  writeJsonAtomic(CONFIG_PATH, next);
  return next;
}

module.exports = {
  CONFIG_PATH,
  NEWS_PATH,
  NOTICES_PATH,
  NOTICE_IDEMPOTENCY_PATH,
  createNews,
  createNotice,
  createNoticeOperation,
  deleteNews,
  deleteNotice,
  getAdminConfig,
  getAdminDashboard,
  getDailyKnowledgeAdminState,
  getPublicAppConfig,
  importDailyKnowledgePack,
  isInDisplayWindow,
  listNews,
  listNotices,
  saveAdminConfig,
  selectDailyKnowledge,
  normalizeDailyKnowledgeImportPack,
  touchDataVersionForSyncKey,
  updateNews,
  updateNotice,
};

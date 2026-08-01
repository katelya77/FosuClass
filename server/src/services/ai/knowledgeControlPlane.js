/**
 * Knowledge Control Plane v2
 * HTTP/MCP adapter → validation/version/audit → knowledgeBaseService
 *
 * P5a WS4a：审计/幂等存储按 FOSU_AGENT_REPOSITORY_BACKEND 双实现——
 * file（默认，现状）或 PostgreSQL（persistence/pgKnowledgeAuditService /
 * pgIdempotencyStore，异步方法）。条目整形/脱敏/指纹算法统一在
 * knowledgeAuditEntry，双后端共用不复制。
 */
const fs = require("fs");
const path = require("path");
const { acquireExclusiveFileLock } = require("../exclusiveFileLockService");
const defaultKnowledgeBaseService = require("./knowledgeBaseService");
const { resolveRepositoryBackend } = require("./persistence/repositoryBackend");
const {
  buildAuditEntry,
  fingerprintBody,
  nowIso,
  safeText,
  typedError,
} = require("./knowledgeAuditEntry");

const HIGH_RISK_FIELDS = new Set([
  "scope",
  "intentName",
  "toolName",
  "status",
  "authorityLevel",
  "patterns",
  "body",
  "reply",
]);

function isThenable(value) {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

class KnowledgeAuditService {
  constructor(options = {}) {
    this.maxEntries = Math.max(10, Number(options.maxEntries || 2000) || 2000);
    this.entries = [];
    this.persistPath = options.persistPath || path.resolve(
      process.env.FOSU_KB_AUDIT_PATH
      || path.join(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../data"), "ai", "kb-audit.jsonl")
    );
    this.memoryOnly = options.memoryOnly === true;
    if (!this.memoryOnly) {
      try {
        fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      } catch (_) {
        // ignore
      }
    }
  }

  record(event = {}) {
    const item = buildAuditEntry(event);
    this.entries = this.entries.concat(item).slice(-this.maxEntries);
    if (!this.memoryOnly) {
      try {
        const release = acquireExclusiveFileLock(this.persistPath, {
          lockPath: `${this.persistPath}.lock`,
          codePrefix: "KB_AUDIT",
          waitMs: 800,
          staleMs: 15000,
        });
        try {
          fs.appendFileSync(this.persistPath, `${JSON.stringify(item)}\n`, "utf8");
        } finally {
          release();
        }
      } catch (_) {
        // keep memory entry even if disk write fails
      }
    }
    return item;
  }

  list(limit = 50) {
    const max = Math.max(1, Math.min(200, Number(limit) || 50));
    if (!this.memoryOnly && fs.existsSync(this.persistPath)) {
      try {
        const lines = fs.readFileSync(this.persistPath, "utf8").split(/\r?\n/).filter(Boolean);
        const recent = lines.slice(-max).map((line) => {
          try { return JSON.parse(line); } catch (_) { return null; }
        }).filter(Boolean);
        if (recent.length) return recent.reverse();
      } catch (_) {
        // fall through
      }
    }
    return this.entries.slice(-max).reverse().map((item) => Object.assign({}, item));
  }
}

class IdempotencyStore {
  constructor(options = {}) {
    this.ttlMs = Math.max(60 * 1000, Number(options.ttlMs || 24 * 60 * 60 * 1000) || 24 * 60 * 60 * 1000);
    this.map = new Map();
    this.filePath = options.filePath || path.resolve(
      process.env.FOSU_KB_IDEMPOTENCY_PATH
      || path.join(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../data"), "ai", "kb-idempotency.json")
    );
    this.memoryOnly = options.memoryOnly === true;
    this._load();
  }

  _load() {
    if (this.memoryOnly) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const now = Date.now();
      Object.keys(raw.entries || {}).forEach((key) => {
        const item = raw.entries[key];
        if (item && item.expiresAt > now) this.map.set(key, item);
      });
    } catch (_) {
      // ignore
    }
  }

  _save() {
    if (this.memoryOnly) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const entries = {};
      this.map.forEach((value, key) => {
        entries[key] = value;
      });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify({ updatedAt: nowIso(), entries }, null, 2)}\n`, "utf8");
      fs.renameSync(tmp, this.filePath);
    } catch (_) {
      // ignore
    }
  }

  fingerprint(body) {
    return fingerprintBody(body);
  }

  get(key, body) {
    if (!key) return null;
    const item = this.map.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.map.delete(key);
      this._save();
      return null;
    }
    const fp = this.fingerprint(body);
    if (item.fingerprint !== fp) {
      throw typedError("Idempotency-Key reused with different payload", "IDEMPOTENCY_KEY_CONFLICT", 409);
    }
    return item.response;
  }

  set(key, body, response) {
    if (!key) return;
    this.map.set(key, {
      fingerprint: this.fingerprint(body),
      response,
      expiresAt: Date.now() + this.ttlMs,
      createdAt: nowIso(),
    });
    // bound memory
    if (this.map.size > 500) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
    this._save();
  }
}

/**
 * P5a WS4a：按 FOSU_AGENT_REPOSITORY_BACKEND 选审计存储实现。
 * file（默认）→ KnowledgeAuditService（同步）；postgres → PgKnowledgeAuditService（异步）。
 */
function createAuditService(options = {}) {
  if (options.audit) return options.audit;
  if (resolveRepositoryBackend(options.repositoryBackend) === "postgres") {
    // lazy require：file 模式不加载 pg 依赖链。
    // WS6：lazy gated pool——require 期不触网、未配置 PG 也不抛错；
    // 每次真实查询先过 init 就绪门（fail closed）。
    const { createLazyPool } = require("./persistence/pgReadiness");
    const { PgKnowledgeAuditService } = require("./persistence/pgKnowledgeAuditService");
    return new PgKnowledgeAuditService({ pool: createLazyPool({ gated: true }), maxEntries: options.maxEntries });
  }
  return new KnowledgeAuditService(options);
}

/** 同上：幂等存储的后端选择（TTL 口径双实现一致）。 */
function createIdempotencyStore(options = {}) {
  if (options.idempotency) return options.idempotency;
  if (resolveRepositoryBackend(options.repositoryBackend) === "postgres") {
    // lazy require + lazy gated pool（同 createAuditService）。
    const { createLazyPool } = require("./persistence/pgReadiness");
    const { PgIdempotencyStore } = require("./persistence/pgIdempotencyStore");
    return new PgIdempotencyStore({ pool: createLazyPool({ gated: true }), ttlMs: options.ttlMs });
  }
  return new IdempotencyStore(options);
}

function fieldDiff(before = {}, after = {}) {
  const keys = new Set([].concat(Object.keys(before || {}), Object.keys(after || {})));
  const changes = [];
  keys.forEach((key) => {
    if (["updatedAt", "contentHash", "revision", "chunks"].includes(key)) return;
    const left = before ? before[key] : undefined;
    const right = after ? after[key] : undefined;
    const leftText = JSON.stringify(left);
    const rightText = JSON.stringify(right);
    if (leftText === rightText) return;
    changes.push({
      field: key,
      before: typeof left === "string" ? safeText(left, 200) : left,
      after: typeof right === "string" ? safeText(right, 200) : right,
      highRisk: HIGH_RISK_FIELDS.has(key),
    });
  });
  return changes;
}

function summarizeBody(text) {
  return safeText(String(text || "").replace(/\s+/g, " "), 160);
}

class KnowledgeRepository {
  constructor(options = {}) {
    this.service = options.service || defaultKnowledgeBaseService;
    this.audit = createAuditService(options);
    this.idempotency = createIdempotencyStore(options);
  }

  // 审计为 best-effort：文件实现落盘失败静默；PG 实现（async）失败同样不阻断主流程。
  _recordAudit(event) {
    const recorded = this.audit.record(event);
    if (isThenable(recorded)) {
      recorded.catch(() => {});
      return null;
    }
    return recorded;
  }

  _cacheIdempotency(key, body, response) {
    const written = this.idempotency.set(key, body, response);
    if (isThenable(written)) written.catch(() => {});
  }

  _operatorMeta(options = {}) {
    return {
      requestId: options.requestId,
      operatorType: options.operatorType || "admin",
      operatorName: options.operatorName || "",
      tokenName: options.tokenName || "",
      scopes: options.scopes || [],
      authMethod: options.authMethod || "",
      clientName: options.clientName || "",
      idempotencyKey: options.idempotencyKey || "",
    };
  }

  listDraft(options = {}) {
    return this.service.listKnowledge(Object.assign({}, options, { status: "draft" }));
  }

  listPublished(options = {}) {
    return this.service.listKnowledge(Object.assign({}, options, { status: "published" }));
  }

  getDraft(id) {
    const list = this.listDraft();
    return (list.entries || []).find((item) => item.id === id || item.sourceId === id) || null;
  }

  getPublished(id) {
    const list = this.listPublished();
    return (list.entries || []).find((item) => item.id === id || item.sourceId === id) || null;
  }

  createDraft(type, input = {}, options = {}) {
    const idempotencyKey = options.idempotencyKey || input.idempotencyKey;
    if (idempotencyKey) {
      const cached = this.idempotency.get(idempotencyKey, { type, input });
      if (isThenable(cached)) {
        // PG 幂等存储为 async：命中走缓存，未命中走同一创建路径（Promise 化）。
        return cached.then((hit) => hit || this._createDraftFresh(type, input, options, idempotencyKey));
      }
      if (cached) return cached;
    }
    return this._createDraftFresh(type, input, options, idempotencyKey);
  }

  _createDraftFresh(type, input, options, idempotencyKey) {
    try {
      const result = this.service.createEntry(Object.assign({}, input, {
        type,
        status: "draft",
        updatedBy: options.operatorName || input.updatedBy || "",
      }));
      this._recordAudit(Object.assign(this._operatorMeta(options), {
        action: "create_draft",
        targetType: type,
        targetId: result.entry && result.entry.id,
        afterVersion: result.entry && String(result.entry.revision || 1),
        success: true,
      }));
      const response = Object.assign({}, result, { item: result.entry });
      if (idempotencyKey) this._cacheIdempotency(idempotencyKey, { type, input }, response);
      return response;
    } catch (error) {
      this._recordAudit(Object.assign(this._operatorMeta(options), {
        action: "create_draft",
        targetType: type,
        targetId: input.id || input.sourceId || "",
        success: false,
        errorCode: error.code || "CREATE_FAILED",
      }));
      throw error;
    }
  }

  updateDraft(type, id, patch = {}, options = {}) {
    const idempotencyKey = options.idempotencyKey || patch.idempotencyKey;
    if (idempotencyKey) {
      const cached = this.idempotency.get(idempotencyKey, { type, id, patch });
      if (isThenable(cached)) {
        // PG 幂等存储为 async：命中走缓存，未命中走同一更新路径（Promise 化）。
        return cached.then((hit) => hit || this._updateDraftFresh(type, id, patch, options, idempotencyKey));
      }
      if (cached) return cached;
    }
    return this._updateDraftFresh(type, id, patch, options, idempotencyKey);
  }

  _updateDraftFresh(type, id, patch, options, idempotencyKey) {
    const expectedRevision = options.expectedRevision != null
      ? options.expectedRevision
      : (options.ifMatch != null ? Number(options.ifMatch) : patch.expectedRevision);
    try {
      const before = this.getDraft(id);
      const result = this.service.updateEntry(id, Object.assign({}, patch, { type }), {
        expectedRevision,
        updatedBy: options.operatorName || patch.updatedBy || "",
      });
      this._recordAudit(Object.assign(this._operatorMeta(options), {
        action: "update_draft",
        targetType: type || (result.entry && result.entry.type),
        targetId: id,
        beforeVersion: before && String(before.revision || 1),
        afterVersion: result.entry && String(result.entry.revision || 1),
        success: true,
      }));
      const response = Object.assign({}, result, {
        item: result.entry,
        fieldChanges: fieldDiff(before || {}, result.entry || {}),
      });
      if (idempotencyKey) this._cacheIdempotency(idempotencyKey, { type, id, patch }, response);
      return response;
    } catch (error) {
      this._recordAudit(Object.assign(this._operatorMeta(options), {
        action: "update_draft",
        targetType: type,
        targetId: id,
        success: false,
        errorCode: error.code || "UPDATE_FAILED",
      }));
      throw error;
    }
  }

  deleteDraft(id, options = {}) {
    try {
      const before = this.getDraft(id);
      const result = this.service.deleteEntry(id);
      this._recordAudit(Object.assign(this._operatorMeta(options), {
        action: "delete_draft",
        targetType: result.removed && result.removed.type || (before && before.type),
        targetId: id,
        beforeVersion: before && String(before.revision || 1),
        success: true,
      }));
      return result;
    } catch (error) {
      this._recordAudit(Object.assign(this._operatorMeta(options), {
        action: "delete_draft",
        targetId: id,
        success: false,
        errorCode: error.code || "DELETE_FAILED",
      }));
      throw error;
    }
  }

  previewImport(input = {}) {
    return this.service.importMarkdown(Object.assign({}, input, { commit: false }));
  }

  importDraft(input = {}, options = {}) {
    const result = this.service.importMarkdown(Object.assign({}, input, { commit: true }));
    this._recordAudit(Object.assign(this._operatorMeta(options), {
      action: "import_draft",
      targetType: "doc",
      targetId: result.entry && result.entry.id,
      success: true,
    }));
    return result;
  }
}

class KnowledgeSearchProvider {
  constructor(options = {}) {
    this.service = options.service || defaultKnowledgeBaseService;
  }

  search(input = {}) {
    return this.service.searchKnowledge(input);
  }

  get(id, options = {}) {
    const result = this.service.listKnowledge({
      status: options.status === "draft" ? "draft" : "published",
      type: options.type,
      environment: options.environment,
    });
    return result.entries.find((item) => item.id === id || item.sourceId === id) || null;
  }
}

class KnowledgeVersionService {
  constructor(options = {}) {
    this.service = options.service || defaultKnowledgeBaseService;
    this.audit = createAuditService(options);
  }

  // 与 KnowledgeRepository 同口径：审计 best-effort，PG（async）失败不阻断主流程。
  _recordAudit(event) {
    const recorded = this.audit.record(event);
    if (isThenable(recorded)) {
      recorded.catch(() => {});
      return null;
    }
    return recorded;
  }

  getCurrentVersion() {
    const status = this.service.getIndexStatus();
    return {
      version: status.currentVersion || status.version,
      publishedAt: status.publishedAt,
      docCount: status.docCount,
      ruleCount: status.ruleCount,
      backupCount: status.backupCount,
    };
  }

  publish(options = {}) {
    const before = this.getCurrentVersion();
    const result = this.service.publish(options);
    const versionId = result.store && result.store.currentVersion || options.versionId;
    this._recordAudit({
      action: "publish",
      targetType: "version",
      targetId: versionId,
      beforeVersion: before.version,
      afterVersion: versionId,
      operatorType: options.operatorType || "admin",
      operatorName: options.operatorName || "",
      success: true,
    });
    return result;
  }

  rollback(versionId, options = {}) {
    const before = this.getCurrentVersion();
    const result = this.service.rollback(versionId);
    this._recordAudit({
      action: "rollback",
      targetType: "version",
      targetId: versionId,
      beforeVersion: before.version,
      afterVersion: versionId,
      operatorType: options.operatorType || "admin",
      operatorName: options.operatorName || "",
      success: true,
    });
    return result;
  }

  diffDraftToPublished(options = {}) {
    const draft = this.service.listKnowledge({ status: "draft" });
    const published = this.service.listKnowledge({ status: "published" });
    const draftMap = new Map(draft.entries.map((item) => [item.id, item]));
    const publishedMap = new Map(published.entries.map((item) => [item.id, item]));
    const added = [];
    const removed = [];
    const modified = [];
    const retained = [];
    draftMap.forEach((entry, id) => {
      if (!publishedMap.has(id)) {
        added.push({
          id,
          title: entry.title,
          type: entry.type,
          bodySummary: summarizeBody(entry.body || entry.reply),
          scope: entry.scope,
          authorityLevel: entry.authorityLevel,
          highRisk: true,
        });
        return;
      }
      const prev = publishedMap.get(id);
      const changes = fieldDiff(prev, entry);
      if (changes.length) {
        modified.push({
          id,
          title: entry.title,
          type: entry.type,
          bodySummary: summarizeBody(entry.body || entry.reply),
          changes,
          highRisk: changes.some((item) => item.highRisk),
          scopeChanged: changes.some((item) => item.field === "scope"),
          sourceChanged: changes.some((item) => String(item.field).startsWith("source")),
          bindingChanged: changes.some((item) => ["intentName", "toolName"].includes(item.field)),
        });
      } else {
        retained.push(id);
      }
    });
    publishedMap.forEach((entry, id) => {
      if (!draftMap.has(id)) {
        removed.push({
          id,
          title: entry.title,
          type: entry.type,
          bodySummary: summarizeBody(entry.body || entry.reply),
          highRisk: true,
        });
      }
    });
    return {
      added,
      removed,
      modified,
      retained,
      // Backward compatible id-only arrays
      addedIds: added.map((item) => item.id),
      removedIds: removed.map((item) => item.id),
      retainedIds: retained,
      highRisk: added.length > 0 || removed.length > 0 || modified.some((item) => item.highRisk),
      summary: {
        added: added.length,
        removed: removed.length,
        modified: modified.length,
        retained: retained.length,
      },
    };
  }
}

class KnowledgeValidationService {
  constructor(options = {}) {
    this.service = options.service || defaultKnowledgeBaseService;
  }

  validateEntry(entry = {}) {
    return this.service.validateEntrySecurity(this.service.normalizeEntry(entry, entry.type || "doc"));
  }

  validateImport(input = {}) {
    const preview = this.service.buildImportPreview(input.markdown || input.content || "", input).preview;
    return {
      ok: preview.blocked !== true,
      risks: preview.risks || [],
      conflict: preview.conflict === true,
      entry: preview.entry,
    };
  }
}

const ASSISTANT_KB_SCOPES = Object.freeze({
  READ: "assistant-kb:read",
  DRAFT_WRITE: "assistant-kb:draft:write",
  VALIDATE: "assistant-kb:validate",
  AUDIT_READ: "assistant-kb:audit:read",
  PUBLISH: "assistant-kb:publish",
  ROLLBACK: "assistant-kb:rollback",
});

function createKnowledgeControlPlane(options = {}) {
  const audit = createAuditService(options);
  const service = options.service || defaultKnowledgeBaseService;
  const idempotency = createIdempotencyStore(options);
  return {
    repository: new KnowledgeRepository({ service, audit, idempotency }),
    searchProvider: new KnowledgeSearchProvider({ service }),
    versionService: new KnowledgeVersionService({ service, audit }),
    validationService: new KnowledgeValidationService({ service }),
    auditService: audit,
    idempotency,
    scopes: ASSISTANT_KB_SCOPES,
  };
}

module.exports = {
  ASSISTANT_KB_SCOPES,
  IdempotencyStore,
  KnowledgeAuditService,
  KnowledgeRepository,
  KnowledgeSearchProvider,
  KnowledgeValidationService,
  KnowledgeVersionService,
  createAuditService,
  createIdempotencyStore,
  createKnowledgeControlPlane,
  fieldDiff,
};

/**
 * File-backed ConversationRepository with principal sharding,
 * optimistic concurrency, TTL prune, and corrupt-file isolation.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { acquireExclusiveFileLock } = require("../../exclusiveFileLockService");
const {
  SCHEMA_VERSION,
  createEmptyConversationState,
  hashConversationId,
  isExpired,
  migrateConversationState,
  nowIso,
  publicConversationView,
} = require("./conversationSchema");
const { principalShard } = require("./conversationPrincipalService");

const DEFAULT_MAX_PER_PRINCIPAL = 20;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;

function typedError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function quarantine(filePath, reason) {
  try {
    if (!fs.existsSync(filePath)) return;
    const brokenDir = path.join(path.dirname(filePath), "_broken");
    ensureDir(brokenDir);
    const base = path.basename(filePath);
    const target = path.join(brokenDir, `${base}.${Date.now()}.${reason || "corrupt"}`);
    fs.renameSync(filePath, target);
  } catch (_) {
    // best effort
  }
}

class FileConversationRepository {
  constructor(options = {}) {
    const dataRoot = path.resolve(
      options.dataDir
      || process.env.FOSU_CONVERSATION_DATA_DIR
      || path.join(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../../data"), "ai", "conversations")
    );
    this.rootDir = dataRoot;
    this.maxPerPrincipal = Math.max(1, Number(options.maxPerPrincipal || DEFAULT_MAX_PER_PRINCIPAL) || DEFAULT_MAX_PER_PRINCIPAL);
    this.maxFileBytes = Math.max(8 * 1024, Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES) || DEFAULT_MAX_FILE_BYTES);
  }

  principalDir(principalKey) {
    return path.join(this.rootDir, principalShard(principalKey));
  }

  indexPath(principalKey) {
    return path.join(this.principalDir(principalKey), "index.json");
  }

  conversationPath(principalKey, conversationIdHash) {
    return path.join(this.principalDir(principalKey), `${conversationIdHash}.json`);
  }

  withPrincipalLock(principalKey, callback) {
    const lockTarget = this.indexPath(principalKey);
    ensureDir(this.principalDir(principalKey));
    const release = acquireExclusiveFileLock(lockTarget, {
      lockPath: `${lockTarget}.lock`,
      codePrefix: "CONVERSATION",
      waitMs: Number(process.env.FOSU_CONVERSATION_LOCK_WAIT_MS || 1500),
      staleMs: Number(process.env.FOSU_CONVERSATION_LOCK_STALE_MS || 30000),
    });
    try {
      return callback();
    } finally {
      release();
    }
  }

  readIndex(principalKey) {
    const filePath = this.indexPath(principalKey);
    try {
      if (!fs.existsSync(filePath)) {
        return { schemaVersion: SCHEMA_VERSION, principalKey, items: [], updatedAt: nowIso() };
      }
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        schemaVersion: SCHEMA_VERSION,
        principalKey,
        items: Array.isArray(raw.items) ? raw.items : [],
        updatedAt: raw.updatedAt || nowIso(),
      };
    } catch (error) {
      quarantine(filePath, "index");
      return { schemaVersion: SCHEMA_VERSION, principalKey, items: [], updatedAt: nowIso() };
    }
  }

  writeIndex(principalKey, index) {
    writeJsonAtomic(this.indexPath(principalKey), {
      schemaVersion: SCHEMA_VERSION,
      principalKey: principalKey ? String(principalKey).slice(0, 16) + "…" : "",
      items: (index.items || []).map((item) => ({
        conversationIdHash: item.conversationIdHash,
        clientConversationId: item.clientConversationId,
        title: item.title,
        revision: item.revision,
        updatedAt: item.updatedAt,
        expiresAt: item.expiresAt,
        memoryMode: item.memoryMode,
      })),
      updatedAt: nowIso(),
    });
  }

  readConversationFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      if (stat.size > this.maxFileBytes) {
        quarantine(filePath, "oversized");
        return null;
      }
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return migrateConversationState(raw);
    } catch (error) {
      quarantine(filePath, "parse");
      return null;
    }
  }

  get(principalKey, conversationId) {
    if (!principalKey) return null;
    const conversationIdHash = hashConversationId(conversationId);
    return this.withPrincipalLock(principalKey, () => {
      const state = this.readConversationFile(this.conversationPath(principalKey, conversationIdHash));
      if (!state) return null;
      if (state.principalKey && state.principalKey !== principalKey) return null;
      if (isExpired(state)) {
        this._deleteUnlocked(principalKey, conversationIdHash);
        return null;
      }
      state.lastAccessedAt = nowIso();
      writeJsonAtomic(this.conversationPath(principalKey, conversationIdHash), state);
      return state;
    });
  }

  create(principalKey, input = {}) {
    if (!principalKey) {
      throw typedError("Authenticated principal required", "PRINCIPAL_REQUIRED", 401);
    }
    const conversationId = String(input.conversationId || input.clientConversationId || "").trim();
    if (!conversationId || conversationId.length > 80) {
      throw typedError("conversationId invalid", "CONVERSATION_ID_INVALID", 400);
    }
    const conversationIdHash = hashConversationId(conversationId);
    return this.withPrincipalLock(principalKey, () => {
      this.pruneExpiredUnlocked(principalKey);
      const existing = this.readConversationFile(this.conversationPath(principalKey, conversationIdHash));
      if (existing && !isExpired(existing)) {
        return existing;
      }
      const state = createEmptyConversationState({
        conversationId,
        principalKey,
        runtimeMode: input.runtimeMode,
        memoryMode: input.memoryMode || "session_state",
        title: input.title,
      });
      state.contextSlots = input.contextSlots || state.contextSlots;
      writeJsonAtomic(this.conversationPath(principalKey, conversationIdHash), state);
      this._upsertIndexUnlocked(principalKey, state);
      this._enforceCapacityUnlocked(principalKey);
      return state;
    });
  }

  list(principalKey, options = {}) {
    if (!principalKey) return [];
    return this.withPrincipalLock(principalKey, () => {
      this.pruneExpiredUnlocked(principalKey);
      const index = this.readIndex(principalKey);
      const items = [];
      index.items.forEach((meta) => {
        const state = this.readConversationFile(this.conversationPath(principalKey, meta.conversationIdHash));
        if (!state || isExpired(state)) return;
        items.push(options.raw ? state : publicConversationView(state));
      });
      items.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      return items;
    });
  }

  update(principalKey, conversationId, patch = {}, options = {}) {
    if (!principalKey) {
      throw typedError("Authenticated principal required", "PRINCIPAL_REQUIRED", 401);
    }
    const conversationIdHash = hashConversationId(conversationId);
    return this.withPrincipalLock(principalKey, () => {
      const filePath = this.conversationPath(principalKey, conversationIdHash);
      let current = this.readConversationFile(filePath);
      let wasCreated = false;
      if (!current || isExpired(current)) {
        if (options.createIfMissing) {
          current = createEmptyConversationState({
            conversationId,
            principalKey,
            runtimeMode: patch.runtimeMode || options.runtimeMode,
            memoryMode: patch.memoryPolicy && patch.memoryPolicy.mode || options.memoryMode || "session_state",
            title: patch.title,
          });
          // revision starts at 1 after first upsert write below
          current.revision = 0;
          wasCreated = true;
        } else {
          throw typedError("Conversation not found", "CONVERSATION_NOT_FOUND", 404);
        }
      }
      if (current.principalKey && current.principalKey !== principalKey) {
        throw typedError("Conversation ownership mismatch", "CONVERSATION_FORBIDDEN", 403);
      }
      const expectedRevision = options.expectedRevision;
      // Skip revision check on first create so client can pass local revision 0 safely.
      if (!wasCreated && expectedRevision !== undefined && expectedRevision !== null
        && Number(expectedRevision) !== Number(current.revision)) {
        throw typedError("Conversation revision conflict", "CONVERSATION_REVISION_CONFLICT", 409);
      }
      const next = migrateConversationState(Object.assign({}, current, patch, {
        principalKey,
        conversationIdHash,
        clientConversationId: current.clientConversationId || conversationId,
        revision: wasCreated ? 1 : Number(current.revision || 0) + 1,
        updatedAt: nowIso(),
        lastAccessedAt: nowIso(),
      }), { conversationId, principalKey });
      writeJsonAtomic(filePath, next);
      this._upsertIndexUnlocked(principalKey, next);
      this._enforceCapacityUnlocked(principalKey);
      return next;
    });
  }

  delete(principalKey, conversationId) {
    if (!principalKey) return { success: true, deleted: false };
    const conversationIdHash = hashConversationId(conversationId);
    return this.withPrincipalLock(principalKey, () => {
      const existed = this._deleteUnlocked(principalKey, conversationIdHash);
      return { success: true, deleted: existed };
    });
  }

  clearPrincipal(principalKey) {
    if (!principalKey) return { success: true, deleted: 0 };
    return this.withPrincipalLock(principalKey, () => {
      const index = this.readIndex(principalKey);
      let deleted = 0;
      index.items.forEach((item) => {
        if (this._deleteUnlocked(principalKey, item.conversationIdHash)) deleted += 1;
      });
      this.writeIndex(principalKey, { items: [] });
      return { success: true, deleted };
    });
  }

  pruneExpired(principalKey) {
    if (!principalKey) return { pruned: 0 };
    return this.withPrincipalLock(principalKey, () => ({
      pruned: this.pruneExpiredUnlocked(principalKey),
    }));
  }

  pruneExpiredUnlocked(principalKey) {
    const index = this.readIndex(principalKey);
    let pruned = 0;
    const kept = [];
    index.items.forEach((item) => {
      const state = this.readConversationFile(this.conversationPath(principalKey, item.conversationIdHash));
      if (!state || isExpired(state)) {
        this._deleteUnlocked(principalKey, item.conversationIdHash);
        pruned += 1;
        return;
      }
      kept.push({
        conversationIdHash: state.conversationIdHash,
        clientConversationId: state.clientConversationId,
        title: state.title,
        revision: state.revision,
        updatedAt: state.updatedAt,
        expiresAt: state.expiresAt,
        memoryMode: state.memoryPolicy && state.memoryPolicy.mode,
      });
    });
    this.writeIndex(principalKey, { items: kept });
    return pruned;
  }

  migrate(principalKey, conversationId) {
    if (!principalKey) return null;
    const state = this.get(principalKey, conversationId);
    if (!state) return null;
    return this.update(principalKey, conversationId, {}, { expectedRevision: state.revision });
  }

  _upsertIndexUnlocked(principalKey, state) {
    const index = this.readIndex(principalKey);
    const nextItem = {
      conversationIdHash: state.conversationIdHash,
      clientConversationId: state.clientConversationId,
      title: state.title,
      revision: state.revision,
      updatedAt: state.updatedAt,
      expiresAt: state.expiresAt,
      memoryMode: state.memoryPolicy && state.memoryPolicy.mode,
    };
    const items = (index.items || []).filter((item) => item.conversationIdHash !== state.conversationIdHash);
    items.push(nextItem);
    this.writeIndex(principalKey, { items });
  }

  _deleteUnlocked(principalKey, conversationIdHash) {
    const filePath = this.conversationPath(principalKey, conversationIdHash);
    let existed = false;
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        existed = true;
      }
    } catch (_) {
      // ignore
    }
    const index = this.readIndex(principalKey);
    this.writeIndex(principalKey, {
      items: (index.items || []).filter((item) => item.conversationIdHash !== conversationIdHash),
    });
    return existed;
  }

  _enforceCapacityUnlocked(principalKey) {
    const index = this.readIndex(principalKey);
    if ((index.items || []).length <= this.maxPerPrincipal) return;
    const sorted = (index.items || []).slice().sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")));
    const overflow = sorted.slice(0, Math.max(0, sorted.length - this.maxPerPrincipal));
    overflow.forEach((item) => this._deleteUnlocked(principalKey, item.conversationIdHash));
  }
}

module.exports = {
  FileConversationRepository,
};

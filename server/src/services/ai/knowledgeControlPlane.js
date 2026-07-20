const defaultKnowledgeBaseService = require("./knowledgeBaseService");

function safeText(value, limit = 100) {
  return String(value || "").replace(/[\r\n\t]/g, " ").slice(0, limit);
}

class KnowledgeAuditService {
  constructor(options = {}) {
    this.maxEntries = Math.max(10, Number(options.maxEntries || 500) || 500);
    this.entries = [];
  }

  record(event = {}) {
    const item = {
      action: safeText(event.action, 60),
      targetType: safeText(event.targetType, 24),
      targetId: safeText(event.targetId, 100),
      versionId: safeText(event.versionId, 100),
      success: event.success !== false,
      errorCode: safeText(event.errorCode, 80),
      at: new Date().toISOString(),
    };
    this.entries = this.entries.concat(item).slice(-this.maxEntries);
    return item;
  }

  list() {
    return this.entries.map((item) => Object.assign({}, item));
  }
}

class KnowledgeRepository {
  constructor(options = {}) {
    this.service = options.service || defaultKnowledgeBaseService;
    this.audit = options.audit || new KnowledgeAuditService();
  }

  listDraft(options = {}) {
    return this.service.listKnowledge(Object.assign({}, options, { status: "draft" }));
  }

  listPublished(options = {}) {
    return this.service.listKnowledge(Object.assign({}, options, { status: "published" }));
  }

  createDraft(type, input = {}) {
    const result = this.service.createEntry(Object.assign({}, input, { type, status: "draft" }));
    this.audit.record({ action: "create_draft", targetType: type, targetId: result.entry && result.entry.id });
    return Object.assign({}, result, { item: result.entry });
  }

  updateDraft(type, id, patch = {}) {
    const result = this.service.updateEntry(id, Object.assign({}, patch, { type }));
    this.audit.record({ action: "update_draft", targetType: type, targetId: id });
    return Object.assign({}, result, { item: result.entry });
  }

  deleteDraft(id) {
    const result = this.service.deleteEntry(id);
    this.audit.record({ action: "delete_draft", targetType: result.removed && result.removed.type, targetId: id });
    return result;
  }

  previewImport(input = {}) {
    return this.service.importMarkdown(Object.assign({}, input, { commit: false }));
  }

  importDraft(input = {}) {
    const result = this.service.importMarkdown(Object.assign({}, input, { commit: true }));
    this.audit.record({ action: "import_draft", targetType: "doc", targetId: result.entry && result.entry.id });
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
      status: "published",
      type: options.type,
      environment: options.environment,
    });
    return result.entries.find((item) => item.id === id || item.sourceId === id) || null;
  }
}

class KnowledgeVersionService {
  constructor(options = {}) {
    this.service = options.service || defaultKnowledgeBaseService;
    this.audit = options.audit || new KnowledgeAuditService();
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
    const result = this.service.publish(options);
    const versionId = result.store && result.store.currentVersion || options.versionId;
    this.audit.record({ action: "publish", versionId });
    return result;
  }

  rollback(versionId) {
    const result = this.service.rollback(versionId);
    this.audit.record({ action: "rollback", versionId });
    return result;
  }

  diffDraftToPublished() {
    const draft = this.service.listKnowledge({ status: "draft" });
    const published = this.service.listKnowledge({ status: "published" });
    const draftIds = new Set(draft.entries.map((item) => item.id));
    const publishedIds = new Set(published.entries.map((item) => item.id));
    return {
      added: draft.entries.filter((item) => !publishedIds.has(item.id)).map((item) => item.id),
      removed: published.entries.filter((item) => !draftIds.has(item.id)).map((item) => item.id),
      retained: draft.entries.filter((item) => publishedIds.has(item.id)).map((item) => item.id),
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

function createKnowledgeControlPlane(options = {}) {
  const audit = options.audit || new KnowledgeAuditService(options);
  const service = options.service || defaultKnowledgeBaseService;
  return {
    repository: new KnowledgeRepository({ service, audit }),
    searchProvider: new KnowledgeSearchProvider({ service }),
    versionService: new KnowledgeVersionService({ service, audit }),
    validationService: new KnowledgeValidationService({ service }),
    auditService: audit,
  };
}

module.exports = {
  KnowledgeAuditService,
  KnowledgeRepository,
  KnowledgeSearchProvider,
  KnowledgeValidationService,
  KnowledgeVersionService,
  createKnowledgeControlPlane,
};

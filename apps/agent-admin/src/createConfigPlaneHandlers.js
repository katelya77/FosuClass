// P4e：Agent 控制面 admin API handlers（runtime-backed，无 mock）。
//
// 包装 Config Kernel 的 draft/validate/test/publish/rollback/版本历史/审计与
// Run Trace 查询。鉴权（会话/服务令牌/CSRF/scope）由挂载方中间件负责，本模块
// 只处理：输入校验、内核调用、coded error 映射、响应脱敏、写操作审计回调。
//
// 脱敏纪律：
// - 响应信封一律经 sanitizePublicValue（与 platformTrace 同源）。
// - 配置 payload 走 redactConfigPayload：密钥形态字段/密钥形态值替换为
//   "[REDACTED]"。已发布版本经域适配器密钥扫描后才可发布，合法声明式字段
//   （如 provider 的 maxTokens）原样保留；不含密钥形态内容的 payload 在草稿
//   编辑器可无损往返，含 "[REDACTED]" 字面量的保存请求被 coded 400 拒绝
//   （占位符不得回存为真值）。脱敏递归深度超限的子树输出 "[TRUNCATED]"
//   （安全方向失败），不再原样透出。
// - 错误消息只在 4xx 时透传内核原文（只含字段名/门禁语义），5xx 一律泛化。

const { sanitizePublicValue } = require("@xiaofu-agent/agent-protocol");

const ADMIN_APP = "@xiaofu-agent/agent-admin";

const MAX_PAYLOAD_BYTES = 256 * 1024;
const REDACTED = "[REDACTED]";
// 脱敏递归深度超限时的安全方向输出（仅显示方向出现；保存方向不特殊处理）。
const TRUNCATED = "[TRUNCATED]";
// 与域适配器同形的密钥字段扫描（provider/maxTokens 是合法声明式字段，豁免）。
const SECRET_FIELD = /api[-_]?key|token|secret|password|authorization|credential/i;
const SECRET_FIELD_EXEMPT = new Set(["maxTokens"]);
const SECRET_VALUE = /(sk-[a-z0-9]{16,}|bearer\s+[a-z0-9._-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|AIza[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|api[_-]?key\s*[:=]\s*\S{8,}|password\s*[:=]\s*\S{6,}|secret\s*[:=]\s*\S{8,})/i;

const STATUS_BY_CODE = Object.freeze({
  CONFIG_KERNEL_ENVIRONMENT_INVALID: 400,
  CONFIG_KERNEL_DOMAIN_ADAPTER_REQUIRED: 400,
  CONFIG_KERNEL_ARTIFACT_ID_REQUIRED: 400,
  CONFIG_KERNEL_PAYLOAD_INVALID: 400,
  CONFIG_KERNEL_PAYLOAD_NOT_DECLARATIVE: 400,
  CONFIG_KERNEL_VALIDATION_REQUIRED: 400,
  CONFIG_KERNEL_VALIDATION_STALE: 400,
  CONFIG_KERNEL_TEST_REQUIRED: 400,
  CONFIG_KERNEL_VERSION_INVALID: 400,
  CONFIG_KERNEL_PATH_SEGMENT_INVALID: 400,
  CONFIG_KERNEL_SEED_INVALID: 400,
  AGENT_CONFIG_PAYLOAD_TOO_LARGE: 400,
  AGENT_CONFIG_ARTIFACT_UNRESOLVABLE: 400,
  AGENT_CONFIG_REDACTED_VALUE_REJECTED: 400,
  AGENT_CONFIG_RUN_ID_INVALID: 400,
  CONFIG_KERNEL_DRAFT_NOT_FOUND: 404,
  CONFIG_KERNEL_VERSION_MISSING: 404,
  CONFIG_KERNEL_ROLLBACK_TARGET_NOT_FOUND: 404,
  AGENT_RUN_TRACE_NOT_FOUND: 404,
  CONFIG_KERNEL_VERSION_EXISTS: 409,
  AGENT_CONFIG_ARTIFACT_AMBIGUOUS: 409,
  CONFIG_KERNEL_STORAGE_CORRUPT: 500,
  CONFIG_KERNEL_SNAPSHOT_UNREADABLE: 500,
});

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw codedError("AGENT_ADMIN_DEPENDENCY_INVALID", `${name} is required`);
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
}

function safePayload(value) {
  return sanitizePublicValue(value && typeof value === "object" ? value : {});
}

// 配置 payload 只走 redactConfigPayload，不能再过 sanitizePublicValue：
// 其 SENSITIVE_KEY 会剥掉 maxTokens 等合法声明式字段，破坏草稿编辑器往返。
// 信封其余部分仍走 sanitizePublicValue（与 platformTrace 同源脱敏）。
function withRedactedPayload(doc) {
  if (!doc) return null;
  const clone = Object.assign({}, doc);
  const payload = clone.payload;
  delete clone.payload;
  const safe = safePayload(clone);
  safe.payload = redactConfigPayload(payload && typeof payload === "object" ? payload : {});
  return safe;
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function redactConfigPayload(value, depth = 0) {
  if (value === null || value === undefined) return value === undefined ? null : value;
  // 深度超限必须安全方向失败：输出截断标记而非原样透出子树（子树可能藏密钥形态值）。
  if (depth > 8) return TRUNCATED;
  if (typeof value === "string") return SECRET_VALUE.test(value) ? REDACTED : value.slice(0, 4000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactConfigPayload(item, depth + 1));
  if (typeof value !== "object") return null;
  const output = {};
  Object.keys(value).slice(0, 200).forEach((key) => {
    if (SECRET_FIELD.test(key) && !SECRET_FIELD_EXEMPT.has(key)) {
      output[key] = REDACTED;
      return;
    }
    output[key] = redactConfigPayload(value[key], depth + 1);
  });
  return output;
}

// "[REDACTED]" 只是显示方向的脱敏占位符；保存方向出现即「把脱敏值当真值回存」，
// 会静默覆盖真实密钥，必须 coded 400 拒绝。拒绝只发生在保存方向；显示方向
// （含超深截断标记 "[TRUNCATED]"）照出。深度/广度受限递归，拒绝不依赖内核。
function containsRedactedLiteral(value, depth = 0) {
  if (depth > 32 || value === null || value === undefined) return false;
  if (typeof value === "string") return value.indexOf(REDACTED) >= 0;
  if (Array.isArray(value)) return value.slice(0, 500).some((item) => containsRedactedLiteral(item, depth + 1));
  if (typeof value !== "object") return false;
  return Object.keys(value).slice(0, 500).some((key) => containsRedactedLiteral(value[key], depth + 1));
}

function assertNoRedactedLiteral(payload) {
  if (containsRedactedLiteral(payload)) {
    throw codedError(
      "AGENT_CONFIG_REDACTED_VALUE_REJECTED",
      "payload contains the redaction placeholder [REDACTED]; re-enter the real value before saving"
    );
  }
}

function createConfigPlaneHandlers(options = {}) {
  const getConfigKernel = options.getConfigKernel;
  const listRecentPlatformTraces = options.listRecentPlatformTraces;
  requireFunction(getConfigKernel, "getConfigKernel");
  requireFunction(listRecentPlatformTraces, "listRecentPlatformTraces");
  const resolveActor = typeof options.resolveActor === "function" ? options.resolveActor : () => "admin";
  const recordWrite = typeof options.recordWrite === "function" ? options.recordWrite : () => {};

  function kernel() {
    const instance = getConfigKernel();
    if (!instance) throw codedError("AGENT_CONFIG_KERNEL_UNAVAILABLE", "config kernel is not available");
    return instance;
  }

  function actorOf(req) {
    return safeString(resolveActor(req) || "admin", 120) || "admin";
  }

  function sendError(res, error) {
    const code = safeString(error && error.code || "AGENT_CONFIG_INTERNAL", 80) || "AGENT_CONFIG_INTERNAL";
    // 只有显式列入 STATUS_BY_CODE 的 coded error 才是客户端错误（4xx）；
    // 未列入的 CONFIG_KERNEL_*/其他 code 一律 500 + 泛化消息（不向客户端透内部语义）。
    const status = STATUS_BY_CODE[code] || 500;
    return res.status(status).json({
      success: false,
      app: ADMIN_APP,
      code,
      message: status >= 500 ? "Agent config plane operation failed." : safeString(error && error.message || code, 240),
      serverTime: new Date().toISOString(),
    });
  }

  function environmentOf(req) {
    const source = req && (req.method === "GET" || req.method === "HEAD") ? req.query : req.body;
    return safeString(source && (source.env || source.environment), 40);
  }

  function domainOf(req) {
    const source = req && (req.method === "GET" || req.method === "HEAD") ? req.query : req.body;
    return safeString(source && source.domain, 60);
  }

  // artifactId 未显式给出时，从内核发布指针解析该域当前唯一发布物。
  // 控制面不假设固定的 artifact 命名；解析不到即 coded 400，解析到多个即
  // coded 409（静默取第一个会把操作打到错误的 artifact 上，必须显式指定）。
  function resolveArtifactId(req, environment, domain) {
    const source = req && req.method === "GET" ? req.query : req.body;
    const explicit = safeString(source && source.artifactId, 100);
    if (explicit) return explicit;
    const diagnostics = kernel().diagnostics(environment);
    const prefix = `${domain}:`;
    const match = Object.keys(diagnostics.artifacts || {}).filter((key) => key.indexOf(prefix) === 0).sort();
    if (!match.length) {
      throw codedError("AGENT_CONFIG_ARTIFACT_UNRESOLVABLE", `no published artifact found for domain ${domain}`);
    }
    if (match.length > 1) {
      const candidates = match.map((key) => key.slice(prefix.length));
      throw codedError(
        "AGENT_CONFIG_ARTIFACT_AMBIGUOUS",
        `domain ${domain} has ${match.length} published artifacts (${candidates.join(", ")}); specify artifactId explicitly`
      );
    }
    return match[0].slice(prefix.length);
  }

  function assertPayloadSize(payload) {
    if (payload === undefined) {
      throw codedError("CONFIG_KERNEL_PAYLOAD_INVALID", "payload is required");
    }
    let serialized;
    try {
      serialized = JSON.stringify(payload);
    } catch (_) {
      throw codedError("CONFIG_KERNEL_PAYLOAD_INVALID", "payload must be JSON serializable");
    }
    if (!serialized || serialized.length > MAX_PAYLOAD_BYTES) {
      throw codedError("AGENT_CONFIG_PAYLOAD_TOO_LARGE", `payload must be <= ${MAX_PAYLOAD_BYTES} bytes`);
    }
  }

  function auditWrite(req, action, target, summary) {
    try {
      recordWrite({ action, target, summary }, req);
    } catch (_) {
      // 审计回调失败不得翻转已完成的内核操作（内核自身审计链仍在）。
    }
  }

  function getSnapshot(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const snapshot = kernel().getCurrentSnapshot(environment);
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        environment,
        snapshot: snapshot || null,
        initialized: Boolean(snapshot),
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  }

  function getDomains(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const configKernel = kernel();
      const diagnostics = configKernel.diagnostics(environment);
      const domains = {};
      Object.keys(diagnostics.artifacts || {}).sort().forEach((key) => {
        const separator = key.indexOf(":");
        const domain = key.slice(0, separator);
        const artifactId = key.slice(separator + 1);
        const draft = configKernel.getDraft({ domain, artifactId, environment });
        domains[domain] = domains[domain] || { domain, artifacts: [] };
        domains[domain].artifacts.push(safePayload({
          artifactId,
          publishedVersion: diagnostics.artifacts[key],
          draft: draft ? {
            baseVersion: draft.baseVersion,
            updatedAt: draft.updatedAt,
            updatedBy: draft.updatedBy,
            validation: draft.validation,
            test: draft.test,
          } : null,
        }));
      });
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        environment,
        configVersion: diagnostics.configVersion,
        snapshotCount: diagnostics.snapshotCount,
        lkgAvailable: diagnostics.lkgAvailable,
        domains: Object.values(domains),
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  }

  function getVersions(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const domain = domainOf(req);
      const artifactId = resolveArtifactId(req, environment, domain);
      const history = kernel().listHistory({ domain, artifactId, environment });
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        environment,
        domain,
        artifactId,
        versions: history,
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  }

  function getArtifact(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const domain = domainOf(req);
      const artifactId = resolveArtifactId(req, environment, domain);
      const version = Number((req.query || {}).version);
      const doc = kernel().getArtifactVersion({ domain, artifactId, environment, version });
      const body = safePayload({
        success: true,
        app: ADMIN_APP,
        serverTime: new Date().toISOString(),
      });
      body.artifact = withRedactedPayload(doc);
      return res.json(body);
    } catch (error) {
      return sendError(res, error);
    }
  }

  function getDraft(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const domain = domainOf(req);
      const artifactId = resolveArtifactId(req, environment, domain);
      const draft = kernel().getDraft({ domain, artifactId, environment });
      const body = safePayload({
        success: true,
        app: ADMIN_APP,
        environment,
        domain,
        artifactId,
        serverTime: new Date().toISOString(),
      });
      body.draft = withRedactedPayload(draft);
      return res.json(body);
    } catch (error) {
      return sendError(res, error);
    }
  }

  function putDraft(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const domain = domainOf(req);
      const artifactId = resolveArtifactId(req, environment, domain);
      const payload = req.body && req.body.payload;
      assertPayloadSize(payload);
      assertNoRedactedLiteral(payload);
      const draft = kernel().saveDraft({
        environment,
        domain,
        artifactId,
        payload,
        actor: actorOf(req),
      });
      auditWrite(req, "draft-save", `${environment}/${domain}:${artifactId}`, `agent config draft saved (base v${draft.baseVersion})`);
      const body = safePayload({
        success: true,
        app: ADMIN_APP,
        serverTime: new Date().toISOString(),
      });
      body.draft = withRedactedPayload(draft);
      return res.json(body);
    } catch (error) {
      return sendError(res, error);
    }
  }

  function postValidate(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const domain = domainOf(req);
      const artifactId = resolveArtifactId(req, environment, domain);
      const report = kernel().validateDraft({ environment, domain, artifactId, actor: actorOf(req) });
      auditWrite(req, "validate", `${environment}/${domain}:${artifactId}`, `agent config draft validated: ${report.ok ? "ok" : "failed"}`);
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        environment,
        domain,
        artifactId,
        validation: report,
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  }

  function postTest(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const domain = domainOf(req);
      const artifactId = resolveArtifactId(req, environment, domain);
      const report = kernel().testDraft({ environment, domain, artifactId, actor: actorOf(req) });
      auditWrite(req, "test", `${environment}/${domain}:${artifactId}`, `agent config draft tested: ${report.ok ? "ok" : "failed"}`);
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        environment,
        domain,
        artifactId,
        test: report,
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  }

  function postPublish(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const domain = domainOf(req);
      const artifactId = resolveArtifactId(req, environment, domain);
      const outcome = kernel().publishDraft({ environment, domain, artifactId, actor: actorOf(req) });
      auditWrite(req, "publish", `${environment}/${domain}:${artifactId}`, `agent config published: v${outcome.version} (${outcome.configVersion})`);
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        environment,
        domain,
        artifactId,
        published: outcome,
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  }

  function postRollback(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const domain = domainOf(req);
      const artifactId = resolveArtifactId(req, environment, domain);
      const toVersion = Number(req.body && req.body.toVersion);
      const outcome = kernel().rollback({ environment, domain, artifactId, toVersion, actor: actorOf(req) });
      auditWrite(req, "rollback", `${environment}/${domain}:${artifactId}`, `agent config rolled back to v${outcome.version} (${outcome.configVersion})`);
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        environment,
        domain,
        artifactId,
        rolledBack: outcome,
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  }

  function getAudit(req, res) {
    noStore(res);
    try {
      const environment = environmentOf(req);
      const limit = Math.max(1, Math.min(500, Number((req.query || {}).limit) || 100));
      const entries = kernel().listAudit({ limit: 500 })
        .filter((entry) => !environment || entry.environment === environment)
        .slice(-limit)
        .reverse();
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        environment: environment || null,
        entries,
        count: entries.length,
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  }

  function getRunTrace(req, res) {
    noStore(res);
    try {
      const runId = safeString(req.params && req.params.runId, 128);
      if (!runId) throw codedError("AGENT_CONFIG_RUN_ID_INVALID", "runId is required");
      const trace = listRecentPlatformTraces().find((item) => item && item.runId === runId);
      if (!trace) {
        throw codedError("AGENT_RUN_TRACE_NOT_FOUND", "run trace not found in the recent trace window");
      }
      return res.json(safePayload({
        success: true,
        app: ADMIN_APP,
        trace,
        serverTime: new Date().toISOString(),
      }));
    } catch (error) {
      return sendError(res, error);
    }
  }

  return Object.freeze({
    getSnapshot,
    getDomains,
    getVersions,
    getArtifact,
    getDraft,
    putDraft,
    postValidate,
    postTest,
    postPublish,
    postRollback,
    getAudit,
    getRunTrace,
    redactConfigPayload,
  });
}

module.exports = {
  ADMIN_APP,
  createConfigPlaneHandlers,
};

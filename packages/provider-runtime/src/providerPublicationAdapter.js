// P4b：Provider 域发布适配器（Config Kernel 域协议，热发布 Provider 运行策略）。
//
// 发布物是纯声明式 overlay，只允许表达「用哪个 Provider、什么模型、多少预算」：
//   {
//     providerChain?: ["deepseek", "mock", ...]        主链（首元素 = 主 Provider）
//     stageProviders?: { decision?, planner?, response? }  阶段显式分配
//     model?: string            → AI_MODEL
//     reasoningModel?: string   → AI_REASONING_MODEL
//     timeoutMs?: number        1000..20000
//     maxTokens?: number        128..8192
//     temperature?: number      0..2
//     executionPolicy?: "strict_model_first" | "adaptive"（deterministic 保留给 public 硬护栏）
//     baseUrlOverrides?: { deepseek?, "cloudbase-openai"? }  仅 https，禁止 IP/localhost
//   }
//
// 安全不变量：
// - 密钥永远不进 Artifact：任何深度出现 key/token/secret/password/authorization
//   字样字段一律拒绝；运行时密钥仍来自环境变量/加密存储（引用化语义）。
// - public 环境外部调用恒 0：由运行时解析层最后应用 public 硬护栏保证
//   （providerChainService 对 public 永远返回 ["mock"]），本适配器不依赖
//   validate 时的环境上下文（内核 validate 不带环境）。
// - 授权不扩大：Provider id 必须 ∈ 服务器注入的已知集合；不得发明新 Provider。

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EXECUTION_POLICIES = Object.freeze(["strict_model_first", "adaptive"]);
const SECRET_FIELD_PATTERN = /api[-_]?key|token|secret|password|authorization|credential/i;
const DECLARATIVE_FIELDS = Object.freeze([
  "providerChain",
  "stageProviders",
  "model",
  "reasoningModel",
  "timeoutMs",
  "maxTokens",
  "temperature",
  "executionPolicy",
  "baseUrlOverrides",
]);
const STAGE_FIELDS = Object.freeze(["decision", "planner", "response"]);
const BASE_URL_OVERRIDE_PROVIDERS = Object.freeze(["deepseek", "cloudbase-openai"]);

const LIMITS = Object.freeze({
  timeoutMs: Object.freeze({ min: 1000, max: 20000 }),
  maxTokens: Object.freeze({ min: 128, max: 8192 }),
  temperature: Object.freeze({ min: 0, max: 2 }),
});

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

// 深度密钥扫描：除精确的声明式白名单字段名外（如 maxTokens 这类合法字段），
// 任何层级出现 key/token/secret 字样一律视为密钥材料。白名单是固定常量，
// 不含任何密钥载体，因此该豁免不扩大攻击面。
function hasSecretField(value, allowedKeys) {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).some((key) => {
    if (allowedKeys && allowedKeys.has(key)) return false;
    if (SECRET_FIELD_PATTERN.test(key)) return true;
    return hasSecretField(value[key], null);
  });
}

function isHttpsPublicUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (_) {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === "localhost" || host.endsWith(".local")) return false;
  if (host.includes(":")) return false; // IPv6 字面量
  return true;
}

function createProviderPublicationAdapter(options = {}) {
  const knownProviders = new Set((Array.isArray(options.knownProviderIds) ? options.knownProviderIds : [])
    .map((id) => safeString(id, 64)).filter(Boolean));
  if (!knownProviders.size) throw codedError("PROVIDER_PUBLICATION_KNOWN_SET_REQUIRED", "known provider ids are required");

  function validateProviderId(value, field, errors, { allowMock = true } = {}) {
    const id = safeString(value, 64);
    if (!id) {
      errors.push(`${field} must be a non-empty provider id`);
      return "";
    }
    if (!PROVIDER_ID_PATTERN.test(id) || !knownProviders.has(id) || (!allowMock && id === "mock")) {
      errors.push(`${field} is not a known provider id: ${id}`);
      return "";
    }
    return id;
  }

  function validate(payload) {
    const errors = [];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, errors: ["payload must be a plain object"] };
    }
    Object.keys(payload).forEach((field) => {
      if (!DECLARATIVE_FIELDS.includes(field)) errors.push(`${field} is not a declarative field`);
    });
    if (hasSecretField(payload, new Set(DECLARATIVE_FIELDS))) {
      errors.push("payload must not contain secret material (keys/tokens/secrets are env/store references only)");
    }

    let chain;
    if (payload.providerChain !== undefined) {
      if (!Array.isArray(payload.providerChain) || !payload.providerChain.length || payload.providerChain.length > 4) {
        errors.push("providerChain must be an array of 1..4 provider ids");
      } else {
        chain = [];
        payload.providerChain.forEach((item, index) => {
          const id = validateProviderId(item, `providerChain[${index}]`, errors);
          if (id && !chain.includes(id)) chain.push(id);
        });
      }
    }

    let stageProviders;
    if (payload.stageProviders !== undefined) {
      if (!payload.stageProviders || typeof payload.stageProviders !== "object" || Array.isArray(payload.stageProviders)) {
        errors.push("stageProviders must be a plain object");
      } else {
        stageProviders = {};
        Object.keys(payload.stageProviders).forEach((stage) => {
          if (!STAGE_FIELDS.includes(stage)) {
            errors.push(`stageProviders.${stage} is not a supported stage`);
            return;
          }
          const id = validateProviderId(payload.stageProviders[stage], `stageProviders.${stage}`, errors);
          if (id) stageProviders[stage] = id;
        });
      }
    }

    let baseUrlOverrides;
    if (payload.baseUrlOverrides !== undefined) {
      if (!payload.baseUrlOverrides || typeof payload.baseUrlOverrides !== "object" || Array.isArray(payload.baseUrlOverrides)) {
        errors.push("baseUrlOverrides must be a plain object");
      } else {
        baseUrlOverrides = {};
        Object.keys(payload.baseUrlOverrides).forEach((id) => {
          if (!BASE_URL_OVERRIDE_PROVIDERS.includes(id)) {
            errors.push(`baseUrlOverrides.${id} is not an overridable provider`);
            return;
          }
          const url = safeString(payload.baseUrlOverrides[id], 240);
          if (!isHttpsPublicUrl(url)) {
            errors.push(`baseUrlOverrides.${id} must be a public https URL (no IP literal/localhost)`);
            return;
          }
          baseUrlOverrides[id] = url;
        });
      }
    }

    const numbers = {};
    [["timeoutMs", LIMITS.timeoutMs], ["maxTokens", LIMITS.maxTokens]].forEach(([field, range]) => {
      if (payload[field] === undefined) return;
      const num = Number(payload[field]);
      if (!Number.isInteger(num) || num < range.min || num > range.max) {
        errors.push(`${field} must be an integer within ${range.min}..${range.max}`);
        return;
      }
      numbers[field] = num;
    });
    if (payload.temperature !== undefined) {
      const num = Number(payload.temperature);
      if (!Number.isFinite(num) || num < LIMITS.temperature.min || num > LIMITS.temperature.max) {
        errors.push(`temperature must be within ${LIMITS.temperature.min}..${LIMITS.temperature.max}`);
      } else {
        numbers.temperature = num;
      }
    }

    let executionPolicy;
    if (payload.executionPolicy !== undefined) {
      const policy = safeString(payload.executionPolicy, 40);
      if (!EXECUTION_POLICIES.includes(policy)) {
        errors.push(`executionPolicy must be one of ${EXECUTION_POLICIES.join("/")} (deterministic is reserved for public hard guards)`);
      } else {
        executionPolicy = policy;
      }
    }

    const strings = {};
    ["model", "reasoningModel"].forEach((field) => {
      if (payload[field] === undefined) return;
      const text = safeString(payload[field], 120);
      if (!text || /\s/.test(text)) {
        errors.push(`${field} must be a non-empty single token`);
        return;
      }
      strings[field] = text;
    });

    if (errors.length) return { ok: false, errors };
    const normalized = {};
    if (chain) normalized.providerChain = chain;
    if (stageProviders && Object.keys(stageProviders).length) normalized.stageProviders = stageProviders;
    if (baseUrlOverrides && Object.keys(baseUrlOverrides).length) normalized.baseUrlOverrides = baseUrlOverrides;
    Object.assign(normalized, numbers, strings);
    if (executionPolicy) normalized.executionPolicy = executionPolicy;
    return { ok: true, errors: [], normalized };
  }

  function resolveRuntime(versionDoc) {
    if (!versionDoc || !versionDoc.payload) throw codedError("PROVIDER_PUBLICATION_VERSION_REQUIRED");
    const validation = validate(versionDoc.payload);
    if (!validation.ok) {
      throw codedError("PROVIDER_PUBLICATION_VERSION_INVALID", validation.errors.join("; ").slice(0, 240));
    }
    return Object.freeze(JSON.parse(JSON.stringify(validation.normalized || {})));
  }

  return Object.freeze({
    domain: "provider",

    validate,

    test(normalized) {
      const overlay = normalized || {};
      // 发布前测试 = 解析演习：链路非空、阶段分配 ⊆ 链路或已知集、密钥为零。
      // 不触达真实 Provider（probe 属 P4e 后台操作，不进发布状态机）。
      if (overlay.providerChain && !overlay.providerChain.length) {
        return { ok: false, results: { reason: "providerChain resolved empty" } };
      }
      if (hasSecretField(overlay, new Set(DECLARATIVE_FIELDS))) {
        return { ok: false, results: { reason: "secret material detected" } };
      }
      return {
        ok: true,
        results: {
          chainLength: (overlay.providerChain || []).length,
          stageOverrides: Object.keys(overlay.stageProviders || {}).length,
          baseUrlOverrides: Object.keys(overlay.baseUrlOverrides || {}).length,
          executionPolicy: overlay.executionPolicy || "inherit",
        },
      };
    },

    composeSnapshotEntry(versionDoc) {
      const payload = versionDoc && versionDoc.payload || {};
      return {
        chainLength: Array.isArray(payload.providerChain) ? payload.providerChain.length : 0,
        stageOverrides: payload.stageProviders ? Object.keys(payload.stageProviders).length : 0,
        executionPolicy: safeString(payload.executionPolicy, 40) || "inherit",
      };
    },

    resolveRuntime,

    seedPayload() {
      // 空 overlay = 继承 env 文件/加密存储的现有解析（种子 ≡ P4b 前行为）。
      return {};
    },
  });
}

/**
 * overlay → 运行时配置键映射（单一事实源）。只映射非密钥键；
 * 调用方负责在此之后应用 public/急停硬护栏。
 */
function overlayToRuntimeConfig(overlay = {}) {
  const source = overlay && typeof overlay === "object" ? overlay : {};
  const updates = {};
  if (Array.isArray(source.providerChain) && source.providerChain.length) {
    updates.AI_PROVIDER_CHAIN = source.providerChain.join(",");
  }
  const stages = source.stageProviders || {};
  if (stages.decision) {
    updates.AI_DECISION_PROVIDER = stages.decision;
    updates.AI_UNDERSTANDING_PROVIDER = stages.decision;
  }
  if (stages.planner) updates.AI_PLANNER_PROVIDER = stages.planner;
  if (stages.response) updates.AI_RESPONSE_PROVIDER = stages.response;
  if (source.model) updates.AI_MODEL = source.model;
  if (source.reasoningModel) updates.AI_REASONING_MODEL = source.reasoningModel;
  if (Number.isInteger(source.timeoutMs)) updates.AI_TIMEOUT_MS = String(source.timeoutMs);
  if (Number.isInteger(source.maxTokens)) updates.AI_MAX_TOKENS = String(source.maxTokens);
  if (Number.isFinite(source.temperature)) updates.AI_TEMPERATURE = String(source.temperature);
  if (source.executionPolicy) updates.AI_EXECUTION_POLICY = source.executionPolicy;
  const baseUrls = source.baseUrlOverrides || {};
  if (baseUrls.deepseek) updates.AI_BASE_URL = baseUrls.deepseek;
  if (baseUrls["cloudbase-openai"]) updates.CLOUDBASE_OPENAI_BASE_URL = baseUrls["cloudbase-openai"];
  return updates;
}

module.exports = Object.freeze({
  createProviderPublicationAdapter,
  overlayToRuntimeConfig,
});

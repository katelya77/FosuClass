// P4b：Memory 域发布适配器（Config Kernel 域协议，热发布记忆策略）。
//
// 发布物是纯声明式策略描述符，只含有界数值与枚举，绝不携带用户记忆内容：
//   {
//     ttlOverridesMs?: { <memoryKey>: number }   1h..365d，key ∈ 服务器注入的已知键集
//     minConfidence?: number                     0..1
//     pendingTtlMs?: number                      5min..7d
//     termScopeTtlMs?: number                    1d..90d
//     maxRetrieve?: number                       1..10
//   }
//
// 安全不变量：
// - 策略发布不影响在途 Run：Run 创建时绑定快照，策略经快照解析注入当次 Turn；
// - 不得经策略接口暴露用户记忆原文：描述符只含数值，白名单字段外一律拒绝，
//   字符串值长度/字符集受限（无任何内容载体）；
// - 数值必须有界：过短 TTL 会误删用户数据，过长会变相永久保存（隐私红线）。
// - 空 overlay（{}）合法，语义 = 继承静态默认（种子 ≡ P4b 前行为）。

// 键形校验只是第一道闸（真正的授权控制是 knownTtlKeys 白名单）；
// 真实记忆键 camelCase 与 snake_case 并存（memoryPolicy.DEFAULT_TTL_MS）。
const TTL_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;
const LIMITS = Object.freeze({
  ttlOverrideMs: Object.freeze({ min: 3600000, max: 31536000000 }), // 1h..365d
  pendingTtlMs: Object.freeze({ min: 300000, max: 604800000 }), // 5min..7d
  termScopeTtlMs: Object.freeze({ min: 86400000, max: 7776000000 }), // 1d..90d
  maxRetrieve: Object.freeze({ min: 1, max: 10 }),
});
const DECLARATIVE_FIELDS = Object.freeze([
  "ttlOverridesMs",
  "minConfidence",
  "pendingTtlMs",
  "termScopeTtlMs",
  "maxRetrieve",
]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function validateBoundedInteger(value, field, range, errors) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < range.min || num > range.max) {
    errors.push(`${field} must be an integer within ${range.min}..${range.max}`);
    return undefined;
  }
  return num;
}

function createMemoryPolicyPublicationAdapter(options = {}) {
  // knownTtlKeys：服务器注入的可覆盖记忆键集合（静态默认表的键）。
  const knownTtlKeys = new Set((Array.isArray(options.knownTtlKeys) ? options.knownTtlKeys : [])
    .map((key) => String(key || "")).filter(Boolean));

  function validate(payload) {
    const errors = [];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, errors: ["payload must be a plain object"] };
    }
    Object.keys(payload).forEach((field) => {
      if (!DECLARATIVE_FIELDS.includes(field)) errors.push(`${field} is not a declarative field`);
    });

    let ttlOverridesMs;
    if (payload.ttlOverridesMs !== undefined) {
      if (!payload.ttlOverridesMs || typeof payload.ttlOverridesMs !== "object" || Array.isArray(payload.ttlOverridesMs)) {
        errors.push("ttlOverridesMs must be a plain object");
      } else {
        ttlOverridesMs = {};
        Object.keys(payload.ttlOverridesMs).forEach((key) => {
          if (!TTL_KEY_PATTERN.test(key) || key.length > 40) {
            errors.push(`ttlOverridesMs key is invalid: ${String(key).slice(0, 48)}`);
            return;
          }
          if (knownTtlKeys.size && !knownTtlKeys.has(key)) {
            errors.push(`ttlOverridesMs key is not a known memory key: ${key}`);
            return;
          }
          const value = validateBoundedInteger(payload.ttlOverridesMs[key], `ttlOverridesMs.${key}`, LIMITS.ttlOverrideMs, errors);
          if (value !== undefined) ttlOverridesMs[key] = value;
        });
      }
    }

    const normalized = {};
    if (ttlOverridesMs && Object.keys(ttlOverridesMs).length) normalized.ttlOverridesMs = ttlOverridesMs;
    if (payload.minConfidence !== undefined) {
      const num = Number(payload.minConfidence);
      if (!Number.isFinite(num) || num < 0 || num > 1) {
        errors.push("minConfidence must be within 0..1");
      } else {
        normalized.minConfidence = num;
      }
    }
    const pendingTtlMs = payload.pendingTtlMs === undefined
      ? undefined
      : validateBoundedInteger(payload.pendingTtlMs, "pendingTtlMs", LIMITS.pendingTtlMs, errors);
    if (pendingTtlMs !== undefined) normalized.pendingTtlMs = pendingTtlMs;
    const termScopeTtlMs = payload.termScopeTtlMs === undefined
      ? undefined
      : validateBoundedInteger(payload.termScopeTtlMs, "termScopeTtlMs", LIMITS.termScopeTtlMs, errors);
    if (termScopeTtlMs !== undefined) normalized.termScopeTtlMs = termScopeTtlMs;
    const maxRetrieve = payload.maxRetrieve === undefined
      ? undefined
      : validateBoundedInteger(payload.maxRetrieve, "maxRetrieve", LIMITS.maxRetrieve, errors);
    if (maxRetrieve !== undefined) normalized.maxRetrieve = maxRetrieve;

    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], normalized };
  }

  function resolveRuntime(versionDoc) {
    if (!versionDoc || !versionDoc.payload) throw codedError("MEMORY_PUBLICATION_VERSION_REQUIRED");
    const validation = validate(versionDoc.payload);
    if (!validation.ok) {
      throw codedError("MEMORY_PUBLICATION_VERSION_INVALID", validation.errors.join("; ").slice(0, 240));
    }
    return Object.freeze(JSON.parse(JSON.stringify(validation.normalized || {})));
  }

  return Object.freeze({
    domain: "memory",

    validate,

    test(normalized) {
      const policy = normalized || {};
      // 发布前测试：策略只含有界数值（validate 已保证）；term 级 TTL 不得
      // 低于 pending 级（语义一致性：版本绑定记忆不应先于工作态记忆过期）。
      if (policy.termScopeTtlMs !== undefined && policy.pendingTtlMs !== undefined
        && policy.termScopeTtlMs < policy.pendingTtlMs) {
        return { ok: false, results: { reason: "termScopeTtlMs must not be shorter than pendingTtlMs" } };
      }
      return {
        ok: true,
        results: {
          ttlOverrides: Object.keys(policy.ttlOverridesMs || {}).length,
          minConfidence: policy.minConfidence === undefined ? "inherit" : policy.minConfidence,
          maxRetrieve: policy.maxRetrieve === undefined ? "inherit" : policy.maxRetrieve,
        },
      };
    },

    composeSnapshotEntry(versionDoc) {
      const payload = versionDoc && versionDoc.payload || {};
      return {
        ttlOverrides: payload.ttlOverridesMs ? Object.keys(payload.ttlOverridesMs).length : 0,
        fields: DECLARATIVE_FIELDS.filter((field) => payload[field] !== undefined).length,
      };
    },

    resolveRuntime,

    seedPayload() {
      // 空 overlay = 全部静态默认（种子 ≡ P4b 前行为）。
      return {};
    },
  });
}

module.exports = Object.freeze({
  createMemoryPolicyPublicationAdapter,
});

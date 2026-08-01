// P4d：RAG 域发布适配器（Config Kernel 域协议，第 6 域）。
//
// 发布物是自包含的版本化知识库定义：
//   {
//     kbId: "platform-guide",                    稳定 KB 标识（索引按 kbId+version 落盘）
//     documents: [{ docId, title, kind?, tags?, text? | uri? }],   1..200，text/uri 二选一
//     retrieval?: { defaultMode?, topK?, minScore?, rerankWeights? } 检索策略（版本化）
//   }
//
// 安全不变量：
// - 纯声明式：字段白名单之外一律拒绝；无任何可执行载体；
// - 密钥不进 Artifact：字段名深度扫描 + 文本值的凭据形态基线扫描；
// - 结构化校园事实 kind 永远拒绝（事实只能走 Tool，AGENTS.md 事实源铁律）；
// - uri 仅 https 公网（ingestion 同规则族），抓取发生在发布后的异步构建，
//   validate/test 不触网；
// - 索引是派生物：可从发布物确定性重建，draft 永不落盘索引（对生产查询不可见）。

const { QUERY_MODES, DEFAULT_RETRIEVAL, digestOf } = require("./ragRuntime");
const { validateDocumentUri, FORBIDDEN_DOCUMENT_KINDS, INGEST_LIMITS } = require("./ingestion");
const { encoderManifest } = require("./localEncoder");
const { normalizeWeights } = require("./fusion");
const { chunkDocument } = require("./textProcessing");

const KB_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DOC_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const KIND_PATTERN = /^[a-z][a-z0-9_]*$/;
const SECRET_FIELD_PATTERN = /api[-_]?key|token|secret|password|authorization|credential/i;
// 文本值凭据形态基线扫描（字段名扫描之外的第二道）。宁可误伤长随机串示例，
// 不放行疑似真实凭据进入不可变发布物（发布物会进入审计与导出链）。
const SECRET_VALUE_PATTERN = /(sk-[a-z0-9]{16,}|bearer\s+[a-z0-9._-]{16,}|api[_-]?key\s*[:=]\s*\S{8,}|password\s*[:=]\s*\S{6,}|secret\s*[:=]\s*\S{8,})/i;

const PAYLOAD_FIELDS = Object.freeze(["kbId", "documents", "retrieval"]);
const DOCUMENT_FIELDS = Object.freeze(["docId", "title", "kind", "tags", "text", "uri"]);
const RETRIEVAL_FIELDS = Object.freeze(["defaultMode", "topK", "minScore", "rerankWeights"]);
const RERANK_FIELDS = Object.freeze(["lexical", "vector", "title"]);

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function hasSecretField(value, allowedKeys) {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).some((key) => {
    if (allowedKeys && allowedKeys.has(key)) return false;
    if (SECRET_FIELD_PATTERN.test(key)) return true;
    return hasSecretField(value[key], null);
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function createRagPublicationAdapter() {
  function validate(payload) {
    const errors = [];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, errors: ["payload must be a plain object"] };
    }
    Object.keys(payload).forEach((field) => {
      if (!PAYLOAD_FIELDS.includes(field)) errors.push(`${field} is not a declarative field`);
    });
    if (hasSecretField(payload, new Set(PAYLOAD_FIELDS.concat(DOCUMENT_FIELDS, RETRIEVAL_FIELDS, RERANK_FIELDS)))) {
      errors.push("payload must not contain secret material (field names)");
    }

    const kbId = safeString(payload.kbId, 64);
    if (!KB_ID_PATTERN.test(kbId)) errors.push("kbId must match [a-z][a-z0-9-]*");

    const documents = [];
    if (!Array.isArray(payload.documents) || !payload.documents.length || payload.documents.length > INGEST_LIMITS.maxDocuments) {
      errors.push(`documents must be an array of 1..${INGEST_LIMITS.maxDocuments}`);
    } else {
      const seen = new Set();
      payload.documents.forEach((raw, index) => {
        const where = `documents[${index}]`;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          errors.push(`${where} must be a plain object`);
          return;
        }
        Object.keys(raw).forEach((field) => {
          if (!DOCUMENT_FIELDS.includes(field)) errors.push(`${where}.${field} is not a declarative field`);
        });
        const docId = safeString(raw.docId, 64);
        if (!DOC_ID_PATTERN.test(docId)) {
          errors.push(`${where}.docId must match [a-z][a-z0-9-]*`);
          return;
        }
        if (seen.has(docId)) {
          errors.push(`${where}.docId is duplicated: ${docId}`);
          return;
        }
        seen.add(docId);
        const title = safeString(raw.title, INGEST_LIMITS.maxTitleChars);
        if (!title) errors.push(`${where}.title must be non-empty`);
        else if (SECRET_VALUE_PATTERN.test(String(raw.title))) {
          errors.push(`${where}.title looks like it contains credential material`);
        }
        let kind;
        if (raw.kind !== undefined) {
          kind = safeString(raw.kind, 40).toLowerCase();
          if (!KIND_PATTERN.test(kind)) {
            errors.push(`${where}.kind must match [a-z][a-z0-9_]*`);
          } else if (FORBIDDEN_DOCUMENT_KINDS.includes(kind)) {
            errors.push(`${where}.kind is a structured campus fact kind (${kind}): facts must come from Tools, not RAG ingestion`);
          }
        }
        const tags = [];
        if (raw.tags !== undefined) {
          if (!Array.isArray(raw.tags) || raw.tags.length > INGEST_LIMITS.maxTags) {
            errors.push(`${where}.tags must be an array of at most ${INGEST_LIMITS.maxTags}`);
          } else {
            raw.tags.forEach((tag) => {
              if (SECRET_VALUE_PATTERN.test(String(tag == null ? "" : tag))) {
                errors.push(`${where}.tags contain credential-shaped material`);
                return;
              }
              const text = safeString(tag, INGEST_LIMITS.maxTagChars);
              if (text) tags.push(text);
            });
          }
        }
        const hasText = raw.text !== undefined && raw.text !== null;
        const hasUri = raw.uri !== undefined && raw.uri !== null;
        if (hasText === hasUri) {
          errors.push(`${where} needs exactly one of text/uri`);
          return;
        }
        let text;
        let uri;
        if (hasText) {
          text = typeof raw.text === "string" ? raw.text.trim() : "";
          if (!text || text.length > INGEST_LIMITS.maxInlineChars) {
            errors.push(`${where}.text must be a string of 1..${INGEST_LIMITS.maxInlineChars} chars`);
          } else if (SECRET_VALUE_PATTERN.test(text)) {
            errors.push(`${where}.text looks like it contains credential material`);
          }
        } else {
          const rawUri = String(raw.uri);
          if (rawUri.trim().length > 500) {
            // 超长 URI 拒绝而非静默截断（归一化会改变资源标识）。
            errors.push(`${where}.uri exceeds 500 chars`);
          } else {
            if (SECRET_VALUE_PATTERN.test(rawUri)) {
              errors.push(`${where}.uri looks like it contains credential material`);
            }
            uri = safeString(raw.uri, 500);
            const verdict = validateDocumentUri(uri);
            if (!verdict.ok) errors.push(`${where}.uri ${verdict.error}`);
          }
        }
        documents.push(Object.freeze({
          docId,
          title: title || docId,
          ...(kind ? { kind } : {}),
          ...(tags.length ? { tags: Object.freeze(tags) } : {}),
          ...(text !== undefined ? { text } : { uri }),
        }));
      });
    }

    let retrieval;
    if (payload.retrieval !== undefined) {
      if (!payload.retrieval || typeof payload.retrieval !== "object" || Array.isArray(payload.retrieval)) {
        errors.push("retrieval must be a plain object");
      } else {
        Object.keys(payload.retrieval).forEach((field) => {
          if (!RETRIEVAL_FIELDS.includes(field)) errors.push(`retrieval.${field} is not a declarative field`);
        });
        const mode = safeString(payload.retrieval.defaultMode, 40);
        if (payload.retrieval.defaultMode !== undefined && !QUERY_MODES.includes(mode)) {
          errors.push(`retrieval.defaultMode must be one of ${QUERY_MODES.join("/")}`);
        }
        let topK;
        if (payload.retrieval.topK !== undefined) {
          topK = Number(payload.retrieval.topK);
          if (!Number.isInteger(topK) || topK < 1 || topK > 20) errors.push("retrieval.topK must be an integer within 1..20");
        }
        let minScore;
        if (payload.retrieval.minScore !== undefined) {
          minScore = Number(payload.retrieval.minScore);
          if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) errors.push("retrieval.minScore must be within 0..1");
        }
        let rerankWeights;
        if (payload.retrieval.rerankWeights !== undefined) {
          const weights = payload.retrieval.rerankWeights;
          if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
            errors.push("retrieval.rerankWeights must be a plain object");
          } else {
            Object.keys(weights).forEach((field) => {
              if (!RERANK_FIELDS.includes(field)) {
                errors.push(`retrieval.rerankWeights.${field} is not a supported weight`);
                return;
              }
              const value = Number(weights[field]);
              if (!Number.isFinite(value) || value < 0 || value > 4) {
                errors.push(`retrieval.rerankWeights.${field} must be within 0..4`);
              }
            });
            rerankWeights = normalizeWeights(weights);
          }
        }
        retrieval = Object.freeze({
          defaultMode: QUERY_MODES.includes(mode) ? mode : DEFAULT_RETRIEVAL.defaultMode,
          topK: topK === undefined ? DEFAULT_RETRIEVAL.topK : topK,
          minScore: minScore === undefined ? DEFAULT_RETRIEVAL.minScore : minScore,
          rerankWeights: rerankWeights || DEFAULT_RETRIEVAL.rerankWeights,
        });
      }
    }

    if (errors.length) return { ok: false, errors };
    const normalized = {
      kbId,
      documents,
      retrieval: retrieval || Object.freeze({
        defaultMode: DEFAULT_RETRIEVAL.defaultMode,
        topK: DEFAULT_RETRIEVAL.topK,
        minScore: DEFAULT_RETRIEVAL.minScore,
        rerankWeights: DEFAULT_RETRIEVAL.rerankWeights,
      }),
    };
    return { ok: true, errors: [], normalized };
  }

  return Object.freeze({
    domain: "rag",

    validate,

    // 发布前测试 = 离线构建演习：只对 inline 文档切块/编码（不触网），
    // 证明发布物可解析、可索引、encoder 世代明确；uri 文档在发布后异步构建时验证。
    test(normalized) {
      const payload = normalized || {};
      const inline = (payload.documents || []).filter((doc) => doc.text !== undefined);
      const uriCount = (payload.documents || []).length - inline.length;
      let chunkCount = 0;
      for (const doc of inline) {
        chunkCount += chunkDocument({ docId: doc.docId, title: doc.title, text: doc.text }).length;
      }
      if (!inline.length && !uriCount) {
        return { ok: false, results: { reason: "no usable documents" } };
      }
      if (inline.length && !chunkCount) {
        return { ok: false, results: { reason: "inline documents produced no chunks" } };
      }
      return {
        ok: true,
        results: {
          kbId: payload.kbId || "",
          documents: (payload.documents || []).length,
          inlineDocuments: inline.length,
          uriDocuments: uriCount,
          chunksFromInline: chunkCount,
          uriVerifiedAtBuild: uriCount > 0,
          encoder: encoderManifest(),
          payloadDigest: digestOf(payload),
        },
      };
    },

    resolveRuntime(versionDoc) {
      if (!versionDoc || !versionDoc.payload) throw codedError("RAG_PUBLICATION_VERSION_REQUIRED");
      const validation = validate(versionDoc.payload);
      if (!validation.ok) {
        throw codedError("RAG_PUBLICATION_VERSION_INVALID", validation.errors.join("; ").slice(0, 240));
      }
      // 深冻结：结果被 platformComposition 按 (env, version) 长期缓存共享，
      // 嵌套变异不得跨请求污染（与 tool-runtime 的 deepFreeze 同风格）。
      return deepFreeze(JSON.parse(JSON.stringify({
        kbId: validation.normalized.kbId,
        documents: validation.normalized.documents,
        retrieval: validation.normalized.retrieval,
        encoder: encoderManifest(),
      })));
    },

    composeSnapshotEntry(versionDoc) {
      const payload = versionDoc && versionDoc.payload || {};
      return {
        kbId: safeString(payload.kbId, 64),
        documents: Array.isArray(payload.documents) ? payload.documents.length : 0,
        mode: payload.retrieval && payload.retrieval.defaultMode || DEFAULT_RETRIEVAL.defaultMode,
      };
    },

    // 种子 = 内置只读示例 KB：通用平台说明文档（无任何校园事实），
    // 保证空环境/standalone 默认启动即有一个可构建、可查询的 KB。
    seedPayload() {
      return {
        kbId: "platform-example",
        documents: [
          {
            docId: "config-publication",
            title: "Declarative config publication",
            kind: "note",
            tags: ["platform", "example"],
            text: [
              "The agent platform stores every runtime configuration as an immutable, versioned artifact.",
              "An operator edits a draft, runs validation and pre-publish tests, then publishes.",
              "Publishing moves an atomic pointer; in-flight runs keep the snapshot they started with,",
              "and a rollback switches the pointer back to a previously verified version.",
            ].join(" "),
          },
        ],
        retrieval: {
          defaultMode: DEFAULT_RETRIEVAL.defaultMode,
          topK: DEFAULT_RETRIEVAL.topK,
          minScore: DEFAULT_RETRIEVAL.minScore,
          rerankWeights: DEFAULT_RETRIEVAL.rerankWeights,
        },
      };
    },
  });
}

module.exports = Object.freeze({
  createRagPublicationAdapter,
  FORBIDDEN_DOCUMENT_KINDS,
  SECRET_VALUE_PATTERN,
});

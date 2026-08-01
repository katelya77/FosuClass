/**
 * Final semantic gate for memory candidates and stored memory migration.
 * This module is deliberately independent from extractors and storage so every
 * candidate source (deterministic, Provider, preference patch, migration, edit)
 * can be checked against the same rules.
 */

const INVALID_PREFERRED_NAMES = new Set([
  "", "什么", "啥", "谁", "哪个", "哪位", "怎么", "如何",
  "你", "我", "用户", "同学", "老师", "未知", "未填写", "不知道",
  "哦", "噢", "喔", "啊", "呀", "吧", "呢", "嘛", "吗", "哈", "呐", "咯", "诶", "欸",
]);

const MIN_DURABLE_CONFIDENCE = 0.72;

function safeText(value, max = 160) {
  return String(value == null ? "" : value).replace(/[\r\n\t]/g, " ").trim().slice(0, max);
}

function normalizeName(value) {
  return safeText(value, 24).replace(/[，。！？,.!?~～]+$/g, "").trim();
}

function isInvalidPreferredName(value) {
  const name = normalizeName(value);
  if (INVALID_PREFERRED_NAMES.has(name)) return true;
  if (!/^[\u3400-\u9fffA-Za-z0-9·\-\s]{1,24}$/.test(name)) return true;
  if (/^(什么|啥|谁|哪个|哪位|怎么|如何|未知)/.test(name)) return true;
  if (/^(?:你|我|他|她|它)(?:叫|是|的)?$/.test(name)) return true;
  if (/^(?:哦|噢|喔|啊|呀|吧|呢|嘛|吗|哈|呐|咯|诶|欸)+$/.test(name)) return true;
  if (/(?:什么|啥|谁|哪个|哪位|怎么|如何)[？?]?$/.test(name)) return true;
  return false;
}

function isQuestionAboutMemory(message, key) {
  const text = safeText(message, 600).replace(/\s+/g, "");
  if (!text) return false;
  const patterns = {
    preferredName: /你能记住什么|我叫(?:什么|啥)|我叫什么|我的名字(?:是)?(?:什么|叫啥)|你(?:还)?记得我叫(?:什么|啥|吗)/,
    college: /我的学院是(?:什么|啥|哪个)|我(?:是|在|读)(?:什么|啥|哪个|哪所)(?:大学)?学院/,
    major: /我的专业是(?:什么|啥|哪个)|我(?:读|学|是)(?:什么|啥|哪个)专业/,
    grade: /我(?:是|读|现在)?大几|我(?:是|读|现在)?几年级|我(?:是|读|现在)?哪个年级/,
    defaultReminderLeadMinutes: /默认提醒(?:时间)?是(?:什么|多少)|默认提醒(?:是什么|多少分钟)/,
  };
  return Boolean(patterns[key] && patterns[key].test(text));
}

function explicitStatementMatches(message, key, value) {
  const text = safeText(message, 600);
  const normalizedValue = safeText(value, 60);
  if (!text || !normalizedValue) return false;
  if (key === "preferredName") {
    return new RegExp(`(?:我的名字叫|我叫|以后(?:叫我|称呼我))\\s*${escapeRegExp(normalizedValue)}(?:$|[，。！？,.!?\\s])`).test(text);
  }
  if (key === "campus") return text.includes(normalizedValue) && /常用|主要在|以后|优先|不对|不是/.test(text);
  if (key === "college") return text.includes(normalizedValue) && /我是|我读|我就读于|我在/.test(text);
  if (key === "major") return text.includes(normalizedValue) && /专业是|我读|我学|主修|修读/.test(text);
  if (key === "grade") return text.includes(normalizedValue) && /我是|我读|我现在|我今年/.test(text);
  if (key === "defaultReminderLeadMinutes") return /(?:提前|上课前)\s*\d{1,3}\s*分钟/.test(text);
  return false;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceSummaryFor(candidate) {
  const key = safeText(candidate && candidate.key, 40);
  const correction = candidate && candidate.correction === true;
  if (correction) return `用户明确纠正${key}`;
  if (candidate && candidate.source === "provider_payload") return `Provider 结构化候选${key}`;
  if (candidate && candidate.source === "explicit_user") return `用户明确设置${key}`;
  return `本轮语义候选${key}`;
}

function reject(reasonCode) {
  return { accepted: false, reasonCode };
}

function validateMemoryCandidate(raw = {}, context = {}) {
  if (!raw || !raw.key) return reject("MEMORY_KEY_MISSING");
  const candidate = Object.assign({}, raw);
  candidate.key = safeText(candidate.key, 40);
  const message = safeText(context.message || candidate.rawText, 600);

  if (candidate.key === "preferredName") {
    candidate.value = normalizeName(candidate.value);
    if (isInvalidPreferredName(candidate.value)) return reject("MEMORY_SEMANTIC_INVALID_PREFERRED_NAME");
  }

  if (isQuestionAboutMemory(message, candidate.key)
    && !explicitStatementMatches(message, candidate.key, candidate.value)) {
    return reject("MEMORY_QUESTION_NOT_FACT");
  }

  const confidence = Math.max(0, Math.min(1, Number(candidate.confidence || 0) || 0));
  candidate.confidence = confidence;
  candidate.reasonCode = safeText(candidate.reasonCode || "semantic_validated", 40);
  candidate.source = safeText(candidate.source || "deterministic", 40);
  candidate.sourceSummary = safeText(candidate.sourceSummary || sourceSummaryFor(candidate), 100);
  candidate.semanticValidated = true;
  candidate.semanticDisposition = "accepted";
  if (candidate.source !== "explicit_user" && confidence < MIN_DURABLE_CONFIDENCE) {
    candidate.scope = "working";
    candidate.durable = false;
    candidate.semanticDisposition = "working_only";
    candidate.reasonCode = "MEMORY_LOW_CONFIDENCE_WORKING_ONLY";
  }
  return { accepted: true, candidate };
}

function validateMemoryCandidates(candidates = [], context = {}) {
  const accepted = [];
  const rejected = [];
  (Array.isArray(candidates) ? candidates : []).forEach((candidate, index) => {
    const result = validateMemoryCandidate(candidate, context);
    if (result.accepted) {
      accepted.push(result.candidate);
      return;
    }
    rejected.push({
      index,
      key: safeText(candidate && candidate.key, 40),
      source: safeText(candidate && candidate.source, 40),
      reasonCode: result.reasonCode,
    });
  });
  return { accepted, rejected };
}

function validateStoredMemory(item = {}) {
  if (item.key === "preferredName" && isInvalidPreferredName(item.normalizedValue)) {
    return reject("MEMORY_SEMANTIC_INVALID_PREFERRED_NAME");
  }
  return { accepted: true };
}

function migrateInvalidStoredMemories(document, nowIso) {
  const source = document && typeof document === "object" ? document : {};
  const now = safeText(nowIso || new Date().toISOString(), 40);
  if (!Array.isArray(source.items)) source.items = [];
  if (!Array.isArray(source.audit)) source.audit = [];
  let invalidatedCount = 0;
  const reasonCounts = {};
  source.items.forEach((item) => {
    if (!item || item.status !== "active") return;
    const validation = validateStoredMemory(item);
    if (validation.accepted) return;
    invalidatedCount += 1;
    reasonCounts[validation.reasonCode] = (reasonCounts[validation.reasonCode] || 0) + 1;
    item.status = "invalid_semantic";
    item.updatedAt = now;
    item.revision = Math.max(1, Number(source.revision || item.revision || 1));
    source.audit.push({
      auditId: `audit_semantic_${safeText(item.memoryId || invalidatedCount, 60)}`,
      action: "invalidate_semantic",
      targetId: safeText(item.memoryId, 100),
      revision: Math.max(0, Number(source.revision || 0)),
      at: now,
    });
  });
  source.audit = source.audit.slice(-100);
  return { invalidatedCount, reasonCounts };
}

module.exports = {
  INVALID_PREFERRED_NAMES,
  MIN_DURABLE_CONFIDENCE,
  isInvalidPreferredName,
  isQuestionAboutMemory,
  migrateInvalidStoredMemories,
  validateMemoryCandidate,
  validateMemoryCandidates,
  validateStoredMemory,
};

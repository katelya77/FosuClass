const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_PATH = path.resolve(process.env.FOSU_ASSISTANT_KB_PATH || path.join(__dirname, "../../../data/ai/knowledge-docs.json"));
const STORE_VERSION = "assistant-kb.v2";
const ALL_SCOPES = ["public", "trial", "dev"];

const DEFAULT_DOCS = [
  {
    sourceId: "fosuclass-guide",
    title: "佛课小表使用说明",
    updatedAt: "2026-06-16",
    keywords: ["佛课小表", "小佛", "使用说明", "校园查询"],
    body: "佛课小表用于查询全校课表、空教室、教学周和个人本地课表摘要。课程事实只能来自课表工具和已发布课表数据；知识库只负责说明功能、隐私和常见问题。",
  },
  {
    sourceId: "privacy-guide",
    title: "隐私与个人课表摘要",
    updatedAt: "2026-06-16",
    keywords: ["隐私", "个人课表", "密码", "Cookie"],
    body: "小佛默认不保存学号、密码、Cookie、完整个人课表和精确位置轨迹。用户主动授权时，只发送完成任务所需的最小课表摘要。",
  },
  {
    sourceId: "failure-guide",
    title: "常见加载失败说明",
    updatedAt: "2026-06-16",
    keywords: ["加载失败", "数据失败", "缓存", "故障"],
    body: "如果课表或空教室加载失败，优先检查网络、当前学期、数据版本和本地缓存。公众输出不展示内部域名、服务器名称或发布控制面细节。",
  },
];

const DEFAULT_RULES = [
  {
    id: "rule-xiaofu-intro",
    sourceId: "rule-xiaofu-intro",
    type: "rule",
    title: "小佛助手能力介绍",
    status: "published",
    scope: ALL_SCOPES,
    tags: ["help"],
    keywords: ["你是谁", "小佛", "能做什么", "帮助"],
    priority: 90,
    body: "我是小佛助手，可以帮你查课表、找空教室、看教学周、解释个人课表导入方式，也能回答佛课小表的使用问题。涉及课程、教师、教室和空教室的事实，我会以已核验的工具数据为准。",
    updatedAt: "2026-06-16T00:00:00.000Z",
  },
];

const PROMPT_INJECTION_PATTERN = /(ignore\s+previous|system\s+prompt|developer\s+instruction|prompt\s+injection|忽略.*(规则|指令|系统)|泄露.*(prompt|提示)|覆盖.*(规则|指令))/i;
const SECRET_VALUE_PATTERN = /(api[_-]?key|token|cookie|password|passwd|secret|authorization)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/i;
const GENERIC_SECRET_PATTERN = /(sk-[A-Za-z0-9]{16,}|AKID[A-Za-z0-9]{12,}|-----BEGIN\s+(?:RSA|OPENSSH|PRIVATE)\s+KEY-----)/i;

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath = DATA_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath = DATA_PATH, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDir(filePath);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function stableId(prefix, text) {
  const hash = crypto.createHash("sha1").update(String(text || `${Date.now()}-${Math.random()}`)).digest("hex").slice(0, 10);
  return `${prefix}-${hash}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  return normalizeText(value)
    .split(/[,，;；、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return {};
  }
}

function normalizeScope(value) {
  const items = normalizeArray(value).map((item) => {
    const env = item.toLowerCase();
    if (env === "release" || env === "formal" || env === "production") return "public";
    if (env === "develop" || env === "development" || env === "devtools") return "dev";
    return env;
  }).filter((item) => ALL_SCOPES.includes(item));
  return items.length ? Array.from(new Set(items)) : ALL_SCOPES.slice();
}

function scopeMatches(entry, environment) {
  const env = normalizeScope(environment || "public")[0] || "public";
  const scopes = normalizeScope(entry && entry.scope);
  return scopes.includes(env);
}

function splitDocChunks(entry = {}) {
  const body = normalizeText(entry.body || entry.content || "");
  if (!body) return [];
  const title = normalizeText(entry.title || "知识文档");
  const sections = [];
  const lines = body.split(/\r?\n/);
  let current = { heading: title, lines: [] };
  lines.forEach((line) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match && current.lines.length) {
      sections.push(current);
      current = { heading: match[2].trim(), lines: [] };
      return;
    }
    if (match) {
      current.heading = match[2].trim();
      return;
    }
    current.lines.push(line);
  });
  if (current.lines.length || !sections.length) sections.push(current);
  const chunks = [];
  sections.forEach((section, sectionIndex) => {
    const text = section.lines.join("\n").trim();
    if (!text) return;
    for (let offset = 0; offset < text.length; offset += 520) {
      chunks.push({
        chunkId: `${entry.sourceId || entry.id}:c${sectionIndex + 1}-${Math.floor(offset / 520) + 1}`,
        sourceId: entry.sourceId || entry.id,
        title: section.heading || title,
        updatedAt: entry.updatedAt || "",
        text: text.slice(offset, offset + 680),
      });
    }
  });
  return chunks;
}

function normalizeEntry(input = {}, fallbackType = "doc") {
  const type = String(input.type || fallbackType || "doc").toLowerCase() === "rule" ? "rule" : "doc";
  const id = normalizeText(input.id || input.sourceId) || stableId(type, `${input.title || ""}:${input.body || input.content || ""}`);
  const body = normalizeText(input.body || input.content || input.answer || input.reply || "");
  const entry = {
    id,
    sourceId: normalizeText(input.sourceId || id).slice(0, 120),
    type,
    title: normalizeText(input.title || (type === "rule" ? "规则问答" : "知识文档")).slice(0, 160),
    status: ["draft", "published", "disabled"].includes(String(input.status || "").toLowerCase())
      ? String(input.status).toLowerCase()
      : "draft",
    scope: normalizeScope(input.scope || input.environments),
    tags: normalizeArray(input.tags).slice(0, 20),
    keywords: normalizeArray(input.keywords).slice(0, 80),
    synonyms: normalizeArray(input.synonyms || input.aliases).slice(0, 80),
    patterns: normalizeArray(input.patterns || input.regex).slice(0, 20),
    priority: Math.max(0, Math.min(999, Number(input.priority || 0) || 0)),
    body: body.slice(0, 30000),
    updatedAt: normalizeText(input.updatedAt) || nowIso(),
  };
  if (type === "rule") {
    const card = normalizePlainObject(input.card);
    entry.intentName = normalizeText(input.intentName || input.intent || "").slice(0, 80);
    entry.toolName = normalizeText(input.toolName || input.tool || "").slice(0, 80);
    entry.cardType = normalizeText(input.cardType || card.type || "").slice(0, 80);
    entry.reply = normalizeText(input.reply || input.answer || body).slice(0, 3000);
    entry.suggestions = normalizeArray(input.suggestions).slice(0, 12);
    entry.action = normalizePlainObject(input.action);
    entry.card = card;
  }
  if (type === "doc") {
    entry.chunks = Array.isArray(input.chunks) && input.chunks.length
      ? input.chunks.map((chunk, index) => ({
        chunkId: normalizeText(chunk.chunkId) || `${entry.sourceId}:c${index + 1}`,
        sourceId: entry.sourceId,
        title: normalizeText(chunk.title || entry.title).slice(0, 160),
        updatedAt: normalizeText(chunk.updatedAt || entry.updatedAt),
        text: normalizeText(chunk.text || chunk.body).slice(0, 2000),
      })).filter((chunk) => chunk.text)
      : splitDocChunks(entry);
  }
  return entry;
}

function normalizeDocument(raw = {}) {
  const docs = Array.isArray(raw.docs) ? raw.docs.map((item) => normalizeEntry(Object.assign({ status: "published" }, item), "doc")) : [];
  const rules = Array.isArray(raw.rules) ? raw.rules.map((item) => normalizeEntry(Object.assign({ status: "published" }, item), "rule")) : [];
  if (raw.version === STORE_VERSION || raw.draft || raw.published) {
    const draft = raw.draft || {};
    const published = raw.published || {};
    return {
      version: STORE_VERSION,
      updatedAt: normalizeText(raw.updatedAt) || nowIso(),
      currentVersion: normalizeText(raw.currentVersion || published.versionId || "kb-initial"),
      draft: {
        rules: (Array.isArray(draft.rules) ? draft.rules : rules).map((item) => normalizeEntry(item, "rule")),
        docs: (Array.isArray(draft.docs) ? draft.docs : docs).map((item) => normalizeEntry(item, "doc")),
      },
      published: {
        versionId: normalizeText(published.versionId || raw.currentVersion || "kb-initial"),
        publishedAt: normalizeText(published.publishedAt || raw.updatedAt) || nowIso(),
        rules: (Array.isArray(published.rules) ? published.rules : rules).map((item) => normalizeEntry(Object.assign({ status: "published" }, item), "rule")),
        docs: (Array.isArray(published.docs) ? published.docs : docs).map((item) => normalizeEntry(Object.assign({ status: "published" }, item), "doc")),
      },
      backups: Array.isArray(raw.backups) ? raw.backups.slice(-20) : [],
    };
  }
  const legacyDocs = docs.length ? docs : DEFAULT_DOCS.map((item) => normalizeEntry(Object.assign({ status: "published" }, item), "doc"));
  const legacyRules = rules.length ? rules : DEFAULT_RULES.map((item) => normalizeEntry(item, "rule"));
  return {
    version: STORE_VERSION,
    updatedAt: normalizeText(raw.updatedAt) || nowIso(),
    currentVersion: normalizeText(raw.version) || "knowledge.v1",
    draft: {
      rules: legacyRules.map((item) => normalizeEntry(Object.assign({}, item, { status: "draft" }), "rule")),
      docs: legacyDocs.map((item) => normalizeEntry(Object.assign({}, item, { status: "draft" }), "doc")),
    },
    published: {
      versionId: normalizeText(raw.version) || "knowledge.v1",
      publishedAt: normalizeText(raw.updatedAt) || nowIso(),
      rules: legacyRules,
      docs: legacyDocs,
    },
    backups: [],
  };
}

function readStore() {
  return normalizeDocument(readJson(DATA_PATH, { docs: DEFAULT_DOCS, rules: DEFAULT_RULES, version: "knowledge.v1", updatedAt: "2026-06-16" }));
}

function saveStore(store) {
  const normalized = normalizeDocument(Object.assign({}, store, { updatedAt: nowIso() }));
  writeJsonAtomic(DATA_PATH, normalized);
  return normalized;
}

function getEntryList(store, status = "draft") {
  const source = status === "published" ? store.published : store.draft;
  return []
    .concat((source.rules || []).map((item) => normalizeEntry(item, "rule")))
    .concat((source.docs || []).map((item) => normalizeEntry(item, "doc")));
}

function validateEntrySecurity(entry = {}) {
  const text = JSON.stringify(entry);
  const risks = [];
  if (SECRET_VALUE_PATTERN.test(text) || BEARER_PATTERN.test(text) || GENERIC_SECRET_PATTERN.test(text)) {
    risks.push({ level: "block", code: "SECRET_VALUE", message: "内容疑似包含密钥、Token、Cookie、密码或私钥。" });
  }
  if (PROMPT_INJECTION_PATTERN.test(text)) {
    risks.push({ level: "block", code: "PROMPT_INJECTION", message: "内容疑似包含系统提示泄露或 prompt injection 指令。" });
  }
  if (/(CloudBase|DeepSeek|Coze|Provider|Prompt|Token|API Key)/i.test(text)) {
    risks.push({ level: "warn", code: "INTERNAL_TERM", message: "内容包含内部实现词，请确认不会发布到 public 范围。" });
  }
  return {
    ok: !risks.some((risk) => risk.level === "block"),
    risks,
  };
}

function assertSafeEntry(entry) {
  const validation = validateEntrySecurity(entry);
  if (!validation.ok) {
    const error = new Error(validation.risks.map((risk) => risk.message).join("; "));
    error.code = "ASSISTANT_KB_SECURITY_BLOCKED";
    error.risks = validation.risks;
    throw error;
  }
  return validation;
}

function listKnowledge(options = {}) {
  const store = readStore();
  const status = options.status === "published" ? "published" : "draft";
  let entries = getEntryList(store, status);
  if (options.type) entries = entries.filter((item) => item.type === options.type);
  if (options.environment) entries = entries.filter((item) => scopeMatches(item, options.environment));
  return {
    success: true,
    store: {
      version: store.version,
      updatedAt: store.updatedAt,
      currentVersion: store.currentVersion,
      publishedVersionId: store.published.versionId,
      publishedAt: store.published.publishedAt,
      backupCount: store.backups.length,
    },
    entries,
    draft: {
      ruleCount: store.draft.rules.length,
      docCount: store.draft.docs.length,
    },
    published: {
      ruleCount: store.published.rules.length,
      docCount: store.published.docs.length,
      versionId: store.published.versionId,
      publishedAt: store.published.publishedAt,
    },
    backups: store.backups.map((item) => ({
      versionId: item.versionId,
      label: item.label || "",
      createdAt: item.createdAt,
      ruleCount: item.rules ? item.rules.length : 0,
      docCount: item.docs ? item.docs.length : 0,
    })).reverse(),
  };
}

function upsertDraftEntry(entry, mode = "upsert") {
  assertSafeEntry(entry);
  const store = readStore();
  const bucket = entry.type === "rule" ? store.draft.rules : store.draft.docs;
  const index = bucket.findIndex((item) => item.id === entry.id || item.sourceId === entry.sourceId);
  if (index >= 0) {
    if (mode === "create") {
      const error = new Error("Knowledge entry already exists.");
      error.code = "ASSISTANT_KB_CONFLICT";
      throw error;
    }
    bucket[index] = normalizeEntry(Object.assign({}, bucket[index], entry, { updatedAt: nowIso() }), entry.type);
  } else {
    bucket.push(normalizeEntry(Object.assign({}, entry, { updatedAt: nowIso() }), entry.type));
  }
  return saveStore(store);
}

function createEntry(input = {}) {
  const entry = normalizeEntry(Object.assign({ status: "draft" }, input), input.type || "doc");
  const store = upsertDraftEntry(entry, "create");
  return { success: true, entry, store: listKnowledge().store };
}

function updateEntry(id, patch = {}) {
  const store = readStore();
  const all = [
    { type: "rule", bucket: store.draft.rules },
    { type: "doc", bucket: store.draft.docs },
  ];
  for (const group of all) {
    const index = group.bucket.findIndex((item) => item.id === id || item.sourceId === id);
    if (index < 0) continue;
    const next = normalizeEntry(Object.assign({}, group.bucket[index], patch, { id: group.bucket[index].id, updatedAt: nowIso() }), group.type);
    assertSafeEntry(next);
    group.bucket[index] = next;
    saveStore(store);
    return { success: true, entry: next };
  }
  const error = new Error("Knowledge entry not found.");
  error.code = "ASSISTANT_KB_NOT_FOUND";
  throw error;
}

function deleteEntry(id) {
  const store = readStore();
  let removed = null;
  ["rules", "docs"].forEach((key) => {
    if (removed) return;
    const index = store.draft[key].findIndex((item) => item.id === id || item.sourceId === id);
    if (index >= 0) {
      removed = store.draft[key][index];
      store.draft[key].splice(index, 1);
    }
  });
  if (!removed) {
    const error = new Error("Knowledge entry not found.");
    error.code = "ASSISTANT_KB_NOT_FOUND";
    throw error;
  }
  saveStore(store);
  return { success: true, removed };
}

function parseFrontmatter(markdown) {
  const text = String(markdown || "").replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return { meta: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: text };
  const raw = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const meta = {};
  raw.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) return;
    let value = match[2].trim();
    if (/^\[.*\]$/.test(value)) {
      value = value.slice(1, -1).split(",").map((item) => item.trim().replace(/^["']|["']$/g, ""));
    }
    meta[match[1]] = value;
  });
  return { meta, body };
}

function buildImportPreview(markdown, options = {}) {
  const parsed = parseFrontmatter(markdown);
  const title = normalizeText(parsed.meta.title || options.title || options.filename || "导入文档");
  const sourceId = normalizeText(parsed.meta.sourceId || parsed.meta.id || stableId("md", `${title}:${parsed.body}`));
  const entry = normalizeEntry({
    id: sourceId,
    sourceId,
    type: "doc",
    title,
    status: "draft",
    scope: parsed.meta.scope || parsed.meta.environments || ALL_SCOPES,
    tags: parsed.meta.tags,
    keywords: parsed.meta.keywords,
    priority: parsed.meta.priority,
    body: parsed.body,
  }, "doc");
  const validation = validateEntrySecurity(entry);
  const store = readStore();
  const conflict = store.draft.docs.some((item) => item.id === entry.id || item.sourceId === entry.sourceId);
  return {
    success: true,
    preview: {
      entry,
      chunks: entry.chunks || [],
      conflict,
      risks: validation.risks,
      blocked: !validation.ok,
    },
  };
}

function importMarkdown(input = {}) {
  const markdown = String(input.markdown || input.content || "");
  const preview = buildImportPreview(markdown, input).preview;
  if (input.commit !== true) return { success: true, preview };
  if (preview.blocked) {
    const error = new Error("Markdown import blocked by knowledge-base security checks.");
    error.code = "ASSISTANT_KB_SECURITY_BLOCKED";
    error.risks = preview.risks;
    throw error;
  }
  const mode = String(input.conflictMode || input.mode || "skip").toLowerCase();
  const store = readStore();
  const index = store.draft.docs.findIndex((item) => item.id === preview.entry.id || item.sourceId === preview.entry.sourceId);
  if (index >= 0 && mode === "skip") {
    return { success: true, skipped: true, entry: store.draft.docs[index], preview };
  }
  if (index >= 0 && mode === "new") {
    preview.entry.id = stableId("md", `${preview.entry.id}:${Date.now()}`);
    preview.entry.sourceId = preview.entry.id;
    store.draft.docs.push(preview.entry);
  } else if (index >= 0) {
    store.draft.docs[index] = preview.entry;
  } else {
    store.draft.docs.push(preview.entry);
  }
  saveStore(store);
  return { success: true, entry: preview.entry, preview };
}

function exportKnowledge(options = {}) {
  const store = readStore();
  const status = options.status === "draft" ? "draft" : "published";
  const entries = getEntryList(store, status);
  const format = String(options.format || "json").toLowerCase();
  if (format === "md" || format === "markdown") {
    const markdown = entries.map((entry) => {
      const frontmatter = [
        "---",
        `id: ${entry.id}`,
        `title: ${entry.title}`,
        `type: ${entry.type}`,
        `scope: ${entry.scope.join(",")}`,
        `tags: ${entry.tags.join(",")}`,
        `keywords: ${entry.keywords.join(",")}`,
        `priority: ${entry.priority}`,
        "---",
        "",
        entry.body,
      ].join("\n");
      return frontmatter;
    }).join("\n\n");
    return { success: true, format: "md", content: markdown };
  }
  return { success: true, format: "json", content: JSON.stringify({ version: store.version, status, entries }, null, 2) };
}

function tokenize(text) {
  return normalizeText(text).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((item) => item.length >= 2)
    .slice(0, 160);
}

function charBigrams(text) {
  const value = normalizeText(text).replace(/\s+/g, "");
  const out = [];
  for (let index = 0; index < value.length - 1; index += 1) out.push(value.slice(index, index + 2).toLowerCase());
  return out;
}

function scoreText(query, target, keywords = []) {
  const qTokens = tokenize(query);
  const dTokens = new Set(tokenize(`${target} ${keywords.join(" ")}`));
  const keywordScore = qTokens.reduce((sum, token) => sum + (dTokens.has(token) ? 3 : 0), 0);
  const qBi = new Set(charBigrams(query));
  const dBi = new Set(charBigrams(`${target}${keywords.join("")}`));
  let overlap = 0;
  qBi.forEach((item) => {
    if (dBi.has(item)) overlap += 1;
  });
  return keywordScore + overlap / Math.max(1, qBi.size);
}

function matchRule(rule, query) {
  const text = normalizeText(query);
  const normalized = text.toLowerCase();
  let score = Number(rule.priority || 0) / 100;
  const matchedKeywords = [];
  normalizeArray(rule.keywords).concat(normalizeArray(rule.synonyms)).forEach((keyword) => {
    const key = keyword.toLowerCase();
    if (key && normalized.includes(key)) {
      matchedKeywords.push(keyword);
      score += 5;
    }
  });
  normalizeArray(rule.patterns).forEach((pattern) => {
    try {
      if (new RegExp(pattern, "i").test(text)) score += 8;
    } catch (error) {
      // Ignore invalid admin-authored regex.
    }
  });
  return score > 0.5 ? { rule, score, matchedKeywords } : null;
}

function searchKnowledge(input = {}) {
  const query = normalizeText(input.q || input.query || input.message || "");
  const environment = normalizeScope(input.environment || input.scope || "public")[0] || "public";
  const store = readStore();
  if (!query) {
    return {
      success: true,
      sourceId: `knowledge:${store.published.versionId}`,
      version: store.published.versionId,
      items: [],
      ruleMatches: [],
      total: 0,
      noAnswer: true,
      fallback: true,
      summary: "没有提供知识库检索问题。",
    };
  }
  const rules = (store.published.rules || [])
    .filter((rule) => rule.status !== "disabled" && scopeMatches(rule, environment))
    .map((rule) => matchRule(rule, query))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  if (rules.length) {
    const top = rules[0];
    return {
      success: true,
      sourceId: `knowledge:${store.published.versionId}`,
      version: store.published.versionId,
      environment,
      ruleMatched: true,
      ruleMatches: rules.slice(0, 5).map((item) => ({
        id: item.rule.id,
        title: item.rule.title,
        score: Number(item.score.toFixed(3)),
        matchedKeywords: item.matchedKeywords,
        intentName: item.rule.intentName || "",
        toolName: item.rule.toolName || "",
        cardType: item.rule.cardType || "",
      })),
      items: [{
        sourceId: top.rule.sourceId,
        title: top.rule.title,
        chunkId: `${top.rule.id}:rule`,
        text: top.rule.body,
        score: Number(top.score.toFixed(3)),
        type: "rule",
        updatedAt: top.rule.updatedAt,
        intentName: top.rule.intentName || "",
        toolName: top.rule.toolName || "",
        cardType: top.rule.cardType || "",
        reply: top.rule.reply || top.rule.body || "",
        suggestions: top.rule.suggestions || [],
        action: top.rule.action || {},
        card: top.rule.card || {},
      }],
      answer: top.rule.reply || top.rule.body,
      total: 1,
      noAnswer: false,
      fallback: false,
      summary: `命中规则：${top.rule.title}`,
    };
  }
  const chunks = (store.published.docs || [])
    .filter((doc) => doc.status !== "disabled" && scopeMatches(doc, environment))
    .flatMap((doc) => {
      const list = Array.isArray(doc.chunks) && doc.chunks.length ? doc.chunks : splitDocChunks(doc);
      return list.map((chunk) => Object.assign({}, chunk, {
        doc,
        score: scoreText(query, `${doc.title}\n${chunk.title}\n${chunk.text}`, doc.keywords),
      }));
    })
    .filter((item) => item.score > 0.2)
    .sort((left, right) => right.score - left.score)
    .slice(0, Number(input.limit || 4) || 4);
  const items = chunks.map((item) => ({
    sourceId: item.sourceId,
    title: item.title,
    updatedAt: item.updatedAt,
    chunkId: item.chunkId,
    text: item.text,
    score: Number(item.score.toFixed(3)),
    type: "doc",
  }));
  return {
    success: true,
    sourceId: `knowledge:${store.published.versionId}`,
    version: store.published.versionId,
    environment,
    ruleMatched: false,
    ruleMatches: [],
    updatedAt: store.published.publishedAt,
    items,
    total: items.length,
    noAnswer: items.length === 0,
    fallback: items.length === 0,
    answer: items.length ? items.map((item) => item.text).join("\n\n").slice(0, 1200) : "",
    summary: items.length ? `找到 ${items.length} 条知识来源。` : "知识库没有可靠答案。",
  };
}

function matchLocalRule(input = {}) {
  const query = normalizeText(input.q || input.query || input.message || "");
  const environment = normalizeScope(input.environment || input.scope || "public")[0] || "public";
  const store = readStore();
  if (!query) {
    return {
      success: true,
      matched: false,
      environment,
      version: store.published.versionId,
      rule: null,
      ruleMatches: [],
    };
  }
  const matches = (store.published.rules || [])
    .filter((rule) => rule.status !== "disabled" && scopeMatches(rule, environment))
    .map((rule) => matchRule(rule, query))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  const top = matches[0] || null;
  return {
    success: true,
    matched: Boolean(top),
    environment,
    version: store.published.versionId,
    sourceId: `knowledge:${store.published.versionId}`,
    rule: top ? top.rule : null,
    score: top ? Number(top.score.toFixed(3)) : 0,
    matchedKeywords: top ? top.matchedKeywords : [],
    ruleMatches: matches.slice(0, 5).map((item) => ({
      id: item.rule.id,
      title: item.rule.title,
      score: Number(item.score.toFixed(3)),
      matchedKeywords: item.matchedKeywords,
      intentName: item.rule.intentName || "",
      toolName: item.rule.toolName || "",
      cardType: item.rule.cardType || "",
    })),
  };
}

function testKnowledge(input = {}) {
  const result = searchKnowledge(input);
  return {
    success: true,
    query: normalizeText(input.query || input.q || input.message || ""),
    environment: result.environment || normalizeScope(input.environment || "public")[0],
    matchedKeywords: (result.ruleMatches || []).flatMap((item) => item.matchedKeywords || []),
    ruleMatches: result.ruleMatches || [],
    ragDocuments: result.items || [],
    score: result.items && result.items[0] ? result.items[0].score : 0,
    finalAnswer: result.answer || (result.items && result.items[0] && result.items[0].text) || "没有命中知识库，已进入默认本地兜底。",
    fallback: result.fallback === true,
    search: result,
  };
}

function publish(options = {}) {
  const store = readStore();
  const entries = getEntryList(store, "draft");
  const risks = entries.flatMap((entry) => validateEntrySecurity(entry).risks.map((risk) => Object.assign({ entryId: entry.id }, risk)));
  const blocking = risks.filter((risk) => risk.level === "block");
  if (blocking.length) {
    const error = new Error("Knowledge publish blocked by security checks.");
    error.code = "ASSISTANT_KB_SECURITY_BLOCKED";
    error.risks = blocking;
    throw error;
  }
  const versionId = options.versionId || `kb-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  store.backups = (store.backups || []).concat(Object.assign({
    versionId: store.published.versionId,
    label: options.label || "before-publish",
    createdAt: nowIso(),
  }, store.published)).slice(-20);
  store.published = {
    versionId,
    publishedAt: nowIso(),
    rules: store.draft.rules.map((item) => normalizeEntry(Object.assign({}, item, { status: "published" }), "rule")),
    docs: store.draft.docs.map((item) => normalizeEntry(Object.assign({}, item, { status: "published" }), "doc")),
  };
  store.currentVersion = versionId;
  return { success: true, store: saveStore(store), risks };
}

function rollback(versionId) {
  const store = readStore();
  const target = (store.backups || []).find((item) => item.versionId === versionId);
  if (!target) {
    const error = new Error("Knowledge backup not found.");
    error.code = "ASSISTANT_KB_BACKUP_NOT_FOUND";
    throw error;
  }
  store.backups = store.backups.concat(Object.assign({
    versionId: store.published.versionId,
    label: "before-rollback",
    createdAt: nowIso(),
  }, store.published)).slice(-20);
  store.published = {
    versionId: target.versionId,
    publishedAt: nowIso(),
    rules: (target.rules || []).map((item) => normalizeEntry(Object.assign({}, item, { status: "published" }), "rule")),
    docs: (target.docs || []).map((item) => normalizeEntry(Object.assign({}, item, { status: "published" }), "doc")),
  };
  store.draft = {
    rules: store.published.rules.map((item) => normalizeEntry(Object.assign({}, item, { status: "draft" }), "rule")),
    docs: store.published.docs.map((item) => normalizeEntry(Object.assign({}, item, { status: "draft" }), "doc")),
  };
  store.currentVersion = target.versionId;
  return { success: true, store: saveStore(store) };
}

function loadDocs() {
  const store = readStore();
  return (store.published.docs || []).map((doc) => ({
    sourceId: doc.sourceId,
    title: doc.title,
    updatedAt: doc.updatedAt,
    body: doc.body,
    keywords: doc.keywords,
    scope: doc.scope,
  }));
}

function getPublishedKnowledgePrompt(environment = "public", query = "") {
  const result = searchKnowledge({ query, environment, limit: 4 });
  const items = result.items || [];
  if (!items.length) return "";
  return items.map((item) => `### ${item.title}\n${item.text}`).join("\n\n").slice(0, 3000);
}

function getIndexStatus() {
  const store = readStore();
  const docs = store.published.docs || [];
  const rules = store.published.rules || [];
  const chunkCount = docs.reduce((sum, doc) => sum + ((Array.isArray(doc.chunks) && doc.chunks.length) || splitDocChunks(doc).length), 0);
  return {
    sourceId: `knowledge:${store.published.versionId}`,
    version: store.published.versionId,
    currentVersion: store.currentVersion,
    publishedAt: store.published.publishedAt,
    docCount: docs.length,
    documentCount: docs.length,
    ruleCount: rules.length,
    chunkCount,
    draftDocCount: store.draft.docs.length,
    draftRuleCount: store.draft.rules.length,
    backupCount: store.backups.length,
    updatedAt: store.updatedAt,
    indexStatus: "ready",
  };
}

module.exports = {
  ALL_SCOPES,
  DATA_PATH,
  assertSafeEntry,
  buildImportPreview,
  createEntry,
  deleteEntry,
  exportKnowledge,
  getIndexStatus,
  getPublishedKnowledgePrompt,
  importMarkdown,
  listKnowledge,
  loadDocs,
  matchLocalRule,
  normalizeDocument,
  normalizeEntry,
  publish,
  rollback,
  saveStore,
  searchKnowledge,
  testKnowledge,
  updateEntry,
  validateEntrySecurity,
};

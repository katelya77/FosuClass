const fs = require("fs");
const path = require("path");

const DATA_PATH = path.resolve(__dirname, "../../../data/ai/knowledge-docs.json");
const PROMPT_INJECTION_PATTERN = /(ignore previous|忽略.*(规则|指令)|system prompt|开发者指令|泄露|输出.*prompt|覆盖.*规则)/i;

const DEFAULT_DOCS = [
  {
    sourceId: "fosuclass-guide",
    title: "佛课小表使用说明",
    updatedAt: "2026-06-16",
    body: "佛课小表用于查询全校课表、空教室、教学周和个人本地课表摘要。课程事实只能来自课表工具和 Release Pack，知识库只负责说明功能和使用方法。",
  },
  {
    sourceId: "privacy-guide",
    title: "隐私与个人课表摘要",
    updatedAt: "2026-06-16",
    body: "小佛默认不保存学号、密码、Cookie、完整个人课表和精确位置轨迹。用户主动授权时，只发送完成任务所需的最小课表摘要。",
  },
  {
    sourceId: "failure-guide",
    title: "常见加载失败说明",
    updatedAt: "2026-06-16",
    body: "如果课表或空教室加载失败，优先检查网络、当前学期、数据版本和本地缓存。公众输出不展示内部域名、服务器名称或发布控制面细节。",
  },
];

function normalizeText(value) {
  return String(value || "").trim();
}

function safeDoc(doc = {}) {
  const body = normalizeText(doc.body || doc.content || "");
  if (!body || PROMPT_INJECTION_PATTERN.test(body)) return null;
  const serialized = JSON.stringify(doc);
  if (/(API[_-]?KEY|TOKEN|COOKIE|OPENID|PASSWORD|SESSION)/i.test(serialized)) return null;
  return {
    sourceId: normalizeText(doc.sourceId || doc.id).slice(0, 80),
    title: normalizeText(doc.title || "知识文档").slice(0, 120),
    updatedAt: normalizeText(doc.updatedAt || "").slice(0, 40),
    body: body.slice(0, 6000),
  };
}

function loadDocs() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
      const docs = Array.isArray(parsed.docs) ? parsed.docs.map(safeDoc).filter(Boolean) : [];
      if (docs.length) return docs;
    }
  } catch (error) {
    return DEFAULT_DOCS;
  }
  return DEFAULT_DOCS;
}

function tokenize(text) {
  return normalizeText(text).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((item) => item.length >= 2)
    .slice(0, 120);
}

function charBigrams(text) {
  const value = normalizeText(text).replace(/\s+/g, "");
  const out = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    out.push(value.slice(index, index + 2).toLowerCase());
  }
  return out;
}

function scoreDoc(doc, query) {
  const qTokens = tokenize(query);
  const dTokens = new Set(tokenize(`${doc.title} ${doc.body}`));
  const keywordScore = qTokens.reduce((sum, token) => sum + (dTokens.has(token) ? 3 : 0), 0);
  const qBi = new Set(charBigrams(query));
  const dBi = new Set(charBigrams(`${doc.title}${doc.body}`));
  let overlap = 0;
  qBi.forEach((item) => {
    if (dBi.has(item)) overlap += 1;
  });
  return keywordScore + overlap / Math.max(1, qBi.size);
}

function chunkDoc(doc) {
  const text = doc.body;
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += 420) {
    chunks.push({
      sourceId: doc.sourceId,
      title: doc.title,
      updatedAt: doc.updatedAt,
      chunkId: `${doc.sourceId}:${Math.floor(offset / 420) + 1}`,
      text: text.slice(offset, offset + 520),
    });
  }
  return chunks;
}

function searchKnowledge(input = {}) {
  const query = normalizeText(input.q || input.query || input.message || "");
  if (!query) {
    return {
      success: true,
      sourceId: "knowledge:v1",
      items: [],
      total: 0,
      noAnswer: true,
      summary: "没有提供知识库检索问题。",
    };
  }
  const docs = loadDocs();
  const scored = docs.map((doc) => ({ doc, score: scoreDoc(doc, query) }))
    .filter((item) => item.score > 0.2)
    .sort((left, right) => right.score - left.score)
    .slice(0, Number(input.limit || 4) || 4);
  const items = scored.flatMap((item) => chunkDoc(item.doc).slice(0, 1).map((chunk) => Object.assign({}, chunk, {
    score: Number(item.score.toFixed(3)),
  })));
  return {
    success: true,
    sourceId: "knowledge:v1",
    updatedAt: docs.reduce((max, doc) => doc.updatedAt > max ? doc.updatedAt : max, ""),
    items,
    total: items.length,
    noAnswer: items.length === 0,
    summary: items.length ? `找到 ${items.length} 条知识来源。` : "知识库没有可靠答案。",
  };
}

function getIndexStatus() {
  const docs = loadDocs();
  return {
    sourceId: "knowledge:v1",
    docCount: docs.length,
    chunkCount: docs.reduce((sum, doc) => sum + chunkDoc(doc).length, 0),
    updatedAt: docs.reduce((max, doc) => doc.updatedAt > max ? doc.updatedAt : max, ""),
  };
}

module.exports = {
  DATA_PATH,
  getIndexStatus,
  loadDocs,
  searchKnowledge,
};

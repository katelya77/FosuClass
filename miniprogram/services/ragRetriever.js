const knowledgeBase = require("../data/fosuKnowledgeBase");

const MIN_RELIABLE_SCORE = 3;
const CATEGORY_HINTS = {
  "学校概况": ["佛山大学", "佛大", "学校", "概况", "学院", "专业"],
  "校区地点": ["校区", "仙溪", "江湾", "河滨", "地址", "位置", "在哪里", "地图"],
  "教务教学": ["教务", "教务处", "教务系统", "选课", "成绩", "考试", "课表系统"],
  "常用系统": ["信息门户", "统一身份", "入口", "系统", "办事大厅", "登录"],
  "校园服务": ["图书馆", "自习", "借书", "服务", "校园卡", "校园网", "宿舍", "后勤", "报修"],
  "学生事务": ["招生", "就业", "学生事务", "咨询", "团委", "第二课堂", "易班", "i志愿"],
  "FAQ": ["小佛", "知识库", "可靠", "边界", "不会编造"],
};

function isNavigationQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  return /(入口|官网|网址|链接|在哪里进|哪里进|怎么进|如何进|从哪进|在哪进|打开|登录|系统在哪里|教务系统|信息门户|办事大厅)/.test(value) &&
    /(佛大|佛山大学|教务|信息门户|统一身份|系统|入口|官网|图书馆|办事|课表|小程序|校园地图|地图|导入)/i.test(value);
}

function normalizeText(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/[\u3000\s]+/g, "")
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

function tokenize(value) {
  const text = String(value || "").trim();
  const matches = text.match(/[A-Za-z0-9]+|[\u4e00-\u9fa5]{2,}/g);
  if (!matches) return [];
  const tokens = [];
  matches.forEach((item) => {
    const normalized = normalizeText(item);
    if (normalized && tokens.indexOf(normalized) < 0) tokens.push(normalized);
  });
  return tokens;
}

function expandQueryTokens(query) {
  const baseTokens = tokenize(query);
  const synonymMap = knowledgeBase.synonymMap || {};
  Object.keys(synonymMap).forEach((key) => {
    const keyNorm = normalizeText(key);
    if (normalizeText(query).indexOf(keyNorm) >= 0 && baseTokens.indexOf(keyNorm) < 0) {
      baseTokens.push(keyNorm);
    }
    const aliases = Array.isArray(synonymMap[key]) ? synonymMap[key] : [];
    const matchedAlias = aliases.some((alias) => normalizeText(query).indexOf(normalizeText(alias)) >= 0);
    if (matchedAlias && baseTokens.indexOf(keyNorm) < 0) baseTokens.push(keyNorm);
    aliases.forEach((alias) => {
      const aliasNorm = normalizeText(alias);
      if ((baseTokens.indexOf(keyNorm) >= 0 || normalizeText(query).indexOf(keyNorm) >= 0 || matchedAlias) && aliasNorm && baseTokens.indexOf(aliasNorm) < 0) {
        baseTokens.push(aliasNorm);
      }
    });
  });
  return baseTokens;
}

function buildDocSearchText(doc) {
  return normalizeText([
    doc.id,
    doc.title,
    doc.category,
    doc.summary,
    doc.content,
    doc.entryType,
    Array.isArray(doc.aliases) ? doc.aliases.join(" ") : "",
    Array.isArray(doc.keywords) ? doc.keywords.join(" ") : "",
  ].join(" "));
}

function scoreDoc(doc, query, tokens) {
  const queryNorm = normalizeText(query);
  const titleNorm = normalizeText(doc.title);
  const categoryNorm = normalizeText(doc.category);
  const keywordNorm = normalizeText((doc.keywords || []).join(" "));
  const aliasNorm = normalizeText((doc.aliases || []).join(" "));
  const entryTypeNorm = normalizeText(doc.entryType || "");
  const contentNorm = normalizeText([doc.summary, doc.content].filter(Boolean).join(" "));
  const haystack = buildDocSearchText(doc);
  let score = 0;

  if (queryNorm && titleNorm.indexOf(queryNorm) >= 0) score += 8;
  if (queryNorm && aliasNorm.indexOf(queryNorm) >= 0) score += 7.5;
  if (queryNorm && keywordNorm.indexOf(queryNorm) >= 0) score += 7;
  if (queryNorm && contentNorm.indexOf(queryNorm) >= 0) score += 5;
  if (queryNorm && categoryNorm.indexOf(queryNorm) >= 0) score += 3;

  (tokens || []).forEach((token) => {
    if (!token) return;
    if (titleNorm.indexOf(token) >= 0) score += 5;
    if (aliasNorm.indexOf(token) >= 0) score += 4.5;
    if (keywordNorm.indexOf(token) >= 0) score += 4;
    if (contentNorm.indexOf(token) >= 0) score += 2;
    if (categoryNorm.indexOf(token) >= 0) score += 1;
    if (entryTypeNorm.indexOf(token) >= 0) score += 1;
    if (haystack.indexOf(token) >= 0 && token.length >= 4) score += 1;
  });

  const hints = CATEGORY_HINTS[doc.category] || [];
  hints.forEach((hint) => {
    const normalizedHint = normalizeText(hint);
    if (!normalizedHint) return;
    if (queryNorm.indexOf(normalizedHint) >= 0) score += 2;
    if ((tokens || []).indexOf(normalizedHint) >= 0) score += 1.5;
  });

  const aliases = knowledgeBase.synonymMap || {};
  Object.keys(aliases).forEach((key) => {
    const keyNorm = normalizeText(key);
    const aliasList = Array.isArray(aliases[key]) ? aliases[key].map(normalizeText) : [];
    const queryHit = queryNorm.indexOf(keyNorm) >= 0 || aliasList.some((alias) => alias && queryNorm.indexOf(alias) >= 0);
    if (!queryHit) return;
    if (titleNorm.indexOf(keyNorm) >= 0 || keywordNorm.indexOf(keyNorm) >= 0) score += 3;
    if (aliasList.some((alias) => alias && (titleNorm.indexOf(alias) >= 0 || keywordNorm.indexOf(alias) >= 0))) score += 2;
  });

  const confidence = Number(doc.confidence || 0);
  if (confidence >= 0.85) score += 1.5;
  if (confidence < 0.6) score -= 0.5;
  if (isNavigationQuery(query) && doc.entryType === "navigation") score += 5;
  if (isNavigationQuery(query) && doc.entryType !== "navigation" && /(入口|系统|官网|怎么进|在哪里进)/.test(queryNorm)) score -= 1;
  if (/(是什么|有哪些|怎么办|如何办理|介绍|概况)/.test(queryNorm) && ["knowledge", "faq"].indexOf(doc.entryType) >= 0) score += 2;
  return score;
}

function isCampusKnowledgeQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  return /(佛大|佛山大学|fosu|校区|仙溪|江湾|河滨|教务|信息门户|统一身份|图书馆|校园卡|校园网|宿舍|后勤|报修|团委|第二课堂|易班|i志愿|学院|部门|招生|就业|校园|办事|学生事务|地址|在哪里|怎么进|怎么用|入口|官网|通知|公告|小佛ai|知识库)/i.test(value);
}

function searchKnowledge(query, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 4) || 4, 1), 8);
  const tokens = expandQueryTokens(query);
  const docs = Array.isArray(knowledgeBase.docs) ? knowledgeBase.docs : [];
  const preferredEntryType = options.preferredEntryType || (isNavigationQuery(query) ? "navigation" : "");
  const results = docs
    .map((doc) => {
      let score = scoreDoc(doc, query, tokens);
      if (preferredEntryType && doc.entryType === preferredEntryType) score += 4;
      if (preferredEntryType && doc.entryType && doc.entryType !== preferredEntryType) score -= 0.5;
      return Object.assign({}, doc, {
        score,
        reliable: score >= MIN_RELIABLE_SCORE && Number(doc.confidence || 0) >= 0.5,
      });
    })
    .filter((doc) => doc.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Number(right.confidence || 0) - Number(left.confidence || 0);
    })
    .slice(0, limit);
  return {
    query,
    tokens,
    results,
    top: results[0] || null,
    hasReliableResult: Boolean(results[0] && results[0].reliable),
    indexVersion: knowledgeBase.version,
    updatedAt: knowledgeBase.updatedAt,
  };
}

module.exports = {
  MIN_RELIABLE_SCORE,
  expandQueryTokens,
  isCampusKnowledgeQuery,
  isNavigationQuery,
  normalizeText,
  searchKnowledge,
  tokenize,
};

const knowledgeBase = require("../data/fosuKnowledgeBase");

const MIN_RELIABLE_SCORE = 5;
const HIGH_RISK_DETAIL_PATTERN = /(电话|联系方式|开放时间|几点开|几点关|上班时间|办公地点|办公室|窗口|材料|流程|费用|挂失|补办|办理)/;
const HIGH_RISK_SUBJECTS = [
  { pattern: /(校医院|医务室|门诊|医保)/, support: /(校医院|医务室|门诊|医保)/ },
  { pattern: /(校园卡|饭卡|一卡通)/, support: /(校园卡|饭卡|一卡通)/ },
  { pattern: /(校园网|网络|wifi|上网)/i, support: /(校园网|网络|wifi|上网)/i },
  { pattern: /(宿舍|寝室)/, support: /(宿舍|寝室)/ },
  { pattern: /(后勤|报修|水电|维修)/, support: /(后勤|报修|水电|维修)/ },
  { pattern: /(校车|班车|通勤车)/, support: /(校车|班车|通勤车)/ },
  { pattern: /(办公室|办公地点|窗口)/, support: /(办公室|办公地点|窗口)/ },
];

const CATEGORY_HINTS = {
  school_overview: ["佛山大学", "佛大", "学校", "概况", "简介"],
  campus: ["校区", "仙溪", "江湾", "河滨", "地址", "位置", "地图"],
  college_department: ["学院", "部门", "二级学院", "职能部门", "机构设置"],
  academic_affairs: ["教务", "教务部", "教务处", "教务系统", "选课", "成绩", "考试"],
  library: ["图书馆", "馆藏", "数据库", "借阅", "自习", "座位"],
  admission: ["招生", "本科招生", "录取", "招生章程"],
  employment: ["就业", "智慧就业", "双选会", "招聘会", "校招", "招聘"],
  graduate: ["研究生", "研究生招生", "研招", "硕士"],
  journal: ["学报", "期刊", "投稿", "编辑部"],
  navigation: ["入口", "官网", "系统", "登录", "链接", "网址"],
  personal_schedule: ["个人课表", "导入", "xls", "excel"],
  schedule: ["全校课表", "课表数据", "当前教学周", "更新时间"],
  weather: ["天气", "下雨", "带伞", "温度"],
  app_help: ["小佛", "小佛校园助手", "小序", "小序校园助手", "校园服务管家", "校园查询", "怎么用", "能做什么"],
  student_affairs: ["学工", "团委", "第二课堂", "易班", "志愿"],
  service_boundary: ["办事", "后勤", "报修", "校园卡", "校园网", "宿舍"],
};

function normalizeText(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/[\u3000\s]+/g, "")
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

function uniquePush(list, value) {
  const normalized = normalizeText(value);
  if (normalized && list.indexOf(normalized) < 0) list.push(normalized);
}

function tokenize(value) {
  const text = String(value || "").trim();
  const matches = text.match(/[A-Za-z0-9.-]+|[\u4e00-\u9fa5]{2,}/g);
  if (!matches) return [];
  const tokens = [];
  matches.forEach((item) => uniquePush(tokens, item));
  return tokens;
}

function collectLexiconTerms() {
  const terms = [];
  const synonymMap = knowledgeBase.synonymMap || {};
  Object.keys(synonymMap).forEach((key) => {
    uniquePush(terms, key);
    (Array.isArray(synonymMap[key]) ? synonymMap[key] : []).forEach((item) => uniquePush(terms, item));
  });
  (Array.isArray(knowledgeBase.docs) ? knowledgeBase.docs : []).forEach((doc) => {
    uniquePush(terms, doc.title);
    uniquePush(terms, doc.categoryLabel || doc.category);
    (Array.isArray(doc.keywords) ? doc.keywords : []).forEach((item) => uniquePush(terms, item));
    (Array.isArray(doc.aliases) ? doc.aliases : []).forEach((item) => uniquePush(terms, item));
  });
  return terms.filter((item) => item.length >= 2);
}

function expandQueryTokens(query) {
  const queryNorm = normalizeText(query);
  const baseTokens = tokenize(query);
  const synonymMap = knowledgeBase.synonymMap || {};
  Object.keys(synonymMap).forEach((key) => {
    const keyNorm = normalizeText(key);
    const aliases = Array.isArray(synonymMap[key]) ? synonymMap[key] : [];
    const matchedKey = keyNorm && queryNorm.indexOf(keyNorm) >= 0;
    const matchedAlias = aliases.some((alias) => {
      const aliasNorm = normalizeText(alias);
      return aliasNorm && queryNorm.indexOf(aliasNorm) >= 0;
    });
    if (matchedKey || matchedAlias) uniquePush(baseTokens, key);
    aliases.forEach((alias) => {
      if (matchedKey || matchedAlias) uniquePush(baseTokens, alias);
    });
  });
  collectLexiconTerms().forEach((term) => {
    if (queryNorm.indexOf(term) >= 0) uniquePush(baseTokens, term);
  });
  return baseTokens;
}

function sourceDomain(sourceUrl) {
  const value = String(sourceUrl || "").trim();
  const match = value.match(/^(?:https?:\/\/)?([^/]+)/i);
  return match ? normalizeText(match[1].replace(/^www\./i, "")) : "";
}

function sourceDomainAliases(sourceUrl) {
  const domain = sourceDomain(sourceUrl);
  if (!domain) return [];
  const aliases = [domain];
  domain.split(".").filter(Boolean).forEach((part) => {
    if (part.length >= 2) aliases.push(part);
  });
  if (domain.endsWith("fosu.edu.cn")) aliases.push("fosu", "佛山大学");
  if (domain.indexOf("zsb.") === 0) aliases.push("招生", "本科招生");
  if (domain.indexOf("jy.") === 0) aliases.push("就业", "智慧就业");
  if (domain.indexOf("rczp.") === 0) aliases.push("招聘", "人才招聘");
  if (domain.indexOf("xbbjb.") === 0) aliases.push("学报", "期刊");
  return aliases.map(normalizeText).filter(Boolean);
}

function isNavigationQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  return /(入口|官网|网址|链接|在哪里进|哪里进|怎么进|如何进|从哪进|在哪进|打开|登录|系统在哪里|教务系统|信息门户|办事大厅)/.test(value) &&
    /(佛大|佛山大学|fosu|教务|信息门户|统一身份|系统|入口|官网|图书馆|办事|课表|小程序|校园地图|地图|导入|招生|就业|招聘|研究生|学报)/i.test(value);
}

function isKnowledgeIntroQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  return /(是什么|有哪些|介绍|概况|简介|部门|学院|校区|服务边界|说明)/.test(value);
}

function isHelpQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  return /(怎么用|如何使用|使用帮助|可以查询什么|能做什么|我能查什么|如何导入|怎么导入|导入个人课表|xls|数据来源说明)/.test(value);
}

function isWeatherToolQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  return /(天气|下雨|降雨|雨|带伞|伞|温度|气温|热不热|冷不冷|风大|风力|湿度|空气|适合跑步|跑步|出行)/.test(value);
}

function isScheduleStatusToolQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  return /(当前是第几教学周|第几教学周|当前教学周|课表数据|更新到什么时候|数据是否最新|当前学期|发布版本|缓存时间)/.test(value);
}

function isDynamicToolQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  return isWeatherToolQuery(value) ||
    isScheduleStatusToolQuery(value) ||
    /(今天有什么课|明天有什么课|本周课表|下一节课|查班级|查教师|查老师|查教室|查课程|导入个人课表|可以查询什么|怎么用|如何使用)/.test(value);
}

function buildDocSearchText(doc) {
  return normalizeText([
    doc.id,
    doc.title,
    doc.category,
    doc.categoryLabel,
    doc.summary,
    doc.content,
    doc.entryType,
    doc.sourceUrl,
    Array.isArray(doc.aliases) ? doc.aliases.join(" ") : "",
    Array.isArray(doc.keywords) ? doc.keywords.join(" ") : "",
  ].join(" "));
}

function isHighRiskDetailQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  return HIGH_RISK_DETAIL_PATTERN.test(value) ||
    HIGH_RISK_SUBJECTS.some((item) => item.pattern.test(value));
}

function hasSupportedHighRiskSubject(doc, query) {
  const value = normalizeText(query);
  if (!isHighRiskDetailQuery(value)) return true;
  const docText = buildDocSearchText(doc);
  const unsupportedSubject = HIGH_RISK_SUBJECTS.some((item) => item.pattern.test(value) && !item.support.test(docText));
  if (unsupportedSubject) return false;
  if (HIGH_RISK_DETAIL_PATTERN.test(value) && doc.category === "school_overview") return false;
  return true;
}

function addScore(state, amount, reason) {
  if (!amount) return;
  state.score += amount;
  if (reason && state.reasons.indexOf(reason) < 0) state.reasons.push(reason);
}

function scoreDoc(doc, query, tokens) {
  const queryNorm = normalizeText(query);
  const titleNorm = normalizeText(doc.title);
  const aliasTerms = (Array.isArray(doc.aliases) ? doc.aliases : []).map(normalizeText).filter(Boolean);
  const categoryNorm = normalizeText(doc.category);
  const categoryLabelNorm = normalizeText(doc.categoryLabel);
  const keywordNorm = normalizeText((doc.keywords || []).join(" "));
  const aliasNorm = normalizeText((doc.aliases || []).join(" "));
  const entryTypeNorm = normalizeText(doc.entryType || "");
  const contentNorm = normalizeText([doc.summary, doc.content].filter(Boolean).join(" "));
  const sourceNorm = normalizeText(doc.sourceUrl || "");
  const haystack = buildDocSearchText(doc);
  const state = { score: 0, reasons: [] };

  if (queryNorm && titleNorm === queryNorm) addScore(state, 18, "title_exact");
  else if (queryNorm && titleNorm.indexOf(queryNorm) >= 0) addScore(state, 12, "title_contains_query");
  if (queryNorm && aliasTerms.indexOf(queryNorm) >= 0) addScore(state, 16, "alias_exact");
  else if (queryNorm && aliasNorm.indexOf(queryNorm) >= 0) addScore(state, 11, "alias_contains_query");
  if (queryNorm && keywordNorm.indexOf(queryNorm) >= 0) addScore(state, 8, "keyword_contains_query");
  if (queryNorm && contentNorm.indexOf(queryNorm) >= 0) addScore(state, 4, "content_contains_query");
  if (queryNorm && (categoryNorm.indexOf(queryNorm) >= 0 || categoryLabelNorm.indexOf(queryNorm) >= 0)) {
    addScore(state, 3, "category_contains_query");
  }
  if (queryNorm && sourceNorm && queryNorm.indexOf(sourceNorm) >= 0) addScore(state, 9, "source_url_exact");

  const sourceAliases = sourceDomainAliases(doc.sourceUrl);
  sourceAliases.forEach((alias) => {
    if (alias && queryNorm.indexOf(alias) >= 0) addScore(state, alias.indexOf(".") >= 0 ? 7 : 2.5, `source_domain:${alias}`);
  });

  (tokens || []).forEach((token) => {
    if (!token) return;
    if (titleNorm.indexOf(token) >= 0) addScore(state, 5.5, `title_token:${token}`);
    if (aliasNorm.indexOf(token) >= 0) addScore(state, 5, `alias_token:${token}`);
    if (keywordNorm.indexOf(token) >= 0) addScore(state, 4.2, `keyword_token:${token}`);
    if (sourceNorm.indexOf(token) >= 0 || sourceAliases.indexOf(token) >= 0) addScore(state, 3.5, `source_token:${token}`);
    if (contentNorm.indexOf(token) >= 0) addScore(state, 1.8, `content_token:${token}`);
    if (categoryNorm.indexOf(token) >= 0 || categoryLabelNorm.indexOf(token) >= 0) addScore(state, 1.4, `category_token:${token}`);
    if (entryTypeNorm.indexOf(token) >= 0) addScore(state, 1, `entry_type_token:${token}`);
    if (haystack.indexOf(token) >= 0 && token.length >= 4) addScore(state, 0.8, `haystack_token:${token}`);
  });

  const hints = CATEGORY_HINTS[doc.category] || [];
  hints.forEach((hint) => {
    const normalizedHint = normalizeText(hint);
    if (!normalizedHint) return;
    if (queryNorm.indexOf(normalizedHint) >= 0) addScore(state, 2, `category_hint:${normalizedHint}`);
  });

  const confidence = Number(doc.confidence || 0);
  if (confidence >= 0.85) addScore(state, 1.2, "high_confidence");
  if (confidence < 0.6) addScore(state, -0.8, "low_confidence_penalty");

  if (isNavigationQuery(query)) {
    if (doc.entryType === "navigation") addScore(state, 7, "navigation_intent_boost");
    else addScore(state, -1.5, "navigation_intent_penalty");
  }

  if (isKnowledgeIntroQuery(query)) {
    if (["knowledge", "faq"].indexOf(doc.entryType) >= 0) addScore(state, 4, "knowledge_intent_boost");
    if (doc.entryType === "navigation" && !isNavigationQuery(query)) addScore(state, -1.2, "knowledge_intent_navigation_penalty");
  }

  if (isHelpQuery(query)) {
    if (["app_help", "schedule_help", "weather_help", "tool_guide"].indexOf(doc.entryType) >= 0 || doc.category === "app_help") {
      addScore(state, 8, "help_intent_boost");
    } else if (/^https?:\/\//.test(String(doc.sourceUrl || ""))) {
      addScore(state, -3, "help_intent_external_penalty");
    }
  }

  return {
    score: state.score,
    matchedReason: state.reasons.join(", "),
  };
}

function isCampusKnowledgeQuery(query) {
  const value = normalizeText(query);
  if (!value) return false;
  if (isDynamicToolQuery(value)) return false;
  return /(佛大|佛山大学|fosu|校区|仙溪|江湾|河滨|教务|信息门户|统一身份|图书馆|校医院|医务室|校园卡|校园网|宿舍|后勤|报修|电话|联系方式|开放时间|办公室|办事窗口|团委|第二课堂|易班|i志愿|学院|部门|招生|就业|招聘|研究生|学报|校园|办事|学生事务|地址|在哪里|怎么进|怎么用|入口|官网|通知|公告|小佛|小序|知识库|期刊|投稿)/i.test(value);
}

function inferPreferredEntryType(query) {
  if (isNavigationQuery(query)) return "navigation";
  if (isHelpQuery(query) && /(导入|xls|excel|表格|文件)/i.test(normalizeText(query))) return "tool_guide";
  if (isHelpQuery(query)) return "app_help";
  return "";
}

function hasIntentAlignedResult(doc, query) {
  if (!doc) return false;
  const queryNorm = normalizeText(query);
  if (!hasSupportedHighRiskSubject(doc, query)) return false;
  if (isNavigationQuery(query)) return doc.entryType === "navigation";
  if (isKnowledgeIntroQuery(query)) return ["knowledge", "faq"].indexOf(doc.entryType) >= 0 || /(校区|学院|部门|概况|图书馆)/.test(queryNorm);
  if (isHelpQuery(query)) return ["app_help", "schedule_help", "weather_help", "tool_guide"].indexOf(doc.entryType) >= 0 || doc.category === "app_help";
  return true;
}

function searchKnowledge(query, options = {}) {
  if (isWeatherToolQuery(query) || isScheduleStatusToolQuery(query)) {
    return {
      query,
      tokens: [],
      results: [],
      top: null,
      hasReliableResult: false,
      blockedByToolIntent: isWeatherToolQuery(query) ? "weather" : "schedule_status",
      indexVersion: knowledgeBase.version,
      updatedAt: knowledgeBase.updatedAt,
    };
  }

  const limit = Math.min(Math.max(Number(options.limit || 4) || 4, 1), 8);
  const tokens = expandQueryTokens(query);
  const docs = Array.isArray(knowledgeBase.docs) ? knowledgeBase.docs : [];
  const preferredEntryType = options.preferredEntryType || inferPreferredEntryType(query);
  const results = docs
    .map((doc) => {
      const scored = scoreDoc(doc, query, tokens);
      let score = scored.score;
      const reasons = scored.matchedReason ? scored.matchedReason.split(/,\s*/).filter(Boolean) : [];
      if (preferredEntryType && doc.entryType === preferredEntryType) {
        score += 4;
        reasons.push(`preferred_entry_type:${preferredEntryType}`);
      }
      if (preferredEntryType && doc.entryType && doc.entryType !== preferredEntryType) score -= 0.8;
      const reliable = score >= MIN_RELIABLE_SCORE &&
        Number(doc.confidence || 0) >= 0.55 &&
        hasIntentAlignedResult(doc, query);
      return Object.assign({}, doc, {
        score,
        reliable,
        matchedReason: reasons.filter((item, index) => reasons.indexOf(item) === index).join(", "),
      });
    })
    .filter((doc) => doc.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Number(right.confidence || 0) - Number(left.confidence || 0);
    })
    .slice(0, limit);
  const top = results[0] || null;
  return {
    query,
    tokens,
    results,
    top,
    hasReliableResult: Boolean(top && top.reliable),
    indexVersion: knowledgeBase.version,
    updatedAt: knowledgeBase.updatedAt,
  };
}

module.exports = {
  MIN_RELIABLE_SCORE,
  expandQueryTokens,
  isCampusKnowledgeQuery,
  isDynamicToolQuery,
  isNavigationQuery,
  normalizeText,
  searchKnowledge,
  tokenize,
};

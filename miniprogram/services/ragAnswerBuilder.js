const ragRetriever = require("./ragRetriever");
const contextManager = require("./xiaofuContextManager");

function safeText(value, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  return text.slice(0, maxLength || 200);
}

function isLocalUrl(url) {
  return /^\/pages\//.test(String(url || ""));
}

function isExternalUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function formatConfidence(confidence) {
  const value = Number(confidence || 0);
  if (value >= 0.85) return "高可信";
  if (value >= 0.65) return "可参考";
  return "待核验";
}

function displayCategory(doc) {
  return safeText(doc && (doc.categoryLabel || doc.category) || "", 40);
}

function firstRelatedLink(doc) {
  const links = Array.isArray(doc && doc.relatedLinks) ? doc.relatedLinks : [];
  return links.find((link) => link && link.url) || null;
}

function buildEntryAction(link, fallbackUrl, fallbackLabel) {
  const url = safeText(link && link.url || fallbackUrl || "", 260);
  const label = safeText(link && link.label || fallbackLabel || "相关入口", 18);
  if (!url) return null;
  if (isLocalUrl(url)) {
    return {
      label: label.indexOf("打开") === 0 ? label : `打开${label}`,
      type: "navigate",
      url,
      payload: {},
    };
  }
  if (isExternalUrl(url)) {
    return {
      label: label.indexOf("打开") === 0 ? label : `打开${label}`,
      type: "navigate",
      url,
      payload: {},
    };
  }
  return null;
}

function uniqueActions(actions) {
  const seen = {};
  return actions.filter(Boolean).filter((action) => {
    const key = [
      action.type,
      action.url || "",
      action.label || "",
      action.payload && action.payload.text || "",
      action.payload && action.payload.message || "",
    ].join("|");
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function buildRelatedActions(doc, mode) {
  const actions = [];
  const primaryLink = firstRelatedLink(doc);
  const entryAction = buildEntryAction(primaryLink, doc.sourceUrl, primaryLink && primaryLink.label || doc.title || "入口");
  if (entryAction) actions.push(entryAction);
  const followup = mode === "navigation"
    ? `${safeText(doc.title, 40)}怎么用`
    : `${safeText(doc.title, 40)}还有哪些相关入口`;
  actions.push({
    label: "继续追问",
    type: "ask",
    payload: { message: followup },
  });
  return uniqueActions(actions).slice(0, 4);
}

function buildKnowledgeCard(doc, query) {
  const category = displayCategory(doc) || "佛山大学校园信息";
  const items = [
    {
      title: "摘要",
      subtitle: safeText(doc.summary || doc.content, 220),
      value: "",
    },
  ];
  if (doc.sourceUrl) {
    items.push({
      title: "信息来源",
      subtitle: safeText(doc.sourceUrl, 180),
      value: "",
    });
  }
  if (doc.updatedAt) {
    items.push({
      title: "更新时间",
      subtitle: doc.updatedAt,
      value: "",
    });
  }
  return {
    type: "school_knowledge",
    title: safeText(doc.title || query || "校园信息", 80),
    subtitle: category,
    badges: [category, formatConfidence(doc.confidence)].filter(Boolean),
    items,
    actions: buildRelatedActions(doc, "knowledge"),
    sourceUrl: doc.sourceUrl || "",
    updatedAt: doc.updatedAt || "",
  };
}

function buildNavigationCard(doc, query) {
  const category = displayCategory(doc) || "佛山大学校园入口";
  const items = [
    {
      title: "入口说明",
      subtitle: safeText(doc.summary || doc.content, 220),
      value: "",
    },
  ];
  if (doc.sourceUrl) {
    items.push({
      title: "信息来源",
      subtitle: safeText(doc.sourceUrl, 180),
      value: "",
    });
  }
  if (doc.updatedAt) {
    items.push({
      title: "更新时间",
      subtitle: doc.updatedAt,
      value: "",
    });
  }
  return {
    type: "navigation",
    title: safeText(doc.title || query || "校园入口", 80),
    subtitle: category,
    badges: ["入口", category, formatConfidence(doc.confidence)].filter(Boolean),
    items,
    actions: buildRelatedActions(doc, "navigation"),
    sourceUrl: doc.sourceUrl || "",
    updatedAt: doc.updatedAt || "",
  };
}

function buildNoResultCard(query) {
  return {
    type: "school_knowledge",
    variant: "error",
    title: "暂未收录可靠信息",
    subtitle: "知识库暂未收录可靠信息",
    badges: ["校园信息", "待补充"],
    items: [
      {
        title: "你的问题",
        subtitle: safeText(query, 160),
        value: "",
      },
      {
        title: "建议",
        subtitle: "我不会用学校概况或官网链接替代未收录的信息；请换一种更具体的问法，或等待知识库补充可靠来源。",
        value: "",
      },
    ],
    actions: [],
  };
}

function buildAnswerText(doc, query) {
  if (!doc) {
    return "知识库暂未收录可靠信息。我不会用学校概况或官网链接替代答案，也不会编造电话、开放时间、办公室或制度细节。";
  }
  const sourceText = doc.sourceUrl ? `\n\n信息来源：${doc.sourceUrl}` : "";
  const updatedText = doc.updatedAt ? `\n更新时间：${doc.updatedAt}` : "";
  const prefix = doc.entryType === "navigation"
    ? "已根据关键词匹配到相关校园入口。"
    : "已匹配到以下佛山大学校园信息。";
  return `${prefix}${doc.summary || doc.content}${sourceText}${updatedText}`;
}

function isLocationFollowup(message) {
  const value = String(message || "").replace(/\s+/g, "");
  return /^(这个|这个教室|这间|那里|那|它)?(在哪|在哪里|位置|怎么去|怎么走|怎么进去|入口在哪)/.test(value);
}

function getContextLocationTarget(contextSlots) {
  const context = contextManager.normalizeContextSlots(contextSlots);
  const result = context.lastQueryResult && typeof context.lastQueryResult === "object" && !Array.isArray(context.lastQueryResult)
    ? context.lastQueryResult
    : {};
  if (context.lastTargetType === "room" && context.lastTargetName) return context.lastTargetName;
  return result.primaryClassroom || result.classroom || result.roomName || "";
}

function tryBuildContextNavigationAnswer(message, clientContext = {}) {
  const query = safeText(message, 200);
  if (!isLocationFollowup(query)) return null;
  const currentContext = clientContext.contextSlots ||
    clientContext.conversation && clientContext.conversation.contextSlots ||
    {};
  const targetName = safeText(getContextLocationTarget(currentContext), 80);
  if (!targetName) return null;
  const nextContext = contextManager.mergeContextSlots(currentContext, {
    lastIntent: "navigation",
    lastTargetType: "navigation",
    lastTargetName: targetName,
    lastWeek: null,
    lastWeekday: null,
    lastQueryResult: {
      title: `${targetName}位置`,
      targetName,
    },
    lastSource: "campus-map",
  });
  return {
    answer: `已根据当前查询记录匹配到 ${targetName} 的位置需求。可通过校园地图入口查看；具体楼层、门禁和临时调整以现场指引为准。`,
    cards: [
      {
        type: "navigation",
        title: `${targetName}位置`,
        subtitle: "校园地图",
        badges: ["校园地图", "需现场核验"],
        items: [
          {
            title: "理解的对象",
            subtitle: targetName,
            value: "",
          },
          {
            title: "说明",
            subtitle: "小程序可跳到校园地图查看楼栋和区域；具体教室门禁、入口和临时调整以现场指引为准。",
            value: "",
          },
        ],
        actions: [
          { label: "打开校园地图", type: "navigate", url: "/pages/campus-map/campus-map" },
        ],
      },
    ],
    suggestions: ["打开校园地图", "查看完整课表", "教务系统在哪里进"],
    toolCalls: [
      {
        name: "fosu_rag_retrieve",
        status: "success",
      },
    ],
    evidence: {
      verified: false,
      source: "campus-map",
      checkedAt: new Date().toISOString(),
    },
    safety: {
      provider: "local-rag",
      resolvedProvider: "local-rag",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: "navigation_followup",
      latencyMs: 0,
      externalProviderUsed: false,
      resultCount: 1,
    },
    contextSlots: nextContext,
  };
}

function tryBuildKnowledgeAnswer(message, clientContext = {}, options = {}) {
  const query = safeText(message, 300);
  if (!ragRetriever.isCampusKnowledgeQuery(query)) return null;
  const startedAt = Date.now();
  const retrieval = ragRetriever.searchKnowledge(query, {
    limit: 4,
    preferredEntryType: options.preferredEntryType || "",
  });
  const top = retrieval.hasReliableResult ? retrieval.top : null;
  const isNavigation = Boolean(top && top.entryType === "navigation") || options.intentName === "navigation";
  const cards = [top ? (isNavigation ? buildNavigationCard(top, query) : buildKnowledgeCard(top, query)) : buildNoResultCard(query)];
  const response = {
    answer: buildAnswerText(top, query),
    cards,
    suggestions: top
      ? ["教务系统在哪里", "佛大有哪些校区", "课表数据是否最新"].filter((item) => item !== query).slice(0, 3)
      : ["佛大有哪些校区", "教务系统在哪里", "课表数据是否最新"],
    toolCalls: [
      {
        name: "fosu_rag_retrieve",
        status: top ? "success" : "not_found",
      },
    ],
    taskSteps: [],
    evidence: {
      verified: Boolean(top && top.sourceUrl),
      source: top && top.sourceUrl || "fosu-rag-knowledge-base",
      checkedAt: new Date().toISOString(),
      knowledgeBaseVersion: retrieval.indexVersion,
      resultCount: retrieval.results.length,
    },
    safety: {
      provider: "local-rag",
      resolvedProvider: "local-rag",
      externalProviderUsed: false,
      mode: "tool-grounded",
      clearPendingClarification: true,
    },
    metrics: {
      intentName: isNavigation ? "navigation" : "school_knowledge",
      latencyMs: Date.now() - startedAt,
      externalProviderUsed: false,
      resultCount: retrieval.results.length,
      ragMatchedReason: top && top.matchedReason || "",
    },
    contextSlots: contextManager.mergeContextSlots(
      clientContext && clientContext.contextSlots || clientContext && clientContext.conversation && clientContext.conversation.contextSlots,
      (isNavigation ? contextManager.buildNavigationPatch : contextManager.buildKnowledgePatch)({
        title: top && top.title || query,
        sourceUrl: top && top.sourceUrl || "",
        confidence: top && top.confidence || "",
        query,
      })
    ),
  };
  return response;
}

module.exports = {
  buildKnowledgeCard,
  buildNavigationCard,
  tryBuildContextNavigationAnswer,
  tryBuildKnowledgeAnswer,
};

/**
 * Unified Response Composer.
 * Decides what the user actually sees — not what the provider dumped.
 */

const capabilityManifestService = require("../capabilityManifestService");
const safetyGuard = require("../safetyGuard");

const PRESENTATION_MODES = Object.freeze([
  "plain",
  "single_card",
  "multi_card",
  "clarification",
  "recovery",
]);

const GENERIC_CARD_TITLES = /^(小佛助手|小佛校园助手|结果|助手)$/;
const GENERIC_CARD_SUBTITLES = /智能体表达层|来自智能体|自然对话/;
const FIXED_SUGGESTIONS = new Set([
  "你能做什么",
  "怎么导入个人课表",
  "怎么导入个人课表？",
  "现在有空教室吗",
  "现在有空教室吗？",
  "今天有什么课",
  "现在第几教学周",
  "现在第几教学周？",
  "找空教室",
  "查今日课程",
  "查空教室",
  "佛课小表怎么用？",
  "查班级本周课表",
  "仙溪校区今天会下雨吗",
]);

function safeText(value, max = 1200) {
  return safetyGuard.redactSensitiveText(String(value == null ? "" : value)).slice(0, max);
}

function isGenericExpressionCard(card) {
  if (!card || typeof card !== "object") return true;
  const type = String(card.type || "generic");
  const title = String(card.title || "");
  const subtitle = String(card.subtitle || "");
  if (type === "generic" && GENERIC_CARD_TITLES.test(title)) return true;
  if (GENERIC_CARD_SUBTITLES.test(subtitle)) return true;
  if (type === "generic" && (!card.items || !card.items.length) && /表达层|自然对话/.test(
    `${title}${subtitle}${(card.badges || []).join("")}`
  )) return true;
  return false;
}

function isFactIntent(intentName) {
  const intent = capabilityManifestService.getIntent(intentName);
  return Boolean(intent && intent.factualTask);
}

function isConversationalIntent(intentName) {
  return ["conversational_help", "project_qa", "generic"].includes(String(intentName || ""));
}

function filterCards(cards, options = {}) {
  const list = Array.isArray(cards) ? cards.slice() : [];
  const cleaned = list.filter((card) => {
    if (!card) return false;
    if (options.stripGeneric && isGenericExpressionCard(card)) return false;
    return true;
  });
  const max = Number(options.maxCards || 2) || 2;
  return cleaned.slice(0, max);
}

function relatedSuggestions(input = {}) {
  const intentName = String(input.intentName || (input.intent && input.intent.name) || "");
  const provided = Array.isArray(input.suggestions) ? input.suggestions : [];
  const filtered = provided
    .map((item) => safeText(item, 40))
    .filter(Boolean)
    .filter((item) => !FIXED_SUGGESTIONS.has(item) || provided.length <= 1);

  if (filtered.length) return filtered.slice(0, 3);

  // Context-related defaults — never the fixed global three for every reply.
  if (intentName === "get_today_courses" || intentName === "get_tomorrow_courses") {
    return ["下一节课在哪", "本周课表", "查空教室"].slice(0, 3);
  }
  if (/empty_room/.test(intentName)) {
    return ["连续两节空教室", "换个楼栋", "今天有什么课"].slice(0, 3);
  }
  if (intentName === "get_teaching_week") {
    return ["本周课表", "查空教室", "校历"].slice(0, 3);
  }
  if (intentName === "get_campus_weather") {
    return ["明天天气", "下一节课", "仙溪空教室"].slice(0, 3);
  }
  if (intentName === "clarify_missing_slot") {
    return (input.clarification && input.clarification.suggestions) || ["查班级课表", "查教师课表", "查空教室"];
  }
  if (isConversationalIntent(intentName)) {
    // Greetings: at most one light follow-up; never force the fixed campus trio.
    return filtered.length ? filtered.slice(0, 2) : ["你能帮我做什么"].slice(0, 1);
  }
  return filtered.slice(0, 2);
}

function buildEvidenceSummary(input = {}) {
  if (input.showEvidence === false) return null;
  const evidence = input.evidence || {};
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const factTools = toolCalls.filter((c) => c && c.status !== "failed" && c.name && c.name !== "provider_chain");
  if (!factTools.length && !evidence.complete) return null;

  const week = evidence.teachingWeek || input.context && input.context.currentTeachingWeek;
  const checkedAt = evidence.checkedAt || new Date().toISOString();
  const timeLabel = (() => {
    try {
      const d = new Date(checkedAt);
      if (Number.isNaN(d.getTime())) return "";
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch (_) {
      return "";
    }
  })();

  const compactParts = ["已核验"];
  if (week) compactParts.push(`第 ${week} 教学周`);
  if (timeLabel) compactParts.push(timeLabel);

  return {
    compact: compactParts.join(" · "),
    expanded: {
      dataType: evidence.dataType || (input.intentName || "campus_fact"),
      term: evidence.term || (input.context && input.context.term) || "",
      teachingWeek: week || null,
      releaseVersion: evidence.releaseVersion || (input.context && input.context.releaseVersion) || "",
      checkedAt,
      sources: Array.isArray(evidence.sources) ? evidence.sources.slice(0, 6) : factTools.map((t) => ({
        tool: t.name,
        summary: t.summary || "",
      })),
    },
    defaultCollapsed: true,
  };
}

const TOOL_PUBLIC_LABELS = Object.freeze({
  get_today_courses: "读取今日课表",
  get_tomorrow_courses: "读取明日课表",
  get_next_course: "查询下一节课",
  get_week_schedule: "读取本周课表",
  get_teaching_week: "读取教学周",
  search_empty_rooms: "查询空教室",
  search_continuous_empty_rooms: "查询连续空教室",
  get_campus_weather: "获取校区天气",
  search_campus_place: "查找校园地点",
  get_classroom_location: "查询教室位置",
  search_school_index: "检索全校课表",
  rag_search: "检索公开知识",
  clarify_missing_slot: "确认缺失信息",
  diagnose_data_status: "诊断数据状态",
  explain_personal_import: "说明课表导入",
});

function publicToolLabel(name) {
  const key = String(name || "");
  return TOOL_PUBLIC_LABELS[key] || (key ? `执行 ${key}` : "执行步骤");
}

function buildTaskTrajectory(input = {}) {
  const plan = input.plan || {};
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const message = safeText(input.userMessage || input.message || plan.goal || "", 120);
  const intentName = String(input.intentName || (input.intent && input.intent.name) || plan.intent || "");
  if (isConversationalIntent(intentName) && !steps.length && !toolCalls.length) {
    return null;
  }
  const understanding = message
    || (intentName ? `处理任务：${intentName}` : "理解你的需求");
  const planSteps = (plan.steps || steps || []).slice(0, 5).map((step, index) => ({
    index: index + 1,
    label: publicToolLabel(step.toolName || step.tool || step.label || step.name),
  }));
  const execution = (steps.length ? steps : toolCalls).slice(0, 6).map((step) => {
    const tool = step.tool || step.name || step.toolName || "";
    const ok = step.status !== "failed" && step.status !== "error";
    return {
      label: publicToolLabel(tool || step.label),
      status: ok ? "success" : "failed",
      summary: safeText(step.summary || "", 80),
    };
  });
  if (!planSteps.length && !execution.length) return null;
  return {
    understanding: safeText(understanding, 160),
    plan: planSteps,
    execution,
    verification: execution.length
      ? "结果来自对应校园工具，未使用模型编造事实。"
      : "",
    plannerType: plan.plannerType || "",
    replanUsed: input.replanUsed === true,
  };
}

function buildRunSummary(input = {}) {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const factTools = toolCalls.filter((c) => c && c.name && c.name !== "provider_chain" && c.status !== "failed");
  const durationMs = Number(input.durationMs || input.metrics && input.metrics.totalDurationMs || 0) || 0;
  const seconds = durationMs > 0 ? (durationMs / 1000).toFixed(1) : "";
  const plan = input.plan || {};
  const isModelPlan = plan.plannerType === "model" || plan.plannerType === "model_replan";
  if (!steps.length && !input.replanUsed && !factTools.length) {
    return null;
  }
  const parts = ["已完成"];
  if (input.replanUsed) parts.push("调整过 1 次方案");
  else if (isModelPlan) parts.push("增强规划");
  if (steps.length) parts.push(`${steps.length} 个步骤`);
  else if (factTools.length) parts.push(`查询了 ${factTools.length} 项校园数据`);
  if (seconds) parts.push(`${seconds} 秒`);
  return {
    compact: parts.join(" · "),
    status: input.status || "completed",
    stepCount: steps.length || factTools.length,
    replanUsed: input.replanUsed === true,
    enhanced: isModelPlan,
    defaultCollapsed: true,
    steps: steps.map((step) => ({
      id: step.id,
      label: safeText(step.label || publicToolLabel(step.tool), 80),
      status: step.status,
      durationMs: step.durationMs,
    })),
  };
}

function answerAvoidsCardDuplication(answer, cards) {
  const text = String(answer || "").trim();
  if (!text || !cards || !cards.length) return text;
  // If answer is basically the same as first card title+items dump, keep short conclusion style
  const first = cards[0];
  const cardBlob = [first.title, first.subtitle]
    .concat((first.items || []).map((i) => `${i.title || ""}${i.subtitle || ""}${i.value || ""}`))
    .join("");
  if (text.length > 80 && cardBlob && text.replace(/\s/g, "").includes(String(first.title || "").replace(/\s/g, ""))
    && (first.items || []).length >= 2 && text.length > cardBlob.length * 0.8) {
    return safeText(first.subtitle || first.title || text.slice(0, 80), 200);
  }
  return text;
}

/**
 * Compose final presentation payload.
 */
function compose(input = {}) {
  const intentName = String(input.intentName || (input.intent && input.intent.name) || "conversational_help");
  const runtimeMode = capabilityManifestService.normalizeRuntimeMode(input.runtimeMode || "public");
  const errors = Array.isArray(input.errors) ? input.errors : [];
  const hasError = input.success === false || input.status === "failed"
    || errors.some((e) => e && (e.code === "RECOVERY" || e.fatal));
  const isClarification = intentName === "clarify_missing_slot"
    || input.needsClarification === true
    || (input.plan && input.plan.needsClarification);

  let presentationMode = "plain";
  let cards = Array.isArray(input.cards) ? input.cards.slice() : [];
  let answer = safeText(input.answer, 2000);
  let evidence = null;
  let runSummary = null;
  let actions = Array.isArray(input.actions) ? input.actions.slice(0, 4) : [];

  // Strip provider generic expression cards always
  cards = filterCards(cards, { stripGeneric: true, maxCards: 6 });

  if (hasError && !answer) {
    presentationMode = "recovery";
    answer = safeText(input.recoveryMessage || "刚才出了点问题，可以换个说法再试一次。", 200);
    cards = filterCards(cards, { stripGeneric: true, maxCards: 1 });
  } else if (isClarification) {
    presentationMode = "clarification";
    cards = filterCards(cards, { stripGeneric: true, maxCards: 1 });
    if (!answer && input.clarification && input.clarification.prompt) {
      answer = safeText(input.clarification.prompt, 200);
    }
  } else if (isConversationalIntent(intentName) || (input.generalAssistant === true && !isFactIntent(intentName))) {
    presentationMode = "plain";
    cards = []; // no generic / tool cards for plain chat
    evidence = null;
    runSummary = null;
  } else if (isFactIntent(intentName) || cards.length) {
    const factCards = cards.filter((c) => c && c.type !== "guide" || (c.items && c.items.length));
    if (factCards.length > 1 || (input.toolCalls || []).filter((t) => t && t.name !== "provider_chain").length > 1) {
      presentationMode = "multi_card";
      cards = filterCards(cards, { stripGeneric: true, maxCards: 2 });
    } else {
      presentationMode = "single_card";
      cards = filterCards(cards, { stripGeneric: true, maxCards: 1 });
    }
    answer = answerAvoidsCardDuplication(answer, cards);
    evidence = buildEvidenceSummary({
      ...input,
      intentName,
      showEvidence: true,
    });
    runSummary = buildRunSummary(input);
  } else {
    presentationMode = "plain";
    cards = [];
  }

  // public: never mention models
  if (runtimeMode === "public") {
    answer = answer
      .replace(/DeepSeek|Coze|Hunyuan|混元|大模型|GPT|OpenAI/gi, "小佛助手")
      .replace(/我是(?:一个)?(?:AI|人工智能|语言模型).{0,20}/g, "我是小佛校园助手，");
  }

  const suggestions = relatedSuggestions({
    intentName,
    suggestions: input.suggestions,
    clarification: input.clarification || (input.plan && input.plan.clarification),
  });

  // Compact feedback contract for client
  const feedback = {
    style: "compact",
    primary: ["helpful", "not_helpful"],
    detailOnNegative: ["unresolved", "stale", "misunderstood"],
  };

  const taskTrajectory = presentationMode === "plain"
    ? null
    : buildTaskTrajectory({
      ...input,
      intentName,
      plan: input.plan,
      steps: input.steps,
      toolCalls: input.toolCalls,
      replanUsed: input.replanUsed,
    });

  return {
    presentationMode: PRESENTATION_MODES.includes(presentationMode) ? presentationMode : "plain",
    answer,
    cards,
    evidence,
    actions,
    suggestions,
    runSummary,
    taskTrajectory,
    feedback,
    meta: {
      intentName,
      runtimeMode,
      strippedGenericCards: true,
      composer: "responseComposer.v1",
    },
  };
}

/**
 * Wrap plain text provider output without generic card spam.
 */
function wrapPlainText(content, options = {}) {
  const answer = safeText(content, 1200);
  if (!answer) {
    const error = new Error("Provider returned empty text.");
    error.code = "INVALID_PROVIDER_TEXT";
    throw error;
  }
  return compose({
    answer,
    cards: [],
    suggestions: options.suggestions || [],
    intentName: options.intentName || "conversational_help",
    runtimeMode: options.runtimeMode || "trial",
    generalAssistant: options.generalAssistant === true,
    toolCalls: [],
    steps: [],
  });
}

module.exports = {
  PRESENTATION_MODES,
  compose,
  wrapPlainText,
  isGenericExpressionCard,
  filterCards,
  relatedSuggestions,
  buildEvidenceSummary,
  buildTaskTrajectory,
  buildRunSummary,
  publicToolLabel,
};

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
  get_today_courses: "正在读取今日课表",
  get_tomorrow_courses: "正在读取明日课表",
  get_next_course: "正在查询下一节课",
  get_week_schedule: "正在读取本周课表",
  get_teaching_week: "正在读取教学周",
  search_empty_rooms: "正在查询空教室",
  search_continuous_empty_rooms: "正在查询连续空教室",
  get_campus_weather: "正在获取校区天气",
  search_campus_place: "正在查找校园地点",
  get_classroom_location: "正在查询教室位置",
  search_school_index: "正在匹配课表目标",
  get_schedule_detail: "正在读取课表",
  set_current_schedule: "正在设置首页课表",
  open_schedule: "正在打开课表",
  rag_search: "正在检索公开知识",
  clarify_missing_slot: "需要补充信息",
  diagnose_data_status: "正在诊断数据状态",
  explain_personal_import: "说明课表导入",
  campus_multi_step_advice: "正在组合校园建议",
});

const DOMAIN_FAILURE_MESSAGES = Object.freeze({
  CLASS_NOT_FOUND: "未匹配到班级，请换个班级名称再试。",
  MULTIPLE_CANDIDATES: "找到多个候选，请选择其中一个。",
  MISSING_DETAIL_ID: "缺少课表详情编号，无法继续打开。",
  ACTION_NOT_EXECUTED: "客户端尚未执行该操作。",
  RECEIPT_TIMEOUT: "等待操作回执超时，请重试一次。",
  RELEASE_VERSION_MISMATCH: "数据版本不一致，请下拉刷新后重试。",
  TEACHER_NOT_FOUND: "未匹配到教师，请检查姓名或学院筛选。",
  TOOL_FAILED: "校园工具执行失败，请稍后重试。",
});

function publicToolLabel(name) {
  const key = String(name || "");
  if (TOOL_PUBLIC_LABELS[key]) return TOOL_PUBLIC_LABELS[key];
  // Never surface raw snake_case tool names to users.
  if (/^[a-z0-9_]+$/.test(key)) {
    if (/class|schedule/.test(key)) return "正在处理课表";
    if (/teacher/.test(key)) return "正在匹配教师";
    if (/weather/.test(key)) return "正在获取天气";
    if (/room/.test(key)) return "正在查询教室";
    return "正在处理校园任务";
  }
  return key ? safeText(key, 40) : "执行步骤";
}

function domainFailureMessage(code, fallback) {
  const key = String(code || "");
  return DOMAIN_FAILURE_MESSAGES[key] || safeText(fallback || DOMAIN_FAILURE_MESSAGES.TOOL_FAILED, 120);
}

function stripZeroMeaningPartitions(cards) {
  return (Array.isArray(cards) ? cards : []).map((card) => {
    if (!card || typeof card !== "object") return card;
    const next = Object.assign({}, card);
    if (Array.isArray(next.items)) {
      next.items = next.items.filter((item) => {
        if (!item) return false;
        const value = item.value != null ? item.value : item.count;
        const title = String(item.title || item.label || "");
        // Hide "明日课程 0 / 空教室 0 / 地点 0" style noise with no business meaning.
        if ((value === 0 || value === "0") && /课程|空教室|地点|教室|结果/.test(title)) {
          return false;
        }
        return true;
      });
    }
    if (Array.isArray(next.sections)) {
      next.sections = next.sections.filter((sec) => {
        const count = Number(sec && (sec.count != null ? sec.count : sec.total));
        if (count === 0 && !sec.keepEmpty) return false;
        return true;
      });
    }
    return next;
  }).filter((card) => {
    if (!card) return false;
    if (Array.isArray(card.items) && !card.items.length && !card.title) return false;
    return true;
  });
}

function countIndependentSuccessfulGoals(input = {}) {
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const success = toolCalls.filter((c) => c && c.name && c.name !== "provider_chain" && c.status !== "failed" && !(c.result && c.result.success === false));
  const goals = new Set(success.map((c) => {
    const n = String(c.name || "");
    if (/weather/.test(n)) return "weather";
    if (/empty_room/.test(n)) return "empty_room";
    if (/schedule|school_index|today|tomorrow|next_course/.test(n)) return "schedule";
    if (/place|location|map/.test(n)) return "place";
    return n;
  }));
  return goals.size;
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
    || (intentName ? publicToolLabel(intentName) : "理解你的需求");
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
    // Do not expose plannerType / Evidence labels to default UI.
    plannerType: "",
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
  cards = stripZeroMeaningPartitions(cards);

  // Domain failure answers — never dump generic capability cards on tool failure.
  if (hasError || (input.toolFailure && input.toolFailure.code)) {
    const failCode = (input.toolFailure && input.toolFailure.code)
      || (errors[0] && (errors[0].code || errors[0].reasonCode))
      || "";
    if (!answer || /小佛可以|你能做什么|校园工具/.test(answer)) {
      answer = domainFailureMessage(failCode, input.recoveryMessage || input.answer);
    }
    presentationMode = "recovery";
    cards = filterCards(cards.filter((c) => c && !isGenericExpressionCard(c) && c.type !== "guide"), {
      stripGeneric: true,
      maxCards: 1,
    });
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
    const independentGoals = countIndependentSuccessfulGoals(input);
    const factTools = (input.toolCalls || []).filter((t) => t && t.name !== "provider_chain" && t.status !== "failed");
    // 「组合任务」仅当 ≥2 个独立目标成功；纯天气不得挂课程/空教室 0 分区。
    const allowMulti = independentGoals >= 2;
    if (allowMulti && (cards.length > 1 || factTools.length > 1)) {
      presentationMode = "multi_card";
      cards = filterCards(cards, { stripGeneric: true, maxCards: 2 });
    } else {
      presentationMode = "single_card";
      cards = filterCards(cards, { stripGeneric: true, maxCards: 1 });
    }
    // Weather-only: drop unrelated empty partitions
    if (intentName === "get_campus_weather" || (factTools.length === 1 && /weather/.test(String(factTools[0].name || "")))) {
      cards = cards.filter((c) => {
        const t = `${c.type || ""}${c.title || ""}`;
        return !/明日课程|空教室|地点|课程\s*0/.test(t);
      });
      presentationMode = "single_card";
    }
    answer = answerAvoidsCardDuplication(answer, cards);
    // Evidence stays in payload for optional expand; client defaults collapsed.
    // Never force Planner/Evidence chrome for single-goal weather etc.
    evidence = input.showEvidence === false
      ? null
      : buildEvidenceSummary({ ...input, intentName, showEvidence: true });
    // Keep runSummary for factual runs (collapsed in UI); multi_card only when ≥2 goals.
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
  domainFailureMessage,
  stripZeroMeaningPartitions,
  countIndependentSuccessfulGoals,
  DOMAIN_FAILURE_MESSAGES,
};

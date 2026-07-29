/**
 * Agent Run Event catalog and user-safe loading copy.
 * Events are summaries only — never include CoT, prompts, secrets, or raw tool args.
 */

const { RUN_EVENT_TYPES: PLATFORM_RUN_EVENT_TYPES } = require("../../../../packages/agent-protocol");

const EVENT_TYPES = Object.freeze([
  "run.accepted",
  "request.sanitized",
  "understanding.started",
  "understanding.completed",
  "understanding.fallback",
  "intent.resolved",
  "skill.selected",
  "plan.created",
  "plan.replan",
  "planner.started",
  "planner.completed",
  "planner.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "provider.selected",
  "provider.started",
  "provider.completed",
  "provider.failed",
  "provider.shadow.started",
  "provider.shadow.completed",
  "provider.shadow.failed",
  "response.composing",
  "result.verifying",
  "run.completed",
  "run.degraded",
  "run.failed",
  "run.cancelled",
  "verification.started",
  "verification.completed",
]);
const PUBLIC_EVENT_TYPE_SET = new Set(EVENT_TYPES.concat(PLATFORM_RUN_EVENT_TYPES));

const TOOL_LABELS = Object.freeze({
  get_today_courses: "读取今日课表",
  get_week_courses: "读取本周课表",
  search_school_index: "检索全校课表索引",
  search_teacher: "查询教师课表",
  search_classroom: "核验教室占用",
  find_empty_classrooms: "整理可用教室",
  get_teaching_week: "读取教学周",
  get_campus_weather: "获取校区天气",
  search_published_knowledge: "检索已发布校园知识",
  get_course_location: "查询上课地点",
});

function safeText(value, max = 120) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function toolLabel(toolName) {
  const name = safeText(toolName, 80);
  return TOOL_LABELS[name] || (name ? `执行 ${name}` : "执行工具");
}

function loadingTextForEvent(event = {}, runtimeMode = "public") {
  const type = String(event.type || "");
  const intent = safeText(event.intentName || event.intent || "", 80);
  const tool = safeText(event.tool || event.toolName || "", 80);
  const enhanced = runtimeMode === "trial" || runtimeMode === "dev";

  switch (type) {
    case "runtime.entered":
      return "任务已进入 Agent Runtime";
    case "stage.started":
      return "正在执行任务阶段";
    case "stage.completed":
      return "任务阶段已完成";
    case "stage.failed":
      return "任务阶段执行失败";
    case "runtime.completed":
      return "Agent Runtime 已完成处理";
    case "run.accepted":
    case "request.sanitized":
      return intent && /weather|天气/.test(intent)
        ? "正在理解你的任务"
        : (intent && /course|课|classroom|教室|week|周/.test(intent)
          ? "正在理解你的任务"
          : "正在理解你的问题");
    case "understanding.started":
      return "正在理解你的目标";
    case "understanding.completed":
      return "已理解任务目标";
    case "understanding.fallback":
      return "增强理解暂不可用，已切换确定性理解";
    case "intent.resolved":
    case "skill.selected":
      return "正在理解你的问题";
    case "plan.created":
      return enhanced && event.plannerType === "model"
        ? "正在增强理解"
        : "正在制定计划";
    case "plan.replan":
      return "正在调整方案";
    case "planner.started":
      return enhanced ? "正在进行增强分析" : "正在制定计划";
    case "planner.completed":
      return "计划已就绪";
    case "planner.failed":
      return "增强规划暂不可用，改用本地计划";
    case "tool.started":
      if (/weather/i.test(tool) || intent === "get_campus_weather") return "正在获取校区天气";
      if (/empty|classroom/i.test(tool) || /empty_classroom|search_classroom/.test(tool)) return "正在核验教室占用";
      if (/knowledge|rag/i.test(tool)) return "正在检索已发布校园知识";
      if (/week|teaching/i.test(tool)) return "正在读取教学周";
      return toolLabel(tool) || "正在读取课表数据";
    case "tool.completed":
      if (/weather/i.test(tool)) return "正在整理出行建议";
      if (/empty|classroom/i.test(tool)) return "正在整理可用教室";
      if (/knowledge|rag/i.test(tool)) return "正在整理来源";
      return "正在核验结果";
    case "tool.failed":
      return "工具执行受阻，正在改用本地能力";
    case "provider.selected":
      return enhanced ? "正在准备增强理解" : "正在准备回答";
    case "provider.started":
      // Only show "enhanced analysis" when a real provider call started — never fake Thinking
      return enhanced ? "正在进行增强分析" : "正在组织回答";
    case "provider.completed":
      return "正在组织回答";
    case "provider.failed":
      return "增强理解暂不可用";
    case "provider.shadow.started":
      return "正在执行推理层影子评估";
    case "provider.shadow.completed":
      return "推理层影子评估已完成";
    case "provider.shadow.failed":
      return "推理层影子评估未完成";
    case "response.composing":
      return enhanced && event.providerUsed === true
        ? "正在组织回答"
        : "正在准备回答";
    case "result.verifying":
      return "正在核验结果";
    case "verification.started":
      return "正在核验结果";
    case "verification.completed":
      if (event.status === "failed") return "结果核验未通过";
      if (event.status === "partial") return "部分结果已通过核验";
      return "结果已核验";
    case "run.degraded":
      return "已切换到本地能力";
    case "run.completed":
      return "已完成";
    case "run.failed":
      return "任务未能完成";
    case "run.cancelled":
      return "已取消";
    default:
      return "正在处理";
  }
}

function publicEventSummary(event = {}) {
  const type = PUBLIC_EVENT_TYPE_SET.has(String(event.type || "")) ? String(event.type) : "run.accepted";
  const publicMode = String(event.runtimeMode || "public") === "public";
  return {
    type,
    sequence: Math.max(0, Number(event.sequence || 0) || 0),
    at: String(event.at || new Date().toISOString()),
    intentName: safeText(event.intentName || "", 80),
    skillId: safeText(event.skillId || "", 80),
    tool: safeText(event.tool || event.toolName || "", 80),
    status: safeText(event.status || "", 32),
    reasonCode: publicMode ? "" : safeText(event.reasonCode || "", 80),
    provider: publicMode ? "" : safeText(event.provider || "", 40),
    purpose: publicMode ? "" : safeText(event.purpose || "", 32),
    understandingSource: publicMode ? "" : safeText(event.understandingSource || "", 40),
    stage: safeText(event.stage || "", 40),
    runtimePackage: safeText(event.runtimePackage || "", 100),
    configVersion: safeText(event.configVersion || "", 128),
    durationMs: Math.max(0, Number(event.durationMs || 0) || 0),
    latencyMs: Math.max(0, Number(event.latencyMs || 0) || 0),
    providerUsed: publicMode ? false : event.providerUsed === true,
    success: event.success !== false,
    fallback: event.fallback === true,
    partialCompletion: event.partialCompletion === true,
    verificationOk: event.verificationOk === false ? false : (event.verificationOk === true ? true : null),
    errorCount: Math.max(0, Number(event.errorCount || 0) || 0),
    // M2-T2 additive fields for verification.* events; 0 for all other events.
    toolCount: Math.max(0, Number(event.toolCount || 0) || 0),
    violationCount: Math.max(0, Number(event.violationCount || 0) || 0),
    label: safeText(event.label || loadingTextForEvent(event, event.runtimeMode || "public"), 120),
  };
}

module.exports = {
  EVENT_TYPES,
  TOOL_LABELS,
  loadingTextForEvent,
  publicEventSummary,
  toolLabel,
};

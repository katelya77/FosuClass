/**
 * Agent Run Event catalog and user-safe loading copy.
 * Events are summaries only — never include CoT, prompts, secrets, or raw tool args.
 */

const EVENT_TYPES = Object.freeze([
  "run.accepted",
  "request.sanitized",
  "intent.resolved",
  "skill.selected",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "provider.selected",
  "provider.started",
  "provider.completed",
  "provider.failed",
  "response.composing",
  "result.verifying",
  "run.completed",
  "run.degraded",
  "run.failed",
  "run.cancelled",
]);

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
    case "run.accepted":
    case "request.sanitized":
      return intent && /weather|天气/.test(intent)
        ? "正在理解你的任务"
        : (intent && /course|课|classroom|教室|week|周/.test(intent)
          ? "正在理解你的任务"
          : "正在理解你的问题");
    case "intent.resolved":
    case "skill.selected":
      return "正在理解你的问题";
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
      return enhanced ? "Thinking · 正在使用增强理解" : "正在组织回答";
    case "provider.completed":
      return "正在组织回答";
    case "provider.failed":
      return "增强理解暂不可用";
    case "response.composing":
      return enhanced && event.providerUsed === true
        ? "正在组织回答"
        : "正在准备回答";
    case "result.verifying":
      return "正在核验结果";
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
  const type = EVENT_TYPES.includes(String(event.type || "")) ? String(event.type) : "run.accepted";
  return {
    type,
    sequence: Math.max(0, Number(event.sequence || 0) || 0),
    at: String(event.at || new Date().toISOString()),
    intentName: safeText(event.intentName || "", 80),
    skillId: safeText(event.skillId || "", 80),
    tool: safeText(event.tool || event.toolName || "", 80),
    status: safeText(event.status || "", 32),
    reasonCode: safeText(event.reasonCode || "", 80),
    providerUsed: event.providerUsed === true,
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

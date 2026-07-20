const PUBLIC_TOOL_LABELS = {
  search_empty_rooms: "查询空教室",
  get_today_courses: "查询今日课程",
  get_tomorrow_courses: "查询明日课程",
  get_next_course: "查询下一节课",
  get_week_schedule: "查询本周课表",
  get_teaching_week: "查询教学周",
  get_term_calendar: "查询校历",
  search_continuous_empty_rooms: "查询连续空教室",
  search_school_index: "查询全校课程",
  get_schedule_detail: "查询课表详情",
  diagnose_data_status: "检查数据状态",
  explain_personal_import: "说明个人课表导入",
  recommend_meeting_time: "推荐空闲时间",
  clarify_missing_slot: "补充查询条件",
  get_campus_weather: "查询校区天气",
  get_course_weather_advice: "查询天气建议",
  search_campus_place: "查询校园地图",
  get_campus_route: "查询校园地图",
  get_classroom_location: "查询校园地图",
  safety_guard: "安全检查",
};

function publicToolLabel(name) {
  const key = String(name || "").toLowerCase();
  if (PUBLIC_TOOL_LABELS[key]) return PUBLIC_TOOL_LABELS[key];
  if (/查询|课程|教室|课表|教学周|导入|数据|天气|地图/.test(String(name || ""))) {
    return String(name || "").slice(0, 24);
  }
  return "校园工具";
}

function sourceCategory(toolName) {
  const key = String(toolName || "").toLowerCase();
  if (/empty|room|教室/.test(key)) return "教室占用";
  if (/weather|天气/.test(key)) return "天气数据";
  if (/map|route|location|地图/.test(key)) return "校园地图";
  if (/rag|knowledge|知识/.test(key)) return "校园知识";
  if (/import|guide|help|说明/.test(key)) return "使用说明";
  if (/schedule|school|today|week|term|course|teacher|课表|课程/.test(key)) return "课表数据";
  return "校园服务";
}

function statusText(status) {
  const value = String(status || "").toLowerCase();
  if (["success", "done", "ok", "completed"].includes(value)) return "已完成";
  if (["failed", "error"].includes(value)) return "未完成";
  if (value === "running" || value === "planned") return "进行中";
  if (value === "skipped") return "已跳过";
  return "已完成";
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (["failed", "error"].includes(value)) return "failed";
  if (value === "running" || value === "planned") return "running";
  return "success";
}

function normalizeSteps(steps, taskSteps) {
  const source = Array.isArray(steps) && steps.length
    ? steps
    : (Array.isArray(taskSteps) ? taskSteps : []);
  return source.slice(0, 8).map((step, index) => {
    const tool = step.tool || step.toolName || step.name || "";
    const label = String(step.label || step.reason || publicToolLabel(tool) || `步骤 ${index + 1}`).slice(0, 40);
    // Never surface raw internal tool ids that look like snake_case APIs.
    const safeLabel = /_/.test(label) && !/[\u4e00-\u9fff]/.test(label)
      ? publicToolLabel(label)
      : label;
    return {
      id: String(step.id || step.key || `step-${index + 1}`),
      label: safeLabel,
      status: step.status || "success",
      statusText: statusText(step.status),
      statusClass: statusClass(step.status),
      sourceCategory: sourceCategory(tool || safeLabel),
      durationText: Number(step.durationMs) > 0 ? `${Math.round(step.durationMs)}ms` : "",
      degraded: step.degraded === true || String(step.errorCode || "").includes("FALLBACK"),
    };
  });
}

function buildPreview(steps, evidenceText, fallback) {
  const lines = [];
  if (steps[0]) lines.push(steps[0].label.indexOf("理解") >= 0 ? steps[0].label : "已理解任务");
  if (steps[1]) lines.push(steps[1].label);
  if (evidenceText) lines.push(evidenceText);
  else if (steps.length) lines.push(`已完成 ${steps.length} 个步骤`);
  if (fallback) lines.push("已使用本地能力");
  return lines.slice(0, 3);
}

Component({
  properties: {
    steps: { type: Array, value: [] },
    taskSteps: { type: Array, value: [] },
    evidenceText: { type: String, value: "" },
    fallback: { type: Boolean, value: false },
    status: { type: String, value: "completed" },
    collapsed: { type: Boolean, value: true },
  },
  data: {
    expanded: false,
    hasContent: false,
    summaryText: "",
    previewLines: [],
    displaySteps: [],
    statusClass: "success",
  },
  observers: {
    "steps, taskSteps, evidenceText, fallback, status, collapsed": function observe() {
      this.refresh();
    },
  },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  methods: {
    refresh() {
      const displaySteps = normalizeSteps(this.properties.steps, this.properties.taskSteps);
      const hasContent = displaySteps.length > 0 || Boolean(this.properties.evidenceText) || this.properties.fallback;
      const summaryText = this.properties.fallback
        ? "已用本地能力完成"
        : (displaySteps.length ? `已完成 ${displaySteps.length} 个步骤` : "处理完成");
      const previewLines = buildPreview(displaySteps, this.properties.evidenceText, this.properties.fallback);
      this.setData({
        expanded: this.properties.collapsed === false,
        hasContent,
        summaryText,
        previewLines,
        displaySteps,
        statusClass: this.properties.fallback ? "degraded" : statusClass(this.properties.status),
      });
    },
    onToggle() {
      this.setData({ expanded: !this.data.expanded });
    },
  },
});

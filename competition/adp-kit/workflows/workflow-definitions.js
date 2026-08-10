"use strict";

const COMMON_FAILURE = "任何工具失败、版本不一致或 verified=false 都进入失败回复；生成模型不得补造课程、教室、冲突或计划事实。";
const COMMON_CONTEXT = "只继承最近一次已确认且仍属于同一任务的字段；用户明确新值时覆盖，切换任务时清空无关字段。";

function node(id, type, label, extra = {}) {
  return Object.assign({ id, type, label }, extra);
}

function finish(workflow) {
  workflow.nodeCount = workflow.nodes.length;
  workflow.failurePolicy = COMMON_FAILURE;
  workflow.contextPolicy = COMMON_CONTEXT;
  workflow.replanLimit = 0;
  return workflow;
}

const workflows = [
  finish({
    id: "wf-schedule",
    name: "01-多维课表查询",
    intent: "query_schedule",
    trigger: "用户要查询某个班级、教师、教室或课程的课程安排；不处理空教室、两对象冲突或个人今日计划。",
    actualStartInputs: ["entity_type", "entity_name", "date_text", "week", "weekday", "period_scope", "campus"],
    legacyStartInputs: [{ name: "campus", policy: "保留现有 ADP 输入但不映射；query_schedule 不消费此字段，后续可由用户手工隐藏或删除。" }],
    params: [
      { name: "entity_type", type: "string", required: true, note: "class|teacher|room|course" },
      { name: "entity_name", type: "string", required: true, note: "匿名实体名；工具内部完成最终解析" },
      { name: "date_text", type: "string", required: false, note: "缺省时 get_academic_context 按 Asia/Shanghai 今天解析" },
      { name: "week", type: "number", required: false, note: "1-20；显式教学周查询可直接传业务工具" },
      { name: "weekday", type: "number", required: false, note: "1-7" },
      { name: "period_scope", type: "object", required: false, note: "{start,end}；上午1-4、下午5-8、晚上9-10" },
    ],
    required: ["entity_type", "entity_name"],
    timePolicy: "时间不是必填项；date_text/week/weekday 均缺失时调用 get_academic_context({})，再把 resolvedDate 作为今天传给 query_schedule。",
    extractPrompt: `只从用户消息和已确认上下文提取 JSON：
{"entity_type":"class|teacher|room|course|","entity_name":"","date_text":"","week":null,"weekday":null,"period_scope":null,"inherited":false}
教师1→教师001，A班→2025级A班；“那周五下午呢”只更新时间并继承已确认对象。不确定字段留空，不生成课程事实。`,
    tool: "query_schedule",
    toolMapping: {
      entity_type: "entityType",
      entity_name: "entityName",
      resolved_date: "date（date_text 或默认今天时）",
      week: "week（显式 week 时）",
      weekday: "weekday",
      "period_scope.start": "periodStart",
      "period_scope.end": "periodEnd",
    },
    branchPolicy: [
      "get_academic_context success=false 或 inSemester=false → tool_error",
      "query_schedule error.code=AMBIGUOUS_ENTITY → entity_issue(choice)",
      "query_schedule error.code=ENTITY_NOT_FOUND → entity_issue(reply)",
      "success!==true / dataVersion!==APP.data_version / evidence.verified!==true → tool_error",
      "success=true 且 items=[] → result(empty reply)",
      "success=true 且 items 非空 → result(schedule widget)",
    ],
    nodes: [
      node("start", "start", "开始"),
      node("extract", "llm_parameter_extract", "参数提取", { constraint: "只输出参数 JSON" }),
      node("check_required", "condition", "必填判断"),
      node("clarify", "reply", "缺参追问"),
      node("academic_context", "tool", "日期解析", { tool: "get_academic_context" }),
      node("academic_branch", "condition", "日期结果判断"),
      node("call", "tool", "课表查询", { tool: "query_schedule" }),
      node("result_branch", "condition", "结果契约判断"),
      node("entity_issue", "widget_or_reply", "歧义或不存在", { cardType: "choice|error" }),
      node("tool_error", "reply", "工具/核验失败"),
      node("result", "widget_or_reply", "空结果或课表卡", { cardType: "schedule" }),
      node("end", "end", "结束"),
    ],
    edges: [
      ["start", "extract"], ["extract", "check_required"], ["check_required", "clarify", "missing"],
      ["check_required", "academic_context", "complete"], ["clarify", "end"],
      ["academic_context", "academic_branch"], ["academic_branch", "tool_error", "invalid_or_outside"],
      ["academic_branch", "call", "valid"], ["call", "result_branch"],
      ["result_branch", "entity_issue", "ambiguous_or_not_found"], ["result_branch", "tool_error", "failed_or_unverified"],
      ["result_branch", "result", "verified"], ["entity_issue", "end"], ["tool_error", "end"], ["result", "end"],
    ],
    samples: [
      "查询教师001本周三的课程", "2025级A班明天有什么课", "A班周五下午有课吗", "教师1第5周周一的课",
      "教室A1-101今天下午被谁用", "高等数学A这周什么时候上", "查教师002的课表", "帮我查下课表",
      "教师099周三的课", "教师001第25周的课", "张老师的课", "（上文教师001后）那周五下午呢",
    ],
  }),
  finish({
    id: "wf-classroom",
    name: "02-空教室规划",
    intent: "find_available_classrooms",
    trigger: "用户要在指定校区、日期和节次寻找空闲教室；不处理某教室占用课表、两对象冲突或个人计划。",
    actualStartInputs: ["campus", "date_text", "week", "weekday", "start_period", "end_period", "consecutive_periods", "building", "capacity"],
    legacyStartInputs: [],
    params: [
      { name: "campus", type: "string", required: true, note: "校区A|校区B；由 find_available_classrooms 校验" },
      { name: "date_text", type: "string", required: false, note: "与 week+weekday 二选一" },
      { name: "week", type: "number", required: false, note: "与 date_text 二选一" },
      { name: "weekday", type: "number", required: false, note: "使用 week 时必填" },
      { name: "start_period", type: "number", required: true, note: "1-10" },
      { name: "end_period", type: "number", required: false, note: "与 consecutive_periods 二选一" },
      { name: "consecutive_periods", type: "number", required: false, note: "与 end_period 二选一" },
      { name: "building", type: "string", required: false, note: "由工具校验" },
      { name: "capacity", type: "number", required: false, note: "最低容量，由工具校验" },
    ],
    required: ["campus", "date_text|week+weekday", "start_period", "end_period|consecutive_periods"],
    timePolicy: "空教室必须有明确日期或教学周+星期；不把‘现在’猜成节次，无法确定时追问。",
    extractPrompt: `只输出 JSON：
{"campus":"","date_text":"","week":null,"weekday":null,"start_period":null,"end_period":null,"consecutive_periods":null,"building":"","capacity":null,"inherited":false}
上午=1-4，下午=5-8，晚上=9-10；连续两节=2。缺校区、日期或起始节次时留空并追问，不生成空闲事实。`,
    tool: "find_available_classrooms",
    toolMapping: {
      campus: "campus", resolved_date: "date", week: "week", weekday: "weekday",
      start_period: "periodStart|startPeriod", end_period: "periodEnd",
      consecutive_periods: "consecutivePeriods", building: "building", capacity: "capacity",
    },
    branchPolicy: [
      "缺校区/时间/节次 → clarify",
      "日期解析失败或学期外 → tool_error",
      "ENTITY_NOT_FOUND/INVALID_PARAM → tool_error（显示工具原始错误码，不由模型改写事实）",
      "success=true 且 items=[] → result(empty reply + 放宽建议)",
      "success=true 且 verified=true → result(classroom widget)",
    ],
    nodes: [
      node("start", "start", "开始"), node("extract", "llm_parameter_extract", "参数提取"),
      node("check_required", "condition", "必填判断"), node("clarify", "reply", "缺参追问"),
      node("academic_context", "tool", "日期解析", { tool: "get_academic_context" }),
      node("academic_branch", "condition", "日期结果判断"),
      node("call", "tool", "空教室查询", { tool: "find_available_classrooms" }),
      node("result_branch", "condition", "结果契约判断"), node("tool_error", "reply", "工具/核验失败"),
      node("result", "widget_or_reply", "空结果或教室卡", { cardType: "classroom" }), node("end", "end", "结束"),
    ],
    edges: [
      ["start", "extract"], ["extract", "check_required"], ["check_required", "clarify", "missing"],
      ["check_required", "academic_context", "complete"], ["clarify", "end"],
      ["academic_context", "academic_branch"], ["academic_branch", "tool_error", "invalid_or_outside"],
      ["academic_branch", "call", "valid"], ["call", "result_branch"],
      ["result_branch", "tool_error", "failed_or_unverified"], ["result_branch", "result", "verified"],
      ["tool_error", "end"], ["result", "end"],
    ],
    samples: [
      "校区A明天下午有哪些连续两节空闲的教室", "周五晚上校区B有空教室吗", "校区A第3周周一上午的空教室",
      "找个能坐60人的空教室", "校区B明天下午连续三节的", "（上文校区A后）那校区B呢",
      "现在哪里可以自习", "有空教室吗", "校区C明天的空教室", "校区A第25周的空教室",
      "校区A明天下午容量500的教室", "校区A明天全天哪些教室一直空着",
    ],
  }),
  finish({
    id: "wf-conflict",
    name: "03-课程冲突比较",
    intent: "compare_schedules",
    trigger: "用户要比较两个班级、教师、教室或课程的时间重叠/赶场风险；不处理单对象课表或空教室。",
    actualStartInputs: ["first_entity_type", "first_entity_name", "second_entity_type", "second_entity_name", "date_range", "period_scope"],
    legacyStartInputs: [],
    params: [
      { name: "first_entity_type", type: "string", required: true, note: "class|teacher|room|course" },
      { name: "first_entity_name", type: "string", required: true, note: "第一个匿名实体" },
      { name: "second_entity_type", type: "string", required: true, note: "class|teacher|room|course" },
      { name: "second_entity_name", type: "string", required: true, note: "第二个匿名实体" },
      { name: "date_range", type: "object", required: false, note: "唯一时间容器：{date_text,week,weekday}；仅第N周表示整周；缺省今天" },
      { name: "period_scope", type: "object", required: false, note: "{start,end}" },
    ],
    required: ["first_entity_type", "first_entity_name", "second_entity_type", "second_entity_name"],
    timePolicy: "开始节点和参数提取都只使用 date_range，不再并列输出顶层 date_text/week/weekday；“第N周”只给 week、不指定 weekday，表示整周，不得默认周一；ADP 内部若以 0 表示未指定 weekday，compare_schedules 入口仅对本工具将其规范化为整周；缺省时间时按今天比较。",
    extractPrompt: `只输出 JSON：
{"first_entity_type":"","first_entity_name":"","second_entity_type":"","second_entity_name":"","date_range":{"date_text":"","week":null,"weekday":null},"period_scope":null,"inherited":false}
A班/B班归一化为2025级A班/2025级B班。只给一个对象时第二对象留空；“第N周”只提取 week=N 且 weekday 留空，只有明确周X时才填 1-7；不预判冲突，不单独输出顶层 date_text/week/weekday。`,
    tool: "compare_schedules",
    toolMapping: {
      first_entity_type: "firstType", first_entity_name: "firstName",
      second_entity_type: "secondType", second_entity_name: "secondName",
      "date_range.resolved_date": "date", "date_range.week": "week", "date_range.weekday": "weekday",
      "period_scope.start": "periodStart", "period_scope.end": "periodEnd",
    },
    branchPolicy: [
      "compare_schedules 内部解析两个实体；ADP 不预先调用 resolve_entity",
      "AMBIGUOUS_ENTITY/ENTITY_NOT_FOUND → entity_issue",
      "success=true、verified=true 且 conflictCount=0 仍是成功结果",
      "summary.selfCompare=true 时使用“<实体> · 课程安排风险检查”，忙碌课次只显示一次，不得使用“A vs A”标题；rushWarnings 只展示工具已经去重的结果",
      "success=false / 版本不一致 / verified=false → tool_error",
    ],
    nodes: [
      node("start", "start", "开始"), node("extract", "llm_parameter_extract", "参数提取"),
      node("check_required", "condition", "必填判断"), node("clarify", "reply", "缺参追问"),
      node("academic_context", "tool", "日期解析", { tool: "get_academic_context" }),
      node("academic_branch", "condition", "日期结果判断"),
      node("call", "tool", "冲突比较", { tool: "compare_schedules" }),
      node("result_branch", "condition", "结果契约判断"),
      node("entity_issue", "widget_or_reply", "歧义或不存在", { cardType: "choice|error" }),
      node("tool_error", "reply", "工具/核验失败"),
      node("result", "widget_or_reply", "冲突结果卡", { cardType: "conflict" }), node("end", "end", "结束"),
    ],
    edges: [
      ["start", "extract"], ["extract", "check_required"], ["check_required", "clarify", "missing"],
      ["check_required", "academic_context", "complete"], ["clarify", "end"],
      ["academic_context", "academic_branch"], ["academic_branch", "tool_error", "invalid_or_outside"],
      ["academic_branch", "call", "valid"], ["call", "result_branch"],
      ["result_branch", "entity_issue", "ambiguous_or_not_found"], ["result_branch", "tool_error", "failed_or_unverified"],
      ["result_branch", "result", "verified"], ["entity_issue", "end"], ["tool_error", "end"], ["result", "end"],
    ],
    samples: [
      "比较A1-101和A1-102第1周的占用冲突", "比较高等数学A和大学英语A第1周的时间冲突",
      "教师003和教师003第1周周一是否存在冲突或跨校区赶场", "教师001和教师002第1周是否存在冲突",
      "比较2025级A班和2025级B班第1周周五下午的课程冲突", "教师001和教师002周三有冲突吗",
      "A班和C班这周哪天下午都有课", "教师003周一的课和A班冲突吗", "比较A班和B班", "（上文A班后）再和D班比一下",
      "比较A班", "比较A班和E班", "张老师和李老师的课冲突吗", "A班第25周周五和B班冲突吗",
    ],
  }),
  finish({
    id: "wf-day-plan",
    name: "04-今日校园计划",
    intent: "generate_day_plan",
    trigger: "用户要查看今天、明天或指定日期的匿名个人课程时间轴、自习空档与赶场提醒；不要求用户提供身份。",
    actualStartInputs: ["visitor_id", "date_text", "preferred_campus", "preferred_study_duration"],
    legacyStartInputs: [{ name: "visitor_id", policy: "保留现有 ADP 输入但忽略任何用户值；工具节点固定注入 visitor-demo-001。" }],
    params: [
      { name: "date_text", type: "string", required: false, note: "缺省今天" },
      { name: "preferred_campus", type: "string", required: false, note: "校区A|校区B" },
      { name: "preferred_study_duration", type: "number", required: false, note: "1-10节" },
    ],
    required: [],
    constants: { demoVisitorId: "visitor-demo-001" },
    timePolicy: "未给日期时 get_academic_context({}) 按 Asia/Shanghai 今天解析；评测可显式传 baseDate，但线上工作流不固定时钟。",
    extractPrompt: `只输出 JSON：
{"date_text":"","preferred_campus":"","preferred_study_duration":null,"focus":""}
未给日期留空，由时间工具默认今天。禁止从文本、登录态、API.visitor_id 或会话猜 visitor_id；禁止生成课程事实。`,
    tool: "generate_day_plan",
    toolMapping: {
      "constant:visitor-demo-001": "visitorId", resolved_date: "date",
      preferred_campus: "preferredCampus", preferred_study_duration: "preferredStudyDuration",
    },
    branchPolicy: [
      "get_academic_context 失败或 inSemester=false → tool_error/学期边界回复",
      "generate_day_plan success=false / 版本不一致 / verified=false → tool_error",
      "lessonCount=0 仍是成功结果，显示无课并提供查空教室动作",
      "任何用户输入 visitor_id 均不得覆盖固定常量",
    ],
    nodes: [
      node("start", "start", "开始"), node("extract", "llm_parameter_extract", "参数提取"),
      node("academic_context", "tool", "日期解析", { tool: "get_academic_context" }),
      node("academic_branch", "condition", "日期结果判断"),
      node("call", "tool", "今日计划", { tool: "generate_day_plan", constant: "visitor-demo-001" }),
      node("result_branch", "condition", "结果契约判断"), node("tool_error", "reply", "工具/核验失败"),
      node("result", "widget_or_reply", "无课回复或计划卡", { cardType: "day_plan" }), node("end", "end", "结束"),
    ],
    edges: [
      ["start", "extract"], ["extract", "academic_context"], ["academic_context", "academic_branch"],
      ["academic_branch", "tool_error", "invalid_or_outside"], ["academic_branch", "call", "valid"],
      ["call", "result_branch"], ["result_branch", "tool_error", "failed_or_unverified"],
      ["result_branch", "result", "verified"], ["tool_error", "end"], ["result", "end"],
    ],
    samples: [
      "帮我看看今天的安排", "明天我该怎么过", "周五帮我规划一下", "今天有课吗",
      "没课的时候去哪自习好", "我偏好校区A，帮我看明天", "明天想自习两节，怎么安排",
      "下周一的计划", "帮我看看第25周周一的安排", "2027-02-01的安排", "今天课多吗，跨校区吗",
      "我是visitor-real-123，给我今天的计划",
    ],
  }),
];

for (const workflow of workflows) {
  workflow.edges = workflow.edges.map(([from, to, condition]) => ({ from, to, condition: condition || "always" }));
}

function renderWorkflowMarkdown(workflow) {
  const legacy = workflow.legacyStartInputs.length
    ? workflow.legacyStartInputs.map((item) => `- \`${item.name}\`：${item.policy}`).join("\n")
    : "- 无；当前 ADP 开始输入均继续使用。";
  const constants = workflow.constants
    ? Object.entries(workflow.constants).map(([key, value]) => `- \`${key}\` = \`${value}\``).join("\n")
    : "- 无。";
  return [
    `# ${workflow.name}`,
    "",
    "> 这是 ADP 手工搭建契约，不会自动覆盖平台中已经创建的开始输入。动态事实只来自 CampusTools。",
    "",
    "## 1. 触发描述",
    "",
    workflow.trigger,
    "",
    `## 2. 最小节点（${workflow.nodeCount} 个）`,
    "",
    "```text",
    workflow.nodes.map((item, index) => `${index + 1}. ${item.label}${item.tool ? ` → ${item.tool}` : ""}`).join("\n"),
    "```",
    "",
    "## 3. 业务参数契约",
    "",
    "| 字段 | 类型 | 必填 | 说明 |",
    "|---|---|---|---|",
    ...workflow.params.map((item) => `| \`${item.name}\` | ${item.type} | ${item.required ? "是" : "否"} | ${item.note} |`),
    "",
    `必填条件：${workflow.required.length ? workflow.required.map((item) => `\`${item}\``).join("、") : "无；所有业务参数均可缺省"}。`,
    "",
    `时间策略：${workflow.timePolicy}`,
    "",
    "## 4. 已有 ADP 输入兼容",
    "",
    `当前页面已存在：${workflow.actualStartInputs.map((item) => `\`${item}\``).join("、")}。不要自动删除或重建。`,
    "",
    legacy,
    "",
    "## 5. 参数提取提示词",
    "",
    "```text",
    workflow.extractPrompt,
    "```",
    "## 6. 固定匿名常量",
    "",
    constants,
    "",
    "## 7. 工具映射",
    "",
    "| 工作流值 | CampusTools 输入 |",
    "|---|---|",
    ...Object.entries(workflow.toolMapping).map(([from, to]) => `| \`${from}\` | \`${to}\` |`),
    "",
    "## 8. 分支契约",
    "",
    ...workflow.branchPolicy.map((item) => `- ${item}`),
    "",
    `- ${workflow.failurePolicy}`,
    "",
    "## 9. 调试样例",
    "",
    ...workflow.samples.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## 10. 多轮上下文",
    "",
    workflow.contextPolicy,
  ].join("\n");
}

module.exports = { workflows, renderWorkflowMarkdown };

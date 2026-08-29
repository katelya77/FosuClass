"use strict";
// R50.0 T6 生成脚本：将 6 个新增 R50 CampusTools 合并进 canonical + import OpenAPI，
// 并派生 r50 增量 delta（恰 6 个 operation，$ref 自包含）。
//
// 运行（Windows）：
//   cd competition\adp-kit\r50; node build-openapi-r50.js
//
// 约束（对齐 R50.0-SEMANTIC-CORE-DESIGN.md §7）：
//   - 全量 campus-agent-tools.adp-import.json = 13 operations（7 既有 + 6 新增）
//   - 增量 campus-agent-tools.r50-existing-plugin-additions.json = 恰好 6 个新增 operations
//   - canonical 保持占位符 server；import/delta 用真实比赛 CloudBase endpoint
//   - 新增 operation 的输入/输出 schema 与真实运行时（mcp/campus-tools-mcp/src/tools.js）逐字段对齐

const fs = require("fs");
const path = require("path");

const OPENAPI_DIR = path.join(__dirname, "..", "r49-ma", "tools", "openapi");
const CANONICAL_PATH = path.join(OPENAPI_DIR, "campus-agent-tools.openapi.json");
const IMPORT_PATH = path.join(OPENAPI_DIR, "campus-agent-tools.adp-import.json");
const DELTA_PATH = path.join(OPENAPI_DIR, "campus-agent-tools.r50-existing-plugin-additions.json");

const REAL_SERVER = "https://cloud1-d3g17rpe7566d3d5c-1442900641.ap-shanghai.app.tcloudbase.com/campusflow-adp-tools";
const VERSION = "1.5.0";

const ENTITY_TYPES = ["campus", "college", "class", "teacher", "room", "course", "user"];
const MATCH_TYPES = ["exact", "normalized_exact", "prefix", "substring", "fuzzy", "list"];

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const S = (description, extra) => Object.assign({ type: "string", description }, extra || {});
const I = (description, extra) => Object.assign({ type: "integer", description }, extra || {});
const N = (description, extra) => Object.assign({ type: "number", description }, extra || {});
const B = (description) => ({ type: "boolean", description });
const OBJ = (description, properties, required, extra) => {
  const obj = { type: "object", description, properties };
  if (required && required.length) obj.required = required;
  if (extra) Object.assign(obj, extra);
  return obj;
};
const ARR = (description, items, extra) => Object.assign({ type: "array", description, items }, extra || {});

// ---------------------------------------------------------------------------
// 6 个新增 operation 定义（tag / summary / description / input / response）
// ---------------------------------------------------------------------------
const NEW_OPS = {
  campus_entity_search: {
    tag: "campus_schedule",
    summary: "校园实体搜索/清单（教师/班级/教室/课程/校区/学院）",
    description:
      "通用校园实体搜索与清单：支持 exact/normalized_exact/prefix/substring/fuzzy 确定性匹配（matchType 由服务端判定）与确定排序，禁止模型编造实体；不传关键词返回该类型清单。支持 campus/college 过滤与 limit 上限（1..100，默认 20）。",
    input: "EntitySearchInput",
    response: "EntitySearchResponse",
  },
  campus_academic_context: {
    tag: "campus_schedule",
    summary: "教学周/学期/节次时间上下文（Temporal Semantic Core）",
    description:
      "封装 Temporal Semantic Core：解析绝对/相对日期与结构化 temporal intent（absolute/relative_day/relative_weekday/academic_week/academic_week_weekday/week_range/future_weeks/recent_weeks/next_week/prev_week/current），确定性输出教学周、星期、学期与节次时间轴并暴露 temporalContext；日期与周次由确定性服务计算，禁止模型猜测。",
    input: "AcademicContextInput",
    response: "AcademicContextResponse",
  },
  campus_common_free_time_query: {
    tag: "campus_schedule",
    summary: "多实体共同空闲窗口（2..6 教师/班级）",
    description:
      "查询 2..6 个教师/班级在指定教学周（或周区间）内的共同空闲连续节次窗口，支持星期/节次范围/最小连续节数过滤，按 week/weekday/periodStart 确定性排序；只从当前匿名数据集派生，禁止模型编造。",
    input: "CommonFreeTimeInput",
    response: "CommonFreeTimeResponse",
  },
  campus_room_utilization_query: {
    tag: "campus_insight",
    summary: "教室/楼栋/校区利用率排名（Ranking Core）",
    description:
      "统计指定教学周窗口内教室/楼栋/校区的利用率（occupiedPeriodUnits/availablePeriodUnits/utilizationRate/lessonOccurrences），按利用率最高/最低经 Ranking Core 确定性排名（rank/metricRank/tieGroup 语义），支持 campus/building/roomType 过滤与 topN；只从匿名数据集确定性派生。",
    input: "RoomUtilizationInput",
    response: "RoomUtilizationResponse",
  },
  campus_reschedule_feasibility: {
    tag: "campus_risk",
    summary: "调课 What-if 模拟可行性（完整确定性链，绝不修改数据）",
    description:
      "What-if 模拟调课可行性（完整确定性链，绝不修改数据）：按 sourceLessonId 或 sourceCourseId/sourceCourseName（可附 className/classId 缩窄班级）解析源课程；逐课次检查教师/班级/教室冲突、目标时段空间可用性（未指定教室时确定性查找空闲且满足容量/设备要求的候选教室）、容量、功能设备、连续负荷与跨校区赶场；返回 feasible/partialFeasible/reason/conflictCount 与 warnings；课程多课次时逐条模拟；week 可选，缺省取源课次首个开课周；模拟绝不修改任何数据（simulation.mutatedData=false）。",
    input: "RescheduleFeasibilityInput",
    response: "RescheduleFeasibilityResponse",
  },
  campus_group_plan: {
    tag: "campus_schedule",
    summary: "群体计划候选（共同空闲 + 空教室 ranked）",
    description:
      "为 2..6 个教师/班级生成群体计划候选：共同空闲窗口 + 该窗口空教室 + 容量/设备过滤，按候选教室数（roomCount）确定性 ranked 排序；教室一律来自确定性数据源，禁止 LLM 拼装虚构房间。",
    input: "GroupPlanInput",
    response: "GroupPlanResponse",
  },
};

// ---------------------------------------------------------------------------
// 新增 schema 定义（与运行时返回逐字段对齐）
// ---------------------------------------------------------------------------
const NEW_SCHEMAS = {
  // ---- campus_entity_search ----
  EntitySearchInput: OBJ(
    "实体搜索/清单输入：entityType 可选（缺省搜索全部类型）；keyword 为空则返回清单",
    {
      entityType: S("实体类型（可选，缩小搜索范围）", { enum: ENTITY_TYPES }),
      keyword: S("搜索关键词（可选，空则返回清单）"),
      campus: S("校区A / 校区B（可选，对支持校区字段的实体过滤）"),
      college: S("学院 id 或名称（可选，对支持学院字段的实体过滤）"),
      limit: I("返回上限，默认 20", { minimum: 1, maximum: 100 }),
    },
  ),
  EntitySearchItem: OBJ(
    "实体搜索结果条目：matchType 由服务端确定性判定（exact/normalized_exact/prefix/substring/fuzzy/list）",
    {
      id: S("实体 id"),
      name: S("实体名称"),
      type: S("实体类型", { enum: ENTITY_TYPES }),
      matchType: S("确定性匹配类型", { enum: MATCH_TYPES }),
      campusId: S("校区 id（room 类型携带）"),
      campusName: S("校区名称"),
      building: S("楼栋（room 类型携带）"),
      capacity: I("教室容量（room 类型携带）"),
      roomType: S("教室类型（room 类型携带）"),
      collegeId: S("学院 id（class/course 类型携带）"),
      collegeName: S("学院名称"),
      classId: S("班级 id（teacher 类型携带）"),
      className: S("班级名称（teacher 类型携带）"),
    },
  ),
  EntitySearchSummary: OBJ(
    "实体搜索汇总",
    {
      total: I("命中总数"),
      returned: I("实际返回条数"),
      matchTypes: ARR("返回条目的匹配类型集合", { type: "string" }),
    },
    ["total", "returned", "matchTypes"],
  ),
  EntitySearchResponse: OBJ(
    "campus_entity_search 成功/失败统一信封（含 query/summary）",
    {
      success: B("统一成功标志"),
      queryId: S("查询 ID"),
      dataVersion: S("数据版本标识", { example: "competition-demo-v3" }),
      resolvedEntity: ref("ResolvedEntity"),
      items: ARR("实体搜索结果条目", ref("EntitySearchItem")),
      actions: ARR("可执行动作（当前为空数组）", ref("Action")),
      evidence: ref("Evidence"),
      error: ref("ErrorInfo"),
      query: OBJ("回显查询条件", {
        entityType: S("实体类型（null 表示未指定）"),
        keyword: S("搜索关键词（null 表示清单）"),
        campus: S("校区名称（null 表示未过滤）"),
        college: S("学院（null 表示未过滤）"),
        limit: I("返回上限"),
      }),
      summary: ref("EntitySearchSummary"),
    },
    ["success", "queryId", "dataVersion", "items", "actions", "evidence", "error"],
  ),

  // ---- campus_academic_context ----
  AcademicContextInput: OBJ(
    "教学周/学期上下文输入：结构化 intent 优先；dateText 走口语解析；baseDate 为评测固定基准",
    {
      intent: OBJ("结构化 temporal intent（对象或 JSON 字符串）", {
        kind: S("intent 类型", {
          enum: [
            "absolute", "relative_day", "relative_weekday", "academic_week",
            "academic_week_weekday", "week_range", "future_weeks", "recent_weeks",
            "next_week", "prev_week", "current",
          ],
        }),
        date: S("绝对日期 YYYY-MM-DD"),
        offset: I("相对偏移（天数/周数，随 kind 语义）"),
        weekday: I("星期 1..7", { minimum: 1, maximum: 7 }),
        week: I("教学周 1..20", { minimum: 1, maximum: 20 }),
        weekStart: I("周窗口起点", { minimum: 1, maximum: 20 }),
        weekEnd: I("周窗口终点", { minimum: 1, maximum: 20 }),
        count: I("未来/最近 N 个教学周", { minimum: 1 }),
      }),
      date: S("显式日期 YYYY-MM-DD（优先级最高）", { pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
      dateText: S("今天/明天/后天/本周X/这周X/下周X/第N周周X/YYYY-MM-DD"),
      baseDate: S("评测固定基准日期；缺省使用 Asia/Shanghai 当前日期", { pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
    },
  ),
  AcademicContextItem: OBJ(
    "教学周/学期上下文条目",
    {
      resolvedDate: S("解析后的日期 YYYY-MM-DD（无法解析时为 null）"),
      date: S("解析后的日期（与 resolvedDate 一致，向后兼容）"),
      week: I("教学周 1..20（学期外为 null）", { minimum: 1, maximum: 20 }),
      weekday: I("星期 1..7", { minimum: 1, maximum: 7 }),
      weekdayName: S("星期名称，如 周一"),
      inSemester: B("是否在学期内（开学前/学期后为 false）"),
      semester: OBJ("学期元信息", {
        id: S("学期 id"),
        name: S("学期名称"),
        startDate: S("开学日期 YYYY-MM-DD"),
        totalWeeks: I("教学周总数"),
      }),
      periods: ARR("节次时间轴", OBJ("节次", {
        period: I("节次序号 1..10"),
        start: S("开始时间 HH:mm"),
        end: S("结束时间 HH:mm"),
      })),
      baseDate: S("本次解析使用的基准日期"),
      resolutionSource: S("解析来源（intent kind 或口语来源标记）"),
      temporalContext: OBJ("Temporal Semantic Core 结构化上下文（内部协议）", {
        referenceDate: S("参考日期（可为 null）"),
        semesterId: S("学期 id（可为 null）"),
        inSemester: B("是否在学期内"),
        currentAcademicWeek: I("当前教学周（可为 null）"),
        resolvedDate: S("解析后日期（可为 null）"),
        resolvedWeek: I("解析后教学周（可为 null）"),
        resolvedWeekStart: I("周窗口起点（可为 null）"),
        resolvedWeekEnd: I("周窗口终点（可为 null）"),
        resolutionKind: S("解析类型（absolute/future_weeks/... 或 none）"),
        note: S("补充说明（可选）"),
      }),
    },
    ["inSemester", "semester", "periods", "baseDate", "resolutionSource"],
  ),
  AcademicContextResponse: OBJ(
    "campus_academic_context 成功/失败统一信封（items[0] 携带 temporalContext）",
    {
      success: B("统一成功标志"),
      queryId: S("查询 ID"),
      dataVersion: S("数据版本标识", { example: "competition-demo-v3" }),
      resolvedEntity: ref("ResolvedEntity"),
      items: ARR("教学周/学期上下文条目", ref("AcademicContextItem")),
      actions: ARR("可执行动作（当前为空数组）", ref("Action")),
      evidence: ref("Evidence"),
      error: ref("ErrorInfo"),
    },
    ["success", "queryId", "dataVersion", "items", "actions", "evidence", "error"],
  ),

  // ---- campus_common_free_time_query ----
  CommonFreeTimeInput: OBJ(
    "共同空闲窗口输入：entities 为 2..6 个教师/班级；week 或 weekStart/weekEnd 二选一",
    {
      entities: ARR("2..6 个教师/班级实体", OBJ("实体", {
        type: S("实体类型", { enum: ["teacher", "class"] }),
        name: S("实体名称"),
      }, ["type", "name"]), { minItems: 2, maxItems: 6 }),
      week: I("单周查询（与 weekStart/weekEnd 二选一）", { minimum: 1, maximum: 20 }),
      weekStart: I("周窗口起点", { minimum: 1, maximum: 20 }),
      weekEnd: I("周窗口终点（须 >= weekStart）", { minimum: 1, maximum: 20 }),
      weekday: I("星期 1..7", { minimum: 1, maximum: 7 }),
      weekdays: ARR("星期数组（缺省 1..7）", I("星期", { minimum: 1, maximum: 7 })),
      periodStart: I("节次范围起点（缺省 1）", { minimum: 1, maximum: 10 }),
      periodEnd: I("节次范围终点（缺省末节）", { minimum: 1, maximum: 10 }),
      minConsecutivePeriods: I("最小连续空闲节数，默认 1", { minimum: 1, maximum: 10 }),
      limit: I("返回上限，默认 50", { minimum: 1, maximum: 200 }),
    },
    ["entities"],
  ),
  CommonFreeTimeItem: OBJ(
    "共同空闲窗口条目",
    {
      week: I("教学周", { minimum: 1, maximum: 20 }),
      weekday: I("星期 1..7", { minimum: 1, maximum: 7 }),
      weekdayName: S("星期名称"),
      date: S("该周该星期对应日期 YYYY-MM-DD"),
      periodStart: I("空闲节次起点", { minimum: 1, maximum: 10 }),
      periodEnd: I("空闲节次终点", { minimum: 1, maximum: 10 }),
      periodText: S("如 第3-4节"),
      freePeriodCount: I("连续空闲节数"),
      entities: ARR("参与该窗口的实体（已解析）", OBJ("已解析实体", {
        type: S("实体类型", { enum: ["teacher", "class"] }),
        id: S("实体 id"),
        name: S("实体名称"),
      }, ["type", "id", "name"])),
    },
    ["week", "weekday", "periodStart", "periodEnd", "freePeriodCount", "entities"],
  ),
  CommonFreeTimeSummary: OBJ(
    "共同空闲窗口汇总",
    {
      entityCount: I("成功解析的实体数"),
      totalWindows: I("命中窗口总数"),
      returned: I("实际返回窗口数"),
    },
    ["entityCount", "totalWindows", "returned"],
  ),
  CommonFreeTimeResponse: OBJ(
    "campus_common_free_time_query 成功/失败统一信封（含 query/summary）",
    {
      success: B("统一成功标志"),
      queryId: S("查询 ID"),
      dataVersion: S("数据版本标识", { example: "competition-demo-v3" }),
      resolvedEntity: ref("ResolvedEntity"),
      items: ARR("共同空闲窗口条目", ref("CommonFreeTimeItem")),
      actions: ARR("可执行动作（当前为空数组）", ref("Action")),
      evidence: ref("Evidence"),
      error: ref("ErrorInfo"),
      query: OBJ("回显查询条件", {
        weekStart: I("周窗口起点"),
        weekEnd: I("周窗口终点"),
        weekdays: ARR("星期数组", I("星期", { minimum: 1, maximum: 7 })),
        periodStart: I("节次起点"),
        periodEnd: I("节次终点"),
        minConsecutivePeriods: I("最小连续空闲节数"),
        limit: I("返回上限"),
      }),
      summary: ref("CommonFreeTimeSummary"),
    },
    ["success", "queryId", "dataVersion", "items", "actions", "evidence", "error"],
  ),

  // ---- campus_room_utilization_query ----
  RoomUtilizationInput: OBJ(
    "教室利用率输入：weekStart/weekEnd 必填；groupBy/sort/topN 可选",
    {
      weekStart: I("起始教学周（必填）", { minimum: 1, maximum: 20 }),
      weekEnd: I("结束教学周（必填，须 >= weekStart）", { minimum: 1, maximum: 20 }),
      campus: S("校区A / 校区B（可选）"),
      building: S("楼栋名（可选）"),
      roomType: S("教室类型（可选）"),
      groupBy: S("聚合粒度，默认 room", { enum: ["room", "building", "campus"] }),
      sort: S("highest=利用率最高（默认）/ lowest=最低", { enum: ["highest", "lowest"] }),
      topN: I("返回前 N 名（可选，默认全部）", { minimum: 1, maximum: 100 }),
    },
    ["weekStart", "weekEnd"],
  ),
  RoomUtilizationItem: OBJ(
    "利用率排名条目（Ranking Core 语义）",
    {
      rank: I("position 语义：1..N 唯一递增，永不因并列失效"),
      metricRank: I("metric 语义：并列同档（competition ranking）"),
      tiedWithPrevious: B("是否与排序中前一项业务指标完全并列"),
      tieGroupId: S("并列组标识（单元素组为 null）"),
      tieGroupSize: I("并列组内实体数（单元素组为 1）"),
      entity: OBJ("排名实体", { id: S("实体 id"), name: S("实体名称"), type: S("实体类型") }),
      metrics: OBJ("请求指标取值快照", { utilizationRate: N("利用率 0..1") }),
      id: S("聚合对象 id"),
      name: S("聚合对象名称"),
      type: S("聚合粒度类型", { enum: ["room", "building", "campus"] }),
      occupiedPeriodUnits: I("占用节次单元数"),
      availablePeriodUnits: I("可用节次单元数"),
      utilizationRate: N("利用率 0..1"),
      lessonOccurrences: I("课次出现次数"),
      campusId: S("校区 id（groupBy=room 携带）"),
      campusName: S("校区名称"),
      building: S("楼栋（groupBy=room 携带）"),
      capacity: I("教室容量（groupBy=room 携带）"),
      roomType: S("教室类型（groupBy=room 携带）"),
      roomCount: I("聚合内教室数（groupBy=building/campus 携带）"),
    },
    ["rank", "metricRank", "entity", "metrics", "id", "name", "type",
      "occupiedPeriodUnits", "availablePeriodUnits", "utilizationRate", "lessonOccurrences"],
  ),
  RoomUtilizationResponse: OBJ(
    "campus_room_utilization_query 成功/失败统一信封（含 window/rankContext/query）",
    {
      success: B("统一成功标志"),
      queryId: S("查询 ID"),
      dataVersion: S("数据版本标识", { example: "competition-demo-v3" }),
      resolvedEntity: ref("ResolvedEntity"),
      items: ARR("利用率排名条目", ref("RoomUtilizationItem")),
      actions: ARR("可执行动作（当前为空数组）", ref("Action")),
      evidence: ref("Evidence"),
      error: ref("ErrorInfo"),
      window: OBJ("查询教学周窗口", { weekStart: I("起始周"), weekEnd: I("结束周") }, ["weekStart", "weekEnd"]),
      rankContext: OBJ("排名上下文（Ranking Core）", {
        source: S("排名来源标识"),
        list: S("排名列表标识"),
        selectedRank: I("当前选中排名（可为 null）"),
        metric: S("排名指标"),
        direction: S("排序方向", { enum: ["highest", "lowest"] }),
      }),
      query: OBJ("回显查询条件", {
        weekStart: I("起始教学周"),
        weekEnd: I("结束教学周"),
        groupBy: S("聚合粒度"),
        sort: S("排序方向"),
        topN: I("返回上限（null 表示全部）"),
        campus: S("校区名称（null 表示未过滤）"),
        building: S("楼栋（null 表示未过滤）"),
        roomType: S("教室类型（null 表示未过滤）"),
      }),
    },
    ["success", "queryId", "dataVersion", "items", "actions", "evidence", "error"],
  ),

  // ---- campus_reschedule_feasibility ----
  RescheduleFeasibilityInput: OBJ(
    "调课 What-if 模拟输入：sourceLessonId / sourceCourseId / sourceCourseName 三选一（可附 className/classId 缩窄课程多课次）；target 含 weekday/periodStart/periodEnd（week 可选，缺省取源课次首个开课周；room 可选）",
    {
      sourceLessonId: S("源课程 lessonId（与 sourceCourseId/sourceCourseName 三选一）"),
      sourceCourseId: S("源课程 courseId（与 sourceLessonId/sourceCourseName 三选一）"),
      sourceCourseName: S("源课程名称（与 sourceLessonId/sourceCourseId 三选一；多个候选时返回歧义候选）"),
      className: S("班级名称（可选，缩窄课程多课次）"),
      classId: S("班级 id（可选，缩窄课程多课次）"),
      target: OBJ("目标时段/教室", {
        week: I("目标教学周（可选，缺省取源课次首个开课周）", { minimum: 1, maximum: 20 }),
        weekday: I("目标星期 1..7", { minimum: 1, maximum: 7 }),
        periodStart: I("目标节次起点", { minimum: 1, maximum: 10 }),
        periodEnd: I("目标节次终点", { minimum: 1, maximum: 10 }),
        room: S("目标教室 id 或名称（可选）"),
      }, ["weekday", "periodStart", "periodEnd"]),
    },
    ["target"],
  ),
  RescheduleSourceLesson: OBJ(
    "源课程信息（lessonDisplay 形态）",
    {
      lessonId: S("课次 id"),
      courseId: S("课程 id"),
      courseName: S("课程名称"),
      teachers: ARR("任课教师名称列表", S("教师名称")),
      classes: ARR("上课班级名称列表", S("班级名称")),
      roomId: S("教室 id"),
      roomName: S("教室名称"),
      building: S("楼栋（可为 null）"),
      campusId: S("校区 id"),
      campusName: S("校区名称"),
      weekday: I("星期 1..7"),
      weekdayName: S("星期名称"),
      periodStart: I("节次起点"),
      periodEnd: I("节次终点"),
      periodText: S("如 第3-4节"),
      startTime: S("开始时间 HH:mm"),
      endTime: S("结束时间 HH:mm"),
      weeks: ARR("开课教学周列表", I("教学周")),
    },
    ["lessonId", "courseId", "courseName", "teachers", "classes", "roomId", "roomName",
      "campusId", "campusName", "weekday", "periodStart", "periodEnd", "weeks"],
  ),
  RescheduleConflictCheck: OBJ(
    "冲突检查结果（teacher/class/room 三类）",
    {
      conflict: B("是否存在冲突"),
      details: ARR("冲突课次明细（lessonDisplay 形态）", ref("RescheduleSourceLesson")),
    },
    ["conflict", "details"],
  ),
  RescheduleCapabilityCheck: OBJ(
    "容量/功能设备检查结果",
    {
      ok: B("是否通过"),
      note: S("检查说明（fail-open 或失败原因，可为 null）"),
    },
    ["ok", "note"],
  ),
  RescheduleSpaceAvailability: OBJ(
    "目标时段空间可用性检查（完整确定性链）",
    {
      ok: B("目标时段是否有可用教室"),
      note: S("说明（可为 null）"),
      roomCount: I("可用教室数"),
      suggestedRoom: OBJ("首选候选教室（未指定目标教室时给出）", {
        id: S("教室 id"),
        name: S("教室名称"),
        capacity: I("容量"),
        campusId: S("校区 id"),
        campusName: S("校区名称"),
      }, ["id", "name", "capacity", "campusId", "campusName"]),
    },
    ["ok", "note", "roomCount", "suggestedRoom"],
  ),
  RescheduleWarning: OBJ(
    "调课风险提示",
    {
      type: S("风险类型（continuous_load/cross_campus_rush 等）"),
      level: S("风险级别", { enum: ["info", "warning", "critical"] }),
      text: S("风险说明"),
    },
    ["type", "level", "text"],
  ),
  RescheduleItem: OBJ(
    "调课模拟结果条目",
    {
      sourceLesson: ref("RescheduleSourceLesson"),
      target: OBJ("目标时段解析", {
        week: I("目标教学周"),
        weekday: I("目标星期"),
        weekdayName: S("星期名称"),
        date: S("目标日期 YYYY-MM-DD"),
        periodStart: I("节次起点"),
        periodEnd: I("节次终点"),
        periodText: S("如 第3-4节"),
        room: OBJ("目标教室（未指定为 null）", {
          id: S("教室 id"),
          name: S("教室名称"),
          capacity: I("容量"),
          campusId: S("校区 id"),
          campusName: S("校区名称"),
        }),
      }, ["week", "weekday", "periodStart", "periodEnd"]),
      checks: OBJ("逐项检查", {
        teacherConflict: ref("RescheduleConflictCheck"),
        classConflict: ref("RescheduleConflictCheck"),
        roomConflict: ref("RescheduleConflictCheck"),
        capacity: ref("RescheduleCapabilityCheck"),
        feature: ref("RescheduleCapabilityCheck"),
        spaceAvailability: ref("RescheduleSpaceAvailability"),
      }, ["teacherConflict", "classConflict", "roomConflict", "capacity", "feature"]),
      warnings: ARR("风险提示列表", ref("RescheduleWarning")),
      feasible: B("该课次整体是否可行（完整链：冲突/容量/设备/空间）"),
      reasons: ARR("不可行原因列表（可读中文）", S("原因")),
    },
    ["sourceLesson", "target", "checks", "warnings", "feasible", "reasons"],
  ),
  RescheduleSummary: OBJ(
    "调课可行性汇总",
    {
      feasible: B("是否全部课次可行"),
      partialFeasible: B("是否存在部分课次可行（多课次）"),
      reason: S("可行性结论说明"),
      conflictCount: I("冲突总数"),
      warningCount: I("风险提示数"),
      lessonCount: I("参与模拟的课次数"),
      multiLesson: B("课程是否存在多个课次（多班级）"),
      classDisambiguated: B("是否已按班级缩窄"),
    },
    ["feasible", "reason", "conflictCount", "warningCount"],
  ),
  RescheduleFeasibilityResponse: OBJ(
    "campus_reschedule_feasibility 成功/失败统一信封（含 summary/simulation）",
    {
      success: B("统一成功标志"),
      queryId: S("查询 ID"),
      dataVersion: S("数据版本标识", { example: "competition-demo-v3" }),
      resolvedEntity: ref("ResolvedEntity"),
      items: ARR("调课模拟结果条目", ref("RescheduleItem")),
      actions: ARR("可执行动作（当前为空数组）", ref("Action")),
      evidence: ref("Evidence"),
      error: ref("ErrorInfo"),
      summary: ref("RescheduleSummary"),
      simulation: OBJ("模拟元信息", {
        sourceLessonId: S("源课程 lessonId（单课次；多课次为 null）"),
        sourceLessonIds: ARR("源课程 lessonId 列表", S("lessonId")),
        sourceCourseId: S("源课程 courseId"),
        sourceCourseName: S("源课程名称"),
        target: OBJ("目标时段解析", {
          week: I("目标教学周"),
          weekday: I("目标星期"),
          weekdayName: S("星期名称"),
          date: S("目标日期"),
          periodStart: I("节次起点"),
          periodEnd: I("节次终点"),
          periodText: S("节次文本"),
          room: OBJ("目标教室（可为 null）", {
            id: S("教室 id"),
            name: S("教室名称"),
            capacity: I("容量"),
            campusId: S("校区 id"),
            campusName: S("校区名称"),
          }),
        }),
        mutatedData: B("是否修改数据（恒为 false）"),
      }, ["sourceLessonId", "sourceLessonIds", "sourceCourseId", "sourceCourseName", "target", "mutatedData"]),
    },
    ["success", "queryId", "dataVersion", "items", "actions", "evidence", "error"],
  ),

  // ---- campus_group_plan ----
  GroupPlanInput: OBJ(
    "群体计划输入：entities 为 2..6 个教师/班级；week 必填",
    {
      entities: ARR("2..6 个教师/班级实体", OBJ("实体", {
        type: S("实体类型", { enum: ["teacher", "class"] }),
        name: S("实体名称"),
      }, ["type", "name"]), { minItems: 2, maxItems: 6 }),
      week: I("教学周（必填）", { minimum: 1, maximum: 20 }),
      campus: S("校区A / 校区B（可选）"),
      weekday: I("星期 1..7", { minimum: 1, maximum: 7 }),
      weekdays: ARR("星期数组（缺省 1..7）", I("星期", { minimum: 1, maximum: 7 })),
      periodStart: I("节次范围起点（缺省 1）", { minimum: 1, maximum: 10 }),
      periodEnd: I("节次范围终点（缺省末节）", { minimum: 1, maximum: 10 }),
      minConsecutivePeriods: I("最小连续空闲节数，默认 1", { minimum: 1, maximum: 10 }),
      minCapacity: I("最小教室容量（可选）", { minimum: 1 }),
      requiredFeatures: ARR("所需教室功能设备（可选）", S("功能设备名")),
    },
    ["entities", "week"],
  ),
  GroupPlanRoom: OBJ(
    "候选窗口内空闲教室",
    {
      roomId: S("教室 id"),
      roomName: S("教室名称"),
      building: S("楼栋"),
      campusId: S("校区 id"),
      campusName: S("校区名称"),
      capacity: I("容量"),
      type: S("教室类型"),
    },
    ["roomId", "roomName", "campusId", "campusName", "capacity", "type"],
  ),
  GroupPlanItem: OBJ(
    "群体计划候选（ranked）",
    {
      rank: I("候选序号 1..N（按 roomCount 降序）"),
      weekday: I("星期 1..7"),
      weekdayName: S("星期名称"),
      date: S("该周该星期对应日期 YYYY-MM-DD"),
      periodStart: I("空闲节次起点"),
      periodEnd: I("空闲节次终点"),
      periodText: S("如 第3-4节"),
      freePeriodCount: I("连续空闲节数"),
      roomCount: I("该窗口空闲教室数"),
      rooms: ARR("空闲教室列表", ref("GroupPlanRoom")),
      entities: ARR("参与实体（已解析）", OBJ("已解析实体", {
        type: S("实体类型", { enum: ["teacher", "class"] }),
        id: S("实体 id"),
        name: S("实体名称"),
      }, ["type", "id", "name"])),
    },
    ["rank", "weekday", "periodStart", "periodEnd", "freePeriodCount", "roomCount", "rooms", "entities"],
  ),
  GroupPlanSummary: OBJ(
    "群体计划汇总",
    {
      entityCount: I("成功解析的实体数"),
      candidateCount: I("候选窗口数"),
    },
    ["entityCount", "candidateCount"],
  ),
  GroupPlanResponse: OBJ(
    "campus_group_plan 成功/失败统一信封（含 query/summary）",
    {
      success: B("统一成功标志"),
      queryId: S("查询 ID"),
      dataVersion: S("数据版本标识", { example: "competition-demo-v3" }),
      resolvedEntity: ref("ResolvedEntity"),
      items: ARR("群体计划候选", ref("GroupPlanItem")),
      actions: ARR("可执行动作（当前为空数组）", ref("Action")),
      evidence: ref("Evidence"),
      error: ref("ErrorInfo"),
      query: OBJ("回显查询条件", {
        week: I("教学周"),
        weekdays: ARR("星期数组", I("星期", { minimum: 1, maximum: 7 })),
        campus: S("校区名称（null 表示未过滤）"),
        periodStart: I("节次起点"),
        periodEnd: I("节次终点"),
        minConsecutivePeriods: I("最小连续空闲节数"),
        minCapacity: I("最小容量（null 表示未指定）"),
        requiredFeatures: ARR("所需功能设备", S("功能设备名")),
      }),
      summary: ref("GroupPlanSummary"),
    },
    ["success", "queryId", "dataVersion", "items", "actions", "evidence", "error"],
  ),
};

// ---------------------------------------------------------------------------
// 生成 operation path 对象
// ---------------------------------------------------------------------------
function makeOperation(name, def) {
  return {
    post: {
      tags: [def.tag],
      summary: def.summary,
      operationId: name,
      description: def.description,
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref(def.input) } },
      },
      responses: {
        200: {
          description: `${name} 结果信封（含 ${def.response} 声明的字段）`,
          content: { "application/json": { schema: ref(def.response) } },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 合并 + 写回
// ---------------------------------------------------------------------------
function main() {
  const canonical = JSON.parse(fs.readFileSync(CANONICAL_PATH, "utf8"));
  const imp = JSON.parse(fs.readFileSync(IMPORT_PATH, "utf8"));

  for (const doc of [canonical, imp]) {
    for (const name of Object.keys(NEW_OPS)) {
      doc.paths[`/api/${name}`] = makeOperation(name, NEW_OPS[name]);
    }
    for (const [sname, schema] of Object.entries(NEW_SCHEMAS)) {
      doc.components.schemas[sname] = schema;
    }
    doc.info.version = VERSION;
    doc.info.description = doc.info.description.replace("7 个", "13 个");
  }

  fs.writeFileSync(CANONICAL_PATH, JSON.stringify(canonical, null, 2) + "\n", "utf8");
  fs.writeFileSync(IMPORT_PATH, JSON.stringify(imp, null, 2) + "\n", "utf8");

  // ---- 派生 r50 增量 delta ----
  const delta = {
    openapi: "3.0.0",
    info: {
      title: "校园智序 · 小序 — R50.0 新增 6 个 Agent Tools（增量导入）",
      version: VERSION,
      description:
        "面向腾讯智能 ADP「基于 API」自定义插件增量导入：仅含 R50.0 新增的 6 个确定性 Agent Tool Façade（/api/campus_*），与全量 campus-agent-tools.adp-import.json 同 server、同 path/operation/schema 语义；$ref 全部自包含，不删除用户现有插件。",
    },
    servers: imp.servers,
    tags: [
      { name: "campus_schedule", description: "课表/空教室/实体/时间上下文/共同空闲/群体计划（课程空间 Agent）" },
      { name: "campus_risk", description: "风险/日计划/调课模拟（风险规划 Agent）" },
      { name: "campus_insight", description: "校园态势/教室利用率（校园洞察 Agent）" },
    ],
    paths: {},
    components: { schemas: {} },
    security: imp.security,
  };

  for (const name of Object.keys(NEW_OPS)) {
    delta.paths[`/api/${name}`] = imp.paths[`/api/${name}`];
  }

  const collectRefs = (node, out) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) collectRefs(x, out);
      return;
    }
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/components/schemas/")) {
      out.add(node.$ref.slice("#/components/schemas/".length));
      return;
    }
    for (const v of Object.values(node)) collectRefs(v, out);
  };

  const pending = [];
  const visit = (node) => {
    const local = new Set();
    collectRefs(node, local);
    for (const s of local) {
      if (!delta.components.schemas[s]) {
        if (!imp.components.schemas[s]) {
          throw new Error(`delta 引用了全量文件中缺失的 schema: ${s}`);
        }
        delta.components.schemas[s] = imp.components.schemas[s];
        pending.push(s);
      }
    }
  };
  for (const name of Object.keys(NEW_OPS)) visit(delta.paths[`/api/${name}`]);
  while (pending.length) {
    visit(delta.components.schemas[pending.shift()]);
  }

  fs.writeFileSync(DELTA_PATH, JSON.stringify(delta, null, 2) + "\n", "utf8");

  // ---- 校验摘要 ----
  const importOps = Object.values(imp.paths).flatMap((p) => Object.values(p).map((m) => m.operationId));
  const deltaOps = Object.values(delta.paths).flatMap((p) => Object.values(p).map((m) => m.operationId));
  const canonicalOps = Object.values(canonical.paths).flatMap((p) => Object.values(p).map((m) => m.operationId));
  console.log(`[build-openapi-r50] canonical ops=${canonicalOps.length}, import ops=${importOps.length}, delta ops=${deltaOps.length}`);
  console.log(`[build-openapi-r50] delta schemas=${Object.keys(delta.components.schemas).length}`);
  console.log(`[build-openapi-r50] written: ${path.basename(CANONICAL_PATH)}, ${path.basename(IMPORT_PATH)}, ${path.basename(DELTA_PATH)}`);
}

main();

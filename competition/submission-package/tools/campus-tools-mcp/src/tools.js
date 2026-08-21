/**
 * CampusTools 七个确定性校园工具。
 *
 * 每个工具都是纯函数（params => 统一信封），同时服务于：
 * - MCP（tools/call）
 * - REST（/api/<toolName>）
 * - 本地自动化测试
 *
 * 设计约定：
 * - 动态校园事实只来自 competition-demo-* 匿名数据集（默认 v1；部署环境可用 CAMPUS_DATA_PATH 覆盖），不调用任何生成式模型；
 * - 实体歧义返回 AMBIGUOUS_ENTITY + candidates，交由上游（ADP 工作流）追问确认；
 * - 空结果返回 success=true 且 items=[]，由 evidence.note=EMPTY_RESULT 标记；
 * - 所有时间解析确定性完成：date <-> (week, weekday) 互转，不猜测。
 */

const {
  loadDataset,
  expandWeeks,
  dateToWeek,
  dateToWeekday,
  weekWeekdayToDate,
  lessonDisplay,
  parseCalendarDate,
} = require("./data");
const { ok, fail, ERR } = require("./envelope");
const temporalCore = require("./temporal-core");
const { buildRankingResult } = require("./ranking-core");

const ENTITY_TYPES = ["class", "teacher", "room", "course", "campus", "college", "user"];
const COLLECTION_OF = {
  class: "classes",
  teacher: "teachers",
  room: "rooms",
  course: "courses",
  campus: "campuses",
  college: "colleges",
  user: "demoUsers",
};

/**
 * 安全 JSON 解析：用于接收 ADP 平台可能以字符串传递的结构化参数（如 intent / entities /
 * requiredFeatures）。对象直接透传，字符串按 JSON.parse 尝试，失败返回 null（fail-open
 * 到无该参数路径，由业务层做确定性兜底），绝不抛异常。
 */
function safeJsonParse(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** 节次连续段展开：[[start,end], ...] 形式的 occupied periods → 空闲连续窗口。 */
function freeWindows(occupied, rangeStart, rangeEnd, minConsecutive) {
  const busy = new Set();
  for (const [s, e] of occupied) {
    for (let p = Math.max(s, rangeStart); p <= Math.min(e, rangeEnd); p += 1) busy.add(p);
  }
  const windows = [];
  let runStart = null;
  for (let p = rangeStart; p <= rangeEnd + 1; p += 1) {
    if (!busy.has(p) && p <= rangeEnd) {
      if (runStart == null) runStart = p;
    } else if (runStart != null) {
      if (p - runStart >= minConsecutive) windows.push({ periodStart: runStart, periodEnd: p - 1 });
      runStart = null;
    }
  }
  return windows;
}

// ---------------------------------------------------------------------------
// 名称归一化：容忍「教师1」「2025级a班」「a1-101」等口语写法
// ---------------------------------------------------------------------------
function normalizeName(raw) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s) return s;
  s = s.replace(/^[a-z]/, (c) => c.toUpperCase());
  s = s.replace(/级([a-d])班$/i, (m, g) => `级${g.toUpperCase()}班`);
  s = s.replace(/^教师(\d)$/, "教师00$1").replace(/^教师(\d\d)$/, "教师0$1");
  // 口语别名：T09 / T03 → 教师009 / 教师003（与 05-TOOL-CONTRACTS.md「教师009 / T09」一致）
  s = s.replace(/^T(\d{1,2})$/i, (m, g) => `教师${String(Number(g)).padStart(3, "0")}`);
  s = s.replace(/^([ab])(\d)-/i, (m, g1, g2) => `${g1.toUpperCase()}${g2}-`);
  return s;
}

function periodsOverlap(aPs, aPe, bPs, bPe) {
  return aPs <= bPe && bPs <= aPe;
}

const WEEKDAY_BY_TEXT = Object.freeze({
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,
});

function shanghaiCurrentDate() {
  // Asia/Shanghai 不使用夏令时，UTC+8 可稳定取得当地日历日期。
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function addCalendarDays(dateStr, days) {
  const timestamp = parseCalendarDate(dateStr);
  if (timestamp == null) return null;
  return new Date(timestamp + Number(days) * 86400000).toISOString().slice(0, 10);
}

/**
 * 受控相对日期解析。模型可以提取 dateText，但最终日期只由这里确定性计算。
 * 优先级：date > dateText > baseDate；baseDate 缺省为 Asia/Shanghai 当前日期。
 */
function resolveAcademicDate(params, data) {
  const input = params || {};
  const explicitDate = String(input.date || "").trim();
  const baseDate = String(input.baseDate || shanghaiCurrentDate()).trim();
  if (parseCalendarDate(baseDate) == null) {
    return { error: fail(ERR.INVALID_PARAM, "baseDate 需为有效的 YYYY-MM-DD", { baseDate }) };
  }
  if (explicitDate) {
    if (parseCalendarDate(explicitDate) == null) {
      return { error: fail(ERR.INVALID_PARAM, "date 需为有效的 YYYY-MM-DD", { date: explicitDate }) };
    }
    return { resolvedDate: explicitDate, baseDate, source: "date" };
  }

  const dateText = String(input.dateText || "").replace(/\s+/g, "");
  if (!dateText) return { resolvedDate: baseDate, baseDate, source: "baseDate" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    if (parseCalendarDate(dateText) == null) {
      return { error: fail(ERR.INVALID_PARAM, "dateText 中的日期无效", { dateText }) };
    }
    return { resolvedDate: dateText, baseDate, source: "dateText.absolute" };
  }

  const relativeDays = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2 };
  if (Object.prototype.hasOwnProperty.call(relativeDays, dateText)) {
    return {
      resolvedDate: addCalendarDays(baseDate, relativeDays[dateText]),
      baseDate,
      source: "dateText.relativeDay",
    };
  }

  const relativeWeek = dateText.match(/^(本周|这周|下周)([一二三四五六日天1-7])$/);
  if (relativeWeek) {
    const targetWeekday = WEEKDAY_BY_TEXT[relativeWeek[2]];
    const baseWeekday = dateToWeekday(baseDate);
    const weekOffset = relativeWeek[1] === "下周" ? 7 : 0;
    return {
      resolvedDate: addCalendarDays(baseDate, weekOffset + targetWeekday - baseWeekday),
      baseDate,
      source: "dateText.relativeWeek",
    };
  }

  const teachingWeek = dateText.match(/^第(\d{1,2})周(?:周|星期)?([一二三四五六日天1-7])$/);
  if (teachingWeek) {
    const week = Number(teachingWeek[1]);
    const weekday = WEEKDAY_BY_TEXT[teachingWeek[2]];
    if (week < 1 || week > data.meta.semester.totalWeeks) {
      return { error: fail(ERR.OUT_OF_RANGE, "dateText 中的教学周超出本学期范围", { dateText, week }) };
    }
    return {
      resolvedDate: weekWeekdayToDate(week, weekday),
      baseDate,
      source: "dateText.teachingWeek",
    };
  }

  return {
    error: fail(ERR.INVALID_PARAM, "不支持的 dateText；请使用受控相对日期或 YYYY-MM-DD", {
      dateText,
      supported: ["今天", "明天", "后天", "本周一~周日", "这周一~周日", "下周一~周日", "第N周周一~周日", "YYYY-MM-DD"],
    }),
  };
}

function resolveTimeRange(params) {
  // 返回 { week, weekday, date } 或 { error }
  const { date, week, weekday } = params || {};
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { error: fail(ERR.INVALID_PARAM, "date 需为 YYYY-MM-DD", { date }) };
    }
    const w = dateToWeek(date);
    const wd = dateToWeekday(date);
    if (w == null || wd == null) {
      return { error: fail(ERR.OUT_OF_RANGE, "date 不在本学期范围内", { date }) };
    }
    return { week: w, weekday: wd, date };
  }
  if (week != null) {
    const w = Number(week);
    const { data } = loadDataset();
    if (!Number.isInteger(w) || w < 1 || w > data.meta.semester.totalWeeks) {
      return { error: fail(ERR.OUT_OF_RANGE, "week 超出本学期周次范围", { week }) };
    }
    const wd = weekday != null ? Number(weekday) : null;
    if (wd != null && (!Number.isInteger(wd) || wd < 1 || wd > 7)) {
      return { error: fail(ERR.INVALID_PARAM, "weekday 需为 1-7", { weekday }) };
    }
    return { week: w, weekday: wd, date: wd ? weekWeekdayToDate(w, wd) : null };
  }
  return { error: fail(ERR.MISSING_PARAM, "需提供 date 或 week（可附 weekday）", {}) };
}

// ---------------------------------------------------------------------------
// 校区别名解析（type-specific，仅用于 campus 语义参数；不改动全局 normalizeName，
// 避免孤立 A/B/C 污染班级、课程等其他实体）。别名从 data.campuses 的 name/id 动态派生：
// 校区A / A校区 / A / a / campus-a / campusA 等；B、C 同理。
// ---------------------------------------------------------------------------
function resolveCampus(data, raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const campuses = data.campuses || [];
  const exact = campuses.find((c) => c.name === trimmed || c.id === trimmed);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  for (const c of campuses) {
    const name = String(c.name || "").trim();
    const id = String(c.id || "").toLowerCase();
    const baseLower = name.replace(/^校区/, "").toLowerCase();
    const aliases = new Set([
      name.toLowerCase(),
      id,
      `${baseLower}校区`,
      baseLower,
      `campus${baseLower}`,
      id.replace(/^campus-/, ""),
    ]);
    if (aliases.has(lower)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 工具 1：resolve_entity —— 实体解析与歧义候选
// ---------------------------------------------------------------------------
function resolveEntity(params) {
  const name = normalizeName(params && params.name);
  if (!name) return fail(ERR.MISSING_PARAM, "缺少必填参数 name", {});
  const type = params && params.type;
  if (type && !ENTITY_TYPES.includes(type)) {
    return fail(ERR.INVALID_PARAM, "type 非法", { type, allowed: ENTITY_TYPES });
  }
  const { data } = loadDataset();
  const types = type ? [type] : ENTITY_TYPES;
  const exact = [];
  const partial = [];
  for (const t of types) {
    for (const item of data[COLLECTION_OF[t]]) {
      if (item.name === name) exact.push({ type: t, id: item.id, name: item.name });
      else if (item.name.includes(name) || name.includes(item.name)) {
        partial.push({ type: t, id: item.id, name: item.name });
      }
    }
  }
  if (exact.length === 1) {
    const env = ok({ resolvedEntity: exact[0], items: exact, actions: [] });
    return env;
  }
  const candidates = exact.length > 1 ? exact : partial;
  if (candidates.length > 1) {
    return fail(ERR.AMBIGUOUS_ENTITY, `「${name}」存在多个候选，需要用户确认`, { candidates });
  }
  if (candidates.length === 1) {
    return ok({ resolvedEntity: candidates[0], items: candidates, actions: [] });
  }
  const suggestions = [];
  for (const t of types) {
    for (const item of data[COLLECTION_OF[t]]) suggestions.push({ type: t, name: item.name });
  }
  return fail(ERR.ENTITY_NOT_FOUND, `未找到实体「${name}」`, {
    suggestions: suggestions.slice(0, 12),
  });
}

// ---------------------------------------------------------------------------
// 工具 2：get_academic_context —— 教学周 / 学期 / 节次上下文
// ---------------------------------------------------------------------------
function getAcademicContext(params) {
  const { data, dataVersion, dataHash } = loadDataset();
  const input = params || {};

  // R50.0 Temporal Semantic Core 路径：Agent 输出结构化 intent（对象或 JSON 字符串），
  // 日期/周次/窗口由 temporal-core 确定性计算（不猜测）。
  const rawIntent = input.intent;
  const intent = safeJsonParse(rawIntent);
  if (intent && typeof intent === "object" && typeof intent.kind === "string") {
    const baseDate = String(input.baseDate || input.date || shanghaiCurrentDate()).trim();
    if (parseCalendarDate(baseDate) != null) {
      const temporalContext = temporalCore.resolveTemporalIntent(intent, {
        referenceDate: baseDate,
        semester: data.meta.semester,
      });
      const resolvedDate = temporalContext.resolvedDate;
      const weekday = resolvedDate ? dateToWeekday(resolvedDate) : null;
      const item = {
        resolvedDate,
        date: resolvedDate || null,
        week: temporalContext.resolvedWeek,
        weekday,
        weekdayName: weekday ? data.meta.weekdayNames[weekday - 1] : null,
        inSemester: temporalContext.inSemester,
        semester: data.meta.semester,
        periods: data.meta.periods,
        baseDate,
        resolutionSource: temporalContext.resolutionKind,
        temporalContext,
      };
      const env = ok({ items: [item], actions: [] });
      env.evidence.dataHash = dataHash;
      env.dataVersion = dataVersion;
      if (temporalContext.resolvedWeekStart == null && temporalContext.resolvedWeekEnd == null
        && temporalContext.resolutionKind !== "none") {
        env.evidence.note = "无法解析到有效教学周（开学前/学期后按契约退化）";
      }
      return env;
    }
  }

  // 原 backward-compatible 路径（未提供有效 intent 时行为完全不变）。
  const resolved = resolveAcademicDate(params, data);
  if (resolved.error) return resolved.error;
  const resolvedDate = resolved.resolvedDate;
  const week = dateToWeek(resolvedDate);
  const weekday = dateToWeekday(resolvedDate);
  const env = ok({
    items: [{
      resolvedDate,
      date: resolvedDate,
      week,
      weekday,
      weekdayName: weekday ? data.meta.weekdayNames[weekday - 1] : null,
      inSemester: week != null,
      semester: data.meta.semester,
      periods: data.meta.periods,
      baseDate: resolved.baseDate,
      resolutionSource: resolved.source,
    }],
    actions: [],
  });
  env.evidence.note = week == null ? "日期不在本学期范围内" : undefined;
  env.evidence.dataHash = dataHash;
  env.dataVersion = dataVersion;
  return env;
}

// ---------------------------------------------------------------------------
// 工具 3：query_schedule —— 多维课表查询（班级/教师/教室/课程）
// ---------------------------------------------------------------------------
const SCHEDULE_INDEX_OF = { class: "class", teacher: "teacher", room: "room", course: "course" };

function querySchedule(params) {
  const input = { ...(params || {}) };
  // ADP 平台归一化：缺失可选整数参数会被填充为 0，一律视为「未指定」
  if (Number(input.weekday) === 0) delete input.weekday;
  if (Number(input.periodStart) === 0) delete input.periodStart;
  if (Number(input.periodEnd) === 0) delete input.periodEnd;
  const { entityType, entityName } = input;
  if (!entityType || !SCHEDULE_INDEX_OF[entityType]) {
    return fail(ERR.INVALID_PARAM, "entityType 需为 class/teacher/room/course", { entityType });
  }
  if (!entityName) return fail(ERR.MISSING_PARAM, "缺少必填参数 entityName", {});
  const resolved = resolveEntity({ type: entityType, name: entityName });
  if (!resolved.success) return resolved;
  const entity = resolved.resolvedEntity;

  const tr = resolveTimeRange(input);
  if (tr.error) return tr.error;

  const { idx } = loadDataset();
  const all = idx[SCHEDULE_INDEX_OF[entityType]].get(entity.id) || [];
  const filtered = all.filter((les) => {
    if (!expandWeeks(les).includes(tr.week)) return false;
    if (tr.weekday != null && les.weekday !== tr.weekday) return false;
    if (input.periodStart != null && input.periodEnd != null
      && !periodsOverlap(les.periodStart, les.periodEnd, Number(input.periodStart), Number(input.periodEnd))) return false;
    return true;
  }).sort((a, b) => (a.weekday - b.weekday) || (a.periodStart - b.periodStart));

  const items = filtered.map((les) => {
    const d = lessonDisplay(les);
    d.date = weekWeekdayToDate(tr.week, les.weekday);
    return d;
  });
  const env = ok({ resolvedEntity: entity, items, actions: [] });
  if (items.length === 0) {
    env.evidence.note = "EMPTY_RESULT";
    env.actions.push({ type: "broaden_query", label: "扩大查询范围（整周/换一周）" });
  } else {
    env.actions.push({ type: "open_widget", cardType: "schedule", label: "以卡片查看" });
  }
  env.query = { week: tr.week, weekday: tr.weekday, date: tr.date };
  return env;
}

// ---------------------------------------------------------------------------
// 工具 3b：query_schedule_range —— 多教学周课表展开（R49.4）
// ---------------------------------------------------------------------------
function queryScheduleRange(params) {
  const input = { ...(params || {}) };
  // ADP 平台归一化：缺失可选整数参数会被填充为 0，一律视为「未指定」
  if (Number(input.weekday) === 0) delete input.weekday;
  if (Number(input.periodStart) === 0) delete input.periodStart;
  if (Number(input.periodEnd) === 0) delete input.periodEnd;
  const { entityType, entityName, weekStart, weekEnd } = input;
  if (!entityType || !SCHEDULE_INDEX_OF[entityType]) {
    return fail(ERR.INVALID_PARAM, "entityType 需为 class/teacher/room/course", { entityType });
  }
  if (!entityName) return fail(ERR.MISSING_PARAM, "缺少必填参数 entityName", {});
  if (weekStart == null || weekEnd == null) {
    return fail(ERR.MISSING_PARAM, "缺少必填参数 weekStart/weekEnd", {});
  }
  const resolved = resolveEntity({ type: entityType, name: entityName });
  if (!resolved.success) return resolved;
  const entity = resolved.resolvedEntity;

  const { data, idx } = loadDataset();
  const totalWeeks = data.meta.semester.totalWeeks;
  if (!Number.isInteger(weekStart) || !Number.isInteger(weekEnd)) {
    return fail(ERR.INVALID_PARAM, "weekStart/weekEnd 需为整数", { weekStart, weekEnd });
  }
  if (weekStart < 1 || weekEnd > totalWeeks) {
    return fail(ERR.OUT_OF_RANGE, `周次必须在 1..${totalWeeks} 之间`, { weekStart, weekEnd });
  }
  if (weekEnd < weekStart) {
    return fail(ERR.INVALID_PARAM, "weekEnd 不得小于 weekStart", { weekStart, weekEnd });
  }

  const all = idx[SCHEDULE_INDEX_OF[entityType]].get(entity.id) || [];
  const items = [];
  for (const les of all) {
    if (input.weekday != null && les.weekday !== Number(input.weekday)) continue;
    if (input.periodStart != null && input.periodEnd != null
      && !periodsOverlap(les.periodStart, les.periodEnd, Number(input.periodStart), Number(input.periodEnd))) continue;
    for (const week of expandWeeks(les)) {
      if (week < weekStart || week > weekEnd) continue;
      const d = lessonDisplay(les);
      d.academicWeek = week;
      d.date = weekWeekdayToDate(week, les.weekday);
      items.push(d);
    }
  }
  items.sort((a, b) => (
    a.academicWeek - b.academicWeek
    || a.weekday - b.weekday
    || a.periodStart - b.periodStart
    || a.lessonId.localeCompare(b.lessonId)
  ));

  const env = ok({ resolvedEntity: entity, items, actions: [] });
  if (items.length === 0) {
    env.evidence.note = "EMPTY_RESULT";
    env.actions.push({ type: "broaden_query", label: "扩大查询范围（整周/换一周）" });
  } else {
    env.actions.push({ type: "open_widget", cardType: "schedule", label: "以卡片查看" });
  }
  env.window = { weekStart, weekEnd };
  env.query = {
    weekStart,
    weekEnd,
    weekday: input.weekday == null ? null : Number(input.weekday),
    periodStart: input.periodStart == null ? null : Number(input.periodStart),
    periodEnd: input.periodEnd == null ? null : Number(input.periodEnd),
  };
  return env;
}

// ---------------------------------------------------------------------------
// 工具 4：find_available_classrooms —— 空教室规划
// ---------------------------------------------------------------------------
function findAvailableClassrooms(params) {
  const input = { ...(params || {}) };
  // ADP 平台归一化：缺失可选整数参数会被填充为 0，一律视为「未指定」
  if (Number(input.weekday) === 0) delete input.weekday;
  if (Number(input.periodStart) === 0) delete input.periodStart;
  if (Number(input.periodEnd) === 0) delete input.periodEnd;
  const { campus } = input;
  const hasConsecutive = input.startPeriod != null && input.consecutivePeriods != null;
  const start = Number(hasConsecutive ? input.startPeriod : input.periodStart);
  const end = Number(hasConsecutive
    ? Number(input.startPeriod) + Number(input.consecutivePeriods) - 1
    : input.periodEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 10 || start > end) {
    return fail(ERR.INVALID_PARAM, "节次范围非法（1-10，且 periodStart<=periodEnd）", {
      periodStart: input.periodStart, periodEnd: input.periodEnd,
    });
  }
  const tr = resolveTimeRange(input);
  if (tr.error) return tr.error;
  if (tr.weekday == null) {
    return fail(ERR.MISSING_PARAM, "空教室查询需要明确的 weekday（或由 date 推导）", {});
  }

  const { data, byId } = loadDataset();
  let campusEntity = null;
  if (campus) {
    campusEntity = resolveCampus(data, campus);
    if (!campusEntity) return fail(ERR.ENTITY_NOT_FOUND, `未找到校区「${campus}」`, {});
  }
  const campusId = campusEntity ? campusEntity.id : null;
  const building = input.building ? String(input.building) : null;
  const capacityValue = input.minCapacity != null ? input.minCapacity : input.capacity;
  const minCapacity = capacityValue != null ? Number(capacityValue) : null;
  if (minCapacity != null && (!Number.isFinite(minCapacity) || minCapacity < 1)) {
    return fail(ERR.INVALID_PARAM, "capacity/minCapacity 需为正数", { capacity: capacityValue });
  }

  const busyRoomIds = new Set(
    data.lessons
      .filter((les) => les.weekday === tr.weekday
        && expandWeeks(les).includes(tr.week)
        && periodsOverlap(les.periodStart, les.periodEnd, start, end))
      .map((les) => les.roomId),
  );

  const freeRooms = data.rooms
    .filter((r) => r.type !== "体育场地")
    .filter((r) => !campusId || r.campusId === campusId)
    .filter((r) => !building || r.building === building)
    .filter((r) => !minCapacity || r.capacity >= minCapacity)
    .filter((r) => !busyRoomIds.has(r.id))
    .sort((a, b) => (a.building.localeCompare(b.building)) || (a.capacity - b.capacity));

  const campusName = campusId ? byId.campuses[campusId].name : null;
  const items = freeRooms.map((r) => ({
    roomId: r.id,
    roomName: r.name,
    building: r.building,
    campusId: r.campusId,
    campusName: byId.campuses[r.campusId].name,
    capacity: r.capacity,
    type: r.type,
    freePeriodStart: start,
    freePeriodEnd: end,
    periodText: `第${start}-${end}节`,
    date: tr.date || weekWeekdayToDate(tr.week, tr.weekday),
  }));
  const env = ok({
    items,
    actions: items.length ? [{ type: "open_widget", cardType: "classroom", label: "以卡片查看空教室" }] : [],
  });
  env.query = { week: tr.week, weekday: tr.weekday, date: tr.date, campus: campusName, periodStart: start, periodEnd: end };
  if (items.length === 0) env.evidence.note = "EMPTY_RESULT";
  return env;
}

// ---------------------------------------------------------------------------
// 工具 5：compare_schedules —— 课程冲突比较
// ---------------------------------------------------------------------------
function compareSchedules(params) {
  const { firstType, firstName, secondType, secondName } = params || {};
  if (!firstType || !firstName || !secondType || !secondName) {
    return fail(ERR.MISSING_PARAM, "需要 firstType/firstName 与 secondType/secondName", {});
  }
  for (const t of [firstType, secondType]) {
    if (!SCHEDULE_INDEX_OF[t]) return fail(ERR.INVALID_PARAM, "实体类型需为 class/teacher/room/course", { type: t });
  }
  const r1 = resolveEntity({ type: firstType, name: firstName });
  if (!r1.success) return r1;
  const r2 = resolveEntity({ type: secondType, name: secondName });
  if (!r2.success) return r2;

  const timeParams = { ...(params || {}) };
  // ADP 平台归一化会把缺失的可选整数参数填充为 0；0 一律视为「未指定」，
  // 不得解释成真实约束（星期0 / 节次0），否则会把全部课程过滤成空结果。
  if (Number(timeParams.weekday) === 0) delete timeParams.weekday;
  if (Number(timeParams.periodStart) === 0) delete timeParams.periodStart;
  if (Number(timeParams.periodEnd) === 0) delete timeParams.periodEnd;
  const tr = resolveTimeRange(timeParams);
  if (tr.error) return tr.error;

  const selfCompare = r1.resolvedEntity.type === r2.resolvedEntity.type
    && r1.resolvedEntity.id === r2.resolvedEntity.id;

  const { idx, data } = loadDataset();
  const busyOf = (type, id) => (idx[SCHEDULE_INDEX_OF[type]].get(id) || [])
    .filter((les) => expandWeeks(les).includes(tr.week))
    .filter((les) => tr.weekday == null || les.weekday === tr.weekday)
    .filter((les) => {
      if (timeParams.periodStart == null || timeParams.periodEnd == null) return true;
      return periodsOverlap(les.periodStart, les.periodEnd, Number(timeParams.periodStart), Number(timeParams.periodEnd));
    });
  const busy1 = busyOf(firstType, r1.resolvedEntity.id);
  const busy2 = busyOf(secondType, r2.resolvedEntity.id);

  const conflicts = [];
  const conflictKeys = new Set();
  for (const a of busy1) {
    for (const b of busy2) {
      if (selfCompare && a.id === b.id) continue;
      if (a.weekday !== b.weekday) continue;
      if (!periodsOverlap(a.periodStart, a.periodEnd, b.periodStart, b.periodEnd)) continue;
      const leftId = String(a.id || "");
      const rightId = String(b.id || "");
      const pairKey = selfCompare
        ? [leftId, rightId].sort().join("::")
        : `${leftId}::${rightId}`;
      if (conflictKeys.has(pairKey)) continue;
      conflictKeys.add(pairKey);
      conflicts.push({
        weekday: a.weekday,
        weekdayName: data.meta.weekdayNames[a.weekday - 1],
        date: weekWeekdayToDate(tr.week, a.weekday),
        periodStart: Math.max(a.periodStart, b.periodStart),
        periodEnd: Math.min(a.periodEnd, b.periodEnd),
        first: lessonDisplay(a),
        second: lessonDisplay(b),
      });
    }
  }
  conflicts.sort((x, y) => (x.weekday - y.weekday) || (x.periodStart - y.periodStart));

  // 跨校区赶场提醒：同一实体同一天相邻课程跨校区且间隔 <= 20 分钟
  const rushWarnings = [];
  const periodTimes = data.meta.periods;
  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const detectRush = (list, who) => {
    const byDay = new Map();
    list.forEach((les) => {
      if (!byDay.has(les.weekday)) byDay.set(les.weekday, []);
      byDay.get(les.weekday).push(les);
    });
    for (const [wd, dayLessons] of byDay.entries()) {
      const sorted = [...dayLessons].sort((x, y) => x.periodStart - y.periodStart);
      for (let i = 0; i + 1 < sorted.length; i += 1) {
        const cur = sorted[i]; const nxt = sorted[i + 1];
        if (cur.campusId === nxt.campusId) continue;
        const gap = toMinutes(periodTimes[nxt.periodStart - 1].start) - toMinutes(periodTimes[cur.periodEnd - 1].end);
        if (gap <= 20) {
          rushWarnings.push({
            entity: who, weekday: wd, weekdayName: data.meta.weekdayNames[wd - 1],
            from: lessonDisplay(cur), to: lessonDisplay(nxt), gapMinutes: gap,
          });
        }
      }
    }
  };
  detectRush(busy1, r1.resolvedEntity.name);
  if (!selfCompare) detectRush(busy2, r2.resolvedEntity.name);

  const rushSeen = new Set();
  const dedupedRushWarnings = rushWarnings.filter((item) => {
    const key = `${item.entity}|${item.weekday}|${item.from.lessonId}|${item.to.lessonId}`;
    if (rushSeen.has(key)) return false;
    rushSeen.add(key);
    return true;
  });

  const env = ok({
    items: conflicts,
    actions: [{ type: "open_widget", cardType: "conflict", label: "以卡片查看冲突对比" }],
  });
  env.query = {
    week: tr.week,
    weekday: tr.weekday == null ? null : tr.weekday,
    date: tr.date || null,
  };
  env.compared = [r1.resolvedEntity, r2.resolvedEntity];
  env.rushWarnings = dedupedRushWarnings;
  env.summary = {
    conflictCount: conflicts.length,
    firstBusySlots: busy1.length,
    secondBusySlots: busy2.length,
    hasConflict: conflicts.length > 0,
    selfCompare,
    rushWarningCount: dedupedRushWarnings.length,
  };
  if (conflicts.length === 0) env.evidence.note = "EMPTY_RESULT";
  return env;
}

// ---------------------------------------------------------------------------
// 工具 6：generate_day_plan —— 今日校园计划
// ---------------------------------------------------------------------------
function generateDayPlan(params) {
  const { visitorId, date } = params || {};
  if (!visitorId) return fail(ERR.MISSING_PARAM, "缺少必填参数 visitorId", {});
  if (!date) return fail(ERR.MISSING_PARAM, "缺少必填参数 date（YYYY-MM-DD）", {});
  const { data, byId } = loadDataset();
  const user = data.demoUsers.find((u) => u.visitorId === visitorId || u.id === visitorId || u.name === normalizeName(visitorId));
  if (!user) return fail(ERR.ENTITY_NOT_FOUND, `未找到演示用户「${visitorId}」`, {});

  const tr = resolveTimeRange({ date });
  if (tr.error) return tr.error;

  const isUserLesson = (les) => les.classIds.includes(user.classId) || user.electiveCourseIds.includes(les.courseId);
  const dayLessons = data.lessons
    .filter((les) => les.weekday === tr.weekday && expandWeeks(les).includes(tr.week) && isUserLesson(les))
    .sort((a, b) => a.periodStart - b.periodStart);

  const items = [];
  const periodTimes = data.meta.periods;
  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  let cursor = null;

  const requestedCampus = params.preferredCampus
    ? resolveCampus(data, params.preferredCampus)
    : null;
  if (params.preferredCampus && !requestedCampus) {
    return fail(ERR.ENTITY_NOT_FOUND, `未找到校区「${params.preferredCampus}」`, {});
  }
  const preferredCampusId = requestedCampus ? requestedCampus.id : user.preferredCampus;
  const preferredStudyDuration = params.preferredStudyDuration == null
    ? null
    : Number(params.preferredStudyDuration);
  if (preferredStudyDuration != null && (!Number.isInteger(preferredStudyDuration) || preferredStudyDuration < 1 || preferredStudyDuration > 10)) {
    return fail(ERR.INVALID_PARAM, "preferredStudyDuration 需为 1-10 节", { preferredStudyDuration: params.preferredStudyDuration });
  }

  const freeRoomSuggestion = (gapStart, gapEnd) => {
    const effectiveEnd = preferredStudyDuration == null
      ? gapEnd
      : Math.min(gapEnd, gapStart + preferredStudyDuration - 1);
    const sub = findAvailableClassrooms({
      campus: byId.campuses[preferredCampusId].name,
      week: tr.week,
      weekday: tr.weekday,
      periodStart: gapStart,
      periodEnd: effectiveEnd,
    });
    return sub.success ? sub.items.slice(0, 2).map((r) => `${r.roomName}（${r.capacity}人）`) : [];
  };

  dayLessons.forEach((les, i) => {
    const d = lessonDisplay(les);
    d.date = date;
    if (cursor != null && les.periodStart > cursor + 1) {
      const gapStart = cursor + 1;
      const gapEnd = les.periodStart - 1;
      items.push({
        type: "gap",
        periodStart: gapStart,
        periodEnd: gapEnd,
        periodText: `第${gapStart}-${gapEnd}节`,
        startTime: periodTimes[gapStart - 1].start,
        endTime: periodTimes[gapEnd - 1].end,
        suggestion: "空闲时段，可安排自习",
        studyRooms: freeRoomSuggestion(gapStart, gapEnd),
      });
    }
    const prev = dayLessons[i - 1];
    if (prev && prev.campusId !== les.campusId) {
      const gap = toMinutes(periodTimes[les.periodStart - 1].start) - toMinutes(periodTimes[prev.periodEnd - 1].end);
      if (gap <= 20) {
        items.push({
          type: "tip",
          level: "warning",
          text: `跨校区赶场：${byId.campuses[prev.campusId].name} → ${byId.campuses[les.campusId].name}，仅 ${gap} 分钟`,
        });
      }
    }
    items.push({ type: "lesson", ...d });
    cursor = les.periodEnd;
  });

  const env = ok({
    resolvedEntity: { type: "user", id: user.id, name: user.name },
    items,
    actions: [{ type: "open_widget", cardType: "day_plan", label: "以卡片查看今日计划" }],
  });
  env.query = { date, week: tr.week, weekday: tr.weekday };
  env.summary = { lessonCount: dayLessons.length, hasCrossCampus: items.some((x) => x.type === "tip") };
  if (dayLessons.length === 0) env.evidence.note = "EMPTY_RESULT";
  return env;
}

// ---------------------------------------------------------------------------
// Tool 7: get_campus_teaching_overview — deterministic Hero analytics
// ---------------------------------------------------------------------------
const HERO_WINDOW = Object.freeze({
  windowStart: "2026-08-25",
  teachingStart: "2026-08-31",
  windowEnd: "2026-09-27",
  weekStart: 1,
  weekEnd: 4,
});

function getCampusTeachingOverview(params) {
  const input = params || {};
  const requestedWindow = {
    windowStart: String(input.windowStart || HERO_WINDOW.windowStart),
    teachingStart: String(input.teachingStart || HERO_WINDOW.teachingStart),
    windowEnd: String(input.windowEnd || HERO_WINDOW.windowEnd),
  };
  if (
    requestedWindow.windowStart !== HERO_WINDOW.windowStart
    || requestedWindow.teachingStart !== HERO_WINDOW.teachingStart
    || requestedWindow.windowEnd !== HERO_WINDOW.windowEnd
  ) {
    return fail(ERR.INVALID_PARAM, "R4 Hero 首版仅支持固定且可复现的 2026-08-25 至 2026-09-27 窗口", {
      expected: HERO_WINDOW,
    });
  }

  const { data, byId } = loadDataset();
  const weeks = [1, 2, 3, 4];
  const weekdays = [1, 2, 3, 4, 5];
  const occurrences = [];
  for (const lesson of data.lessons) {
    for (const week of weeks) {
      if (!expandWeeks(lesson).includes(week) || !weekdays.includes(lesson.weekday)) continue;
      occurrences.push({
        week,
        weekday: lesson.weekday,
        date: weekWeekdayToDate(week, lesson.weekday),
        lesson,
      });
    }
  }

  const matrix = weeks.map((week) => ({
    week,
    startDate: weekWeekdayToDate(week, 1),
    endDate: weekWeekdayToDate(week, 7),
    days: weekdays.map((weekday) => ({
      weekday,
      weekdayName: data.meta.weekdayNames[weekday - 1],
      date: weekWeekdayToDate(week, weekday),
      lessonCount: occurrences.filter((item) => item.week === week && item.weekday === weekday).length,
    })),
  }));

  const activeTeachers = new Set();
  const activeRooms = new Set();
  for (const item of occurrences) {
    item.lesson.teacherIds.forEach((id) => activeTeachers.add(id));
    activeRooms.add(item.lesson.roomId);
  }

  const campusResources = data.campuses.map((campus) => {
    const campusRooms = data.rooms.filter((room) => room.campusId === campus.id && room.type !== "体育场地");
    const largeRooms = campusRooms.filter((room) => Number(room.capacity) >= 60);
    const campusOccurrences = occurrences.filter((item) => item.lesson.campusId === campus.id);
    const occupiedUnits = new Set();
    const occupiedLargeUnits = new Set();
    for (const item of campusOccurrences) {
      const room = byId.rooms[item.lesson.roomId];
      for (let period = item.lesson.periodStart; period <= item.lesson.periodEnd; period += 1) {
        const key = `${item.week}:${item.weekday}:${period}:${item.lesson.roomId}`;
        occupiedUnits.add(key);
        if (room && Number(room.capacity) >= 60) occupiedLargeUnits.add(key);
      }
    }
    const slotCount = weeks.length * weekdays.length * data.meta.periods.length;
    const totalUnits = campusRooms.length * slotCount;
    const largeTotalUnits = largeRooms.length * slotCount;
    const freeUnits = Math.max(totalUnits - occupiedUnits.size, 0);
    const largeFreeUnits = Math.max(largeTotalUnits - occupiedLargeUnits.size, 0);
    return {
      campusId: campus.id,
      campusName: campus.name,
      roomCount: campusRooms.length,
      lessonOccurrences: campusOccurrences.length,
      occupiedRoomPeriodUnits: occupiedUnits.size,
      freeRoomPeriodUnits: freeUnits,
      occupancyRate: totalUnits ? Number((occupiedUnits.size / totalUnits).toFixed(4)) : 0,
      largeRoomCount: largeRooms.length,
      largeRoomFreeUnits: largeFreeUnits,
      largeRoomAvailabilityRate: largeTotalUnits ? Number((largeFreeUnits / largeTotalUnits).toFixed(4)) : 0,
    };
  });

  const teacherLoad = data.teachers.map((teacher) => {
    const own = occurrences.filter((item) => item.lesson.teacherIds.includes(teacher.id));
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      lessonOccurrences: own.length,
      periodUnits: own.reduce((sum, item) => sum + item.lesson.periodEnd - item.lesson.periodStart + 1, 0),
    };
  }).sort((left, right) => (
    right.lessonOccurrences - left.lessonOccurrences
    || right.periodUnits - left.periodUnits
    || left.teacherName.localeCompare(right.teacherName, "zh-CN")
  ));

  const conflicts = [];
  const conflictSeen = new Set();
  const rushWarnings = [];
  const continuousLoads = [];
  const periodTimes = data.meta.periods;
  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const overlap = (left, right) => periodsOverlap(
    left.periodStart, left.periodEnd, right.periodStart, right.periodEnd,
  );

  for (const week of weeks) {
    for (const weekday of weekdays) {
      const day = occurrences
        .filter((item) => item.week === week && item.weekday === weekday)
        .map((item) => item.lesson);
      for (let leftIndex = 0; leftIndex < day.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < day.length; rightIndex += 1) {
          const left = day[leftIndex];
          const right = day[rightIndex];
          if (!overlap(left, right)) continue;
          const sharedTeachers = left.teacherIds.filter((id) => right.teacherIds.includes(id));
          const sharedClasses = left.classIds.filter((id) => right.classIds.includes(id));
          const sameRoom = left.roomId === right.roomId;
          if (!sharedTeachers.length && !sharedClasses.length && !sameRoom) continue;
          const key = `${week}:${weekday}:${[left.id, right.id].sort().join(":")}`;
          if (conflictSeen.has(key)) continue;
          conflictSeen.add(key);
          conflicts.push({
            week,
            weekday,
            date: weekWeekdayToDate(week, weekday),
            lessonIds: [left.id, right.id].sort(),
            sharedTeacherCount: sharedTeachers.length,
            sharedClassCount: sharedClasses.length,
            sameRoom,
          });
        }
      }
    }
  }

  for (const teacher of data.teachers) {
    for (const week of weeks) {
      for (const weekday of weekdays) {
        const own = occurrences
          .filter((item) => item.week === week && item.weekday === weekday && item.lesson.teacherIds.includes(teacher.id))
          .map((item) => item.lesson)
          .sort((left, right) => left.periodStart - right.periodStart || left.id.localeCompare(right.id));
        for (let index = 0; index + 1 < own.length; index += 1) {
          const current = own[index];
          const next = own[index + 1];
          if (next.periodStart > current.periodEnd + 1) continue;
          const base = {
            teacherId: teacher.id,
            teacherName: teacher.name,
            week,
            weekday,
            date: weekWeekdayToDate(week, weekday),
            fromLessonId: current.id,
            toLessonId: next.id,
          };
          continuousLoads.push(base);
          if (current.campusId !== next.campusId) {
            const gapMinutes = toMinutes(periodTimes[next.periodStart - 1].start)
              - toMinutes(periodTimes[current.periodEnd - 1].end);
            if (gapMinutes <= 20) rushWarnings.push({ ...base, gapMinutes });
          }
        }
      }
    }
  }

  const peakCandidates = [];
  for (const week of weeks) {
    for (const weekday of weekdays) {
      for (let period = 1; period <= data.meta.periods.length; period += 1) {
        const lessonCount = occurrences.filter((item) => (
          item.week === week
          && item.weekday === weekday
          && item.lesson.periodStart <= period
          && item.lesson.periodEnd >= period
        )).length;
        peakCandidates.push({
          week,
          weekday,
          weekdayName: data.meta.weekdayNames[weekday - 1],
          date: weekWeekdayToDate(week, weekday),
          period,
          lessonCount,
        });
      }
    }
  }
  peakCandidates.sort((left, right) => (
    right.lessonCount - left.lessonCount
    || left.week - right.week
    || left.weekday - right.weekday
    || left.period - right.period
  ));

  const item = {
    window: {
      ...requestedWindow,
      phase: "preparation-and-teaching",
      preparationPeriod: { startDate: "2026-08-25", endDate: "2026-08-30", lessonCount: 0 },
      teachingWeeks: { start: 1, end: 4, count: 4 },
    },
    summary: {
      weekCount: 4,
      lessonOccurrences: occurrences.length,
      teacherCount: data.teachers.length,
      activeTeacherCount: activeTeachers.size,
      roomCount: data.rooms.length,
      activeRoomCount: activeRooms.size,
      campusCount: data.campuses.length,
    },
    matrix,
    campusResources,
    teacherLoadTop: teacherLoad.slice(0, 3),
    peakSlot: peakCandidates[0],
    risks: {
      conflictCount: conflicts.length,
      rushCount: rushWarnings.length,
      continuousLoadCount: continuousLoads.length,
      conflicts,
      rushWarnings,
      continuousLoads,
    },
  };
  const env = ok({
    items: [item],
    actions: [
      { type: "sys.chat", intent: "schedule_week", query: "查看第1周校园课表", week: 1 },
      { type: "sys.chat", intent: "classroom_find", query: "查找第1周校园空教室", week: 1 },
      { type: "sys.chat", intent: "schedule_risk_check", query: "检查第1周校园教学风险", week: 1 },
    ],
  });
  env.query = requestedWindow;
  env.summary = item.summary;
  const { dataVersion } = loadDataset();
  env.evidence.derivation = `${dataVersion} deterministic 4-week occurrence aggregation`;
  env.evidence.preparationPeriodLessonCount = 0;
  return env;
}

// ---------------------------------------------------------------------------
// 工具 8：query_teacher_load —— 教师课表负载窗口聚合（R49.4）
// ---------------------------------------------------------------------------
function queryTeacherLoad(params) {
  const input = params || {};
  const weekStart = input.weekStart;
  const weekEnd = input.weekEnd;
  if (weekStart == null || weekEnd == null) {
    return fail(ERR.MISSING_PARAM, "缺少必填参数 weekStart/weekEnd", {});
  }
  const { data, byId } = loadDataset();
  const totalWeeks = data.meta.semester.totalWeeks;
  if (!Number.isInteger(weekStart) || !Number.isInteger(weekEnd)) {
    return fail(ERR.INVALID_PARAM, "weekStart/weekEnd 需为整数", { weekStart, weekEnd });
  }
  if (weekStart < 1 || weekEnd > totalWeeks) {
    return fail(ERR.OUT_OF_RANGE, `周次必须在 1..${totalWeeks} 之间`, { weekStart, weekEnd });
  }
  if (weekEnd < weekStart) {
    return fail(ERR.INVALID_PARAM, "weekEnd 不得小于 weekStart", { weekStart, weekEnd });
  }
  let topN = null;
  if (input.topN != null) {
    topN = Number(input.topN);
    if (!Number.isInteger(topN) || topN < 1 || topN > 10) {
      return fail(ERR.INVALID_PARAM, "topN 需为 1..10 的整数", { topN: input.topN });
    }
  }
  let campusEntity = null;
  if (input.campus) {
    campusEntity = resolveCampus(data, input.campus);
    if (!campusEntity) {
      return fail(ERR.ENTITY_NOT_FOUND, `未找到校区「${input.campus}」`, { campus: input.campus });
    }
  }
  const campusId = campusEntity ? campusEntity.id : null;

  // 聚合：每个 (lesson, week) 记一次课时出现；periodUnits 累加该次节次跨度。
  const counts = new Map();
  for (const lesson of data.lessons) {
    if (campusId && lesson.campusId !== campusId) continue;
    for (const week of expandWeeks(lesson)) {
      if (week < weekStart || week > weekEnd) continue;
      for (const teacherId of lesson.teacherIds) {
        const entry = counts.get(teacherId) || { lessonOccurrences: 0, periodUnits: 0 };
        entry.lessonOccurrences += 1;
        entry.periodUnits += lesson.periodEnd - lesson.periodStart + 1;
        counts.set(teacherId, entry);
      }
    }
  }

  const ranked = [...counts.entries()]
    .map(([teacherId, metrics]) => ({
      teacherId,
      teacherName: byId.teachers[teacherId] ? byId.teachers[teacherId].name : teacherId,
      ...metrics,
    }))
    .sort((left, right) => (
      right.lessonOccurrences - left.lessonOccurrences
      || right.periodUnits - left.periodUnits
      || left.teacherName.localeCompare(right.teacherName, "zh-CN")
      || left.teacherId.localeCompare(right.teacherId)
    ));

  const sliced = topN == null ? ranked : ranked.slice(0, topN);
  const items = sliced.map((entry, index) => {
    const prev = ranked[index - 1];
    return {
      rank: index + 1,
      teacher: { id: entry.teacherId, name: entry.teacherName },
      lessonOccurrences: entry.lessonOccurrences,
      periodUnits: entry.periodUnits,
      tiedWithPrevious: Boolean(prev
        && prev.lessonOccurrences === entry.lessonOccurrences
        && prev.periodUnits === entry.periodUnits),
    };
  });

  const env = ok({ items, actions: [] });
  env.window = { weekStart, weekEnd };
  env.rankContext = { source: "query_teacher_load", list: "teacherLoadTop", selectedRank: null };
  env.query = {
    weekStart,
    weekEnd,
    topN: topN == null ? null : topN,
    campus: campusEntity ? campusEntity.name : null,
  };
  if (items.length === 0) env.evidence.note = "EMPTY_RESULT";
  return env;
}

// ---------------------------------------------------------------------------
// 工具 9（R50.0）：query_entity_search —— 实体清单/搜索（确定排序，禁止编造）
// matchType 优先级：exact > normalized_exact > prefix > substring > fuzzy；空关键词=list。
// ---------------------------------------------------------------------------
const MATCH_ORDER = { exact: 0, normalized_exact: 1, prefix: 2, substring: 3, fuzzy: 4, list: 5 };

function queryEntitySearch(params) {
  const input = params || {};
  const { data, byId } = loadDataset();
  let type = input.entityType;
  if (type && !ENTITY_TYPES.includes(type)) {
    return fail(ERR.INVALID_PARAM, "entityType 非法", { entityType: type, allowed: ENTITY_TYPES });
  }
  let limit = input.limit == null ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(ERR.INVALID_PARAM, "limit 需为 1..100 的整数", { limit: input.limit });
  }
  const keyword = String(input.keyword || "").trim();
  const types = type ? [type] : ENTITY_TYPES;
  const campus = input.campus ? resolveCampus(data, input.campus) : null;
  if (input.campus && !campus) return fail(ERR.ENTITY_NOT_FOUND, `未找到校区「${input.campus}」`, {});
  const campusId = campus ? campus.id : null;
  const collegeId = input.college ? String(input.college).trim() : null;
  const nkw = normalizeName(keyword);
  const compact = (s) => String(s || "").replace(/[\s\-_]/g, "");

  const results = [];
  for (const t of types) {
    for (const item of data[COLLECTION_OF[t]]) {
      // 校区/学院过滤：字段存在才过滤（部分实体类型缺字段时 fail-open 跳过）
      if (campusId) {
        if (t === "room" && item.campusId !== campusId) continue;
        if (item.campusId != null && item.campusId !== campusId) continue;
      }
      if (collegeId && item.collegeId != null && item.collegeId !== collegeId) continue;
      let matchType = null;
      if (!keyword) matchType = "list";
      else if (item.name === keyword) matchType = "exact";
      else if (normalizeName(item.name) === nkw) matchType = "normalized_exact";
      else if (normalizeName(item.name).startsWith(nkw)) matchType = "prefix";
      else if (normalizeName(item.name).includes(nkw)) matchType = "substring";
      else if (compact(item.name).includes(compact(keyword))) matchType = "fuzzy";
      if (!matchType) continue;
      const entry = { matchOrder: MATCH_ORDER[matchType], type: t, id: item.id, name: item.name, matchType };
      if (t === "room") {
        entry.campusId = item.campusId;
        entry.campusName = byId.campuses[item.campusId] ? byId.campuses[item.campusId].name : null;
        entry.building = item.building;
        entry.capacity = item.capacity;
        entry.roomType = item.type;
      } else if (t === "class" || t === "course") {
        entry.collegeId = item.collegeId || null;
        entry.collegeName = item.collegeId && byId.colleges[item.collegeId] ? byId.colleges[item.collegeId].name : null;
      } else if (t === "teacher") {
        entry.classId = item.classId || null;
        entry.className = item.classId && byId.classes[item.classId] ? byId.classes[item.classId].name : null;
      }
      results.push(entry);
    }
  }
  results.sort((a, b) => (
    a.matchOrder - b.matchOrder
    || a.type.localeCompare(b.type)
    || a.name.localeCompare(b.name, "zh-CN")
    || a.id.localeCompare(b.id)
  ));
  const sliced = results.slice(0, limit);
  const items = sliced.map(({ matchOrder, ...rest }) => rest);

  const env = ok({ items, actions: [] });
  env.query = {
    entityType: type || null,
    keyword: keyword || null,
    campus: campus ? campus.name : null,
    college: collegeId || null,
    limit,
  };
  env.summary = {
    total: results.length,
    returned: items.length,
    matchTypes: [...new Set(items.map((i) => i.matchType))],
  };
  if (items.length === 0) env.evidence.note = "EMPTY_RESULT";
  return env;
}

// ---------------------------------------------------------------------------
// 工具 10（R50.0）：query_common_free_time —— 2~6 个教师/班级共同空闲窗口
// ---------------------------------------------------------------------------
function queryCommonFreeTime(params) {
  const input = params || {};
  const entitiesRaw = safeJsonParse(input.entities);
  const entities = Array.isArray(entitiesRaw) ? entitiesRaw : null;
  if (!entities || entities.length < 2 || entities.length > 6) {
    return fail(ERR.INVALID_PARAM, "entities 需为 2..6 个 { type, name } 实体", { entities });
  }
  const { data, idx } = loadDataset();
  const totalWeeks = data.meta.semester.totalWeeks;

  let weekStart = null;
  let weekEnd = null;
  if (input.week != null) {
    weekStart = Number(input.week);
    weekEnd = Number(input.week);
  } else if (input.weekStart != null && input.weekEnd != null) {
    weekStart = Number(input.weekStart);
    weekEnd = Number(input.weekEnd);
  }
  if (weekStart == null || weekEnd == null) {
    return fail(ERR.MISSING_PARAM, "需提供 week 或 weekStart/weekEnd", {});
  }
  if (!Number.isInteger(weekStart) || !Number.isInteger(weekEnd) || weekStart < 1 || weekEnd > totalWeeks || weekEnd < weekStart) {
    return fail(ERR.OUT_OF_RANGE, `周次必须在 1..${totalWeeks} 之间且 weekEnd>=weekStart`, { weekStart, weekEnd });
  }

  let weekdays = input.weekdays != null ? safeJsonParse(input.weekdays) : null;
  if (weekdays == null && input.weekday != null) weekdays = [Number(input.weekday)];
  if (weekdays == null) weekdays = [1, 2, 3, 4, 5, 6, 7];
  if (!Array.isArray(weekdays) || !weekdays.length || weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return fail(ERR.INVALID_PARAM, "weekdays 需为 1..7 的整数数组", { weekdays });
  }
  weekdays = [...new Set(weekdays)].sort((a, b) => a - b);

  const rangeStart = input.periodStart == null ? 1 : Number(input.periodStart);
  const rangeEnd = input.periodEnd == null ? data.meta.periods.length : Number(input.periodEnd);
  if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 1 || rangeEnd > data.meta.periods.length || rangeStart > rangeEnd) {
    return fail(ERR.INVALID_PARAM, `periodStart/periodEnd 需在 1..${data.meta.periods.length} 且 start<=end`, { rangeStart, rangeEnd });
  }
  const minConsecutive = input.minConsecutivePeriods == null ? 1 : Number(input.minConsecutivePeriods);
  if (!Number.isInteger(minConsecutive) || minConsecutive < 1 || minConsecutive > data.meta.periods.length) {
    return fail(ERR.INVALID_PARAM, "minConsecutivePeriods 需为 1..10 的整数", { minConsecutive: input.minConsecutivePeriods });
  }
  const limit = input.limit == null ? 50 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return fail(ERR.INVALID_PARAM, "limit 需为 1..200 的整数", { limit: input.limit });
  }

  const resolvedEntities = [];
  for (const e of entities) {
    if (!e || typeof e !== "object" || !e.type || !e.name) {
      return fail(ERR.INVALID_PARAM, "每个实体需包含 type 与 name", { entity: e });
    }
    if (e.type !== "teacher" && e.type !== "class") {
      return fail(ERR.INVALID_PARAM, "共同空闲仅支持 teacher/class 实体", { type: e.type });
    }
    const r = resolveEntity({ type: e.type, name: e.name });
    if (!r.success) return r;
    resolvedEntities.push(r.resolvedEntity);
  }

  const busyOf = (type, id, week, weekday) => (idx[type === "teacher" ? "teacher" : "class"].get(id) || [])
    .filter((les) => expandWeeks(les).includes(week) && les.weekday === weekday);

  const items = [];
  for (let week = weekStart; week <= weekEnd; week += 1) {
    for (const weekday of weekdays) {
      const occupied = [];
      for (const ent of resolvedEntities) {
        for (const les of busyOf(ent.type, ent.id, week, weekday)) occupied.push([les.periodStart, les.periodEnd]);
      }
      for (const win of freeWindows(occupied, rangeStart, rangeEnd, minConsecutive)) {
        items.push({
          week,
          weekday,
          weekdayName: data.meta.weekdayNames[weekday - 1],
          date: weekWeekdayToDate(week, weekday),
          periodStart: win.periodStart,
          periodEnd: win.periodEnd,
          periodText: `第${win.periodStart}-${win.periodEnd}节`,
          freePeriodCount: win.periodEnd - win.periodStart + 1,
          entities: resolvedEntities.map((ent) => ({ type: ent.type, id: ent.id, name: ent.name })),
        });
      }
    }
  }
  items.sort((a, b) => (a.week - b.week) || (a.weekday - b.weekday) || (a.periodStart - b.periodStart));
  const sliced = items.slice(0, limit);

  const env = ok({ items: sliced, actions: [] });
  env.query = {
    weekStart,
    weekEnd,
    weekdays,
    periodStart: rangeStart,
    periodEnd: rangeEnd,
    minConsecutivePeriods: minConsecutive,
    limit,
  };
  env.summary = { entityCount: resolvedEntities.length, totalWindows: items.length, returned: sliced.length };
  if (sliced.length === 0) env.evidence.note = "EMPTY_RESULT";
  return env;
}

// ---------------------------------------------------------------------------
// 工具 11（R50.0）：query_room_utilization —— 教室/楼栋/校区利用率（Ranking Core）
// ---------------------------------------------------------------------------
function queryRoomUtilization(params) {
  const input = params || {};
  const { data, byId } = loadDataset();
  const totalWeeks = data.meta.semester.totalWeeks;
  const weekStart = input.weekStart;
  const weekEnd = input.weekEnd;
  if (weekStart == null || weekEnd == null) {
    return fail(ERR.MISSING_PARAM, "缺少必填参数 weekStart/weekEnd", {});
  }
  if (!Number.isInteger(weekStart) || !Number.isInteger(weekEnd)) {
    return fail(ERR.INVALID_PARAM, "weekStart/weekEnd 需为整数", { weekStart, weekEnd });
  }
  if (weekStart < 1 || weekEnd > totalWeeks) {
    return fail(ERR.OUT_OF_RANGE, `周次必须在 1..${totalWeeks} 之间`, { weekStart, weekEnd });
  }
  if (weekEnd < weekStart) {
    return fail(ERR.INVALID_PARAM, "weekEnd 不得小于 weekStart", { weekStart, weekEnd });
  }
  const groupBy = input.groupBy || "room";
  if (!["room", "building", "campus"].includes(groupBy)) {
    return fail(ERR.INVALID_PARAM, "groupBy 需为 room/building/campus", { groupBy: input.groupBy });
  }
  const sort = input.sort || "highest";
  if (!["highest", "lowest"].includes(sort)) {
    return fail(ERR.INVALID_PARAM, "sort 需为 highest/lowest", { sort: input.sort });
  }
  let topN = null;
  if (input.topN != null) {
    topN = Number(input.topN);
    if (!Number.isInteger(topN) || topN < 1 || topN > 100) {
      return fail(ERR.INVALID_PARAM, "topN 需为 1..100 的整数", { topN: input.topN });
    }
  }
  let campusEntity = null;
  if (input.campus) {
    campusEntity = resolveCampus(data, input.campus);
    if (!campusEntity) return fail(ERR.ENTITY_NOT_FOUND, `未找到校区「${input.campus}」`, {});
  }
  const campusId = campusEntity ? campusEntity.id : null;
  const building = input.building ? String(input.building) : null;
  const roomType = input.roomType ? String(input.roomType) : null;

  const weekCount = weekEnd - weekStart + 1;
  const periodsCount = data.meta.periods.length;
  const totalUnitsPerRoom = weekCount * 7 * periodsCount;

  const occupiedUnits = new Map();
  const lessonOccurrences = new Map();
  for (const lesson of data.lessons) {
    for (const week of expandWeeks(lesson)) {
      if (week < weekStart || week > weekEnd) continue;
      let roomUnits = occupiedUnits.get(lesson.roomId);
      if (!roomUnits) { roomUnits = new Set(); occupiedUnits.set(lesson.roomId, roomUnits); }
      for (let p = lesson.periodStart; p <= lesson.periodEnd; p += 1) {
        roomUnits.add(`${week}:${lesson.weekday}:${p}`);
      }
      lessonOccurrences.set(lesson.roomId, (lessonOccurrences.get(lesson.roomId) || 0) + 1);
    }
  }

  const rooms = data.rooms.filter((r) => {
    if (r.type === "体育场地") return false;
    if (campusId && r.campusId !== campusId) return false;
    if (building && r.building !== building) return false;
    if (roomType && r.type !== roomType) return false;
    return true;
  });

  const rows = [];
  if (groupBy === "room") {
    for (const r of rooms) {
      const occ = occupiedUnits.get(r.id) ? occupiedUnits.get(r.id).size : 0;
      rows.push({
        id: r.id,
        name: r.name,
        type: "room",
        occupiedPeriodUnits: occ,
        availablePeriodUnits: Math.max(totalUnitsPerRoom - occ, 0),
        utilizationRate: totalUnitsPerRoom ? Number((occ / totalUnitsPerRoom).toFixed(4)) : 0,
        lessonOccurrences: lessonOccurrences.get(r.id) || 0,
        campusId: r.campusId,
        campusName: byId.campuses[r.campusId] ? byId.campuses[r.campusId].name : null,
        building: r.building,
        capacity: r.capacity,
        roomType: r.type,
      });
    }
  } else {
    const buckets = new Map();
    for (const r of rooms) {
      const key = groupBy === "building" ? `${r.campusId}::${r.building}` : r.campusId;
      if (!buckets.has(key)) buckets.set(key, { ids: [] });
      buckets.get(key).ids.push(r.id);
    }
    for (const [key, bucket] of buckets.entries()) {
      let occ = 0;
      let lessons = 0;
      for (const rid of bucket.ids) {
        occ += occupiedUnits.get(rid) ? occupiedUnits.get(rid).size : 0;
        lessons += lessonOccurrences.get(rid) || 0;
      }
      const roomCount = bucket.ids.length;
      const totalUnits = roomCount * totalUnitsPerRoom;
      let id = key;
      let name = key;
      if (groupBy === "building") {
        const cId = key.split("::")[0];
        name = `${byId.campuses[cId] ? byId.campuses[cId].name : cId} ${key.split("::")[1]}`;
      } else if (byId.campuses[key]) {
        name = byId.campuses[key].name;
      }
      rows.push({
        id,
        name,
        type: groupBy,
        occupiedPeriodUnits: occ,
        availablePeriodUnits: Math.max(totalUnits - occ, 0),
        utilizationRate: totalUnits ? Number((occ / totalUnits).toFixed(4)) : 0,
        lessonOccurrences: lessons,
        roomCount,
      });
    }
  }

  const ranked = buildRankingResult(rows, {
    metrics: ["utilizationRate"],
    tieBreak: ["name"],
    direction: sort === "lowest" ? "asc" : "desc",
  });

  const sliced = topN == null ? ranked.items : ranked.items.slice(0, topN);
  const items = sliced.map((it) => ({
    rank: it.rank,
    metricRank: it.metricRank,
    tiedWithPrevious: it.tiedWithPrevious,
    tieGroupId: it.tieGroupId,
    tieGroupSize: it.tieGroupSize,
    entity: it.entity,
    metrics: it.metrics,
    ...it.data,
  }));

  const env = ok({ items, actions: [] });
  env.window = { weekStart, weekEnd };
  env.rankContext = {
    source: "query_room_utilization",
    list: "utilizationRanking",
    selectedRank: null,
    metric: "utilizationRate",
    direction: sort,
  };
  env.query = {
    weekStart,
    weekEnd,
    groupBy,
    sort,
    topN: topN == null ? null : topN,
    campus: campusEntity ? campusEntity.name : null,
    building,
    roomType,
  };
  if (items.length === 0) env.evidence.note = "EMPTY_RESULT";
  return env;
}

// ---------------------------------------------------------------------------
// 工具 12（R50.0）：check_reschedule_feasibility —— 调课 What-if 完整确定性链（绝不改数据）
// ---------------------------------------------------------------------------
// 完整确定性链（最终收敛要求，2026-08）：
//   实体解析（sourceLessonId | sourceCourseId | sourceCourseName + className/classId）
//   → 教师可用性（teacherConflict）
//   → 受影响班级可用性（classConflict）
//   → 目标时段空间可用性（spaceAvailability：未指定教室时确定性查找容量/设备/空闲都满足的候选教室；
//     指定教室时由 roomConflict + capacity + feature 共同覆盖）
//   → 内在约束（容量 capacity、功能设备 feature、教学周范围）
//   → 风险（连续负荷 continuous_load、跨校区赶场 cross_campus_rush）
//   → 可行性汇总（summary.feasible / partialFeasible）+ DecisionBundle（由 decision runtime 附加）+ result-card。
// 课程存在多个课次（多个班级）时按课次逐条模拟，绝不静默挑一个；绝不修改任何数据。
function checkRescheduleFeasibility(params) {
  const input = params || {};
  const { data, byId, idx } = loadDataset();
  const totalWeeks = data.meta.semester.totalWeeks;

  // ---------- 1. 实体解析（源课次） ----------
  const lessonIdParam = input.sourceLessonId != null ? String(input.sourceLessonId).trim() : null;
  let sources = [];
  let resolvedCourse = null;
  let disambiguatedByClass = false;
  if (lessonIdParam) {
    const les = data.lessons.find((item) => item.id === lessonIdParam);
    if (!les) return fail(ERR.ENTITY_NOT_FOUND, `未找到课程「${lessonIdParam}」`, {});
    sources = [les];
  } else {
    const courseIdParam = input.sourceCourseId != null ? String(input.sourceCourseId).trim() : null;
    const courseNameParam = input.sourceCourseName != null ? String(input.sourceCourseName).trim() : null;
    let course = null;
    if (courseIdParam) {
      course = data.courses.find((c) => c.id === courseIdParam) || null;
    } else if (courseNameParam) {
      const r = resolveEntity({ type: "course", name: courseNameParam });
      if (!r.success) return r; // ENTITY_NOT_FOUND / AMBIGUOUS_ENTITY → 上游只澄清完成判断所必需的最少信息
      course = byId.courses[r.resolvedEntity.id] || null;
    }
    if (!course) {
      return fail(ERR.ENTITY_NOT_FOUND, "未找到课程，请提供课程名称或课程 id", {
        source: courseIdParam || courseNameParam || null,
      });
    }
    resolvedCourse = { type: "course", id: course.id, name: course.name };
    sources = data.lessons.filter((les) => les.courseId === course.id);
    const classIdParam = input.classId != null ? String(input.classId).trim() : null;
    const classNameParam = input.className != null ? normalizeName(String(input.className).trim()) : null;
    if (classIdParam || classNameParam) {
      const before = sources.length;
      sources = sources.filter((les) => {
        if (classIdParam && les.classIds.includes(classIdParam)) return true;
        if (classNameParam) {
          return les.classIds.some((cid) => {
            const cls = byId.classes[cid];
            return cls && cls.name === classNameParam;
          });
        }
        return false;
      });
      if (sources.length === 0) {
        return fail(ERR.ENTITY_NOT_FOUND, `课程「${course.name}」没有匹配该班级的课次`, {
          className: classNameParam || input.className || null,
          classId: classIdParam || null,
          courseLessonCount: before,
        });
      }
      disambiguatedByClass = true;
    }
    if (sources.length === 0) {
      return fail(ERR.ENTITY_NOT_FOUND, `课程「${course.name}」当前没有可模拟的课次`, {});
    }
  }
  const lessonCount = sources.length;

  // ---------- 2. 目标时段解析（week 可选：缺省取源课次首个开课周，确定性不猜测） ----------
  const target = input.target && typeof input.target === "object" ? input.target : {};
  const weekday = Number(target.weekday);
  const periodStart = Number(target.periodStart);
  const periodEnd = Number(target.periodEnd);
  if (!Number.isInteger(weekday) || !Number.isInteger(periodStart) || !Number.isInteger(periodEnd)) {
    return fail(ERR.MISSING_PARAM, "target 需包含 weekday/periodStart/periodEnd（week 可选，缺省取源课次首个开课周）", { target });
  }
  let week = Number(target.week);
  if (!Number.isInteger(week)) {
    const firstActive = sources[0] && expandWeeks(sources[0])[0];
    week = firstActive != null ? firstActive : 1;
  }
  if (week < 1 || week > totalWeeks) return fail(ERR.OUT_OF_RANGE, `week 需在 1..${totalWeeks}`, { week });
  if (weekday < 1 || weekday > 7) return fail(ERR.INVALID_PARAM, "weekday 需为 1..7", { weekday });
  if (periodStart < 1 || periodEnd > data.meta.periods.length || periodStart > periodEnd) {
    return fail(ERR.INVALID_PARAM, `periodStart/periodEnd 需在 1..${data.meta.periods.length} 且 start<=end`, { periodStart, periodEnd });
  }

  // ---------- 3. 目标教室（可选） ----------
  let targetRoom = null;
  if (target.room != null) {
    const roomParam = String(target.room).trim();
    targetRoom = data.rooms.find((r) => r.id === roomParam || r.name === roomParam);
    if (!targetRoom) {
      const r = resolveEntity({ type: "room", name: roomParam });
      if (r.success && r.resolvedEntity) targetRoom = byId.rooms[r.resolvedEntity.id];
    }
    if (!targetRoom) return fail(ERR.ENTITY_NOT_FOUND, `未找到教室「${target.room}」`, {});
  }

  const periodTimes = data.meta.periods;
  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

  const overlapCheck = (list, excludeId) => list.filter((les) => (
    les.id !== excludeId
    && expandWeeks(les).includes(week)
    && les.weekday === weekday
    && periodsOverlap(les.periodStart, les.periodEnd, periodStart, periodEnd)
  ));

  // ---------- 4. 目标时段空间可用性（未指定教室：确定性查找候选） ----------
  // 候选规则：该时段无其他占用、容量 ≥ expectedSize（存在时）、功能 ⊇ requiredFeatures（存在时）；
  // 排序：同源校区优先 → 容量升序（最小满足）→ 教室名稳定排序。
  function findSpaceCandidates(source) {
    const course = byId.courses[source.courseId];
    const required = Array.isArray(course && course.requiredFeatures) ? course.requiredFeatures : [];
    const minCapacity = course && course.expectedSize != null ? Number(course.expectedSize) : null;
    const candidates = [];
    for (const room of data.rooms) {
      if (minCapacity != null && Number(room.capacity) < minCapacity) continue;
      if (required.length && !(Array.isArray(room.features) && required.every((f) => room.features.includes(f)))) continue;
      const busy = (idx.room.get(room.id) || []).some((les) => (
        les.id !== source.id
        && expandWeeks(les).includes(week)
        && les.weekday === weekday
        && periodsOverlap(les.periodStart, les.periodEnd, periodStart, periodEnd)
      ));
      if (busy) continue;
      candidates.push(room);
    }
    candidates.sort((a, b) => {
      const aSame = a.campusId === source.campusId ? 0 : 1;
      const bSame = b.campusId === source.campusId ? 0 : 1;
      if (aSame !== bSame) return aSame - bSame;
      if (Number(a.capacity) !== Number(b.capacity)) return Number(a.capacity) - Number(b.capacity);
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return candidates;
  }

  // ---------- 5. 逐课次完整模拟 ----------
  const items = sources.map((source) => {
    const course = byId.courses[source.courseId];
    const teacherConflicts = [];
    for (const tid of source.teacherIds) {
      for (const les of overlapCheck(idx.teacher.get(tid) || [], source.id)) teacherConflicts.push(lessonDisplay(les));
    }
    const classConflicts = [];
    for (const cid of source.classIds) {
      for (const les of overlapCheck(idx.class.get(cid) || [], source.id)) classConflicts.push(lessonDisplay(les));
    }
    const roomConflicts = [];
    if (targetRoom) {
      for (const les of overlapCheck(idx.room.get(targetRoom.id) || [], source.id)) roomConflicts.push(lessonDisplay(les));
    }

    let capacityOk = true;
    let capacityNote = null;
    if (targetRoom && course && course.expectedSize != null) {
      if (Number(targetRoom.capacity) < Number(course.expectedSize)) {
        capacityOk = false;
        capacityNote = `容量不足：需要 ${course.expectedSize} 人，${targetRoom.name} 仅 ${targetRoom.capacity} 人`;
      }
    } else if (targetRoom && course && course.expectedSize == null) {
      capacityNote = "数据源未提供课程 expectedSize，容量校验跳过（fail-open）";
    }
    let featureOk = true;
    let featureNote = null;
    if (targetRoom && course && Array.isArray(course.requiredFeatures) && course.requiredFeatures.length) {
      const missing = course.requiredFeatures.filter((f) => !(Array.isArray(targetRoom.features) && targetRoom.features.includes(f)));
      if (missing.length) {
        featureOk = false;
        featureNote = `缺少功能设备：${missing.join("/")}`;
      }
    } else if (targetRoom && course && !(Array.isArray(course.requiredFeatures) && course.requiredFeatures.length)) {
      featureNote = "数据源未提供课程 requiredFeatures，功能校验跳过（fail-open）";
    }

    // 空间可用性
    let spaceOk = true;
    let spaceNote = null;
    let spaceRooms = [];
    if (targetRoom) {
      spaceOk = roomConflicts.length === 0 && capacityOk && featureOk;
      if (roomConflicts.length) spaceNote = "目标教室在该时段已被占用";
      else if (!capacityOk) spaceNote = "目标教室容量不足";
      else if (!featureOk) spaceNote = "目标教室功能设备不满足";
    } else {
      spaceRooms = findSpaceCandidates(source);
      if (spaceRooms.length === 0) {
        spaceOk = false;
        spaceNote = "该时段没有满足容量/设备要求的空闲教室";
      }
    }

    // 风险：相邻连续负荷
    const warnings = [];
    const teacherPeriods = new Set();
    for (const tid of source.teacherIds) {
      for (const les of idx.teacher.get(tid) || []) {
        if (les.id !== source.id && expandWeeks(les).includes(week) && les.weekday === weekday) {
          for (let p = les.periodStart; p <= les.periodEnd; p += 1) teacherPeriods.add(p);
        }
      }
    }
    for (let p = periodStart; p <= periodEnd; p += 1) teacherPeriods.add(p);
    let longestRun = 0;
    let run = 0;
    for (let p = 1; p <= data.meta.periods.length + 1; p += 1) {
      if (teacherPeriods.has(p)) { run += 1; longestRun = Math.max(longestRun, run); } else run = 0;
    }
    if (longestRun >= 4) {
      warnings.push({ type: "continuous_load", level: "warning", text: `调整后教师连续 ${longestRun} 节，可能存在连堂负荷` });
    }

    // 风险：跨校区赶场（目标教室与源课不同校区）
    const adjacentOf = [];
    for (const tid of source.teacherIds) {
      for (const les of idx.teacher.get(tid) || []) {
        if (les.id !== source.id && expandWeeks(les).includes(week) && les.weekday === weekday) adjacentOf.push(les);
      }
    }
    for (const cid of source.classIds) {
      for (const les of idx.class.get(cid) || []) {
        if (les.id !== source.id && expandWeeks(les).includes(week) && les.weekday === weekday) adjacentOf.push(les);
      }
    }
    const uniqueAdjacent = [...new Map(adjacentOf.map((les) => [les.id, les])).values()];
    if (targetRoom && source.campusId !== targetRoom.campusId) {
      const matrix = (data.campusTravelMatrix || {})[source.campusId] || {};
      const travel = matrix[targetRoom.campusId] || 20;
      const fromName = byId.campuses[source.campusId] ? byId.campuses[source.campusId].name : source.campusId;
      const toName = byId.campuses[targetRoom.campusId] ? byId.campuses[targetRoom.campusId].name : targetRoom.campusId;
      for (const les of uniqueAdjacent) {
        const gapBefore = toMinutes(periodTimes[periodStart - 1].start) - toMinutes(periodTimes[les.periodEnd - 1].end);
        const gapAfter = toMinutes(periodTimes[les.periodStart - 1].start) - toMinutes(periodTimes[periodEnd - 1].end);
        if (les.periodEnd + 1 === periodStart && gapBefore <= travel) {
          warnings.push({
            type: "cross_campus_rush",
            level: "warning",
            text: `跨校区赶场：${fromName} → ${toName}，仅 ${gapBefore} 分钟（交通 ${travel} 分钟）`,
          });
        }
        if (periodEnd + 1 === les.periodStart && gapAfter <= travel) {
          warnings.push({
            type: "cross_campus_rush",
            level: "warning",
            text: `跨校区赶场：${toName} → ${fromName}，仅 ${gapAfter} 分钟（交通 ${travel} 分钟）`,
          });
        }
      }
    }

    const hasConflict = teacherConflicts.length > 0 || classConflicts.length > 0 || roomConflicts.length > 0;
    const feasible = !hasConflict && capacityOk && featureOk && spaceOk;
    const reasons = [];
    if (teacherConflicts.length) reasons.push("教师时间冲突");
    if (classConflicts.length) reasons.push("班级时间冲突");
    if (roomConflicts.length) reasons.push("教室被占用");
    if (!capacityOk) reasons.push("容量不足");
    if (!featureOk) reasons.push("功能设备不匹配");
    if (!spaceOk) reasons.push("目标时段无可用教室");

    return {
      sourceLesson: lessonDisplay(source),
      target: {
        week,
        weekday,
        weekdayName: data.meta.weekdayNames[weekday - 1],
        date: weekWeekdayToDate(week, weekday),
        periodStart,
        periodEnd,
        periodText: `第${periodStart}-${periodEnd}节`,
        room: targetRoom ? {
          id: targetRoom.id,
          name: targetRoom.name,
          capacity: targetRoom.capacity,
          campusId: targetRoom.campusId,
          campusName: byId.campuses[targetRoom.campusId] ? byId.campuses[targetRoom.campusId].name : null,
        } : null,
      },
      checks: {
        teacherConflict: { conflict: teacherConflicts.length > 0, details: teacherConflicts },
        classConflict: { conflict: classConflicts.length > 0, details: classConflicts },
        roomConflict: { conflict: roomConflicts.length > 0, details: roomConflicts },
        capacity: { ok: capacityOk, note: capacityNote },
        feature: { ok: featureOk, note: featureNote },
        spaceAvailability: {
          ok: spaceOk,
          note: spaceNote,
          roomCount: targetRoom ? (spaceOk ? 1 : 0) : spaceRooms.length,
          suggestedRoom: spaceRooms[0] ? {
            id: spaceRooms[0].id,
            name: spaceRooms[0].name,
            capacity: spaceRooms[0].capacity,
            campusId: spaceRooms[0].campusId,
            campusName: byId.campuses[spaceRooms[0].campusId] ? byId.campuses[spaceRooms[0].campusId].name : null,
          } : null,
        },
      },
      warnings,
      feasible,
      reasons,
    };
  });

  const feasibleCount = items.filter((item) => item.feasible).length;
  const conflictCount = items.reduce((sum, item) => (
    sum + item.checks.teacherConflict.details.length
    + item.checks.classConflict.details.length
    + item.checks.roomConflict.details.length
  ), 0);
  const warningCount = items.reduce((sum, item) => sum + item.warnings.length, 0);

  let summaryReason;
  if (feasibleCount === items.length) {
    summaryReason = lessonCount > 1 ? `全部 ${lessonCount} 个课次均可行` : "可行";
  } else if (feasibleCount === 0) {
    summaryReason = `不可行：${items.map((item) => item.reasons.join("；") || "存在冲突").join("；") || "存在冲突"}`;
  } else {
    summaryReason = `部分可行：${feasibleCount}/${lessonCount} 个课次可行`;
  }

  const env = ok({
    resolvedEntity: resolvedCourse || (sources[0] ? {
      type: "course",
      id: sources[0].courseId,
      name: (byId.courses[sources[0].courseId] || {}).name || sources[0].courseId,
    } : null),
    items,
    actions: [],
  });
  env.summary = {
    feasible: feasibleCount === items.length && items.length > 0,
    partialFeasible: feasibleCount > 0 && feasibleCount < items.length,
    reason: summaryReason,
    conflictCount,
    warningCount,
    lessonCount,
    multiLesson: lessonCount > 1,
    classDisambiguated: disambiguatedByClass,
  };
  env.simulation = {
    sourceLessonId: sources.length === 1 ? sources[0].id : null,
    sourceLessonIds: sources.map((s) => s.id),
    sourceCourseId: resolvedCourse ? resolvedCourse.id : sources[0].courseId,
    sourceCourseName: resolvedCourse ? resolvedCourse.name : (byId.courses[sources[0].courseId] || {}).name || null,
    target: items[0].target,
    mutatedData: false,
  };
  return env;
}

// ---------------------------------------------------------------------------
// 工具 13（R50.0）：plan_group —— 群体共同空闲 + 空教室 ranked 候选
// ---------------------------------------------------------------------------
function planGroup(params) {
  const input = params || {};
  const entitiesRaw = safeJsonParse(input.entities);
  const entities = Array.isArray(entitiesRaw) ? entitiesRaw : null;
  if (!entities || entities.length < 2 || entities.length > 6) {
    return fail(ERR.INVALID_PARAM, "entities 需为 2..6 个 { type, name } 实体", { entities });
  }
  const { data, byId, idx } = loadDataset();
  const totalWeeks = data.meta.semester.totalWeeks;
  const week = input.week != null ? Number(input.week) : null;
  if (week == null || !Number.isInteger(week) || week < 1 || week > totalWeeks) {
    return fail(ERR.OUT_OF_RANGE, `week 需在 1..${totalWeeks}`, { week: input.week });
  }
  let campusEntity = null;
  if (input.campus) {
    campusEntity = resolveCampus(data, input.campus);
    if (!campusEntity) return fail(ERR.ENTITY_NOT_FOUND, `未找到校区「${input.campus}」`, {});
  }
  let weekdays = input.weekdays != null ? safeJsonParse(input.weekdays) : null;
  if (weekdays == null && input.weekday != null) weekdays = [Number(input.weekday)];
  if (weekdays == null) weekdays = [1, 2, 3, 4, 5, 6, 7];
  if (!Array.isArray(weekdays) || !weekdays.length || weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return fail(ERR.INVALID_PARAM, "weekdays 需为 1..7 的整数数组", { weekdays });
  }
  weekdays = [...new Set(weekdays)].sort((a, b) => a - b);
  const rangeStart = input.periodStart == null ? 1 : Number(input.periodStart);
  const rangeEnd = input.periodEnd == null ? data.meta.periods.length : Number(input.periodEnd);
  if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 1 || rangeEnd > data.meta.periods.length || rangeStart > rangeEnd) {
    return fail(ERR.INVALID_PARAM, `periodStart/periodEnd 需在 1..${data.meta.periods.length} 且 start<=end`, { rangeStart, rangeEnd });
  }
  const minConsecutive = input.minConsecutivePeriods == null ? 1 : Number(input.minConsecutivePeriods);
  if (!Number.isInteger(minConsecutive) || minConsecutive < 1 || minConsecutive > data.meta.periods.length) {
    return fail(ERR.INVALID_PARAM, "minConsecutivePeriods 需为 1..10", { minConsecutive: input.minConsecutivePeriods });
  }
  const minCapacity = input.minCapacity != null ? Number(input.minCapacity) : null;
  if (minCapacity != null && (!Number.isInteger(minCapacity) || minCapacity < 1)) {
    return fail(ERR.INVALID_PARAM, "minCapacity 需为正整数", { minCapacity: input.minCapacity });
  }
  const requiredFeatures = Array.isArray(safeJsonParse(input.requiredFeatures)) ? safeJsonParse(input.requiredFeatures) : [];
  for (const f of requiredFeatures) {
    if (typeof f !== "string" || !f) return fail(ERR.INVALID_PARAM, "requiredFeatures 需为字符串数组", { requiredFeatures });
  }

  const resolvedEntities = [];
  for (const e of entities) {
    if (!e || typeof e !== "object" || !e.type || !e.name) {
      return fail(ERR.INVALID_PARAM, "每个实体需包含 type 与 name", { entity: e });
    }
    if (e.type !== "teacher" && e.type !== "class") {
      return fail(ERR.INVALID_PARAM, "群体计划仅支持 teacher/class 实体", { type: e.type });
    }
    const r = resolveEntity({ type: e.type, name: e.name });
    if (!r.success) return r;
    resolvedEntities.push(r.resolvedEntity);
  }

  const busyOf = (type, id, weekday) => (idx[type === "teacher" ? "teacher" : "class"].get(id) || [])
    .filter((les) => expandWeeks(les).includes(week) && les.weekday === weekday);

  const windows = [];
  for (const weekday of weekdays) {
    const occupied = [];
    for (const ent of resolvedEntities) {
      for (const les of busyOf(ent.type, ent.id, weekday)) occupied.push([les.periodStart, les.periodEnd]);
    }
    for (const win of freeWindows(occupied, rangeStart, rangeEnd, minConsecutive)) {
      windows.push({
        weekday,
        periodStart: win.periodStart,
        periodEnd: win.periodEnd,
        freePeriodCount: win.periodEnd - win.periodStart + 1,
      });
    }
  }

  const candidates = [];
  for (const win of windows) {
    const sub = findAvailableClassrooms({
      campus: campusEntity ? campusEntity.name : undefined,
      week,
      weekday: win.weekday,
      periodStart: win.periodStart,
      periodEnd: win.periodEnd,
      minCapacity: minCapacity || undefined,
    });
    if (!sub.success) continue;
    const rooms = sub.items.filter((r) => {
      if (!requiredFeatures.length) return true;
      const room = byId.rooms[r.roomId];
      if (!room) return true; // 数据层未找到时 fail-open
      if (!Array.isArray(room.features) || !room.features.length) return true; // V2 无 features → fail-open
      return requiredFeatures.every((f) => room.features.includes(f));
    });
    if (rooms.length) {
      candidates.push({
        weekday: win.weekday,
        weekdayName: data.meta.weekdayNames[win.weekday - 1],
        date: weekWeekdayToDate(week, win.weekday),
        periodStart: win.periodStart,
        periodEnd: win.periodEnd,
        periodText: `第${win.periodStart}-${win.periodEnd}节`,
        freePeriodCount: win.freePeriodCount,
        roomCount: rooms.length,
        rooms: rooms.map((r) => ({
          roomId: r.roomId,
          roomName: r.roomName,
          building: r.building,
          campusId: r.campusId,
          campusName: r.campusName,
          capacity: r.capacity,
          type: r.type,
        })),
      });
    }
  }
  candidates.sort((a, b) => (
    b.roomCount - a.roomCount
    || b.freePeriodCount - a.freePeriodCount
    || a.weekday - b.weekday
    || a.periodStart - b.periodStart
  ));
  const items = candidates.map((c, index) => ({
    rank: index + 1,
    ...c,
    entities: resolvedEntities.map((ent) => ({ type: ent.type, id: ent.id, name: ent.name })),
  }));

  const env = ok({ items, actions: [] });
  env.query = {
    week,
    weekdays,
    campus: campusEntity ? campusEntity.name : null,
    periodStart: rangeStart,
    periodEnd: rangeEnd,
    minConsecutivePeriods: minConsecutive,
    minCapacity: minCapacity || null,
    requiredFeatures,
  };
  env.summary = { entityCount: resolvedEntities.length, candidateCount: items.length };
  if (items.length === 0) env.evidence.note = "EMPTY_RESULT";
  return env;
}

// ---------------------------------------------------------------------------
// 工具清单（MCP tools/list 与 OpenAPI 生成共用）
// ---------------------------------------------------------------------------
const TOOL_DEFS = [
  {
    name: "resolve_entity",
    description: "解析校园实体（班级/教师/教室/课程/校区/学院/演示用户），返回唯一实体或歧义候选。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ENTITY_TYPES, description: "实体类型（可选，缩小搜索范围）" },
        name: { type: "string", description: "实体名称，如 教师001 / 2025级A班 / A1-101" },
      },
      required: ["name"],
    },
    handler: resolveEntity,
  },
  {
    name: "get_academic_context",
    description: "确定性解析绝对/相对日期，并返回教学周、星期、学期与节次时间轴；默认按 Asia/Shanghai 今天。R50.0：支持结构化 intent（Temporal Semantic Core），返回 temporalContext。",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "object", description: "结构化 temporal intent：{ kind: absolute|relative_day|relative_weekday|academic_week|academic_week_weekday|week_range|future_weeks|recent_weeks|next_week|prev_week|current, ... }；对象或 JSON 字符串" },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "显式日期 YYYY-MM-DD，优先级最高" },
        dateText: { type: "string", description: "今天/明天/后天/本周X/这周X/下周X/第N周周X/YYYY-MM-DD" },
        baseDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "评测固定基准；缺省使用 Asia/Shanghai 当前日期" },
      },
    },
    handler: getAcademicContext,
  },
  {
    name: "query_schedule",
    description: "按班级/教师/教室/课程查询课表，支持教学周+星期或具体日期，支持节次过滤。",
    inputSchema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["class", "teacher", "room", "course"] },
        entityName: { type: "string" },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        week: { type: "integer", minimum: 1, maximum: 20 },
        weekday: { type: "integer", minimum: 1, maximum: 7 },
        periodStart: { type: "integer", minimum: 1, maximum: 10 },
        periodEnd: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["entityType", "entityName"],
    },
    handler: querySchedule,
  },
  {
    name: "query_schedule_range",
    description: "按班级/教师/教室/课程查询指定教学周窗口内的课表，逐周展开（每个匹配周一条），支持星期与节次过滤；只从当前 competition-demo 匿名数据集确定性派生。",
    inputSchema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["class", "teacher", "room", "course"] },
        entityName: { type: "string" },
        weekStart: { type: "integer", minimum: 1, maximum: 20, description: "起始教学周（必填，1..20）" },
        weekEnd: { type: "integer", minimum: 1, maximum: 20, description: "结束教学周（必填，1..20，须 >= weekStart）" },
        weekday: { type: "integer", minimum: 1, maximum: 7 },
        periodStart: { type: "integer", minimum: 1, maximum: 10 },
        periodEnd: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["entityType", "entityName", "weekStart", "weekEnd"],
    },
    handler: queryScheduleRange,
  },
  {
    name: "find_available_classrooms",
    description: "查询指定日期/星期与连续节次范围内的空闲教室，支持校区、楼栋、容量过滤。",
    inputSchema: {
      type: "object",
      properties: {
        campus: { type: "string", description: "校区A / 校区B（可选）" },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        week: { type: "integer", minimum: 1, maximum: 20 },
        weekday: { type: "integer", minimum: 1, maximum: 7 },
        periodStart: { type: "integer", minimum: 1, maximum: 10 },
        periodEnd: { type: "integer", minimum: 1, maximum: 10 },
        startPeriod: { type: "integer" },
        consecutivePeriods: { type: "integer" },
        building: { type: "string" },
        minCapacity: { type: "integer" },
        capacity: { type: "integer", description: "最小容量；兼容 ADP 工作流字段名" },
      },
    },
    handler: findAvailableClassrooms,
  },
  {
    name: "compare_schedules",
    description: "比较两个实体（班级/教师/教室/课程）在指定周的课表冲突；支持整周比较（weekday 可省略），并给出跨校区赶场提醒。",
    inputSchema: {
      type: "object",
      properties: {
        firstType: { type: "string", enum: ["class", "teacher", "room", "course"] },
        firstName: { type: "string" },
        secondType: { type: "string", enum: ["class", "teacher", "room", "course"] },
        secondName: { type: "string" },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        week: { type: "integer", minimum: 1, maximum: 20 },
        weekday: { type: "integer", minimum: 1, maximum: 7 },
        periodStart: { type: "integer", minimum: 1, maximum: 10 },
        periodEnd: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["firstType", "firstName", "secondType", "secondName"],
    },
    handler: compareSchedules,
  },
  {
    name: "generate_day_plan",
    description: "为演示用户生成指定日期的校园计划：课程、空闲时段与自习教室建议、跨校区提醒。",
    inputSchema: {
      type: "object",
      properties: {
        visitorId: { type: "string", description: "演示用户 visitorId / id / 名称" },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        preferredCampus: { type: "string", description: "优先校区（可选）" },
        preferredStudyDuration: { type: "integer", minimum: 1, maximum: 10, description: "期望连续自习节数（可选）" },
      },
      required: ["visitorId", "date"],
    },
    handler: generateDayPlan,
  },
  {
    name: "get_campus_teaching_overview",
    description: "确定性汇总 2026-08-25 至 2026-09-27 的校园教学态势：准备期、四周负载、空间压力、教师负载与风险；所有指标只从当前 competition-demo 匿名数据集派生。",
    inputSchema: {
      type: "object",
      properties: {
        windowStart: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "首版固定为 2026-08-25" },
        teachingStart: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "首版固定为 2026-08-31" },
        windowEnd: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "首版固定为 2026-09-27" },
      },
    },
    handler: getCampusTeachingOverview,
  },
  {
    name: "query_teacher_load",
    description: "确定性汇总指定教学周窗口内每位教师的课表负载（课时出现次数与节次单元），按负载降序稳定排序，支持 topN 与校区过滤；只从当前 competition-demo 匿名数据集派生。",
    inputSchema: {
      type: "object",
      properties: {
        weekStart: { type: "integer", minimum: 1, maximum: 20, description: "起始教学周（必填，1..20）" },
        weekEnd: { type: "integer", minimum: 1, maximum: 20, description: "结束教学周（必填，1..20，须 >= weekStart）" },
        topN: { type: "integer", minimum: 1, maximum: 10, description: "返回负载最高的前 N 位教师（可选，默认返回全部）" },
        campus: { type: "string", description: "校区A / 校区B（可选，先按校区过滤再聚合）" },
      },
      required: ["weekStart", "weekEnd"],
    },
    handler: queryTeacherLoad,
  },
  {
    name: "query_entity_search",
    description: "通用校园实体搜索/清单：支持 exact/normalized/prefix/substring/fuzzy 确定性匹配与确定排序，禁止编造实体；空关键词返回该类型清单。",
    inputSchema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ENTITY_TYPES, description: "实体类型（可选，缺省搜索全部类型）" },
        keyword: { type: "string", description: "搜索关键词（可选，空则返回清单）" },
        campus: { type: "string", description: "校区A / 校区B（可选，对支持校区字段的实体过滤）" },
        college: { type: "string", description: "学院 id 或名称（可选，对支持学院字段的实体过滤）" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "返回上限，默认 20" },
      },
    },
    handler: queryEntitySearch,
  },
  {
    name: "query_common_free_time",
    description: "查询 2..6 个教师/班级在指定教学周（或周区间）内的共同空闲连续节次窗口；支持星期/节次范围/最小连续节数过滤。",
    inputSchema: {
      type: "object",
      properties: {
        entities: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["teacher", "class"] }, name: { type: "string" } }, required: ["type", "name"] }, minItems: 2, maxItems: 6, description: "2..6 个教师/班级实体" },
        week: { type: "integer", minimum: 1, maximum: 20, description: "单周查询（与 weekStart/weekEnd 二选一）" },
        weekStart: { type: "integer", minimum: 1, maximum: 20 },
        weekEnd: { type: "integer", minimum: 1, maximum: 20, description: "须 >= weekStart" },
        weekday: { type: "integer", minimum: 1, maximum: 7 },
        weekdays: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 }, description: "星期数组（可选，缺省 1..7）" },
        periodStart: { type: "integer", minimum: 1, maximum: 10 },
        periodEnd: { type: "integer", minimum: 1, maximum: 10 },
        minConsecutivePeriods: { type: "integer", minimum: 1, maximum: 10, description: "最小连续空闲节数，默认 1" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "返回上限，默认 50" },
      },
      required: ["entities"],
    },
    handler: queryCommonFreeTime,
  },
  {
    name: "query_room_utilization",
    description: "统计指定教学周窗口内教室/楼栋/校区的利用率（occupiedPeriodUnits/availablePeriodUnits/utilizationRate/lessonOccurrences），按利用率最高/最低确定性排名。",
    inputSchema: {
      type: "object",
      properties: {
        weekStart: { type: "integer", minimum: 1, maximum: 20, description: "起始教学周（必填）" },
        weekEnd: { type: "integer", minimum: 1, maximum: 20, description: "结束教学周（必填，须 >= weekStart）" },
        campus: { type: "string", description: "校区A / 校区B（可选）" },
        building: { type: "string", description: "楼栋名（可选）" },
        roomType: { type: "string", description: "教室类型（可选）" },
        groupBy: { type: "string", enum: ["room", "building", "campus"], description: "聚合粒度，默认 room" },
        sort: { type: "string", enum: ["highest", "lowest"], description: "highest=利用率最高（默认）/ lowest=最低" },
        topN: { type: "integer", minimum: 1, maximum: 100, description: "返回前 N 名（可选，默认全部）" },
      },
      required: ["weekStart", "weekEnd"],
    },
    handler: queryRoomUtilization,
  },
  {
    name: "check_reschedule_feasibility",
    description: "What-if 模拟调课可行性（完整确定性链，绝不修改数据）：按 sourceLessonId 或 sourceCourseId/sourceCourseName（可附 className/classId 缩窄班级）解析源课程；逐课次检查教师/班级/教室冲突、目标时段空间可用性（未指定教室时确定性查找空闲且满足容量/设备要求的候选教室）、容量、功能设备、连续负荷与跨校区赶场；返回 feasible/partialFeasible/reason/conflictCount 与 warnings；课程多课次时逐条模拟；week 可选，缺省取源课次首个开课周。",
    inputSchema: {
      type: "object",
      properties: {
        sourceLessonId: { type: "string", description: "源课程 lessonId（与 sourceCourseId/sourceCourseName 三选一）" },
        sourceCourseId: { type: "string", description: "源课程 courseId（与 sourceLessonId/sourceCourseName 三选一）" },
        sourceCourseName: { type: "string", description: "源课程名称（与 sourceLessonId/sourceCourseId 三选一；多个候选时返回歧义候选）" },
        className: { type: "string", description: "班级名称（可选，用于缩窄课程多课次）" },
        classId: { type: "string", description: "班级 id（可选，用于缩窄课程多课次）" },
        target: {
          type: "object",
          properties: {
            week: { type: "integer", minimum: 1, maximum: 20, description: "目标教学周（可选，缺省取源课次首个开课周）" },
            weekday: { type: "integer", minimum: 1, maximum: 7 },
            periodStart: { type: "integer", minimum: 1, maximum: 10 },
            periodEnd: { type: "integer", minimum: 1, maximum: 10 },
            room: { type: "string", description: "目标教室 id 或名称（可选）" },
          },
          required: ["weekday", "periodStart", "periodEnd"],
        },
      },
      required: ["target"],
    },
    handler: checkRescheduleFeasibility,
  },
  {
    name: "plan_group",
    description: "为 2..6 个教师/班级生成群体计划候选：共同空闲窗口 + 该窗口空教室 + 容量/设备过滤，按候选教室数确定性 ranked 排序；禁止 LLM 拼装虚构房间。",
    inputSchema: {
      type: "object",
      properties: {
        entities: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["teacher", "class"] }, name: { type: "string" } }, required: ["type", "name"] }, minItems: 2, maxItems: 6, description: "2..6 个教师/班级实体" },
        week: { type: "integer", minimum: 1, maximum: 20, description: "教学周（必填）" },
        campus: { type: "string", description: "校区A / 校区B（可选）" },
        weekday: { type: "integer", minimum: 1, maximum: 7 },
        weekdays: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 }, description: "星期数组（可选，缺省 1..7）" },
        periodStart: { type: "integer", minimum: 1, maximum: 10 },
        periodEnd: { type: "integer", minimum: 1, maximum: 10 },
        minConsecutivePeriods: { type: "integer", minimum: 1, maximum: 10, description: "最小连续空闲节数，默认 1" },
        minCapacity: { type: "integer", minimum: 1, description: "最小教室容量（可选）" },
        requiredFeatures: { type: "array", items: { type: "string" }, description: "所需教室功能设备（可选，V3 数据集启用）" },
      },
      required: ["entities", "week"],
    },
    handler: planGroup,
  },
];

function callTool(name, params) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return fail(ERR.INVALID_PARAM, `未知工具 ${name}`, { allowed: TOOL_DEFS.map((t) => t.name) });
  try {
    return def.handler(params || {});
  } catch (err) {
    return fail(ERR.INTERNAL, "工具暂时不可用，请稍后重试", null);
  }
}

module.exports = { TOOL_DEFS, callTool };

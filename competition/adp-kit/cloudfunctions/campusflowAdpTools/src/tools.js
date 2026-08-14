/**
 * CampusTools 六个确定性校园工具。
 *
 * 每个工具都是纯函数（params => 统一信封），同时服务于：
 * - MCP（tools/call）
 * - REST（/api/<toolName>）
 * - 本地自动化测试
 *
 * 设计约定：
 * - 动态校园事实只来自 competition-demo-v1 数据集，不调用任何生成式模型；
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

// ---------------------------------------------------------------------------
// 名称归一化：容忍「教师1」「2025级a班」「a1-101」等口语写法
// ---------------------------------------------------------------------------
function normalizeName(raw) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s) return s;
  s = s.replace(/^[a-z]/, (c) => c.toUpperCase());
  s = s.replace(/级([a-d])班$/i, (m, g) => `级${g.toUpperCase()}班`);
  s = s.replace(/^教师(\d)$/, "教师00$1").replace(/^教师(\d\d)$/, "教师0$1");
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
  const { entityType, entityName } = params || {};
  if (!entityType || !SCHEDULE_INDEX_OF[entityType]) {
    return fail(ERR.INVALID_PARAM, "entityType 需为 class/teacher/room/course", { entityType });
  }
  if (!entityName) return fail(ERR.MISSING_PARAM, "缺少必填参数 entityName", {});
  const resolved = resolveEntity({ type: entityType, name: entityName });
  if (!resolved.success) return resolved;
  const entity = resolved.resolvedEntity;

  const tr = resolveTimeRange(params);
  if (tr.error) return tr.error;

  const { idx } = loadDataset();
  const all = idx[SCHEDULE_INDEX_OF[entityType]].get(entity.id) || [];
  const filtered = all.filter((les) => {
    if (!expandWeeks(les).includes(tr.week)) return false;
    if (tr.weekday != null && les.weekday !== tr.weekday) return false;
    if (params.periodStart != null && params.periodEnd != null
      && !periodsOverlap(les.periodStart, les.periodEnd, Number(params.periodStart), Number(params.periodEnd))) return false;
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
// 工具 4：find_available_classrooms —— 空教室规划
// ---------------------------------------------------------------------------
function findAvailableClassrooms(params) {
  const input = params || {};
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
  const tr = resolveTimeRange(params);
  if (tr.error) return tr.error;
  if (tr.weekday == null) {
    return fail(ERR.MISSING_PARAM, "空教室查询需要明确的 weekday（或由 date 推导）", {});
  }

  const { data, byId } = loadDataset();
  if (campus) {
    const hit = data.campuses.find((c) => c.name === normalizeName(campus));
    if (!hit) return fail(ERR.ENTITY_NOT_FOUND, `未找到校区「${campus}」`, {});
  }
  const campusId = campus ? data.campuses.find((c) => c.name === normalizeName(campus)).id : null;
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
  if (Number(timeParams.weekday) === 0) delete timeParams.weekday;
  const tr = resolveTimeRange(timeParams);
  if (tr.error) return tr.error;

  const selfCompare = r1.resolvedEntity.type === r2.resolvedEntity.type
    && r1.resolvedEntity.id === r2.resolvedEntity.id;

  const { idx, data } = loadDataset();
  const busyOf = (type, id) => (idx[SCHEDULE_INDEX_OF[type]].get(id) || [])
    .filter((les) => expandWeeks(les).includes(tr.week))
    .filter((les) => tr.weekday == null || les.weekday === tr.weekday)
    .filter((les) => {
      if (params.periodStart == null || params.periodEnd == null) return true;
      return periodsOverlap(les.periodStart, les.periodEnd, Number(params.periodStart), Number(params.periodEnd));
    });
  const busy1 = busyOf(firstType, r1.resolvedEntity.id);
  const busy2 = busyOf(secondType, r2.resolvedEntity.id);

  const conflicts = [];
  const conflictKeys = new Set();
  for (const a of busy1) {
    for (const b of busy2) {
      if (selfCompare && a.lessonId === b.lessonId) continue;
      if (a.weekday !== b.weekday) continue;
      if (!periodsOverlap(a.periodStart, a.periodEnd, b.periodStart, b.periodEnd)) continue;
      const leftId = String(a.lessonId || "");
      const rightId = String(b.lessonId || "");
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
    ? data.campuses.find((campus) => campus.name === normalizeName(params.preferredCampus))
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
  env.evidence.derivation = "competition-demo-v1 deterministic 4-week occurrence aggregation";
  env.evidence.preparationPeriodLessonCount = 0;
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
    description: "确定性解析绝对/相对日期，并返回教学周、星期、学期与节次时间轴；默认按 Asia/Shanghai 今天。",
    inputSchema: {
      type: "object",
      properties: {
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
    description: "确定性汇总 2026-08-25 至 2026-09-27 的校园教学态势：准备期、四周负载、空间压力、教师负载与风险；所有指标只从 competition-demo-v1 派生。",
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

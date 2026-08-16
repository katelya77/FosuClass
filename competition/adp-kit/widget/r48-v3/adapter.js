/*
 * R48 Widget V3 — Canonical ViewModel Adapter
 *
 * 职责边界（硬性）：
 *   只做字段映射、结构裁剪、展示文本与 Action 文案生成。
 *   不做日期推理、教学周计算、冲突计算、空教室计算、Top1 选择或身份推断。
 *   Action 文案只能引用 envelope/ViewModel 中已确认的实体与时间字段。
 *
 * 输入：CampusTools verified envelope（与 widget/adapter.js 相同的输入形态；
 *       campus_overview 使用 05 工具 items[0] 真实结构）。
 * 输出：campus-widget/v3 ViewModel（见 viewmodel-schema.json）。
 *
 * 同一份代码服务 Node 测试与浏览器预览（挂 window.R48Adapter）。
 */
(function bootstrapR48Adapter(global) {
  "use strict";

  const DATA_VERSION = "competition-demo-v1";
  const SCHEMA_VERSION = "campus-widget/v3";
  const WEEKDAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"];
  const TOTAL_WEEKS = 20;

  const ENTITY_TYPE_LABELS = {
    teacher: "教师",
    class: "班级",
    room: "教室",
    course: "课程",
    campus: "校区",
  };

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function text(value, fallback = "") {
    const str = value === undefined || value === null ? "" : String(value).trim();
    return str || fallback;
  }

  function compact(values) {
    return values.filter((value) => value !== undefined && value !== null && value !== "");
  }

  function weekdayName(value) {
    const n = Number(value);
    return n >= 1 && n <= 7 ? `周${WEEKDAY_NAMES[n - 1]}` : "";
  }

  function assertVerifiedEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object") {
      throw new Error("Widget adapter rejected missing envelope");
    }
    if (envelope.success === false) return; // 失败 envelope 由 recovery/choice 适配器处理
    if (envelope.dataVersion !== DATA_VERSION) {
      throw new Error("Widget adapter rejected unexpected dataVersion");
    }
    if (!envelope.evidence || envelope.evidence.verified !== true) {
      throw new Error("Widget adapter rejected unverified dynamic result");
    }
  }

  // 只允许写入已确认字段；week/weekday/date 未知时保持缺省，绝不推断。
  function action(id, label, message, confirmed = {}) {
    const result = { id, type: "sys.chat", label, message };
    if (confirmed.intentHint) result.intentHint = confirmed.intentHint;
    if (confirmed.entityType) result.entityType = confirmed.entityType;
    if (confirmed.entityName) result.entityName = confirmed.entityName;
    if (Number.isInteger(confirmed.week)) result.week = confirmed.week;
    if (Number.isInteger(confirmed.weekday)) result.weekday = confirmed.weekday;
    if (confirmed.date) result.date = confirmed.date;
    return result;
  }

  function baseViewModel(cardType, envelope, context) {
    return {
      schemaVersion: SCHEMA_VERSION,
      cardType,
      success: envelope && envelope.success !== false,
      queryId: text(envelope && envelope.queryId),
      dataVersion: text(envelope && envelope.dataVersion, DATA_VERSION),
      title: text(context.title || (envelope && envelope.title)),
      subtitle: text(context.subtitle),
      timeText: "",
      statusText: "",
      filters: [],
      summary: {},
      items: [],
      rushWarnings: [],
      actions: [],
      interaction: { waitForUser: false },
      evidence: { verified: Boolean(envelope && envelope.evidence && envelope.evidence.verified === true) },
      error: null,
    };
  }

  function periodTextOf(query) {
    if (!query || !Number.isInteger(Number(query.periodStart))) return "";
    const start = Number(query.periodStart);
    const end = Number(query.periodEnd || query.periodStart);
    return end > start ? `第${start}-${end}节` : `第${start}节`;
  }

  // ---------------------------------------------------------------- schedule

  function scheduleTimeText(query, items) {
    const first = asArray(items)[0] || {};
    return compact([
      Number.isInteger(Number(query.week)) ? `第${Number(query.week)}周` : "",
      weekdayName(query.weekday),
      text(query.date) || text(first.date),
    ]).join(" · ");
  }

  function buildScheduleDays(viewMode, query, items) {
    if (viewMode !== "week") {
      const weekday = Number(query.weekday) || Number(asArray(items)[0] && asArray(items)[0].weekday) || 0;
      const date = text(query.date) || text(asArray(items)[0] && asArray(items)[0].date);
      return [{
        weekday: weekday || 1,
        weekdayName: weekdayName(weekday) || "当天",
        date,
        count: items.length,
      }];
    }
    const byWeekday = new Map();
    items.forEach((item) => {
      const weekday = Number(item.weekday) || 0;
      if (weekday < 1 || weekday > 7) return;
      if (!byWeekday.has(weekday)) {
        byWeekday.set(weekday, { weekday, weekdayName: weekdayName(weekday), date: text(item.date), count: 0 });
      }
      byWeekday.get(weekday).count += 1;
      if (!byWeekday.get(weekday).date) byWeekday.get(weekday).date = text(item.date);
    });
    const days = [];
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      days.push(byWeekday.get(weekday) || { weekday, weekdayName: weekdayName(weekday), date: "", count: 0 });
    }
    return days;
  }

  function scheduleActionsV3(viewMode, entity, query) {
    const name = text(entity.name);
    if (!name) return [];
    const entityType = text(entity.type);
    const week = Number.isInteger(Number(query.week)) ? Number(query.week) : null;
    const weekday = Number.isInteger(Number(query.weekday)) ? Number(query.weekday) : null;
    const date = text(query.date);
    const confirmed = { entityType, entityName: name, week, weekday, date };

    const chooseDay = () => week
      ? action("schedule-choose-day", "换一天", `【小序操作:选择课表日期】${name}|第${week}周`, { ...confirmed, intentHint: "schedule_choose_day" })
      : action("schedule-choose-day", "换一天", `换日期查看${name}的课表`, { ...confirmed, intentHint: "schedule_choose_day" });
    const wholeWeek = () => week
      ? action("schedule-week", "查看整周", `查询${name}第${week}周的课表`, { ...confirmed, intentHint: "schedule_week" })
      : action("schedule-week", "查看整周", `查看${name}的整周课表`, { ...confirmed, intentHint: "schedule_week" });
    const dayRisk = () => {
      if (week && weekday) {
        return action("schedule-risk", "检查风险", `检查${name}第${week}周${weekdayName(weekday)}是否存在时间冲突或跨校区赶场`, { ...confirmed, intentHint: "schedule_risk_check" });
      }
      if (date) {
        return action("schedule-risk", "检查风险", `检查${name}在${date}是否存在时间冲突或跨校区赶场`, { ...confirmed, intentHint: "schedule_risk_check" });
      }
      return action("schedule-risk", "检查风险", `检查${name}的课程安排风险`, { ...confirmed, intentHint: "schedule_risk_check" });
    };

    if (viewMode === "week" && week) {
      const list = [];
      if (week > 1) list.push(action("schedule-prev-week", "上一周", `查询${name}第${week - 1}周的课表`, { ...confirmed, week: week - 1, weekday: null, intentHint: "schedule_week" }));
      if (week < TOTAL_WEEKS) list.push(action("schedule-next-week", "下一周", `查询${name}第${week + 1}周的课表`, { ...confirmed, week: week + 1, weekday: null, intentHint: "schedule_week" }));
      if (entityType === "teacher") {
        list.push(action("schedule-week-risk", "检查本周风险", `检查${name}第${week}周是否存在时间冲突或跨校区赶场`, { ...confirmed, weekday: null, intentHint: "schedule_risk_check" }));
      } else {
        list.push(chooseDay());
      }
      return list.slice(0, 3);
    }

    const list = [wholeWeek(), chooseDay()];
    if (entityType === "teacher") list.push(dayRisk());
    else if (entityType === "room" && week && weekday) {
      list.push(action("schedule-room-free", "查空闲时段", `查询${name}第${week}周${weekdayName(weekday)}的空闲时段`, { ...confirmed, intentHint: "schedule_day" }));
    }
    return list.slice(0, 3);
  }

  function adaptScheduleV3(envelope, context = {}) {
    assertVerifiedEnvelope(envelope);
    const view = baseViewModel("schedule", envelope, context);
    const entity = asObject(envelope.resolvedEntity);
    const query = asObject(envelope.query);
    const items = asArray(envelope.items).map((item) => ({
      lessonId: text(item.lessonId),
      courseName: text(item.courseName, "未命名课程"),
      periodText: text(item.periodText),
      startTime: text(item.startTime),
      endTime: text(item.endTime),
      date: text(item.date),
      weekday: Number(item.weekday) || null,
      weekdayName: text(item.weekdayName),
      campusName: text(item.campusName),
      building: text(item.building),
      roomName: text(item.roomName),
      teachers: asArray(item.teachers).map((name) => text(name)).filter(Boolean),
      classes: asArray(item.classes).map((name) => text(name)).filter(Boolean),
    }));

    const viewMode = context.viewMode || (text(query.date) && !Number(query.weekday) ? "date" : Number(query.weekday) ? "day" : "week");
    const campuses = new Set(items.map((item) => item.campusName).filter(Boolean));
    const days = buildScheduleDays(viewMode, query, items);
    const activeWeekday = viewMode === "week"
      ? (days.find((day) => day.count > 0) || days[0]).weekday
      : (Number(query.weekday) || (days[0] ? days[0].weekday : null));

    view.title = text(context.title) || text(entity.name, "课表查询结果");
    view.subtitle = ENTITY_TYPE_LABELS[text(entity.type)] || "";
    view.statusText = "已核验";
    view.timeText = scheduleTimeText(query, items);
    view.viewMode = viewMode;
    view.activeWeekday = activeWeekday;
    view.days = days;
    view.summary = {
      totalCount: items.length,
      shownCount: items.length,
      hiddenCount: 0,
      entityType: text(entity.type),
      entityTypeLabel: ENTITY_TYPE_LABELS[text(entity.type)] || "对象",
      entityName: text(entity.name),
      campusCount: campuses.size,
    };
    view.items = items;
    view.actions = scheduleActionsV3(viewMode, entity, query);
    view.footerText = `数据源：校园课表工具 · ${view.dataVersion}`;
    return view;
  }

  // --------------------------------------------------------------- classroom

  function classroomFiltersV3(query) {
    const filters = [];
    if (text(query.campus)) filters.push({ id: "campus", label: text(query.campus), value: text(query.campus) });
    if (text(query.date)) filters.push({ id: "date", label: text(query.date), value: text(query.date) });
    else if (Number.isInteger(Number(query.week))) {
      filters.push({ id: "week", label: `第${Number(query.week)}周${weekdayName(query.weekday)}`, value: Number(query.week) });
    }
    const period = periodTextOf(query);
    if (period) filters.push({ id: "period", label: period, value: period });
    if (text(query.building)) filters.push({ id: "building", label: text(query.building), value: text(query.building) });
    if (Number(query.capacity) > 0) filters.push({ id: "capacity", label: `≥${Number(query.capacity)}人`, value: Number(query.capacity) });
    return filters;
  }

  function classroomActionsV3(query, filters, empty) {
    const hasCapacity = filters.some((item) => item.id === "capacity");
    const hasBuilding = filters.some((item) => item.id === "building");
    const keep = "其他条件不变";
    const datePart = text(query.date) ? `，日期保持${text(query.date)}` : "";
    const periodPart = periodTextOf(query) ? `，节次保持${periodTextOf(query)}` : "";

    if (empty) {
      const list = [];
      if (hasCapacity) list.push(action("classroom-relax-capacity", "放宽容量", `取消容量限制${datePart}${periodPart}，${keep}`, { intentHint: "classroom_find" }));
      if (hasBuilding) list.push(action("classroom-remove-building", "取消楼栋", `取消楼栋限制${datePart}${periodPart}，${keep}`, { intentHint: "classroom_find" }));
      list.push(action("classroom-change-period", "换时段", `换一个时段再找空教室${datePart}，${keep}`, { intentHint: "classroom_find" }));
      return list.slice(0, 3);
    }

    const campus = text(query.campus);
    const otherCampus = campus === "校区A" ? "校区B" : campus === "校区B" ? "校区A" : "";
    const list = [];
    list.push(otherCampus
      ? action("classroom-change-campus", "换校区", `换成${otherCampus}${datePart}${periodPart}，${keep}`, { intentHint: "classroom_find" })
      : action("classroom-change-campus", "换校区", `换一个校区再找空教室${datePart}${periodPart}，${keep}`, { intentHint: "classroom_find" }));
    list.push(action("classroom-change-date", "换日期", `改日期再查空教室（当前${text(query.date) || `第${Number(query.week)}周${weekdayName(query.weekday)}`}），${keep}`, { intentHint: "classroom_find" }));
    list.push(hasCapacity
      ? action("classroom-relax-capacity", "放宽容量", `取消容量限制${datePart}${periodPart}，${keep}`, { intentHint: "classroom_find" })
      : action("classroom-capacity-60", "容量≥60", `容量至少60人${datePart}${periodPart}，${keep}`, { intentHint: "classroom_find" }));
    return list.slice(0, 3);
  }

  function adaptClassroomV3(envelope, context = {}) {
    assertVerifiedEnvelope(envelope);
    const view = baseViewModel("classroom", envelope, context);
    const query = asObject(envelope.query);
    const allItems = asArray(envelope.items).map((item) => ({
      roomName: text(item.roomName, "教室"),
      campusName: text(item.campusName),
      building: text(item.building),
      capacity: Number(item.capacity || 0),
      roomType: text(item.roomType || item.type),
      periodText: text(item.periodText),
      date: text(item.date),
    }));
    const shown = allItems.slice(0, 5);
    const filters = classroomFiltersV3(query);

    view.title = text(context.title) || `${text(query.campus, "校园")} · 空教室`;
    view.subtitle = "可用空间查询";
    view.statusText = "已核验";
    view.timeText = compact([text(query.date), Number.isInteger(Number(query.week)) ? `第${Number(query.week)}周` : "", weekdayName(query.weekday), periodTextOf(query)]).join(" · ");
    view.filters = filters;
    view.summary = {
      totalCount: allItems.length,
      shownCount: shown.length,
      hiddenCount: Math.max(allItems.length - shown.length, 0),
      empty: allItems.length === 0,
    };
    view.items = shown;
    view.actions = classroomActionsV3(query, filters, allItems.length === 0);
    view.footerText = `数据源：空教室工具 · ${view.dataVersion}`;
    return view;
  }

  // ---------------------------------------------------------------- conflict

  function conflictLessonSide(side) {
    const value = asObject(side);
    return {
      courseName: text(value.courseName, "课程"),
      periodText: text(value.periodText),
      campusName: text(value.campusName),
      roomName: text(value.roomName),
    };
  }

  function conflictActionsV3(selfCompare, firstName, secondName, query) {
    const week = Number.isInteger(Number(query.week)) ? Number(query.week) : null;
    const weekday = Number.isInteger(Number(query.weekday)) ? Number(query.weekday) : null;
    const date = text(query.date);
    const daySchedule = (name) => {
      if (week && weekday) return `查询${name}第${week}周${weekdayName(weekday)}的课`;
      if (date) return `查询${name}${date}的课表`;
      return `查看${name}当天的课表`;
    };
    const weekSchedule = (name) => (week ? `查询${name}第${week}周的课表` : `查看${name}的整周课表`);

    if (selfCompare) {
      return [
        action("conflict-self-day", "查看当天课表", daySchedule(firstName), { intentHint: "schedule_day", entityName: firstName, week, weekday, date }),
        action("conflict-self-week", "查看整周课表", weekSchedule(firstName), { intentHint: "schedule_week", entityName: firstName, week }),
      ];
    }
    return [
      action("conflict-first-schedule", `查看${firstName}课表`, weekSchedule(firstName), { intentHint: "schedule_week", entityName: firstName, week }),
      action("conflict-second-schedule", `查看${secondName}课表`, weekSchedule(secondName), { intentHint: "schedule_week", entityName: secondName, week }),
    ];
  }

  function adaptConflictV3(envelope, context = {}) {
    assertVerifiedEnvelope(envelope);
    const view = baseViewModel("conflict", envelope, context);
    const compared = asArray(envelope.compared);
    const summary = asObject(envelope.summary);
    const query = asObject(envelope.query);
    const selfCompare = summary.selfCompare === true;
    const firstName = text(asObject(compared[0]).name, "第一对象");
    const secondName = text(asObject(compared[1]).name, "第二对象");
    const conflicts = asArray(envelope.items).map((item) => ({
      date: text(item.date),
      weekdayName: text(item.weekdayName),
      periodText: text(item.periodText),
      first: conflictLessonSide(item.first),
      second: conflictLessonSide(item.second),
    }));
    const rushWarnings = asArray(envelope.rushWarnings).map((warning) => ({
      entity: text(warning.entity),
      date: text(warning.date),
      weekdayName: text(warning.weekdayName),
      gapMinutes: Number(warning.gapMinutes || 0),
      from: conflictLessonSide(warning.from),
      to: conflictLessonSide(warning.to),
    }));
    const rushCount = Number(summary.rushWarningCount !== undefined ? summary.rushWarningCount : rushWarnings.length);

    view.title = text(context.title) || (selfCompare
      ? `${firstName} · 课程安排风险检查`
      : `${firstName} vs ${secondName} · 课程冲突比较`);
    view.subtitle = selfCompare ? "单对象排课风险" : "双对象时间比较";
    view.statusText = "已核验";
    view.timeText = compact([
      Number.isInteger(Number(query.week)) ? `第${Number(query.week)}周` : "",
      weekdayName(query.weekday),
      text(query.date),
    ]).join(" · ");
    view.summary = {
      conflictCount: conflicts.length,
      rushWarningCount: rushCount,
      selfCompare,
      firstBusySlots: Number(summary.firstBusySlots || 0),
      secondBusySlots: Number(summary.secondBusySlots || 0),
    };
    view.items = conflicts;
    view.rushWarnings = rushWarnings;
    view.actions = conflictActionsV3(selfCompare, firstName, secondName, query);
    view.footerText = `数据源：冲突比较工具 · ${view.dataVersion}`;
    return view;
  }

  // --------------------------------------------------------------- day plan

  function adaptDayPlanV3(envelope, context = {}) {
    assertVerifiedEnvelope(envelope);
    const view = baseViewModel("day_plan", envelope, context);
    const query = asObject(envelope.query);
    const summary = asObject(envelope.summary);
    const items = asArray(envelope.items).map((item) => ({
      type: ["lesson", "gap", "study", "risk"].includes(item.type) ? item.type : "note",
      lessonId: text(item.lessonId),
      courseName: text(item.courseName),
      periodText: text(item.periodText),
      startTime: text(item.startTime),
      endTime: text(item.endTime),
      campusName: text(item.campusName),
      roomName: text(item.roomName),
      teachers: asArray(item.teachers).map((name) => text(name)).filter(Boolean),
      suggestion: text(item.suggestion || item.text),
      studyRooms: asArray(item.studyRooms).map((name) => text(name)).filter(Boolean).slice(0, 2),
    }));
    const date = text(query.date) || text(envelope.timeText);
    // 下一天：仅当工具已解析出 nextDate 时才携带确定日期，否则把已确认日期作为锚点交回 00 总控。
    const nextDate = text(query.nextDate);
    const nextDayMessage = nextDate
      ? `安排${nextDate}的一天，其他偏好不变`
      : `基于${date || "这一天"}继续安排下一天，其他偏好不变`;

    view.title = text(context.title) || `${date || "当天"} · 一天安排`;
    view.subtitle = "今日校园计划";
    view.statusText = "已核验";
    view.timeText = compact([date, weekdayName(query.weekday)]).join(" · ");
    view.summary = {
      lessonCount: Number(summary.lessonCount !== undefined ? summary.lessonCount : items.filter((item) => item.type === "lesson").length),
      gapCount: Number(summary.gapCount !== undefined ? summary.gapCount : items.filter((item) => item.type === "gap").length),
      studySuggestionCount: items.filter((item) => item.studyRooms.length > 0).length,
      hasCrossCampus: summary.hasCrossCampus === true,
    };
    view.items = items;
    view.actions = [
      action("day-plan-next-day", "下一天", nextDayMessage, { intentHint: "day_plan", date: nextDate }),
      action("day-plan-campus-pref", "换校区偏好", `重新安排${date || "这一天"}的一天，我想换校区偏好`, { intentHint: "day_plan", date }),
      action("day-plan-study-2", "连续自习2节", `安排${date || "这一天"}的一天，希望连续自习2节`, { intentHint: "day_plan", date }),
    ];
    view.footerText = `数据源：今日计划工具 · ${view.dataVersion}`;
    return view;
  }

  // ---------------------------------------------------------- campus overview

  function percentText(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
  }

  function adaptCampusOverviewV3(envelope, context = {}) {
    assertVerifiedEnvelope(envelope);
    const view = baseViewModel("campus_overview", envelope, context);
    const overview = asObject(asArray(envelope.items)[0]);
    const windowInfo = asObject(overview.window);
    const preparation = asObject(windowInfo.preparationPeriod);
    const summary = asObject(overview.summary);
    const matrix = asArray(overview.matrix);
    const campuses = asArray(overview.campusResources).map((item) => {
      const campus = asObject(item);
      return {
        campusName: text(campus.campusName, "校区"),
        occurrences: Number(campus.lessonOccurrences || 0),
        loadText: `${text(campus.campusName, "校区")} · ${Number(campus.lessonOccurrences || 0)} 次课程 · 占用率 ${percentText(campus.occupancyRate)}`,
        freeText: `可用教室时段 ${Number(campus.freeRoomPeriodUnits || 0)} · ≥60人资源可用率 ${percentText(campus.largeRoomAvailabilityRate)}`,
      };
    });
    const topTeachers = asArray(overview.teacherLoadTop).slice(0, 3).map((item) => {
      const teacher = asObject(item);
      return {
        teacherName: text(teacher.teacherName, "教师"),
        loadText: `${Number(teacher.lessonOccurrences || 0)} 次课程 · ${Number(teacher.periodUnits || 0)} 节次`,
      };
    });
    const risks = asObject(overview.risks);
    const peak = asObject(overview.peakSlot);
    const weeks = matrix.slice(0, 4).map((row, index) => ({
      label: `W${index + 1}`,
      count: asArray(asObject(row).days).reduce((sum, day) => sum + Number(asObject(day).lessonCount || 0), 0),
    }));
    // Top1 只读取工具输出的 teacherLoadTop[0]；教学周沿用 05 已验证口径（首个教学周）。
    const firstTeachingWeek = 1;
    const top1 = topTeachers[0] || null;
    const busiestCampus = campuses.reduce(
      (best, item) => (!best || item.occurrences > best.occurrences ? item : best),
      null,
    );

    view.title = text(context.title) || "未来四周 · 校园教学态势";
    view.subtitle = "校园运行概览";
    view.statusText = "已核验";
    view.timeText = `${text(windowInfo.windowStart)} ～ ${text(windowInfo.windowEnd)}`;
    view.phaseText = text(preparation.startDate)
      ? `${text(preparation.startDate)}～${text(preparation.endDate)} 准备期无教学安排 · ${text(windowInfo.teachingStart)} 起进入教学周`
      : "";
    view.summary = {
      lessonOccurrences: Number(summary.lessonOccurrences || 0),
      teacherCount: Number(summary.teacherCount || 0),
      roomCount: Number(summary.roomCount || 0),
      campusCount: Number(summary.campusCount || 0),
      weekCount: Number(summary.weekCount || weeks.length),
    };
    view.metrics = compact([
      Number(summary.lessonOccurrences || 0) > 0 ? { id: "lessons", label: "课程总量", value: `${Number(summary.lessonOccurrences)} 次` } : null,
      busiestCampus ? { id: "busiest-campus", label: "最忙校区", value: busiestCampus.campusName } : null,
      top1 ? { id: "top-teacher", label: "高负载教师", value: top1.teacherName } : null,
      { id: "rush", label: "跨校区赶场", value: `${Number(risks.rushCount || 0)} 起` },
    ]).slice(0, 4);
    view.weeks = weeks;
    view.campuses = campuses;
    view.topTeachers = topTeachers;
    view.top1 = top1 ? { teacherName: top1.teacherName, loadText: top1.loadText, week: firstTeachingWeek } : null;
    view.risks = {
      conflictCount: Number(risks.conflictCount || 0),
      rushCount: Number(risks.rushCount || 0),
      continuousLoadCount: Number(risks.continuousLoadCount || 0),
      summaryText: `时间冲突 ${Number(risks.conflictCount || 0)} · 跨校区赶场 ${Number(risks.rushCount || 0)} · 连续课负载 ${Number(risks.continuousLoadCount || 0)}`,
      peakText: text(peak.weekdayName)
        ? `高峰：第${Number(peak.week || 0)}周${text(peak.weekdayName)}第${Number(peak.period || 0)}节 · ${Number(peak.lessonCount || 0)} 次课程`
        : "",
    };
    view.actions = top1 ? [
      action("overview-top1-schedule", "查看Top1课表", `查询${top1.teacherName}第${firstTeachingWeek}周的课表`, { intentHint: "schedule_week", entityType: "teacher", entityName: top1.teacherName, week: firstTeachingWeek }),
      action("overview-top1-risk", "检查Top1风险", `检查${top1.teacherName}第${firstTeachingWeek}周是否存在时间冲突或跨校区赶场`, { intentHint: "schedule_risk_check", entityType: "teacher", entityName: top1.teacherName, week: firstTeachingWeek }),
      action("overview-classroom", "查空教室", `查找第${firstTeachingWeek}周校园空教室`, { intentHint: "classroom_find", week: firstTeachingWeek }),
    ] : [
      action("overview-classroom", "查空教室", `查找第${firstTeachingWeek}周校园空教室`, { intentHint: "classroom_find", week: firstTeachingWeek }),
    ];
    view.footerText = `数据源：校园教学态势工具 · ${view.dataVersion}`;
    return view;
  }

  // ------------------------------------------------------------------ choice

  function adaptChoiceV3(envelope, context = {}) {
    const view = baseViewModel("choice", envelope || { success: false }, context);
    const originalTask = text(context.originalTask, "刚才的查询");
    view.success = false;
    view.title = text(context.title, "找到多个匹配，请确认一个");
    view.subtitle = text(context.subtitle, "选择后继续刚才的任务，不需要重新输入");
    view.statusText = "请确认对象";
    view.interaction.waitForUser = true;
    view.items = asArray(envelope && envelope.items).slice(0, 5).map((item, index) => {
      const name = text(item.name, `候选${index + 1}`);
      return {
        key: text(item.key, `choice-${index + 1}`),
        name,
        typeLabel: ENTITY_TYPE_LABELS[text(item.type)] || text(item.type, "对象"),
        description: text(item.description || item.campusName || item.collegeName),
        message: `选择${name}，继续${originalTask}`,
      };
    });
    view.actions = [action("choice-rephrase", "重新描述", "我重新描述一下查询对象", { intentHint: "rephrase" })];
    view.error = envelope && envelope.error ? { code: text(envelope.error.code, "AMBIGUOUS_ENTITY") } : null;
    return view;
  }

  // ---------------------------------------------------------------- recovery

  const RECOVERY_COPY = {
    ENTITY_NOT_FOUND: { title: "没有找到这个校园对象", reason: "当前名称没有匹配到已核验的教师、班级、教室或课程。" },
    AMBIGUOUS_ENTITY: { title: "找到多个可能对象", reason: "需要先确认查询对象后才能继续。" },
    INVALID_PARAM: { title: "部分查询条件不符合规则", reason: "请调整条件后重试，动态事实不会被补造。" },
    OUT_OF_RANGE: { title: "这个日期超出了当前学期可查询范围", reason: "只能查询当前学期内的日期与教学周。" },
    MISSING_PARAM: { title: "还缺少一些查询条件", reason: "补充关键条件后即可继续，不需要从头描述。" },
    TIMEOUT: { title: "校园工具暂时没有返回可核验结果", reason: "本次没有使用模型补造任何动态事实，可直接重试。" },
    TOOL_FAILURE: { title: "校园工具暂时没有返回可核验结果", reason: "本次没有使用模型补造任何动态事实，可直接重试。" },
  };

  function recoveryActionsV3(code) {
    if (code === "OUT_OF_RANGE") {
      return [
        action("recovery-semester-range", "查看学期范围", "本学期可查询的日期范围是什么", { intentHint: "semester_range" }),
        action("recovery-first-week", "改到开学第一周", "查询开学第1周的安排", { intentHint: "schedule_week", week: 1 }),
      ];
    }
    if (code === "ENTITY_NOT_FOUND" || code === "AMBIGUOUS_ENTITY") {
      return [
        action("recovery-edit-entity", "修改对象", "我想换一个查询对象", { intentHint: "rephrase" }),
        action("recovery-retry", "重新查询", "重新执行刚才的查询", { intentHint: "retry" }),
      ];
    }
    if (code === "MISSING_PARAM" || code === "INVALID_PARAM") {
      return [
        action("recovery-edit-query", "修改条件", "我想补充或修改刚才的查询条件", { intentHint: "rephrase" }),
        action("recovery-retry", "重新查询", "重新执行刚才的查询", { intentHint: "retry" }),
      ];
    }
    return [
      action("recovery-retry", "重试", "重新执行刚才的查询", { intentHint: "retry" }),
      action("recovery-edit-query", "修改条件", "我想修改刚才的查询条件", { intentHint: "rephrase" }),
    ];
  }

  function adaptRecoveryV3(envelope, context = {}) {
    const view = baseViewModel("recovery", envelope || { success: false }, context);
    const error = asObject(envelope && envelope.error);
    const code = text(error.code, "TOOL_FAILURE");
    const copy = RECOVERY_COPY[code] || RECOVERY_COPY.TOOL_FAILURE;
    const query = asObject(envelope && envelope.query);
    view.success = false;
    view.title = text(context.title, copy.title);
    view.subtitle = "任务恢复 · 事实未核验时不展示推测结果";
    view.statusText = "任务恢复";
    view.interaction.waitForUser = true;
    view.reasonText = text(context.message || error.message, copy.reason);
    view.keptFilters = classroomFiltersV3(query);
    view.actions = recoveryActionsV3(code).slice(0, 3);
    view.error = { code };
    view.footerText = "未核验状态下不展示任何推测性校园事实";
    return view;
  }

  const api = Object.freeze({
    DATA_VERSION,
    SCHEMA_VERSION,
    adaptScheduleV3,
    adaptClassroomV3,
    adaptConflictV3,
    adaptDayPlanV3,
    adaptCampusOverviewV3,
    adaptChoiceV3,
    adaptRecoveryV3,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.R48Adapter = api;
})(typeof window !== "undefined" ? window : globalThis);

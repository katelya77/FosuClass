"use strict";
// R50.4 确定性投影：CampusResultEnvelope + raw 工具结果 → WidgetViewModel（2026-08-19）
//
// layoutMode 决策（单一规则，无模型参与）：
//  - variant=schedule 且为整周 / 周范围查询（campus_schedule_query / campus_schedule_range_query、
//    无单日过滤、存在已核验课程事实）→ "week-board"；
//  - 其余全部（含 campus_day_plan 单日计划、带 weekday 过滤的课表、space / collaboration /
//    risk / reschedule / ranking / overview / empty / error / message）→ "result-card"。
//
// week-board 数据（聊天卡片友好的扁平结构）：
//  - weekBoardTitle / weekBoardSubtitle：复用 Envelope 标题区；
//  - days[0..6]：周一..周日，每项 { label, blocks: [{ time, title, location, meta }] }，
//    对应需求字段 day0Label~day6Label + 每日课程块（days[i].label / days[i].blocks）；
//  - 多周范围时 block.meta 携带「第X周」，按（weekday, periodStart, 课程名）确定性排序；
//  - 空天不输出板块，仅保留有课程块的 day。
//
// fail-closed：整周判定成立但课程为空 / 结构损坏 → 回退 layoutMode="result-card"
// （结果卡仍展示原 Envelope 内容，不丢失事实）。
//
// 与 R50.2B 边界一致：不输出 queryId / dataHash / sourceTool / rankContext /
// temporalContext / NodeID / VarBizID / token / 内部 URL；action 只走官方 sys.chat，
// payload 只含用户语义 query。
const { isClean, validateEnvelope } = require("./envelope.js");

const LAYOUT_WEEK_BOARD = "week-board";
const LAYOUT_RESULT_CARD = "result-card";
const LAYOUT_MODES = [LAYOUT_RESULT_CARD, LAYOUT_WEEK_BOARD];

const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WEEKDAY_INDEX = { 周一: 0, 周二: 1, 周三: 2, 周四: 3, 周五: 4, 周六: 5, 周日: 6 };

// 周视图来源工具：整周/周范围课表（campus_day_plan 为单日计划，不在此列）。
const WEEK_SCHEDULE_TOOLS = new Set(["campus_schedule_query", "campus_schedule_range_query"]);

function isWholeWeekScope(raw, toolName) {
  if (!WEEK_SCHEDULE_TOOLS.has(toolName)) return false;
  if (!raw || !raw.query || raw.query.weekday != null) return false;
  return Boolean(raw.window && raw.window.weekStart != null);
}

function collectLessons(raw) {
  const items = Array.isArray(raw && raw.items) ? raw.items : [];
  const lessons = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.type && item.type !== "lesson") continue;
    const lesson = item.lesson && item.lesson.courseName ? item.lesson : item;
    if (lesson && lesson.courseName) lessons.push(lesson);
  }
  return lessons;
}

function isRange(raw) {
  const window = raw && raw.window;
  return Boolean(window && window.weekStart != null && window.weekEnd != null && window.weekEnd > window.weekStart);
}

function weekTextOf(lesson, raw) {
  if (!isRange(raw)) return "";
  const week = lesson.weeks && lesson.weeks.length === 1
    ? `第${lesson.weeks[0]}周`
    : raw.window && raw.window.weekStart != null
      ? `第${raw.window.weekStart}-${raw.window.weekEnd}周`
      : "";
  return week;
}

function peopleOf(lesson) {
  return [...(lesson.teachers || []), ...(lesson.classes || [])].join(" · ");
}

function buildBlock(lesson, raw) {
  const meta = [];
  const clock = lesson.startTime && lesson.endTime ? `${lesson.startTime}-${lesson.endTime}` : "";
  if (clock) meta.push(clock);
  const people = peopleOf(lesson);
  if (people) meta.push(people);
  const week = weekTextOf(lesson, raw);
  if (week) meta.push(week);
  const block = {
    time: lesson.periodText || "",
    title: lesson.courseName,
    location: `${lesson.campusName || ""} ${lesson.roomName || "教室未定"}`.trim(),
  };
  if (meta.length) block.meta = meta.join(" · ");
  return block;
}

function buildDays(lessons, raw) {
  const days = DAY_LABELS.map((label) => ({ label, blocks: [] }));
  for (const lesson of lessons) {
    const index = WEEKDAY_INDEX[lesson.weekdayName];
    if (index == null) continue;
    const weekdayNumber = Number(lesson.weekday);
    const block = buildBlock(lesson, raw);
    if (!block.time || !block.title || !block.location) continue;
    days[index].blocks.push({
      ...block,
      _sortWeek: weekdayNumber || index + 1,
      _sortPeriod: Number(lesson.periodStart) || 0,
      _sortTitle: block.title,
    });
  }
  for (const day of days) {
    day.blocks.sort((a, b) => a._sortWeek - b._sortWeek || a._sortPeriod - b._sortPeriod || (a._sortTitle < b._sortTitle ? -1 : a._sortTitle > b._sortTitle ? 1 : 0));
    for (const block of day.blocks) {
      delete block._sortWeek;
      delete block._sortPeriod;
      delete block._sortTitle;
    }
  }
  return days.filter((day) => day.blocks.length > 0);
}

function buildDayDetailAction(raw, days, envelope) {
  const firstDay = days.length ? days[0] : null;
  if (!firstDay) return null;
  const entityName = raw && raw.resolvedEntity && raw.resolvedEntity.name ? raw.resolvedEntity.name : "";
  const window = raw && raw.window;
  const weekText = window && window.weekStart != null
    ? window.weekStart === window.weekEnd ? `第${window.weekStart}周` : `第${window.weekStart}-${window.weekEnd}周`
    : "";
  const query = `查看${entityName}${weekText}${firstDay.label}的课表明细`.trim();
  return { id: "weekboard-day-detail", type: "sys.chat", label: `看${firstDay.label}明细`, payload: { query } };
}

function isWeekBoardRequest(envelope) {
  return Boolean(envelope && envelope.variant === "schedule" && envelope.layoutMode === LAYOUT_WEEK_BOARD);
}

/**
 * 唯一入口：raw 工具结果 + Agent Tool 名 + 已投影 Envelope → { ok, errors, viewModel }。
 * layoutMode 由确定性规则派生；week-board 视图从 raw 重新派生课程块（与 Envelope 同源事实），
 * 结构损坏时回退 result-card。
 */
function projectViewModel(raw, toolName, envelope) {
  if (!envelope || !validateEnvelope(envelope).ok) {
    return { ok: false, errors: ["envelope 非法或缺失"], viewModel: null };
  }
  const base = {
    version: envelope.version || "1.0",
    variant: envelope.variant,
    status: envelope.status,
    title: envelope.title,
    subtitle: envelope.subtitle || "",
    verified: envelope.verified,
    summary: envelope.summary,
    context: envelope.context || "",
    sections: Array.isArray(envelope.sections) ? envelope.sections : [],
    actions: Array.isArray(envelope.actions) ? envelope.actions : [],
    displayMeta: envelope.displayMeta || {},
  };

  if (isWeekBoardRequest(envelope) || (envelope.variant === "schedule" && isWholeWeekScope(raw, toolName))) {
    const lessons = collectLessons(raw);
    if (lessons.length > 0) {
      const days = buildDays(lessons, raw);
      const extraAction = buildDayDetailAction(raw, days, envelope);
      const viewModel = {
        ...base,
        layoutMode: LAYOUT_WEEK_BOARD,
        weekBoardTitle: envelope.title,
        weekBoardSubtitle: envelope.subtitle || "",
        days,
        actions: extraAction ? [...base.actions, extraAction] : base.actions,
      };
      if (!isWeekBoardViewModel(viewModel)) {
        return {
          ok: true,
          errors: ["week-board 视图结构损坏，回退 result-card"],
          viewModel: { ...base, layoutMode: LAYOUT_RESULT_CARD, weekBoardTitle: "", weekBoardSubtitle: "", days: [] },
        };
      }
      const leak = isClean(viewModel);
      if (!leak.ok) {
        return { ok: false, errors: [`week-board 视图泄漏内部字段：${leak.violations.map((v) => v.field || v.pattern).join(",")}`], viewModel: null };
      }
      return { ok: true, errors: [], viewModel };
    }
    return {
      ok: true,
      errors: ["整周课表无课程事实，回退 result-card"],
      viewModel: { ...base, layoutMode: LAYOUT_RESULT_CARD, weekBoardTitle: "", weekBoardSubtitle: "", days: [] },
    };
  }

  const viewModel = { ...base, layoutMode: LAYOUT_RESULT_CARD, weekBoardTitle: "", weekBoardSubtitle: "", days: [] };
  const leak = isClean(viewModel);
  if (!leak.ok) {
    return { ok: false, errors: [`result-card 视图泄漏内部字段：${leak.violations.map((v) => v.field || v.pattern).join(",")}`], viewModel: null };
  }
  return { ok: true, errors: [], viewModel };
}

function isWeekBoardViewModel(viewModel) {
  if (!viewModel || viewModel.layoutMode !== LAYOUT_WEEK_BOARD) return false;
  if (!Array.isArray(viewModel.days) || viewModel.days.length === 0) return false;
  return viewModel.days.every(
    (day) => day && typeof day.label === "string" && day.label && Array.isArray(day.blocks) &&
      day.blocks.every((block) => block && block.time && block.title && block.location)
  );
}

/**
 * CSF P1.5 组合 Mission 最终 Widget 投影：最终 Widget 必须收口在最终完成能力的变体
 * （如 课表→风险 以 risk 卡收口，而不是第一张课表卡）。
 * - mission：{ completedCapabilities: [...] }（执行顺序追加）；
 * - toolResults：{ toolName: rawToolResult }；
 * - capabilityToolMap：{ capability: toolName }；
 * - buildEnvelope(raw, toolName) → { ok, errors, envelope }（确定性，由调用方提供）。
 * 最终变体依据 = 最后一个已完成能力的工具；确定性、无模型参与。
 */
function projectMissionFinalViewModel(mission, toolResults, capabilityToolMap, buildEnvelope) {
  const caps = Array.isArray(mission && mission.completedCapabilities) ? mission.completedCapabilities : [];
  if (caps.length === 0) {
    return { ok: false, errors: ["无已完成能力，无法投影最终 Widget"], viewModel: null };
  }
  const finalCap = caps[caps.length - 1];
  const toolName = capabilityToolMap && capabilityToolMap[finalCap];
  if (!toolName) {
    return { ok: false, errors: [`最终能力 ${finalCap} 无对应工具映射`], viewModel: null };
  }
  const raw = toolResults && toolResults[toolName];
  if (!raw) {
    return { ok: false, errors: [`最终工具 ${toolName} 无结果可投影`], viewModel: null };
  }
  const built = buildEnvelope(raw, toolName);
  if (!built || !built.ok) {
    return { ok: false, errors: (built && built.errors) || ["最终结果投影失败"], viewModel: null };
  }
  return projectViewModel(raw, toolName, built.envelope);
}

module.exports = {
  LAYOUT_WEEK_BOARD,
  LAYOUT_RESULT_CARD,
  LAYOUT_MODES,
  DAY_LABELS,
  WEEK_SCHEDULE_TOOLS,
  isWholeWeekScope,
  collectLessons,
  buildDays,
  buildDayDetailAction,
  isWeekBoardViewModel,
  projectViewModel,
  projectMissionFinalViewModel,
};

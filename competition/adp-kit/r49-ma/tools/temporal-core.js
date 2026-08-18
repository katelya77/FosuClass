"use strict";
// R50.0 Temporal Semantic Core —— 统一确定性时间解析层（契约真源）
//
// 设计目标：
//  - Agent 不再靠 Prompt 猜「未来第一周是不是第1教学周 / 当前日期是否学期内」。
//  - 自然语言由 Agent 提取为结构化 temporal intent，最终日期 / 教学周 / 窗口
//    全部由本层确定性计算（纯函数，注入 semester，不依赖 demo 当前日期）。
//
// 唯一契约定义（见 r50/R50.0-SEMANTIC-CORE-DESIGN.md §1）：
//  - 「未来/接下来 N 个教学周」= 从 referenceDate 所在有效教学周开始；若 referenceDate
//    不在学期教学周（开学前/学期后/假期），则从之后第一个有效教学周开始。
//  - 「未来第一个教学周」= 该窗口第 1 个有效教学周。
//  - 「最近 N 个教学周」= 学期内 [week-N+1, week]；学期后 [totalWeeks-N+1, totalWeeks]；
//    开学前无已开展教学周 → resolutionKind=pre_semester + null。
//
// 本模块只包含纯函数；测试与 Prompt 共同约束同一语义（test-temporal-core.js）。

const DAY_MS = 86400000;

/** 将 YYYY-MM-DD 解析为 UTC 零点时间戳（把 UTC 当作无时区日历算术容器）。 */
function parseDate(dateStr) {
  const match = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ts = Date.UTC(year, month - 1, day);
  const d = new Date(ts);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return ts;
}

function addDays(dateStr, days) {
  const ts = parseDate(dateStr);
  if (ts == null) return null;
  return new Date(ts + Number(days) * DAY_MS).toISOString().slice(0, 10);
}

/** 日期 → 教学周（从学期起始周一算起）；越界/非法返回 null。 */
function dateToWeek(dateStr, semester) {
  const start = parseDate(semester.startDate);
  const target = parseDate(dateStr);
  if (start == null || target == null) return null;
  const diff = Math.floor((target - start) / DAY_MS);
  const week = Math.floor(diff / 7) + 1;
  if (week < 1 || week > semester.totalWeeks) return null;
  return week;
}

/** 日期 → 星期（1=周一 … 7=周日）。 */
function dateToWeekday(dateStr) {
  const ts = parseDate(dateStr);
  if (ts == null) return null;
  const day = new Date(ts).getUTCDay();
  return day === 0 ? 7 : day;
}

/** 教学周 + 星期 → 日期。 */
function weekWeekdayToDate(week, weekday, semester) {
  const start = parseDate(semester.startDate);
  if (start == null) return null;
  return new Date(start + ((week - 1) * 7 + (weekday - 1)) * DAY_MS).toISOString().slice(0, 10);
}

function semesterFrom(datasetOrSemester) {
  if (datasetOrSemester && datasetOrSemester.semester) return datasetOrSemester.semester;
  return datasetOrSemester;
}

/** 当前教学周状态判定：学期前/学期内/学期后。 */
function semesterPhase(referenceDate, semester) {
  const start = parseDate(semester.startDate);
  const end = parseDate(semester.endDate);
  const target = parseDate(referenceDate);
  if (start == null || end == null || target == null) return { phase: "invalid" };
  if (target < start) return { phase: "pre_semester" };
  if (target > end) return { phase: "post_semester" };
  const week = dateToWeek(referenceDate, semester);
  if (week == null) return { phase: "invalid" };
  return { phase: "in_semester", week };
}

/**
 * 解析结构化 temporal intent → temporalContext。
 *
 * @param {object} intent  { kind, ... }
 * @param {object} opts    { referenceDate?, semester? }
 *   semester 形如 { id, startDate, endDate, totalWeeks }（缺省由数据集 meta 提供）
 * @returns {object} temporalContext（见设计文档 §1.5）
 */
function resolveTemporalIntent(intent, { referenceDate, semester } = {}) {
  const sem = semesterFrom(semester);
  if (!sem || !sem.startDate || !sem.totalWeeks) {
    return failClosed(referenceDate || null, null, "invalid_semester");
  }
  const base = referenceDate || "1970-01-01"; // 显式缺失时 fail-closed，绝不猜测
  const phase = semesterPhase(base, sem);

  const ctx = {
    referenceDate: base,
    semesterId: sem.id || null,
    inSemester: phase.phase === "in_semester",
    currentAcademicWeek: phase.phase === "in_semester" ? phase.week : null,
    resolvedDate: null,
    resolvedWeek: null,
    resolvedWeekStart: null,
    resolvedWeekEnd: null,
    resolutionKind: "none",
  };
  if (!intent || typeof intent !== "object") return finish(ctx, "none");

  switch (intent.kind) {
    case "absolute": {
      const date = intent.date;
      if (!parseDate(date)) return finish(ctx, "none");
      ctx.resolvedDate = date;
      ctx.resolvedWeek = dateToWeek(date, sem);
      ctx.resolvedWeekStart = ctx.resolvedWeek;
      ctx.resolvedWeekEnd = ctx.resolvedWeek;
      ctx.inSemester = ctx.resolvedWeek != null;
      ctx.currentAcademicWeek = ctx.resolvedWeek;
      return finish(ctx, "absolute");
    }
    case "relative_day": {
      const offset = Number(intent.offset);
      if (!Number.isInteger(offset)) return finish(ctx, "none");
      const date = addDays(base, offset);
      if (!date) return finish(ctx, "none");
      ctx.resolvedDate = date;
      ctx.resolvedWeek = dateToWeek(date, sem);
      ctx.resolvedWeekStart = ctx.resolvedWeek;
      ctx.resolvedWeekEnd = ctx.resolvedWeek;
      ctx.inSemester = ctx.resolvedWeek != null;
      return finish(ctx, "relative_day");
    }
    case "relative_weekday": {
      const weekday = Number(intent.weekday);
      const offset = Number(intent.offset == null ? 0 : intent.offset);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !Number.isInteger(offset)) {
        return finish(ctx, "none");
      }
      // 所在周周一
      const baseWeekday = dateToWeekday(base);
      if (baseWeekday == null) return finish(ctx, "none");
      const thisMonday = addDays(base, -(baseWeekday - 1));
      const date = addDays(thisMonday, offset * 7 + (weekday - 1));
      if (!date) return finish(ctx, "none");
      ctx.resolvedDate = date;
      ctx.resolvedWeek = dateToWeek(date, sem);
      ctx.resolvedWeekStart = ctx.resolvedWeek;
      ctx.resolvedWeekEnd = ctx.resolvedWeek;
      ctx.inSemester = ctx.resolvedWeek != null;
      return finish(ctx, "relative_weekday");
    }
    case "academic_week": {
      const week = Number(intent.week);
      if (!Number.isInteger(week) || week < 1 || week > sem.totalWeeks) return finish(ctx, "none");
      ctx.resolvedWeek = week;
      ctx.resolvedWeekStart = week;
      ctx.resolvedWeekEnd = week;
      ctx.inSemester = true;
      return finish(ctx, "academic_week");
    }
    case "academic_week_weekday": {
      const week = Number(intent.week);
      const weekday = Number(intent.weekday);
      if (!Number.isInteger(week) || week < 1 || week > sem.totalWeeks
        || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) return finish(ctx, "none");
      const date = weekWeekdayToDate(week, weekday, sem);
      if (!date) return finish(ctx, "none");
      ctx.resolvedDate = date;
      ctx.resolvedWeek = week;
      ctx.resolvedWeekStart = week;
      ctx.resolvedWeekEnd = week;
      ctx.inSemester = true;
      return finish(ctx, "academic_week_weekday");
    }
    case "week_range": {
      const ws = Number(intent.weekStart);
      const we = Number(intent.weekEnd);
      if (!Number.isInteger(ws) || !Number.isInteger(we)
        || ws < 1 || we > sem.totalWeeks || we < ws) return finish(ctx, "none");
      ctx.resolvedWeekStart = ws;
      ctx.resolvedWeekEnd = we;
      ctx.inSemester = true;
      return finish(ctx, "week_range");
    }
    case "future_weeks": {
      const count = Number(intent.count);
      if (!Number.isInteger(count) || count < 1) return finish(ctx, "none");
      let startWeek;
      if (phase.phase === "in_semester") {
        startWeek = phase.week;
      } else if (phase.phase === "pre_semester") {
        startWeek = 1; // 之后第一个有效教学周
      } else {
        // post_semester：之后已无有效教学周
        return finish({ ...ctx, resolutionKind: "post_semester" }, "post_semester");
      }
      const endWeek = Math.min(startWeek + count - 1, sem.totalWeeks);
      ctx.resolvedWeekStart = startWeek;
      ctx.resolvedWeekEnd = endWeek;
      ctx.resolvedWeek = startWeek; // 「未来第一个教学周」= 窗口第1个有效教学周
      ctx.inSemester = phase.phase === "in_semester"; // inSemester=referenceDate 是否处于教学期
      ctx.note = endWeek < startWeek + count - 1 ? "超界截断到学期末" : undefined;
      return finish(ctx, "future_weeks");
    }
    case "recent_weeks": {
      const count = Number(intent.count);
      if (!Number.isInteger(count) || count < 1) return finish(ctx, "none");
      if (phase.phase === "in_semester") {
        const startWeek = Math.max(phase.week - count + 1, 1);
        ctx.resolvedWeekStart = startWeek;
        ctx.resolvedWeekEnd = phase.week;
        ctx.inSemester = true; // referenceDate 学期内
        return finish(ctx, "recent_weeks");
      }
      if (phase.phase === "post_semester") {
        ctx.resolvedWeekStart = Math.max(sem.totalWeeks - count + 1, 1);
        ctx.resolvedWeekEnd = sem.totalWeeks;
        ctx.inSemester = false; // referenceDate 已学期后，契约与 future_weeks 一致
        return finish(ctx, "recent_weeks");
      }
      // pre_semester：无已开展教学周
      return finish({ ...ctx, resolutionKind: "pre_semester" }, "pre_semester");
    }
    case "next_week": {
      if (phase.phase === "pre_semester") {
        ctx.resolvedWeek = 1;
        ctx.resolvedWeekStart = 1;
        ctx.resolvedWeekEnd = 1;
        return finish(ctx, "next_week");
      }
      if (phase.phase !== "in_semester") return finish(ctx, "none");
      if (phase.week >= sem.totalWeeks) return finish(ctx, "none");
      ctx.resolvedWeek = phase.week + 1;
      ctx.resolvedWeekStart = ctx.resolvedWeek;
      ctx.resolvedWeekEnd = ctx.resolvedWeek;
      ctx.inSemester = true;
      return finish(ctx, "next_week");
    }
    case "prev_week": {
      if (phase.phase === "post_semester") {
        ctx.resolvedWeek = sem.totalWeeks;
        ctx.resolvedWeekStart = ctx.resolvedWeek;
        ctx.resolvedWeekEnd = ctx.resolvedWeek;
        return finish(ctx, "prev_week");
      }
      if (phase.phase !== "in_semester") return finish(ctx, "none");
      if (phase.week <= 1) return finish(ctx, "none");
      ctx.resolvedWeek = phase.week - 1;
      ctx.resolvedWeekStart = ctx.resolvedWeek;
      ctx.resolvedWeekEnd = ctx.resolvedWeek;
      ctx.inSemester = true;
      return finish(ctx, "prev_week");
    }
    case "current": {
      if (phase.phase === "in_semester") {
        ctx.resolvedWeek = phase.week;
        ctx.resolvedWeekStart = phase.week;
        ctx.resolvedWeekEnd = phase.week;
        return finish(ctx, "current");
      }
      if (phase.phase === "pre_semester") return finish({ ...ctx, resolutionKind: "pre_semester" }, "pre_semester");
      return finish({ ...ctx, resolutionKind: "post_semester" }, "post_semester");
    }
    default:
      return finish(ctx, "none");
  }
}

function finish(ctx, kind) {
  ctx.resolutionKind = kind;
  // 清理可选 note 空值
  if (!ctx.note) delete ctx.note;
  return ctx;
}

function failClosed(referenceDate, semesterId, kind) {
  return {
    referenceDate: referenceDate || null,
    semesterId: semesterId || null,
    inSemester: false,
    currentAcademicWeek: null,
    resolvedDate: null,
    resolvedWeek: null,
    resolvedWeekStart: null,
    resolvedWeekEnd: null,
    resolutionKind: kind || "none",
  };
}

module.exports = {
  parseDate,
  addDays,
  dateToWeek,
  dateToWeekday,
  weekWeekdayToDate,
  semesterPhase,
  resolveTemporalIntent,
};

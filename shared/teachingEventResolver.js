"use strict";

const ALLOWED_TYPES = new Set(["holiday", "makeup", "no-class", "special-teaching"]);

function parseDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function weekday(value) {
  const date = parseDate(value);
  if (!date) return 0;
  return date.getUTCDay() || 7;
}

function teachingWeek(value, termStartDate) {
  const date = parseDate(value);
  const start = parseDate(termStartDate);
  if (!date || !start) return 0;
  return Math.floor((date.getTime() - start.getTime()) / 604800000) + 1;
}

function resolveTermPhase(value, termStartDate, totalWeeks) {
  if (!parseDate(value) || !parseDate(termStartDate)) return "unknown";
  const week = teachingWeek(value, termStartDate);
  const count = Number(totalWeeks || 0);
  if (!Number.isFinite(count) || count <= 0) return "unknown";
  if (week <= 0) return "before-term";
  if (week > count) return "after-term";
  return "in-term";
}

function normalizeSpecialDate(item) {
  const source = item && typeof item === "object" ? item : {};
  if (!parseDate(source.date) || !ALLOWED_TYPES.has(source.type)) return null;
  if (source.type === "makeup" && !parseDate(source.scheduleSourceDate)) return null;
  return {
    date: source.date,
    type: source.type,
    scheduleSourceDate: source.type === "makeup" ? source.scheduleSourceDate : "",
    note: String(source.note || "").trim(),
    audience: String(source.audience || "all").trim(),
  };
}

function resolveTeachingEvent(date, calendar = {}, termConfig = {}) {
  const physicalDate = String(date || "");
  const config = Object.assign({}, termConfig, calendar.termConfig || {});
  const termStartDate = config.termStartDate || calendar.termStartDate || "";
  const totalWeeks = Number(config.totalWeeks || calendar.totalWeeks || 0) || 0;
  const termPhase = resolveTermPhase(physicalDate, termStartDate, totalWeeks);
  const special = (Array.isArray(calendar.specialDates) ? calendar.specialDates : [])
    .map(normalizeSpecialDate).find((item) => item && item.date === physicalDate) || null;
  const type = special ? special.type : "regular";
  const scheduleSourceDate = special && special.scheduleSourceDate || physicalDate;
  const isExplicitTeachingDay = type === "makeup" || type === "special-teaching";
  const isTeachingDay = isExplicitTeachingDay || (type === "regular" && termPhase === "in-term");
  return {
    date: physicalDate,
    type,
    termPhase,
    isTeachingDay,
    scheduleSourceDate,
    scheduleWeekday: isTeachingDay ? weekday(scheduleSourceDate) : 0,
    scheduleWeek: isTeachingDay ? teachingWeek(scheduleSourceDate, termStartDate) : 0,
    physicalWeekday: weekday(physicalDate),
    note: special && special.note || "",
    sourceStatus: calendar.sourceStatus || "",
  };
}

module.exports = { ALLOWED_TYPES, normalizeSpecialDate, resolveTeachingEvent, resolveTermPhase, teachingWeek, weekday };

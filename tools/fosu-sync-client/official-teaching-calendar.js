"use strict";

const crypto = require("crypto");

function loadXlsx() {
  try {
    return require("xlsx");
  } catch (_error) {
    return require("../../server/node_modules/xlsx");
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`CALENDAR_DATE_INVALID:${value}`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function termDate(startYear, month, day) {
  const year = Number(month) >= 8 ? startYear : startYear + 1;
  const value = `${year}-${pad(month)}-${pad(day)}`;
  if (formatDate(new Date(`${value}T00:00:00.000Z`)) !== value) {
    throw new Error(`CALENDAR_DATE_INVALID:${value}`);
  }
  return value;
}

function parseTermTitle(value) {
  const match = String(value || "").replace(/\s+/g, " ").match(/(\d{4})-(\d{4})学年\s*第\s*([12])\s*学期/);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  return {
    term: `${match[1]}-${match[2]}-${match[3]}`,
    semesterText: `${match[1]}-${match[2]}学年第${match[3]}学期`,
    startYear: Number(match[1]),
  };
}

function parseSpecialDates(notes, startYear) {
  const text = String(notes || "");
  const items = [];
  const holiday = /(\d{1,2})月(\d{1,2})日至(?:(\d{1,2})月)?(\d{1,2})日放假/g;
  let match;
  while ((match = holiday.exec(text))) {
    const startMonth = Number(match[1]);
    const startDay = Number(match[2]);
    const endMonth = Number(match[3] || match[1]);
    const endDay = Number(match[4]);
    const start = termDate(startYear, startMonth, startDay);
    const end = termDate(startYear, endMonth, endDay);
    const label = startMonth === 9 ? "中秋节放假" : "国庆节放假";
    for (let value = start; value <= end; value = addDays(value, 1)) {
      items.push({ date: value, type: "holiday", scheduleSourceDate: "", note: label, audience: "all" });
    }
  }
  const makeup = /(\d{1,2})月(\d{1,2})日（[^）]+）补(\d{1,2})月(\d{1,2})日（[^）]+）的课/g;
  while ((match = makeup.exec(text))) {
    const date = termDate(startYear, Number(match[1]), Number(match[2]));
    const scheduleSourceDate = termDate(startYear, Number(match[3]), Number(match[4]));
    items.push({
      date,
      type: "makeup",
      scheduleSourceDate,
      note: `补${Number(match[3])}月${Number(match[4])}日的课`,
      audience: "all",
    });
  }
  return Array.from(new Map(items.map((item) => [item.date, item])).values())
    .sort((left, right) => left.date.localeCompare(right.date));
}

function parseCohortMilestones(notes, startYear) {
  const text = String(notes || "").replace(/\s+/g, "");
  const items = [];
  let match = text.match(/老生(\d{1,2})月(\d{1,2})日返校报到.*?(\d{1,2})月(\d{1,2})日正式上课/);
  if (match) {
    items.push({ audience: "returning-students", date: termDate(startYear, match[1], match[2]), type: "registration" });
    items.push({ audience: "returning-students", date: termDate(startYear, match[3], match[4]), type: "classes-start" });
  }
  match = text.match(/新生(\d{1,2})月(\d{1,2})日入学报到.*?(\d{1,2})月(\d{1,2})日-(\d{1,2})日军训.*?(\d{1,2})月(\d{1,2})日正式上课/);
  if (match) {
    items.push({ audience: "new-students", date: termDate(startYear, match[1], match[2]), type: "registration" });
    items.push({
      audience: "new-students",
      startDate: termDate(startYear, match[3], match[4]),
      endDate: termDate(startYear, match[3], match[5]),
      type: "military-training",
    });
    items.push({ audience: "new-students", date: termDate(startYear, match[6], match[7]), type: "classes-start" });
  }
  return items;
}

function classifyWeek(weekNo, note) {
  const text = String(note || "");
  if (weekNo === 1) return { type: "opening", typeText: "开学教学周", title: "开学教学周" };
  if (/考试周/.test(text)) return { type: "exam", typeText: "考试周", title: "考试周" };
  if (/机动实践周/.test(text)) return { type: "flexible", typeText: "机动实践周", title: "机动实践周" };
  if (/放假|补课/.test(text)) return { type: "adjustment", typeText: "节假日调休周", title: "节假日调休周" };
  return { type: "teaching", typeText: "正常教学周", title: "正常教学周" };
}

function parseOfficialTeachingCalendarWorkbook(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("CALENDAR_WORKBOOK_EMPTY");
  const XLSX = loadXlsx();
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const sheetName = workbook.SheetNames.find((name) => /教学周历/.test(name)) || workbook.SheetNames[0];
  if (!sheetName) throw new Error("CALENDAR_WORKBOOK_SHEET_MISSING");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
  const title = parseTermTitle(rows[0] && rows[0][0]);
  if (!title) throw new Error("CALENDAR_WORKBOOK_TERM_MISSING");
  if (options.term && options.term !== title.term) {
    const error = new Error(`CALENDAR_WORKBOOK_TERM_MISMATCH:${title.term}:${options.term}`);
    error.code = "CALENDAR_WORKBOOK_TERM_MISMATCH";
    throw error;
  }
  const firstWeekRow = rows.findIndex((row) => Number(row && row[0]) === 1);
  if (firstWeekRow < 0) throw new Error("CALENDAR_WORKBOOK_WEEK_ROWS_MISSING");
  const weekRows = [];
  for (let index = firstWeekRow; index < rows.length; index += 1) {
    const weekNo = Number(rows[index] && rows[index][0]);
    if (!Number.isInteger(weekNo)) break;
    if (weekNo !== weekRows.length + 1) throw new Error(`CALENDAR_WORKBOOK_WEEK_SEQUENCE_INVALID:${weekNo}`);
    weekRows.push(rows[index]);
  }
  if (!weekRows.length) throw new Error("CALENDAR_WORKBOOK_WEEK_ROWS_MISSING");
  const termStartDate = String(options.termStartDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(termStartDate)) throw new Error("CALENDAR_TERM_START_DATE_REQUIRED");
  const firstMonday = String(weekRows[0][2] || "").replace(/\D/g, "");
  if (firstMonday && Number(firstMonday) !== Number(termStartDate.slice(8, 10))) {
    throw new Error(`CALENDAR_TERM_START_DATE_MISMATCH:${firstMonday}:${termStartDate}`);
  }
  const weeks = weekRows.map((row, index) => {
    const weekNo = index + 1;
    const note = String(row[8] || "").trim();
    const kind = classifyWeek(weekNo, note);
    return Object.assign({
      weekNo,
      startDate: addDays(termStartDate, index * 7),
      endDate: addDays(termStartDate, index * 7 + 6),
      note,
    }, kind);
  });
  const allNotes = weekRows.map((row) => String(row[8] || "")).filter(Boolean).join("\n");
  return {
    schemaVersion: 2,
    term: title.term,
    semesterText: title.semesterText,
    termStartDate,
    totalWeeks: weeks.length,
    weekStart: "monday",
    source: "official-teaching-calendar-xls",
    sourceStatus: "CALENDAR_SOURCE_COMPLETE",
    sourceFile: String(options.sourceFileName || "").replace(/^.*[\\/]/, ""),
    sourceHash: crypto.createHash("sha256").update(buffer).digest("hex"),
    updatedAt: String(options.updatedAt || ""),
    defaultWeekTitle: "正常教学周",
    weeks,
    specialDates: parseSpecialDates(allNotes, title.startYear),
    cohortMilestones: parseCohortMilestones(allNotes, title.startYear),
  };
}

module.exports = {
  classifyWeek,
  parseCohortMilestones,
  parseOfficialTeachingCalendarWorkbook,
  parseSpecialDates,
};

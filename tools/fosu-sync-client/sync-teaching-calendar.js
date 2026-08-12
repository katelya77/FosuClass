"use strict";

const fs = require("fs");
const path = require("path");
const { DEFAULT_CURRENT_TERM, loadTermConfig } = require("../../shared/termConfig");
const { normalizeSpecialDate } = require("../../shared/teachingEventResolver");

function buildCalendarFixture(term, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, "../.."));
  const config = loadTermConfig(term || DEFAULT_CURRENT_TERM, { root });
  const source = config.teachingCalendar || {};
  return {
    success: true,
    schemaVersion: 2,
    term: config.term,
    semesterText: config.semesterText,
    termStartDate: config.termStartDate,
    totalWeeks: config.totalWeeks,
    weekStart: config.weekStart,
    source: source.source || "public-safe-fixture",
    sourceStatus: source.sourceStatus || "CALENDAR_SOURCE_INCOMPLETE",
    updatedAt: source.updatedAt || "",
    termConfig: {
      term: config.term,
      semesterText: config.semesterText,
      termStartDate: config.termStartDate,
      totalWeeks: config.totalWeeks,
      weekStart: config.weekStart,
    },
    specialDates: (source.specialDates || []).map(normalizeSpecialDate).filter(Boolean),
    cohortMilestones: Array.isArray(source.cohortMilestones) ? source.cohortMilestones.slice() : [],
  };
}

function parseArgs(argv) {
  const params = {};
  argv.forEach((arg) => {
    const match = String(arg).match(/^--([^=]+)(?:=(.*))?$/);
    if (match) params[match[1]] = match[2] === undefined ? true : match[2];
  });
  return params;
}

function main(argv = process.argv.slice(2)) {
  const params = parseArgs(argv);
  const calendar = buildCalendarFixture(params.term || DEFAULT_CURRENT_TERM);
  const output = path.resolve(params.output || path.join(__dirname, ".cache", calendar.term, "teaching-calendar.json"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(calendar, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    term: calendar.term,
    status: calendar.sourceStatus,
    source: calendar.source,
    specialDateCount: calendar.specialDates.length,
    output,
    requiredOfficialExport: calendar.sourceStatus === "CALENDAR_SOURCE_INCOMPLETE" ? "完整教学周历页面或官方导出" : "",
  }, null, 2));
}

if (require.main === module) main();
module.exports = { buildCalendarFixture, main };

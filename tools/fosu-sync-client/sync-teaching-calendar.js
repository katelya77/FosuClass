"use strict";

const fs = require("fs");
const path = require("path");
const { DEFAULT_CURRENT_TERM, loadTermConfig } = require("../../shared/termConfig");
const { normalizeSpecialDate } = require("../../shared/teachingEventResolver");
const { parseOfficialTeachingCalendarWorkbook } = require("./official-teaching-calendar");

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
    sourceFile: source.sourceFile || "",
    sourceHash: source.sourceHash || "",
    termConfig: {
      term: config.term,
      semesterText: config.semesterText,
      termStartDate: config.termStartDate,
      totalWeeks: config.totalWeeks,
      weekStart: config.weekStart,
    },
    specialDates: (source.specialDates || []).map(normalizeSpecialDate).filter(Boolean),
    weeks: Array.isArray(source.weeks) ? source.weeks.slice() : [],
    cohortMilestones: Array.isArray(source.cohortMilestones) ? source.cohortMilestones.slice() : [],
    count: Array.isArray(source.weeks) ? source.weeks.length : 0,
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

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function main(argv = process.argv.slice(2)) {
  const params = parseArgs(argv);
  const term = params.term || DEFAULT_CURRENT_TERM;
  const config = loadTermConfig(term);
  let calendar = buildCalendarFixture(term);
  let configPath = "";
  if (params.file) {
    const inputPath = path.resolve(params.file);
    const stat = fs.statSync(inputPath);
    const parsed = parseOfficialTeachingCalendarWorkbook(fs.readFileSync(inputPath), {
      term,
      termStartDate: config.termStartDate,
      sourceFileName: path.basename(inputPath),
      updatedAt: stat.mtime.toISOString(),
    });
    calendar = Object.assign({ success: true }, parsed, {
      termConfig: {
        term: parsed.term,
        semesterText: parsed.semesterText,
        termStartDate: parsed.termStartDate,
        totalWeeks: parsed.totalWeeks,
        weekStart: parsed.weekStart,
      },
      count: parsed.weeks.length,
    });
    if (params["write-config"] === true || params["write-config"] === "true") {
      configPath = config.filePath;
      const nextConfig = Object.assign({}, config, {
        totalWeeks: parsed.totalWeeks,
        teachingCalendar: Object.assign({}, parsed),
      });
      delete nextConfig.filePath;
      writeJsonAtomic(configPath, nextConfig);
    }
  }
  const output = path.resolve(params.output || path.join(__dirname, ".cache", calendar.term, "teaching-calendar.json"));
  writeJsonAtomic(output, calendar);
  console.log(JSON.stringify({
    term: calendar.term,
    status: calendar.sourceStatus,
    source: calendar.source,
    specialDateCount: calendar.specialDates.length,
    weekCount: calendar.weeks.length,
    output,
    configPath,
    requiredOfficialExport: calendar.sourceStatus === "CALENDAR_SOURCE_INCOMPLETE" ? "完整教学周历页面或官方导出" : "",
  }, null, 2));
}

if (require.main === module) main();
module.exports = { buildCalendarFixture, main };

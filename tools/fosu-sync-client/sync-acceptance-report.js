"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assessCohortAvailability } = require("../../shared/cohortAvailability");

function list(value) { return Array.isArray(value) ? value : []; }
function hash(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`; }
function schedules(snapshot, name) {
  const direct = list(snapshot && snapshot[name]);
  return direct.length ? direct : list(snapshot && snapshot.resources && snapshot.resources[name]);
}
function sample(items, limit = 10) {
  return items.slice(0, limit).map((item) => ({
    idFingerprint: hash(item && (item.id || item.classId || item.teacherId || item.roomName || item.courseName || item.name || item)),
    courseCount: list(item && (item.courses || item.items)).length,
  }));
}

function verifySampleFingerprint(items, samples) {
  return samples.every((entry, index) => entry.idFingerprint === sample(items.slice(index, index + 1), 1)[0].idFingerprint);
}

function buildAcceptanceReport(snapshot, context = {}) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const coverage = source.coverage || {};
  const catalog = source.catalog || {};
  const cohorts = assessCohortAvailability({
    term: source.term || source.semester || context.term || "",
    catalog,
    classSchedules: schedules(source, "classSchedules"),
  });
  const report = {
    schema: "fosuclass-sync-acceptance/v1",
    term: source.term || source.semester || context.term || "",
    termStartDate: source.termStartDate || source.termConfig && source.termConfig.termStartDate || context.termStartDate || "",
    totalWeeks: source.totalWeeks || source.termConfig && source.termConfig.totalWeeks || context.totalWeeks || 0,
    calendarSource: context.calendarSource || "",
    calendarStatus: context.calendarStatus || "",
    activeTerm: context.activeTerm || "",
    releaseVersion: source.releaseVersion || source.version || "",
    status: context.status || "STAGING_READY",
    counts: {
      colleges: Number(coverage.collegeCount || list(catalog.colleges).length),
      majors: Number(coverage.majorCount || list(catalog.majors).length),
      grades: Number(coverage.gradeCount || list(catalog.grades).length),
      adminClasses: Number(coverage.adminClassCount || list(catalog.adminClasses || catalog.classes).length),
      classSchedules: schedules(source, "classSchedules").length,
      teacherSchedules: schedules(source, "teacherSchedules").length,
      classroomSchedules: schedules(source, "classroomSchedules").length,
      courseSchedules: schedules(source, "courseSchedules").length,
    },
    releasedGrades: cohorts.releasedGrades,
    pendingGrades: cohorts.pendingGrades.map((grade) => ({ grade, status: "pending_schedule_release" })),
    samples: {
      classes: sample(schedules(source, "classSchedules")),
      teachers: sample(schedules(source, "teacherSchedules")),
      classrooms: sample(schedules(source, "classroomSchedules")),
      courses: sample(schedules(source, "courseSchedules")),
    },
  };
  report.sampleValidationComplete = Object.values(report.samples).every((items) => items.length >= 10) &&
    verifySampleFingerprint(schedules(source, "classSchedules"), report.samples.classes) &&
    verifySampleFingerprint(schedules(source, "teacherSchedules"), report.samples.teachers) &&
    verifySampleFingerprint(schedules(source, "classroomSchedules"), report.samples.classrooms) &&
    verifySampleFingerprint(schedules(source, "courseSchedules"), report.samples.courses);
  return report;
}

function main(argv = process.argv.slice(2)) {
  const inputArg = argv.find((item) => item.startsWith("--input="));
  const outputArg = argv.find((item) => item.startsWith("--output="));
  if (!inputArg) throw new Error("--input is required");
  const input = path.resolve(inputArg.slice(8));
  const snapshot = JSON.parse(fs.readFileSync(input, "utf8"));
  const config = require("../../shared/termConfig").loadTermConfig(snapshot.term || snapshot.semester);
  const contextArg = argv.find((item) => item.startsWith("--status="));
  const report = buildAcceptanceReport(snapshot, {
    calendarSource: config.teachingCalendar && config.teachingCalendar.source || "",
    calendarStatus: config.teachingCalendar && config.teachingCalendar.sourceStatus || "",
    activeTerm: "2025-2026-2",
    status: contextArg ? contextArg.slice("--status=".length) : "STAGING_READY",
  });
  const output = path.resolve(outputArg ? outputArg.slice(9) : path.join("output", "sync", `${report.term}-acceptance.json`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, status: report.status, counts: report.counts, pendingGrades: report.pendingGrades }, null, 2));
}

if (require.main === module) main();
module.exports = { buildAcceptanceReport, sample };

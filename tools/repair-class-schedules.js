#!/usr/bin/env node
// Offline only: never changes the input, active sync cache, release pointer or remote data.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { repairClassScheduleEntries, validateClassScheduleIsolation } = require("../server/src/utils/scheduleNormalizer");

function getSchedules(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.classSchedules)) return input.classSchedules;
  if (Array.isArray(input.items) && ["class", "classSchedules"].includes(input.type)) return input.items;
  throw new Error("输入必须是班级课表数组、class 缓存或完整同步快照");
}

function count(schedules) {
  const admin = schedules.filter(s => !s.isAggregated && !/^major-/.test(s.displayType || "")).length;
  return { schedules: schedules.length, administrativeClasses: admin, unresolvedSchedules: schedules.length - admin,
    courseRows: schedules.reduce((sum, s) => sum + (s.courses || []).length, 0) };
}

function evidenceSet(schedules) {
  const ignored = new Set(["className", "originalClassName", "sharedByMajor", "sourceClassNameUnreliable"]);
  return new Set(schedules.flatMap(s => (s.courses || []).map(course => {
    const evidence = Object.keys(course).filter(key => !ignored.has(key)).sort().map(key => [key, course[key]]);
    return crypto.createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  })));
}

function repairDocument(input) {
  const before = getSchedules(input);
  const repaired = repairClassScheduleEntries(before);
  const errors = validateClassScheduleIsolation(repaired);
  if (errors.length) throw new Error(`班级隔离校验失败：${errors.join("; ")}`);
  const originalEvidence = evidenceSet(before);
  const repairedEvidence = evidenceSet(repaired);
  const missing = [...originalEvidence].filter(key => !repairedEvidence.has(key));
  if (missing.length) throw new Error(`修复丢失 ${missing.length} 条原始课程证据，已拒绝生成候选`);
  const recovered = before.filter(s => (s.isAggregated || /^major-/.test(s.displayType || "")) &&
    repaired.some(r => !r.isAggregated && r.semester === s.semester && r.collegeCode === s.collegeCode &&
      r.grade === s.grade && r.majorCode === s.majorCode));
  const report = {
    schemaVersion: 1, algorithm: "class-isolation-v1", generatedAt: new Date().toISOString(),
    sourceGeneratedAt: input.generatedAt || input.updatedAt || "", offlineOnly: true,
    before: count(before), after: count(repaired), recoveredAggregateCount: recovered.length,
    sourceUniqueCourseEvidenceCount: originalEvidence.size, repairedUniqueCourseEvidenceCount: repairedEvidence.size,
    missingCourseEvidenceCount: missing.length, isolationErrors: errors,
    recoveredMajors: recovered.map(s => ({ semester: s.semester, collegeCode: s.collegeCode, grade: s.grade,
      majorCode: s.majorCode, majorName: s.majorName, previousClassName: s.className,
      classes: repaired.filter(r => !r.isAggregated && r.semester === s.semester && r.collegeCode === s.collegeCode &&
        r.grade === s.grade && r.majorCode === s.majorCode).map(r => ({ className: r.className, courseRows: r.courses.length })) })),
  };
  // Output is an importable class array; all other scopes remain outside this repair.
  return { repaired, report };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const index = arg.indexOf("=");
    return [arg.slice(2, index), arg.slice(index + 1)];
  }));
  if (!args.input || !args.output || !args.report) throw new Error("用法：node tools/repair-class-schedules.js --input=<源文件> --output=<新候选文件> --report=<新报告文件>");
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const reportPath = path.resolve(args.report);
  if (new Set([inputPath.toLowerCase(), outputPath.toLowerCase(), reportPath.toLowerCase()]).size !== 3 ||
    fs.existsSync(outputPath) || fs.existsSync(reportPath)) throw new Error("输出必须是不同的新文件，禁止覆盖输入或已有文件");
  const bytes = fs.readFileSync(inputPath);
  const { repaired, report } = repairDocument(JSON.parse(bytes));
  report.inputSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  report.outputSha256 = crypto.createHash("sha256").update(JSON.stringify(repaired, null, 2) + "\n").digest("hex");
  for (const target of [outputPath, reportPath]) fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(repaired, null, 2) + "\n", { flag: "wx" });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ before: report.before, after: report.after,
    recoveredAggregateCount: report.recoveredAggregateCount, missingCourseEvidenceCount: report.missingCourseEvidenceCount,
    output: outputPath, report: reportPath }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { repairDocument, evidenceSet };

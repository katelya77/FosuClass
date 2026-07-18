const fs = require("fs");
const path = require("path");
const { readIgnoreDocument } = require("./repository");

const STORAGE_DIR = path.resolve(process.env.FOSU_STORAGE_DIR || path.join(__dirname, "../../../storage"));

function readJsonArray(name) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(STORAGE_DIR, name), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (_) { return []; }
}

function buildQualityReport() {
  const classes = readJsonArray("class-schedules.json");
  const teachers = readJsonArray("teacher-schedules.json");
  const classrooms = readJsonArray("classroom-schedules.json");
  const doc = readIgnoreDocument();
  const rules = new Map(doc.rules.map((rule) => [rule.fingerprint || `${rule.type || ""}::${rule.target || ""}`, rule]));
  const anomalies = [];
  const stats = { totalCoursesCount: 0, missingTeacher: 0, missingClassroom: 0, missingWeeks: 0, missingSections: 0, duplicateCount: 0, emptyClassSchedules: 0, abnormalLessCourses: 0 };
  const add = (type, target, severity, original, suggestion) => anomalies.push({ type, target, fingerprint: `${type}::${target}`, severity, original, suggestion });

  classes.forEach((item) => {
    const className = item.className || "";
    const courses = Array.isArray(item.courses) ? item.courses : [];
    stats.totalCoursesCount += courses.length;
    if (!courses.length) { stats.emptyClassSchedules += 1; add("empty-schedule", className, "warning", "课程表无课程安排数据", "核实并重新同步"); }
    else if (courses.length < 3) { stats.abnormalLessCourses += 1; add("few-courses", className, "info", `课程数量较少: ${courses.length}`, "核查排课数据"); }
    const slots = {};
    courses.forEach((course) => {
      if (!course.courseName) add("missing-coursename", className, "danger", "包含空的课程名称", "补充课程名称");
      const courseTarget = `${className}:${course.courseName}`;
      if (!course.teacherName) { stats.missingTeacher += 1; add("missing-teacher", courseTarget, "info", "课程缺少授课教师", "补充授课教师"); }
      if (!course.classroom) { stats.missingClassroom += 1; add("missing-classroom", courseTarget, "warning", "课程缺少上课教室", "补充上课教室"); }
      const weeks = Array.isArray(course.weeks) ? course.weeks : [];
      const sections = Array.isArray(course.sections) ? course.sections : [];
      if (!weeks.length) stats.missingWeeks += 1;
      if (!sections.length) stats.missingSections += 1;
      weeks.forEach((week) => sections.forEach((section) => {
        const slot = `${week}_${course.dayOfWeek || course.weekday || 0}_${section}`;
        if (slots[slot] && slots[slot] !== course.courseName) { stats.duplicateCount += 1; add("class-conflict", `${className}:${slot}`, "danger", "班级课表时间冲突", "核实冲突课程"); }
        slots[slot] = course.courseName;
      }));
    });
  });
  teachers.forEach((item) => {
    const slots = {};
    (Array.isArray(item.courses) ? item.courses : []).forEach((course) => {
      (Array.isArray(course.weeks) ? course.weeks : []).forEach((week) => (Array.isArray(course.sections) ? course.sections : []).forEach((section) => {
        const slot = `${week}_${course.dayOfWeek || course.weekday || 0}_${section}`;
        const room = course.classroom || "未知";
        if (slots[slot] && slots[slot] !== room) add("teacher-conflict", `${item.teacherName || ""}:${slot}`, "danger", "教师时间冲突", "核实教师安排");
        slots[slot] = room;
      }));
    });
  });
  classrooms.forEach((item) => {
    const room = item.roomName || item.classroom || "";
    if (!room) return;
    const slots = {};
    (Array.isArray(item.courses) ? item.courses : []).forEach((course) => {
      (Array.isArray(course.weeks) ? course.weeks : []).forEach((week) => (Array.isArray(course.sections) ? course.sections : []).forEach((section) => {
        const slot = `${week}_${course.dayOfWeek || course.weekday || 0}_${section}`;
        const descriptor = `${course.teacherName || "未知"}:${course.className || "未知"}`;
        if (slots[slot] && slots[slot] !== descriptor) add("classroom-conflict", `${room}:${slot}`, "danger", "教室时间冲突", "核实教室安排");
        slots[slot] = descriptor;
      }));
    });
  });
  const active = [];
  const ignored = [];
  anomalies.forEach((anomaly) => {
    const rule = rules.get(anomaly.fingerprint);
    if (rule && rule.ignored !== false) ignored.push({
      ...anomaly,
      reason: rule.reason || "",
      status: "ignored",
      ruleId: rule.id || null,
      createdAt: rule.createdAt || null,
      ignoredAt: rule.updatedAt || rule.createdAt || null,
      rule: {
        id: rule.id || null,
        fingerprint: anomaly.fingerprint,
        reason: rule.reason || "",
        severity: rule.severity || "info",
        category: rule.category || "general",
        createdAt: rule.createdAt || null,
        ignored: rule.ignored !== false,
      },
    });
    else active.push(anomaly);
  });
  const summary = { ...stats, anomalyCount: anomalies.length, activeCount: active.length, ignoredCount: ignored.length, totalCount: anomalies.length };
  return {
    active,
    ignored,
    summary,
    generatedAt: new Date().toISOString(),
    // Read-only aliases preserve the existing report consumer while active
    // and ignored remain the canonical partition.
    stats: summary,
    anomalies: active,
  };
}

module.exports = { buildQualityReport };

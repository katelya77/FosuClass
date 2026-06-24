const crypto = require("crypto");
const { toRenderableCourse } = require("./courseNormalizer");

const FIELD_ALIASES = {
  studentName: ["学生姓名", "姓名", "studentName", "name"],
  courseName: ["课程名称", "课程名", "courseName", "name", "title"],
  weekText: ["周次", "上课周次", "weekText", "weeks"],
  weekdayText: ["星期几", "星期", "weekdayText", "weekDayText"],
  sectionText: ["节次", "上课节次", "sectionText", "sections"],
  roomName: ["课室名称", "教室", "上课地点", "roomName", "classroom"],
  className: ["上课班级", "班级", "className", "teachingClass"],
  campus: ["校区", "campus"],
  specialNote: ["特别说明", "说明", "备注", "specialNote", "note"],
};

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizePunctuation(value) {
  return toText(value)
    .replace(/\u3000/g, " ")
    .replace(/，/g, ",")
    .replace(/、/g, ",")
    .replace(/；/g, ",")
    .replace(/－|—|–|~|～|至|到/g, "-")
    .replace(/[［【]/g, "[")
    .replace(/[］】]/g, "]")
    .replace(/\s+/g, "");
}

function uniqSorted(numbers) {
  return Array.from(new Set((numbers || [])
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)))
    .sort((left, right) => left - right);
}

function expandRangeText(text, options = {}) {
  const max = Number(options.max || 60) || 60;
  const normalized = normalizePunctuation(text)
    .replace(/第/g, "")
    .replace(/周/g, "")
    .replace(/节/g, "")
    .replace(/[()（）]/g, "");
  if (!normalized) return [];

  const values = [];
  normalized.split(",").forEach((part) => {
    const item = toText(part);
    if (!item) return;
    if (item.includes("-")) {
      const [startRaw, endRaw] = item.split("-");
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start && end <= max) {
        for (let current = start; current <= end; current += 1) {
          values.push(current);
        }
      }
      return;
    }
    const single = Number(item);
    if (Number.isInteger(single) && single > 0 && single <= max) {
      values.push(single);
    }
  });
  return uniqSorted(values);
}

function parseWeeks(weekText) {
  return expandRangeText(weekText, { max: 60 });
}

function parseWeekday(weekdayText) {
  const text = toText(weekdayText).replace(/\s+/g, "");
  if (!text) return null;
  const direct = Number(text);
  if (Number.isInteger(direct) && direct >= 1 && direct <= 7) return direct;
  const map = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 7,
    天: 7,
  };
  const match = text.match(/星期([一二三四五六日天])|周([一二三四五六日天])/);
  if (match) {
    return map[match[1] || match[2]] || null;
  }
  return null;
}

function parseSections(sectionText) {
  const normalized = normalizePunctuation(sectionText)
    .replace(/第/g, "")
    .replace(/节/g, "")
    .replace(/[\[\]()（）]/g, "");
  return expandRangeText(normalized, { max: 30 });
}

function firstField(raw, aliases) {
  const source = raw || {};
  for (const key of aliases) {
    if (source[key] !== undefined && source[key] !== null && toText(source[key]) !== "") {
      return toText(source[key]);
    }
  }
  const keys = Object.keys(source);
  for (const alias of aliases) {
    const normalizedAlias = alias.toLowerCase();
    const foundKey = keys.find((key) => String(key).trim().toLowerCase() === normalizedAlias);
    if (foundKey && toText(source[foundKey])) {
      return toText(source[foundKey]);
    }
  }
  return "";
}

function normalizeRawRow(raw) {
  const result = {};
  Object.keys(FIELD_ALIASES).forEach((key) => {
    result[key] = firstField(raw, FIELD_ALIASES[key]);
  });
  result.raw = raw && typeof raw === "object" ? Object.assign({}, raw) : {};
  return result;
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value || {}))
    .digest("hex")
    .slice(0, 24);
}

function isOnlineOrPending(row) {
  const text = [
    row.roomName,
    row.campus,
    row.specialNote,
  ].join(" ");
  return /线上|在线|网络|平台|待定|未定|另行通知|自行安排/.test(text);
}

function roomForScheduledCourse(row) {
  if (row.roomName) return row.roomName;
  if (isOnlineOrPending(row)) return "线上/待定";
  return "未注明";
}

function inferStudentName(rows) {
  const counts = new Map();
  (rows || []).forEach((row) => {
    const name = toText(row.studentName);
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])[0]?.[0] || "";
}

function hasMergedClassPattern(text) {
  const value = toText(text);
  return /\[[^\]]*[-,，、][^\]]*\]班/.test(value) ||
    /\d+\s*[-~～至]\s*\d+\s*班/.test(value) ||
    /合班|混合班|多个班/.test(value);
}

function inferClassName(rows) {
  const counts = new Map();
  (rows || []).forEach((row) => {
    const raw = toText(row.className);
    if (!raw || hasMergedClassPattern(raw)) return;
    const matches = raw.match(/(?:20\d{2}|\d{2})级?[\u4e00-\u9fa5A-Za-z]{2,40}\d{1,2}班?/g);
    const candidates = matches && matches.length ? matches : [raw];
    candidates.forEach((candidate) => {
      const normalized = toText(candidate).endsWith("班") ? toText(candidate) : `${toText(candidate)}班`;
      if (!/^\d{2,4}/.test(normalized)) return;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    });
  });

  const sorted = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  if (!sorted.length) {
    return { className: "", classNameConfidence: "low" };
  }
  const [className, count] = sorted[0];
  const total = (rows || []).length || 1;
  const ratio = count / total;
  return {
    className,
    classNameConfidence: ratio >= 0.45 ? "high" : (ratio >= 0.2 ? "medium" : "low"),
  };
}

function buildSourceHash(row, studentId) {
  return stableHash({
    studentId,
    courseName: row.courseName,
    weekText: row.weekText,
    weekdayText: row.weekdayText,
    sectionText: row.sectionText,
    roomName: row.roomName,
    className: row.className,
    campus: row.campus,
  });
}

function normalizeScheduleRows(rawRows, options = {}) {
  const studentId = toText(options.studentId);
  const term = toText(options.semester || options.term || "当前学期");
  const importedAt = options.importedAt || new Date().toISOString();
  const normalizedRows = (Array.isArray(rawRows) ? rawRows : [])
    .map(normalizeRawRow)
    .filter((row) => row.courseName);

  const scheduled = [];
  const unscheduled = [];

  normalizedRows.forEach((row, index) => {
    const weeks = parseWeeks(row.weekText);
    const weekday = parseWeekday(row.weekdayText);
    const sections = parseSections(row.sectionText);
    const sourceHash = buildSourceHash(row, studentId);
    const isScheduled = Boolean(row.courseName && weeks.length && weekday && sections.length);
    const base = {
      id: `fosu_apaas_${sourceHash}`,
      studentName: row.studentName,
      studentId,
      courseName: row.courseName,
      weekText: row.weekText,
      weeks,
      weekdayText: row.weekdayText,
      weekday,
      weekDay: weekday,
      sectionText: row.sectionText,
      sections,
      startSection: sections[0] || null,
      endSection: sections[sections.length - 1] || null,
      roomName: row.roomName,
      classroom: row.roomName,
      teacherName: "",
      className: row.className,
      campus: row.campus,
      specialNote: row.specialNote,
      note: row.specialNote,
      remark: row.specialNote,
      semester: term,
      term,
      source: "fosu_apaas",
      sourceType: "personal",
      sourceStudentId: studentId,
      sourceHash,
      uniqueKey: [
        studentId,
        row.courseName,
        row.weekText,
        weekday || row.weekdayText,
        row.sectionText,
        row.roomName,
        row.className,
        "fosu_apaas",
      ].join("|"),
      importedAt,
      rawData: row.raw,
      raw: row.raw,
      isScheduled,
      isOnlineOrUnplaced: !isScheduled || isOnlineOrPending(row),
      originalIndex: index,
    };

    if (!isScheduled) {
      unscheduled.push(Object.assign({}, base, {
        reason: "缺少周次、星期或节次",
      }));
      return;
    }

    const renderable = toRenderableCourse(Object.assign({}, base, {
      classroom: roomForScheduledCourse(row),
      roomName: roomForScheduledCourse(row),
      startWeek: weeks[0],
      endWeek: weeks[weeks.length - 1],
    }));
    scheduled.push(renderable);
  });

  return {
    rows: scheduled.concat(unscheduled),
    scheduled,
    unscheduled,
  };
}

function rangesOverlap(left, right) {
  const a = new Set(left || []);
  return (right || []).some((item) => a.has(item));
}

function countConflicts(courses) {
  const conflicts = new Set();
  const list = Array.isArray(courses) ? courses : [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const left = list[i];
      const right = list[j];
      if (left.weekday !== right.weekday) continue;
      if (!rangesOverlap(left.weeks, right.weeks)) continue;
      if (!rangesOverlap(left.sections, right.sections)) continue;
      conflicts.add(`${left.weekday}:${(left.sections || []).join(",")}:${i}:${j}`);
    }
  }
  return conflicts.size;
}

function previewCourse(course) {
  return {
    id: course.id,
    courseName: course.courseName,
    weekText: course.weekText,
    weekday: course.weekday,
    weekdayText: course.weekdayText,
    sectionText: course.sectionText,
    roomName: course.roomName || course.classroom || "",
    classroom: course.classroom || course.roomName || "",
    className: course.className || "",
    campus: course.campus || "",
    specialNote: course.specialNote || course.note || "",
    reason: course.reason || "",
  };
}

function buildImportPreview(rawRows, options = {}) {
  const normalized = normalizeScheduleRows(rawRows, options);
  const studentName = inferStudentName(normalized.rows);
  const classInference = inferClassName(normalized.rows);
  const rawRowCount = Array.isArray(rawRows) ? rawRows.length : 0;
  return {
    profile: {
      studentId: toText(options.studentId),
      studentName,
      className: classInference.className,
      classNameConfidence: classInference.classNameConfidence,
    },
    summary: {
      rawRowCount,
      scheduledCourseCount: normalized.scheduled.length,
      unscheduledCourseCount: normalized.unscheduled.length,
      conflictCount: countConflicts(normalized.scheduled),
      semester: toText(options.semester || options.term || "当前学期"),
    },
    preview: {
      scheduled: normalized.scheduled.slice(0, 12).map(previewCourse),
      unscheduled: normalized.unscheduled.slice(0, 12).map(previewCourse),
    },
    scheduledCourses: normalized.scheduled,
    unscheduledCourses: normalized.unscheduled,
  };
}

module.exports = {
  buildImportPreview,
  countConflicts,
  inferClassName,
  inferStudentName,
  normalizeScheduleRows,
  parseSections,
  parseWeekday,
  parseWeeks,
};

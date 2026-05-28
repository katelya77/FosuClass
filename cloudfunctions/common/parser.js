const TITLE_SUFFIXES = [
  "教授",
  "副教授",
  "讲师",
  "助理研究员",
  "研究员",
  "高级实验师",
  "实验师",
  "老师",
];

function uniqueNumbers(numbers) {
  const seen = {};
  return numbers
    .filter((number) => {
      if (seen[number]) {
        return false;
      }
      seen[number] = true;
      return true;
    })
    .sort((a, b) => a - b);
}

function normalizeLineBreaks(text) {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "\n");
}

function stripTeacherTitle(name) {
  let value = String(name || "").trim();
  TITLE_SUFFIXES.forEach((suffix) => {
    if (value.endsWith(suffix)) {
      value = value.slice(0, -suffix.length);
    }
  });
  return value.trim();
}

function parseWeekText(text) {
  const raw = String(text || "").trim();
  let weekType = "all";
  if (/单周|单/.test(raw)) {
    weekType = "odd";
  }
  if (/双周|双/.test(raw)) {
    weekType = "even";
  }
  const clean = raw.replace(/周/g, "").replace(/[单双]/g, "").replace(/\s/g, "");
  const weeks = [];
  clean.split(/[，,]/).forEach((part) => {
    if (!part) {
      return;
    }
    const range = part.split("-");
    if (range.length === 2) {
      for (let week = Number(range[0]); week <= Number(range[1]); week += 1) {
        weeks.push(week);
      }
      return;
    }
    const week = Number(part);
    if (week) {
      weeks.push(week);
    }
  });
  const filteredWeeks = uniqueNumbers(
    weeks.filter((week) => {
      if (weekType === "odd") {
        return week % 2 === 1;
      }
      if (weekType === "even") {
        return week % 2 === 0;
      }
      return true;
    })
  );
  return {
    startWeek: filteredWeeks[0] || 1,
    endWeek: filteredWeeks[filteredWeeks.length - 1] || 1,
    weeks: filteredWeeks,
    weekText: raw,
    weekType,
  };
}

function parseSectionText(text) {
  const value = String(text || "").trim();
  const match = value.match(/(.+?)?\[([0-9\-]+)\]\s*节?/);
  if (!match) {
    return {
      classroom: value,
      startSection: 1,
      endSection: 1,
    };
  }
  const sections = match[2].split("-").map(Number).filter(Boolean);
  return {
    classroom: (match[1] || "").trim(),
    startSection: sections[0] || 1,
    endSection: sections[sections.length - 1] || sections[0] || 1,
  };
}

function splitCourseBlocks(text) {
  return normalizeLineBreaks(text)
    .split(/\n?\s*-{3,}\s*\n?/g)
    .map((block) => block.trim())
    .filter(Boolean);
}

function parseCourseText(rawText, options) {
  const config = options || {};
  return splitCourseBlocks(rawText).map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const courseName = lines[0] || "";
    const teacherLine = lines[1] || "";
    const weekLine = lines.find((line) => /周/.test(line)) || "";
    const sectionLine = lines.find((line) => /\[[0-9\-]+\]\s*节?/.test(line)) || "";
    const remarkLine = lines.find((line) => /^备注[:：]/.test(line)) || "";
    const weekInfo = parseWeekText(weekLine);
    const sectionInfo = parseSectionText(sectionLine);

    return {
      id: `${config.idPrefix || "parsed-course"}-${index + 1}`,
      source: config.source || "school",
      semester: config.semester || "",
      className: config.className || "",
      courseName,
      teacherName: stripTeacherTitle(teacherLine),
      classroom: sectionInfo.classroom,
      weekday: config.weekday || 1,
      startSection: sectionInfo.startSection,
      endSection: sectionInfo.endSection,
      startWeek: weekInfo.startWeek,
      endWeek: weekInfo.endWeek,
      weeks: weekInfo.weeks,
      weekText: weekInfo.weekText,
      weekType: weekInfo.weekType,
      color: config.color || "",
      remark: remarkLine.replace(/^备注[:：]/, "").trim(),
      rawText: block,
      rawHtml: config.rawHtml || "",
    };
  });
}

module.exports = {
  normalizeLineBreaks,
  parseCourseText,
  parseSectionText,
  parseWeekText,
  splitCourseBlocks,
  stripTeacherTitle,
};

const DEFAULT_TOTAL_WEEKS = 20;

const TITLE_SUFFIXES = [
  "讲师（高校）",
  "讲师(高校)",
  "助理研究员",
  "助理实验师",
  "高级实验师",
  "研究馆员",
  "副研究员",
  "高级工程师",
  "副教授",
  "研究员",
  "实验师",
  "工程师",
  "教授",
  "讲师",
  "助教",
  "老师",
].sort((a, b) => b.length - a.length);

const HTML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: " ",
  quot: "\"",
  apos: "'",
};

function range(start, end) {
  const values = [];
  for (let value = start; value <= end; value += 1) {
    values.push(value);
  }
  return values;
}

function uniqueNumbers(numbers) {
  const seen = {};
  return numbers
    .filter((number) => {
      if (!number || seen[number]) {
        return false;
      }
      seen[number] = true;
      return true;
    })
    .sort((a, b) => a - b);
}

function decodeHtmlEntities(text) {
  return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();
    if (key[0] === "#") {
      const isHex = key[1] === "x";
      const code = parseInt(key.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : match;
  });
}

function normalizeFullWidthDigits(text) {
  return String(text || "").replace(/[０-９]/g, (char) => {
    return String(char.charCodeAt(0) - 0xff10);
  });
}

function normalizeLineBreaks(text) {
  return decodeHtmlEntities(String(text || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<hr\b[^>]*>/gi, "\n-----\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n");
}

function normalizeDash(text) {
  return String(text || "").replace(/[－—–~～至]/g, "-");
}

function stripTeacherTitle(name) {
  let value = String(name || "").trim();
  let changed = true;
  while (changed) {
    changed = false;
    TITLE_SUFFIXES.forEach((suffix) => {
      if (value.endsWith(suffix)) {
        value = value.slice(0, -suffix.length).trim();
        changed = true;
      }
    });
  }
  return value.trim();
}

function detectWeekType(rawText) {
  if (/双周|双/.test(rawText)) {
    return "even";
  }
  if (/单周|单/.test(rawText)) {
    return "odd";
  }
  return "all";
}

function filterWeekType(weeks, weekType) {
  return weeks.filter((week) => {
    if (weekType === "odd") {
      return week % 2 === 1;
    }
    if (weekType === "even") {
      return week % 2 === 0;
    }
    return true;
  });
}

function parseWeekText(text, options) {
  const config = options || {};
  const raw = normalizeDash(normalizeFullWidthDigits(decodeHtmlEntities(text))).trim();
  const weekType = detectWeekType(raw);
  const defaultWeeks = range(config.defaultStartWeek || 1, config.defaultEndWeek || DEFAULT_TOTAL_WEEKS);
  const numericMatch = raw.match(/[0-9]+(?:\s*-\s*[0-9]+)?(?:\s*[,，、]\s*[0-9]+(?:\s*-\s*[0-9]+)?)*\s*周?/);
  const clean = (numericMatch ? numericMatch[0] : raw)
    .replace(/第/g, "")
    .replace(/周/g, "")
    .replace(/[单双]/g, "")
    .replace(/[()（）]/g, "")
    .replace(/\s/g, "");
  const weeks = [];

  clean.split(/[，,、]/).forEach((part) => {
    if (!part) {
      return;
    }
    const rangeParts = part.split("-").filter(Boolean);
    if (rangeParts.length === 2) {
      const start = Number(rangeParts[0]);
      const end = Number(rangeParts[1]);
      if (start && end) {
        for (let week = start; week <= end; week += 1) {
          weeks.push(week);
        }
      }
      return;
    }
    const week = Number(part);
    if (week) {
      weeks.push(week);
    }
  });

  const filteredWeeks = uniqueNumbers(filterWeekType(weeks.length ? weeks : defaultWeeks, weekType));

  return {
    startWeek: filteredWeeks[0] || 1,
    endWeek: filteredWeeks[filteredWeeks.length - 1] || 1,
    weeks: filteredWeeks,
    weekText: raw || config.defaultWeekText || "未标明周次",
    weekType,
  };
}

function parseSectionText(text) {
  const value = normalizeDash(normalizeFullWidthDigits(decodeHtmlEntities(text))).trim();
  const match = value.match(/([\s\S]*?)[\[［【]([0-9\s,，、\-]+)[\]］】]\s*节?/);
  if (!match) {
    return {
      classroom: value.replace(/^(教室|地点)[:：]/, "").trim(),
      startSection: 1,
      endSection: 1,
      hasSection: false,
    };
  }
  const sections = match[2]
    .split(/[^0-9]+/)
    .map((item) => Number(item.trim()))
    .filter(Boolean);
  return {
    classroom: (match[1] || "").replace(/^(教室|地点)[:：]/, "").trim(),
    startSection: sections[0] || 1,
    endSection: sections[sections.length - 1] || sections[0] || 1,
    hasSection: sections.length > 0,
  };
}

function splitCourseBlocks(text) {
  return normalizeLineBreaks(text)
    .split(/\n?\s*(?:-{5,}|—{3,}|─{3,}|={4,}|_{4,})\s*\n?/g)
    .map((block) => block.trim())
    .filter(Boolean);
}

function isWeekLine(line) {
  return /([0-9０-９]+.*周|单周|双周)/.test(line);
}

function isSectionLine(line) {
  return /[\[［【][0-9０-９\s,，、－—–~～至-]+[\]］】]\s*节?/.test(line);
}

function cleanCourseName(line) {
  return String(line || "").replace(/^(课程|课程名称)[:：]/, "").trim();
}

function cleanRemark(line) {
  return String(line || "").replace(/^备注[:：]?/, "").trim();
}

function parseCourseText(rawText, options) {
  const config = options || {};
  return splitCourseBlocks(rawText)
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) {
        return null;
      }

      const weekIndex = lines.findIndex(isWeekLine);
      const sectionIndex = lines.findIndex(isSectionLine);
      const remarkIndexes = {};
      lines.forEach((line, lineIndex) => {
        if (/^备注[:：]?/.test(line)) {
          remarkIndexes[lineIndex] = true;
        }
      });

      const courseName = cleanCourseName(lines[0]);
      const teacherIndex = lines.findIndex((line, lineIndex) => {
        return lineIndex > 0 && lineIndex !== weekIndex && lineIndex !== sectionIndex && !remarkIndexes[lineIndex];
      });
      const teacherLine = teacherIndex >= 0 ? lines[teacherIndex] : "";
      const weekLine = weekIndex >= 0 ? lines[weekIndex] : "";
      const sectionLine = sectionIndex >= 0 ? lines[sectionIndex] : "";
      const weekInfo = parseWeekText(weekLine, {
        defaultStartWeek: config.defaultStartWeek || 1,
        defaultEndWeek: config.defaultEndWeek || DEFAULT_TOTAL_WEEKS,
      });
      const sectionInfo = parseSectionText(sectionLine);
      const remark = lines
        .filter((line, lineIndex) => remarkIndexes[lineIndex] || (lineIndex > 0 && lineIndex !== teacherIndex && lineIndex !== weekIndex && lineIndex !== sectionIndex))
        .map(cleanRemark)
        .filter(Boolean)
        .join("\n");

      return Object.assign(
        {
          id: `${config.idPrefix || "parsed-course"}-${index + 1}`,
          source: config.source || "school",
          semester: config.semester || "",
          className: config.className || "",
          courseName,
          teacherName: stripTeacherTitle(teacherLine),
          classroom: sectionInfo.classroom,
          weekday: config.weekday || 1,
          startSection: sectionInfo.hasSection ? sectionInfo.startSection : config.fallbackStartSection || sectionInfo.startSection,
          endSection: sectionInfo.hasSection ? sectionInfo.endSection : config.fallbackEndSection || sectionInfo.endSection,
          startWeek: weekInfo.startWeek,
          endWeek: weekInfo.endWeek,
          weeks: weekInfo.weeks,
          weekText: weekInfo.weekText,
          weekType: weekInfo.weekType,
          color: config.color || "",
          remark,
          rawText: block,
          rawHtml: config.rawHtml || "",
        },
        config.extra || {}
      );
    })
    .filter((course) => course && course.courseName);
}

module.exports = {
  decodeHtmlEntities,
  normalizeDash,
  normalizeFullWidthDigits,
  normalizeLineBreaks,
  parseCourseText,
  parseSectionText,
  parseWeekText,
  splitCourseBlocks,
  stripTeacherTitle,
};

#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { colorForCourse } = require("../miniprogram/utils/color");
const {
  normalizeLineBreaks,
  parseCourseText,
  parseWeekText,
  splitCourseBlocks,
  stripTeacherTitle,
} = require("../cloudfunctions/common/parser");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_HAR_PATH = path.join(ROOT_DIR, "docs", "captures", "ProxyPin5-28_16_57_23.sanitized.har");
const FALLBACK_SANITIZED_HAR_PATHS = [
  path.join(ROOT_DIR, "docs", "captures", "ProxyPin5-28_16_57_23.sanitized(1).har"),
  path.join(ROOT_DIR, "docs", "ProxyPin5-28_16_57_23.sanitized.har"),
  path.join(ROOT_DIR, "docs", "ProxyPin5-28_16_57_23.sanitized(1).har"),
];
const OUTPUT_JSON_PATH = path.join(ROOT_DIR, "docs", "captures", "personal-schedule.parsed.json");
const OUTPUT_JS_PATH = path.join(ROOT_DIR, "miniprogram", "data", "importedCourses.js");

const DEFAULT_CLASS_NAME = "25动物医学6";
const DEFAULT_SEMESTER = "2025-2026学年第二学期";
const REDACTED = "[REDACTED]";
const SENSITIVE_NAME = /^(cookie|set-cookie|authorization|jsessionid|token|password|pwd|passwd|fosu_password)$/i;
const SENSITIVE_PART = /(jsessionid|token|password|pwd|passwd|fosu_password|authorization)/i;
const ROW_SECTION_FALLBACKS = [
  [1, 2],
  [3, 5],
  [6, 7],
  [8, 10],
  [11, 12],
  [13, 14],
];
const ROW_SECTION_LABELS = [
  { pattern: /第一大节|1大节|第1大节/, range: [1, 2] },
  { pattern: /第二大节|2大节|第2大节/, range: [3, 5] },
  { pattern: /第三大节|3大节|第3大节/, range: [6, 7] },
  { pattern: /第四大节|4大节|第4大节/, range: [8, 10] },
  { pattern: /第五大节|5大节|第5大节/, range: [11, 12] },
  { pattern: /第六大节|6大节|第6大节/, range: [13, 14] },
];

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function assertSanitizedHarPath(filePath) {
  const baseName = path.basename(filePath).toLowerCase();
  if (!baseName.includes("sanitized") || !baseName.endsWith(".har")) {
    throw new Error("Refusing to read non-sanitized HAR. Please run tools/sanitize-har.js first.");
  }
}

function resolveInputPath() {
  if (process.argv[2]) {
    return path.resolve(process.cwd(), process.argv[2]);
  }
  if (fs.existsSync(DEFAULT_HAR_PATH)) {
    return DEFAULT_HAR_PATH;
  }
  const fallback = FALLBACK_SANITIZED_HAR_PATHS.find((filePath) => fs.existsSync(filePath));
  return fallback || DEFAULT_HAR_PATH;
}

function isSensitiveName(name) {
  return SENSITIVE_NAME.test(String(name || "")) || SENSITIVE_PART.test(String(name || ""));
}

function isRedactedValue(value) {
  const text = String(value || "").trim();
  return !text || text === REDACTED || /^\*+$/.test(text) || /redacted/i.test(text);
}

function inspectNameValueList(list, label, findings) {
  if (!Array.isArray(list)) {
    return;
  }
  list.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const name = item.name || "";
    if (isSensitiveName(name) && !isRedactedValue(item.value)) {
      findings.push(`${label}.${name}`);
    }
  });
}

function inspectUrl(rawUrl, label, findings) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return;
  }
  if (/;jsessionid=([^?&#]+)/i.test(rawUrl) && !/;jsessionid=(\[REDACTED\]|redacted)/i.test(rawUrl)) {
    findings.push(`${label}.url.jsessionid`);
  }
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.forEach((value, key) => {
      if (isSensitiveName(key) && !isRedactedValue(value)) {
        findings.push(`${label}.url.${key}`);
      }
    });
  } catch (error) {
    if (/([?&][^=]*(?:jsessionid|token|password|pwd|passwd|authorization)[^=]*=)(?!\[REDACTED\]|redacted)[^&]*/i.test(rawUrl)) {
      findings.push(`${label}.url`);
    }
  }
}

function findUnsafeHarFields(har) {
  const findings = [];
  const entries = (((har || {}).log || {}).entries || []);
  entries.forEach((entry, index) => {
    const prefix = `entries[${index}]`;
    const request = entry.request || {};
    const response = entry.response || {};
    inspectUrl(request.url, `${prefix}.request`, findings);
    inspectNameValueList(request.headers, `${prefix}.request.headers`, findings);
    inspectNameValueList(request.cookies, `${prefix}.request.cookies`, findings);
    inspectNameValueList(request.queryString, `${prefix}.request.queryString`, findings);
    inspectNameValueList(request.postData && request.postData.params, `${prefix}.request.postData.params`, findings);
    inspectNameValueList(response.headers, `${prefix}.response.headers`, findings);
    inspectNameValueList(response.cookies, `${prefix}.response.cookies`, findings);
  });
  return findings;
}

function readHar(filePath) {
  assertSanitizedHarPath(filePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Sanitized HAR not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const har = JSON.parse(raw);
  const unsafeFields = findUnsafeHarFields(har);
  if (unsafeFields.length) {
    throw new Error(`Sanitized HAR still contains sensitive fields: ${unsafeFields.slice(0, 8).join(", ")}`);
  }
  return har;
}

function getResponseText(entry) {
  const content = entry && entry.response && entry.response.content;
  if (!content || typeof content.text !== "string") {
    return "";
  }
  if (String(content.encoding || "").toLowerCase() === "base64") {
    return Buffer.from(content.text, "base64").toString("utf8");
  }
  return content.text;
}

function hasKbtable(html) {
  return /<table\b[^>]*\bid\s*=\s*["']?kbtable["']?/i.test(html || "");
}

function findPersonalScheduleEntry(har) {
  const entries = (((har || {}).log || {}).entries || []);
  const candidates = entries
    .map((entry) => {
      return {
        entry,
        text: getResponseText(entry),
      };
    })
    .filter((candidate) => {
      const requestUrl = (((candidate.entry || {}).request || {}).url || "");
      const status = (((candidate.entry || {}).response || {}).status || 0);
      return requestUrl.indexOf("/xskb/xskb_list.do") >= 0 && Number(status) === 200 && hasKbtable(candidate.text);
    })
    .sort((a, b) => b.text.length - a.text.length);
  return candidates[0] || null;
}

function htmlText(html) {
  return normalizeLineBreaks(html).replace(/\n{3,}/g, "\n\n").trim();
}

function extractKbtableHtml(html) {
  const tableStart = /<table\b[^>]*\bid\s*=\s*["']?kbtable["']?[^>]*>/i.exec(html);
  if (!tableStart) {
    return "";
  }
  const startIndex = tableStart.index;
  const endIndex = html.toLowerCase().indexOf("</table>", startIndex);
  if (endIndex < 0) {
    return html.slice(startIndex);
  }
  return html.slice(startIndex, endIndex + "</table>".length);
}

function getTableInnerHtml(tableHtml) {
  const openEnd = tableHtml.indexOf(">");
  const closeStart = tableHtml.toLowerCase().lastIndexOf("</table>");
  if (openEnd < 0) {
    return tableHtml;
  }
  return tableHtml.slice(openEnd + 1, closeStart >= 0 ? closeStart : tableHtml.length);
}

function extractRows(tableHtml) {
  const rows = [];
  const innerHtml = getTableInnerHtml(tableHtml);
  const tagPattern = /<\/?(table|tr)\b[^>]*>/gi;
  let nestedTableDepth = 0;
  let rowStart = -1;
  let tagMatch = tagPattern.exec(innerHtml);
  while (tagMatch) {
    const tag = tagMatch[1].toLowerCase();
    const rawTag = tagMatch[0];
    const isClosing = /^<\//.test(rawTag);
    if (tag === "table") {
      nestedTableDepth += isClosing ? -1 : 1;
    } else if (tag === "tr" && nestedTableDepth === 0) {
      if (!isClosing) {
        rowStart = tagPattern.lastIndex;
      } else if (rowStart >= 0) {
        rows.push(innerHtml.slice(rowStart, tagMatch.index));
        rowStart = -1;
      }
    }
    tagMatch = tagPattern.exec(innerHtml);
  }
  return rows;
}

function extractCells(rowHtml) {
  const cells = [];
  const tagPattern = /<\/?(table|td|th)\b[^>]*>/gi;
  let nestedTableDepth = 0;
  let currentCell = null;
  let tagMatch = tagPattern.exec(rowHtml);
  while (tagMatch) {
    const tag = tagMatch[1].toLowerCase();
    const rawTag = tagMatch[0];
    const isClosing = /^<\//.test(rawTag);
    if (tag === "table") {
      nestedTableDepth += isClosing ? -1 : 1;
    } else if ((tag === "td" || tag === "th") && nestedTableDepth === 0) {
      if (!isClosing) {
        currentCell = {
          tag,
          attrs: rawTag.replace(/^<\w+\s*/i, "").replace(/>$/, ""),
          start: tagPattern.lastIndex,
        };
      } else if (currentCell && currentCell.tag === tag) {
        const html = rowHtml.slice(currentCell.start, tagMatch.index);
        cells.push({
          tag: currentCell.tag,
          attrs: currentCell.attrs,
          html,
          text: htmlText(html),
        });
        currentCell = null;
      }
    }
    tagMatch = tagPattern.exec(rowHtml);
  }
  return cells;
}

function isHeaderRow(cells) {
  return cells.some((cell) => /星期[一二三四五六日]|周[一二三四五六日]/.test(cell.text));
}

function isEmptyCell(cell) {
  const text = (cell && cell.text) || "";
  return !text || /^[\s　-]*$/.test(text);
}

function extractQiangzhiContentDivs(cellHtml) {
  const divs = [];
  const divPattern = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi;
  let divMatch = divPattern.exec(cellHtml);
  while (divMatch) {
    const attrs = divMatch[1] || "";
    const classMatch = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i);
    const className = classMatch ? classMatch[1] : "";
    if (/\bkbcontent\b/.test(className) && !/\bkbcontent1\b/.test(className)) {
      divs.push(divMatch[2] || "");
    }
    divMatch = divPattern.exec(cellHtml);
  }
  return divs;
}

function isWeekText(line) {
  return /([0-9０-９]+.*周|单周|双周)/.test(line || "");
}

function isSectionText(line) {
  return /[\[［【][0-9０-９\s,，、－—–~～至-]+[\]］】]\s*节?/.test(line || "");
}

function buildCourseTextFromQiangzhiCell(cellHtml) {
  const divs = extractQiangzhiContentDivs(cellHtml);
  if (!divs.length) {
    return cellHtml;
  }

  const chunks = splitCourseBlocks(divs.map((html) => htmlText(html)).join("\n-----\n"));
  const pendingTeachers = {};
  const courseBlocks = [];

  chunks.forEach((chunk) => {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      return;
    }

    const hasWeek = lines.some(isWeekText);
    const hasSection = lines.some(isSectionText);
    const isRemarkOnly = lines.every((line) => /^备注[:：]?/.test(line));
    if (isRemarkOnly) {
      if (courseBlocks.length) {
        courseBlocks[courseBlocks.length - 1] = `${courseBlocks[courseBlocks.length - 1]}\n${lines.join("\n")}`;
      }
      return;
    }

    if (!hasWeek && !hasSection && lines.length >= 2) {
      pendingTeachers[lines[0]] = lines.slice(1).join("\n");
      return;
    }

    const courseName = lines[0];
    const hasTeacherLine = lines.slice(1).some((line) => {
      return !isWeekText(line) && !isSectionText(line) && !/^备注[:：]?/.test(line);
    });
    const blockLines = lines.slice();
    if (!hasTeacherLine && pendingTeachers[courseName]) {
      blockLines.splice(1, 0, pendingTeachers[courseName]);
    }
    courseBlocks.push(blockLines.join("\n"));
  });

  return courseBlocks.length ? courseBlocks.join("\n-----\n") : cellHtml;
}

function isLooseRemarkCell(text) {
  return /[;；]/.test(text || "") && /周/.test(text || "") && !isSectionText(text || "");
}

function parseLooseRemarkCourses(text, context) {
  const config = context || {};
  return String(text || "")
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter((item) => /周/.test(item))
    .map((item, index) => {
      const weekMatch = item.match(/[0-9０-９]+(?:\s*[-－—–~～至]\s*[0-9０-９]+)?(?:\s*[,，、]\s*[0-9０-９]+(?:\s*[-－—–~～至]\s*[0-9０-９]+)?)*\s*周/);
      const weekText = weekMatch ? weekMatch[0] : "";
      const beforeWeek = (weekMatch ? item.slice(0, weekMatch.index) : item).trim();
      const nameParts = beforeWeek.split(/\s+/).filter(Boolean);
      let courseName = beforeWeek;
      let teacherName = "";
      let extraRemark = "";
      if (nameParts.length >= 2) {
        const maybeTeacher = nameParts[nameParts.length - 1];
        courseName = nameParts.slice(0, -1).join(" ");
        if (/\d+\s*学时/.test(maybeTeacher)) {
          extraRemark = maybeTeacher;
        } else {
          teacherName = stripTeacherTitle(maybeTeacher);
        }
      }
      const weekInfo = parseWeekText(weekText || item);
      const classroom = /在线|网课|超星|尔雅/.test(item) ? "在线课程" : /自行安排|集中排课/.test(item) ? "自行安排" : "";
      return normalizeCourse({
        id: `${config.idPrefix || "har-remark"}-${index + 1}`,
        source: "har",
        semester: config.semester || DEFAULT_SEMESTER,
        className: config.className || DEFAULT_CLASS_NAME,
        courseName,
        teacherName,
        classroom,
        weekday: 0,
        startSection: 0,
        endSection: 0,
        startWeek: weekInfo.startWeek,
        endWeek: weekInfo.endWeek,
        weeks: weekInfo.weeks,
        weekText: weekInfo.weekText,
        weekType: weekInfo.weekType,
        color: colorForCourse(courseName),
        remark: extraRemark ? `备注行课程，无固定星期和节次。${extraRemark}` : "备注行课程，无固定星期和节次。",
        rawText: item,
        rawHtml: config.rawHtml || "",
      });
    });
}

function getFallbackSections(rowLabel, dataRowIndex) {
  const normalized = String(rowLabel || "").replace(/\s/g, "");
  const labelMatch = ROW_SECTION_LABELS.find((item) => item.pattern.test(normalized));
  if (labelMatch) {
    return labelMatch.range;
  }
  return ROW_SECTION_FALLBACKS[dataRowIndex] || [1, 1];
}

function extractSemester(entry, html) {
  const request = (entry && entry.request) || {};
  const params = (request.postData && request.postData.params) || [];
  const param = params.find((item) => item && (item.name === "xnxq01id" || item.name === "xnxqh"));
  let value = (param && param.value) || "";
  if (!value && request.postData && typeof request.postData.text === "string") {
    try {
      const postParams = new URLSearchParams(request.postData.text);
      value = postParams.get("xnxq01id") || postParams.get("xnxqh") || "";
    } catch (error) {
      const match = request.postData.text.match(/(?:^|&)(?:xnxq01id|xnxqh)=([^&]+)/);
      value = match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
    }
  }
  const source = value || html;
  const match = String(source).match(/(20\d{2})-(20\d{2})-([12])/);
  if (!match) {
    return DEFAULT_SEMESTER;
  }
  return `${match[1]}-${match[2]}学年${match[3] === "1" ? "第一" : "第二"}学期`;
}

function extractClassName(html) {
  const text = htmlText(html);
  const labeled = text.match(/(?:行政班级|班级名称|班级)[:：\s]+([^\n\r]{2,40})/);
  if (labeled) {
    const value = labeled[1].replace(/\s+/g, "").trim();
    if (/[\u4e00-\u9fa5]/.test(value)) {
      return value;
    }
  }
  const compact = text.match(/[0-9]{2}[\u4e00-\u9fa5A-Za-z0-9（）()]{2,20}[0-9]班?/);
  return compact && /[\u4e00-\u9fa5]/.test(compact[0]) ? compact[0].replace(/班$/, "") : DEFAULT_CLASS_NAME;
}

function hashText(text) {
  let hash = 0;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/<input\b[^>]*>/gi, "")
    .replace(/;jsessionid=([^?&#"'<\s]+)/gi, `;jsessionid=${REDACTED}`)
    .replace(/([?&](?:[^=&#]*(?:jsessionid|token|password|pwd|passwd|authorization)[^=&#]*)=)[^&#"'<\s]+/gi, `$1${REDACTED}`)
    .replace(/(Cookie|Authorization)\s*:\s*[^\n\r<]+/gi, `$1: ${REDACTED}`);
}

function normalizeCourse(course) {
  const key = [
    course.courseName,
    course.teacherName,
    course.classroom,
    course.weekday,
    course.startSection,
    course.endSection,
    course.weekText,
    course.remark,
  ].join("|");
  return Object.assign({}, course, {
    id: `har-${course.weekday}-${course.startSection}-${hashText(key)}`,
    source: "har",
    color: course.color || colorForCourse(course.courseName),
    rawText: redactSensitiveText(course.rawText),
    rawHtml: redactSensitiveText(course.rawHtml),
  });
}

function dedupeCourses(courses) {
  const seen = {};
  const output = [];
  courses.forEach((course) => {
    const key = [
      course.courseName,
      course.teacherName,
      course.classroom,
      course.weekday,
      course.startSection,
      course.endSection,
      course.weekText,
      course.remark,
    ].join("|");
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    output.push(course);
  });
  return output;
}

function parsePersonalScheduleHtml(html, entry) {
  const tableHtml = extractKbtableHtml(html);
  const rows = extractRows(tableHtml);
  const semester = extractSemester(entry, html);
  const className = extractClassName(html);
  const courses = [];
  let dataRowIndex = 0;

  rows.forEach((rowHtml, rowIndex) => {
    const cells = extractCells(rowHtml);
    if (!cells.length || isHeaderRow(cells)) {
      return;
    }
    const hasRowLabel = cells.length >= 8 || /大节|备注/.test(cells[0].text);
    const rowLabel = hasRowLabel ? cells[0].text : "";
    const dayCells = (hasRowLabel ? cells.slice(1) : cells).slice(0, 7);
    const fallbackSections = getFallbackSections(rowLabel, dataRowIndex);

    dayCells.forEach((cell, weekdayIndex) => {
      if (isEmptyCell(cell)) {
        return;
      }
      const weekday = weekdayIndex + 1;
      const cellText = htmlText(cell.html || cell.text);
      if (isLooseRemarkCell(cellText)) {
        parseLooseRemarkCourses(cellText, {
          idPrefix: `har-r${rowIndex}-remark`,
          semester,
          className,
          rawHtml: redactSensitiveText(cell.html || ""),
        }).forEach((course) => courses.push(course));
        return;
      }
      const courseText = buildCourseTextFromQiangzhiCell(cell.html || cell.text);
      const parsed = parseCourseText(courseText, {
        idPrefix: `har-r${rowIndex}-d${weekday}`,
        source: "har",
        semester,
        className,
        weekday,
        fallbackStartSection: fallbackSections[0],
        fallbackEndSection: fallbackSections[1],
        rawHtml: redactSensitiveText(cell.html || ""),
      });
      parsed.forEach((course) => courses.push(normalizeCourse(course)));
    });

    if (!/备注/.test(rowLabel)) {
      dataRowIndex += 1;
    }
  });

  return dedupeCourses(courses).sort((a, b) => {
    if (a.weekday !== b.weekday) {
      return a.weekday - b.weekday;
    }
    if (a.startSection !== b.startSection) {
      return a.startSection - b.startSection;
    }
    return a.courseName.localeCompare(b.courseName, "zh-Hans-CN");
  });
}

function writeImportedCourses(courses) {
  ensureDir(OUTPUT_JS_PATH);
  const content = [
    "// Generated by tools/extract-har-schedule.js from a sanitized HAR.",
    "// Do not edit manually; rerun the extractor after updating the capture.",
    `const importedCourses = ${JSON.stringify(courses, null, 2)};`,
    "",
    "module.exports = {",
    "  importedCourses,",
    "};",
    "",
  ].join("\n");
  fs.writeFileSync(OUTPUT_JS_PATH, content, "utf8");
}

function writeParsedJson(courses) {
  ensureDir(OUTPUT_JSON_PATH);
  fs.writeFileSync(OUTPUT_JSON_PATH, `${JSON.stringify(courses, null, 2)}\n`, "utf8");
}

function main() {
  const inputPath = resolveInputPath();
  const har = readHar(inputPath);
  const candidate = findPersonalScheduleEntry(har);
  if (!candidate) {
    throw new Error("No /xskb/xskb_list.do 200 response containing table#kbtable was found.");
  }
  const courses = parsePersonalScheduleHtml(candidate.text, candidate.entry);
  writeParsedJson(courses);
  writeImportedCourses(courses);
  console.log(`Parsed ${courses.length} courses from sanitized HAR.`);
  console.log(`JSON written to ${path.relative(ROOT_DIR, OUTPUT_JSON_PATH)}`);
  console.log(`Mini Program data written to ${path.relative(ROOT_DIR, OUTPUT_JS_PATH)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

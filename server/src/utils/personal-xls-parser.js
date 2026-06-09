/**
 * 个人课表 XLS 解析器
 * NOTE: 负责解析从 100 网下载的“学生个人理论课表” XLS 文件，扩散合并单元格并提取完整的个人课表课程列表。
 */

const XLSX = require("xlsx");
const { toRenderableCourse } = require("./courseNormalizer");
const { stripTeacherTitle, parseWeeks, parseSections } = require("./personal-schedule-parser");
const { safeLog } = require("./safeLogger");
const termRegistryService = require("../services/termRegistryService");

/**
 * 扩散合并单元格的值
 * @param {Object} sheet 工作表对象
 * @param {Array<Array<string>>} rows 二维数组结构
 */
function fillMergedCells(sheet, rows) {
  const merges = sheet["!merges"] || [];
  merges.forEach((merge) => {
    const val = rows[merge.s.r]?.[merge.s.c];
    if (val) {
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) {
          if (rows[r]) {
            rows[r][c] = val;
          }
        }
      }
    }
  });
}

function normalizeHeaderCell(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDefaultTerm() {
  const active = termRegistryService.getActiveTerm();
  return active && active.term || termRegistryService.LEGACY_CURRENT_TERM_CONFIG.term;
}

function normalizeDateText(value) {
  const text = normalizeHeaderCell(value);
  const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) {
    return text;
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
}

function buildHeaderRows(rows) {
  return rows.slice(0, 5).map((row) => (Array.isArray(row) ? row : []).map(normalizeHeaderCell));
}

function findHeaderLabelValue(headerRows, label) {
  const exactRe = new RegExp("^" + label + "\\s*[:：]\\s*(.+)$");
  const labelOnlyRe = new RegExp("^" + label + "\\s*[:：]?\\s*$");

  for (const row of headerRows) {
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c] || "";
      const inlineMatch = cell.match(exactRe);
      if (inlineMatch && inlineMatch[1]) {
        return inlineMatch[1].trim();
      }
      if (labelOnlyRe.test(cell)) {
        for (let next = c + 1; next < row.length; next += 1) {
          if (row[next]) {
            return row[next].trim();
          }
        }
      }
    }
  }
  return "";
}

function extractPersonalXlsMetadata(rows, sourceFileName, finalTerm) {
  const headerRows = buildHeaderRows(rows);
  const headerText = headerRows
    .map((row) => row.filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" ");
  const filename = normalizeHeaderCell(sourceFileName);

  const titleNameMatch = headerText.match(/佛山大学\s*(.+?)\s*学生(?:个人)?(?:理论)?课表/);
  const fileStudentIdMatch = filename.match(/(\d{8,12})/);
  const termMatch = headerText.match(/学年学期\s*[:：]\s*(\d{4}-\d{4}-\d)/);
  const classMatch = headerText.match(/(?:^|\s)班级\s*[:：]\s*([^\s]+)/);
  const majorMatch = headerText.match(/所属班级\s*[:：]\s*([^\s]+)/);
  const collegeMatch = headerText.match(/学院\s*[:：]\s*([^\s]+)/);
  const printDateMatch = headerText.match(/打印日期\s*[:：]\s*([0-9年./-]+(?:月[0-9]{1,2}日?)?)/);

  const studentName = (titleNameMatch && titleNameMatch[1])
    || findHeaderLabelValue(headerRows, "姓名")
    || "";
  const studentId = (fileStudentIdMatch && fileStudentIdMatch[1])
    || findHeaderLabelValue(headerRows, "学号")
    || "";
  const term = (termMatch && termMatch[1])
    || findHeaderLabelValue(headerRows, "学年学期")
    || finalTerm
    || "";
  const className = (classMatch && classMatch[1])
    || findHeaderLabelValue(headerRows, "班级")
    || "";
  const majorName = (majorMatch && majorMatch[1])
    || findHeaderLabelValue(headerRows, "所属班级")
    || "";
  const collegeName = (collegeMatch && collegeMatch[1])
    || findHeaderLabelValue(headerRows, "学院")
    || "";
  const printDate = normalizeDateText((printDateMatch && printDateMatch[1])
    || findHeaderLabelValue(headerRows, "打印日期")
    || "");

  return {
    studentName: studentName.trim(),
    studentId: studentId.trim(),
    term: term.trim(),
    className: className.trim(),
    majorName: majorName.trim(),
    collegeName: collegeName.trim(),
    printDate,
    source: "fosu-100-print-xls",
    sourceFileName: filename,
  };
}

/**
 * 合并相同课程在同一节次但不同地点的记录（如多场地体育课）
 * @param {Array<Object>} courses 课程对象列表
 * @returns {Array<Object>} 合并后的课程对象列表
 */
function mergeMultiVenueCourses(courses) {
  const mergedMap = new Map();

  for (const course of courses) {
    const secKey = (course.sections || []).join(",");
    const weekKey = (course.weeks || []).join(",");
    const key = `${course.courseName}|${course.teacherName}|${course.weekDay}|${secKey}|${weekKey}`;

    if (mergedMap.has(key)) {
      const existing = mergedMap.get(key);
      if (course.classroom && !existing.classrooms.includes(course.classroom)) {
        existing.classrooms.push(course.classroom);
      }
      existing.rawText = `${existing.rawText}\n-----\n${course.rawText}`;
    } else {
      const classrooms = course.classroom ? [course.classroom] : [];
      mergedMap.set(key, Object.assign({}, course, { classrooms }));
    }
  }

  const result = [];
  for (const course of mergedMap.values()) {
    if (course.classrooms.length > 1) {
      course.classroom = "多个地点";
    } else if (course.classrooms.length === 1) {
      course.classroom = course.classrooms[0];
    } else {
      course.classroom = "";
    }
    delete course.classrooms; // 清理临时属性
    result.push(course);
  }

  return result;
}

/**
 * 解析个人理论课表 XLS 的 Buffer 二进制内容
 * @param {Buffer} buffer 文件 Buffer
 * @param {string} targetTermFromUser 用户传入的目标学期
 * @param {string} sourceFileName 用户上传的源文件名
 * @returns {Object} 包含学期与已解析去重的课程数组
 */
function parsePersonalXlsBuffer(buffer, targetTermFromUser, sourceFileName) {
  // 1. 读取 xls
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new Error("工作表为空，无法解析。");
  }

  // 2. 转换为二维数组并扩散合并单元格的值
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  fillMergedCells(sheet, rows);

  // 3. 寻找学期（优先从表格上方识别）
  let detectedTerm = "";
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const rowStr = rows[r].join(" ");
    // 匹配类似 "2025-2026学年第二学期" 或 "2025-2026-2"
    const termMatch = rowStr.match(/(\d{4})-(\d{4})学年第([一二三四])学期/);
    if (termMatch) {
      const semMap = { "一": "1", "二": "2", "三": "3", "四": "4" };
      detectedTerm = `${termMatch[1]}-${termMatch[2]}-${semMap[termMatch[3]] || "1"}`;
      break;
    }
    const termMatch2 = rowStr.match(/(\d{4}-\d{4}-\d)/);
    if (termMatch2) {
      detectedTerm = termMatch2[1];
      break;
    }
  }
  const finalTerm = detectedTerm || targetTermFromUser || getDefaultTerm();
  const metadata = extractPersonalXlsMetadata(rows, sourceFileName, finalTerm);

  // 4. 定位星期表头行
  let headerRowIndex = -1;
  const weekdayColMap = {}; // weekday(1-7) -> colIndex
  
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let foundWeekdays = 0;
    const currentMap = {};
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c]).trim();
      const match = val.match(/星期([一二三四五六日天])/);
      if (match) {
        const chinese = match[1];
        const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
        currentMap[map[chinese]] = c;
        foundWeekdays++;
      }
    }
    if (foundWeekdays >= 5) {
      headerRowIndex = r;
      Object.assign(weekdayColMap, currentMap);
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error("无法在课表中定位星期表头列（未匹配到包含“星期一”至“星期五”的表头行）");
  }

  // 5. 遍历表头行之下的数据行，解析课程块
  const courses = [];
  
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    // 尝试识别当前行的节次 fallback（如第一大节、1-2节等）
    let fallbackSections = [1, 2];
    for (let c = 0; c < Math.min(3, row.length); c++) {
      const val = String(row[c]).trim();
      const secMatch = val.match(/第?\s*(\d{1,2})\s*[-~～至到]\s*(\d{1,2})\s*节?/);
      if (secMatch) {
        fallbackSections = [parseInt(secMatch[1], 10), parseInt(secMatch[2], 10)];
        break;
      }
      const secMatch2 = val.match(/\[([0-9\-\s]+)\]/);
      if (secMatch2) {
        const parts = secMatch2[1].split("-").map(Number);
        if (parts.length >= 2) {
          fallbackSections = [parts[0], parts[parts.length - 1]];
          break;
        }
      }
    }

    // 遍历星期一到星期日对应的各列
    for (let weekDay = 1; weekDay <= 7; weekDay++) {
      const colIndex = weekdayColMap[weekDay];
      if (colIndex === undefined) continue;

      const cellVal = String(row[colIndex] || "").trim();
      if (!cellVal || /^[\s　-]*$/.test(cellVal)) {
        continue;
      }

      // XLS 的单元格可能包含一门或多门课，它们在 Excel 单元格中以换行和分割线分隔
      const blocks = cellVal
        .split(/\s*(?:-{4,}|—{3,}|─{3,}|={4,}|_{4,})\s*/g)
        .map((b) => b.trim())
        .filter(Boolean);

      blocks.forEach((blockText) => {
        const lines = blockText.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length === 0) return;

        let courseName = "";
        let teacherName = "";
        let weekText = "";
        let sectionsText = "";
        let classroom = "";
        let note = "";

        const weekIdx = lines.findIndex((l) => /([0-9]+.*周|单周|双周)/.test(l));
        const sectionIdx = lines.findIndex((l) => /[\[［【][0-9\s,，、－—–~～至-]+[\]］】]\s*节?/.test(l));

        lines.forEach((line, index) => {
          if (index === weekIdx || index === sectionIdx) {
            if (index === weekIdx) weekText = line;
            if (index === sectionIdx) sectionsText = line;
            return;
          }

          if (/^备注[:：]/.test(line)) {
            note = line.replace(/^备注[:：]/, "").trim();
            return;
          }

          if (!courseName) {
            courseName = line.replace(/^(课程|课程名称)[:：]/, "").trim();
          } else if (weekIdx >= 0 && index > weekIdx && !classroom) {
            classroom = line.replace(/^(教室|地点)[:：]/, "").trim();
          } else if (!teacherName) {
            teacherName = stripTeacherTitle(line);
          } else if (!classroom) {
            classroom = line.replace(/^(教室|地点)[:：]/, "").trim();
          }
        });

        // 进一步提取可能包含在节次前面的教室字段
        if (sectionsText) {
          const match = sectionsText.match(/^([\s\S]*?)[\[［【]/);
          if (match) {
            const extractedClass = match[1].replace(/^(教室|地点)[:：]/, "").trim();
            if (extractedClass) {
              classroom = extractedClass;
            }
          }
        }

        if (!courseName || /^星期[一二三四五六日]$/.test(courseName)) {
          return;
        }

        // 若无周次，视为无效片段直接过滤
        if (!weekText) {
          return;
        }

        const { startWeek, endWeek, weeks } = parseWeeks(weekText);
        const { startSection, endSection, sections } = parseSections(sectionsText, fallbackSections);

        const courseItem = {
          courseName,
          displayCourseName: courseName,
          canonicalCourseName: courseName,
          teacherName: teacherName || "",
          rawTeacherName: teacherName || "",
          classroom: classroom || "",
          weekDay: weekDay,
          weekday: weekDay,
          sections,
          startSection,
          endSection,
          weeks,
          startWeek,
          endWeek,
          weekText: weekText || "未标明周次",
          note: note,
          rawText: blockText,
          source: "fosu-100-print-xls",
        };

        const rendered = toRenderableCourse(courseItem);
        courses.push(rendered);
      });
    }
  }

  // 6. 进行多地点合并与最终去重
  const uniqueCourses = [];
  const seenKeys = new Set();
  const mergedCourses = mergeMultiVenueCourses(courses);

  mergedCourses.forEach((c) => {
    const secKey = (c.sections || []).join("-");
    const weekKey = (c.weeks || []).join("-");
    const key = `${c.courseName}::${c.weekDay}::${secKey}::${weekKey}::${c.classroom}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueCourses.push(c);
    }
  });

  safeLog("personal-xls-parsed", { term: finalTerm, courseCount: uniqueCourses.length });

  return {
    term: metadata.term || finalTerm,
    metadata,
    courses: uniqueCourses,
  };
}

module.exports = {
  parsePersonalXlsBuffer,
  _test: {
    extractPersonalXlsMetadata,
  },
};

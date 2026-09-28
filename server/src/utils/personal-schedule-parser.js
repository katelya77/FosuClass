/**
 * 个人课表 HTML 解析器
 * NOTE: 负责解析个人课表 (/xskb/xskb_list.do) 返回的 HTML，支持多课合并和多地点体育课逻辑。
 */

const cheerio = require("cheerio");
const { toRenderableCourse } = require("./courseNormalizer");

const TITLE_SUFFIXES = [
  "讲师（高校）", "讲师(高校)", "助理研究员", "助理实验师", "高级实验师",
  "研究馆员", "副研究员", "高级工程师", "副教授", "研究员", "实验师",
  "工程师", "教授", "讲师", "助教", "老师",
].sort((a, b) => b.length - a.length);

const ROW_SECTION_FALLBACKS = [
  [1, 2],   // 第一大节
  [3, 5],   // 第二大节
  [6, 7],   // 第三大节
  [8, 10],  // 第四大节
  [11, 12], // 第五大节
  [13, 14], // 第六大节
];

const ROW_SECTION_LABELS = [
  { pattern: /第一大节|1大节|第1大节/, range: [1, 2] },
  { pattern: /第二大节|2大节|第2大节/, range: [3, 5] },
  { pattern: /第三大节|3大节|第3大节/, range: [6, 7] },
  { pattern: /第四大节|4大节|第4大节/, range: [8, 10] },
  { pattern: /第五大节|5大节|第5大节/, range: [11, 12] },
  { pattern: /第六大节|6大节|第6大节/, range: [13, 14] },
];

/**
 * 剥离教师名称后的职称后缀
 * @param {string} name 教师姓名
 * @returns {string} 剥离后的教师姓名
 */
function stripTeacherTitle(name) {
  let value = String(name || "").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of TITLE_SUFFIXES) {
      if (value.endsWith(suffix)) {
        value = value.slice(0, -suffix.length).trim();
        changed = true;
      }
    }
  }
  return value;
}

/**
 * 解析周次文本 (如: "1-16周(单)", "2,4,6-10周")
 * @param {string} weekText 原始周次文本
 * @returns {Object} 包含 weeks 数组、oddEven 类型及范围等信息
 */
function parseWeeks(weekText) {
  const raw = normalizeScheduleText(weekText);

  let oddEven = null;
  if (/单周|单/.test(raw)) {
    oddEven = "odd";
  } else if (/双周|双/.test(raw)) {
    oddEven = "even";
  }

  const numericMatch = raw.match(/[0-9]+(?:\s*-\s*[0-9]+)?(?:\s*[,，、]\s*[0-9]+(?:\s*-\s*[0-9]+)?)*\s*周?/);
  const clean = (numericMatch ? numericMatch[0] : raw)
    .replace(/第/g, "")
    .replace(/周/g, "")
    .replace(/[单双]/g, "")
    .replace(/[()（）]/g, "")
    .replace(/\s/g, "");

  let weeks = [];
  clean.split(/[,，、]/).forEach((part) => {
    if (!part) return;
    if (part.includes("-")) {
      const rangeParts = part.split("-");
      if (rangeParts.length === 2) {
        const start = parseInt(rangeParts[0], 10);
        const end = parseInt(rangeParts[1], 10);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end; i++) {
            weeks.push(i);
          }
        }
      }
    } else {
      const week = parseInt(part, 10);
      if (!isNaN(week)) {
        weeks.push(week);
      }
    }
  });

  if (weeks.length === 0) {
    weeks = Array.from({ length: 20 }, (_, i) => i + 1);
  }

  // 过滤单双周
  if (oddEven === "odd") {
    weeks = weeks.filter((w) => w % 2 === 1);
  } else if (oddEven === "even") {
    weeks = weeks.filter((w) => w % 2 === 0);
  }

  weeks = Array.from(new Set(weeks)).sort((a, b) => a - b);

  return {
    weeks,
    oddEven,
    startWeek: weeks[0] || 1,
    endWeek: weeks[weeks.length - 1] || 20,
  };
}

/**
 * 解析节次文本 (如: "[03-04]节", "[03-04-05]")
 * @param {string} sectionsText 节次文本
 * @param {Array<number>} fallbackSections 默认节次范围
 * @returns {Object} 包含 sections 数组、startSection 和 endSection
 */
function parseSections(sectionsText, fallbackSections) {
  if (!sectionsText) {
    return {
      sections: Array.from({ length: fallbackSections[1] - fallbackSections[0] + 1 }, (_, i) => fallbackSections[0] + i),
      startSection: fallbackSections[0],
      endSection: fallbackSections[1],
    };
  }

  const normalized = normalizeScheduleText(sectionsText);
  const match = normalized.match(/[\[［【]([0-9\s,，、\-—]+)[\]］】]\s*节?/) ||
    normalized.match(/(?:节次|上课节次|课节|上课时间)?\s*[:：]?\s*([0-9]{1,2}\s*[-,，、]\s*[0-9]{1,2}(?:\s*[-,，、]\s*[0-9]{1,2})*)\s*节?/);
  if (!match) {
    return {
      sections: Array.from({ length: fallbackSections[1] - fallbackSections[0] + 1 }, (_, i) => fallbackSections[0] + i),
      startSection: fallbackSections[0],
      endSection: fallbackSections[1],
    };
  }

  const raw = match[1].replace(/\s/g, "");
  const parts = raw.split(/[-—,，、]/).map(Number).filter((n) => !isNaN(n));
  if (parts.length === 0) {
    return {
      sections: Array.from({ length: fallbackSections[1] - fallbackSections[0] + 1 }, (_, i) => fallbackSections[0] + i),
      startSection: fallbackSections[0],
      endSection: fallbackSections[1],
    };
  }

  const start = parts[0];
  const end = parts[parts.length - 1];
  const sections = [];
  for (let i = start; i <= end; i++) {
    sections.push(i);
  }
  return {
    sections,
    startSection: start,
    endSection: end,
  };
}

function isWeekLine(line) {
  return /([0-9]+.*周|单周|双周|周次|教学周|起止周)/.test(normalizeScheduleText(line));
}

function isSectionLine(line) {
  const normalized = normalizeScheduleText(line);
  return /[\[［【][0-9\s,，、—~～至-]+[\]］】]\s*节?/.test(normalized) ||
    /^(节次|上课节次|课节|上课时间)\s*[:：]?\s*[0-9]{1,2}\s*[-,，、]\s*[0-9]{1,2}/.test(normalized);
}

function normalizeScheduleText(value) {
  return String(value || "")
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xFF10))
    .replace(/\u00a0/g, " ")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/，/g, ",")
    .replace(/－|–|—|~|～|至|到/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCourseFieldLabel(value) {
  return String(value || "").replace(/^(课程名称|课程|名称)\s*[:：]\s*/, "").trim();
}

function stripTeacherFieldLabel(value) {
  return String(value || "").replace(/^(任课教师|授课教师|主讲教师|教师|老师)\s*[:：]\s*/, "").trim();
}

function stripClassroomFieldLabel(value) {
  return String(value || "").replace(/^(上课地点|上课教室|课室名称|课室|教室|地点|场地)\s*[:：]\s*/, "").trim();
}

function appendWeekQualifier(weekText, value) {
  const base = String(weekText || "").trim();
  const qualifier = String(value || "").trim();
  if (!qualifier) return base;
  if (!base) return qualifier;
  if (base.indexOf(qualifier) >= 0) return base;
  return `${base}(${qualifier})`;
}

function parseLabeledCourseField(line) {
  const text = normalizeScheduleText(line);
  const match = text.match(/^(课程名称|课程|名称|任课教师|授课教师|主讲教师|教师|老师|周次|上课周次|教学周|起止周次|节次|上课节次|课节|上课时间|上课地点|上课教室|课室名称|课室|教室|地点|场地|单双周|周类型|备注|说明)\s*[:：]\s*(.+)$/);
  if (!match) return null;
  const label = match[1];
  const value = match[2].trim();
  if (/课程|名称/.test(label)) return { type: "courseName", value };
  if (/教师|老师/.test(label)) return { type: "teacherName", value: stripTeacherTitle(value) };
  if (/周次|教学周|起止周/.test(label)) return { type: "weekText", value };
  if (/单双周|周类型/.test(label)) return { type: "weekQualifier", value };
  if (/节次|课节|上课时间/.test(label)) return { type: "sectionsText", value };
  if (/地点|教室|课室|场地/.test(label)) return { type: "classroom", value };
  if (/备注|说明/.test(label)) return { type: "note", value };
  return null;
}

/**
 * 解析行头，得到节次 fallback 范围
 * @param {string} label 行头文本
 * @param {number} rowIndex 当前行索引
 * @returns {Array<number>} 默认节次范围 [start, end]
 */
function getFallbackSections(label, rowIndex) {
  const normalized = String(label || "").replace(/\s/g, "");
  const found = ROW_SECTION_LABELS.find((item) => item.pattern.test(normalized));
  if (found) {
    return found.range;
  }
  return ROW_SECTION_FALLBACKS[rowIndex] || [1, 1];
}

/**
 * 对合并后相同课程但地点不同的课程进行多地点合并
 * @param {Array<Object>} courses 课程数组
 * @returns {Array<Object>} 合并后的课程数组
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
    result.push(course);
  }

  return result;
}

/**
 * 将 HTML 中的单元格内容切分为不同的课程文本块
 * @param {string} cellHtml 单元格的原始 HTML
 * @returns {Array<string>} 切分后的课程块文本列表
 */
function splitCellIntoCourseBlocks(cellHtml) {
  const raw = String(cellHtml || "")
    // 替换 hr 和分界线为统一的分隔符
    .replace(/<hr\b[^>]*>/gi, "\n-----\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/p>/gi, "\n");

  const $ = cheerio.load(raw);
  
  // 提取文本，去掉其余无用 html 标签，保留换行
  const text = $.text();
  
  // 根据连续横线或 `-----` 来分割
  return text
    .split(/\n?\s*(?:-{5,}|—{3,}|─{3,}|={4,}|_{4,})\s*\n?/g)
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * 将强智教务网的单元格 HTML 重新组装并整理，自动结合那些后置输出的“独立教师栏”为正确的课程描述块。
 * @param {string} cellHtml 单元格的 HTML 结构
 * @returns {Array<string>} 组装完毕后的课程块文本列表
 */
function buildCourseTextFromQiangzhiCell(cellHtml) {
  const $ = cheerio.load(cellHtml);
  const divs = [];

  // 获取所有 class 含有 kbcontent 但不含有 kbcontent1 的 div
  $("div").each((i, el) => {
    const className = $(el).attr("class") || "";
    if (/\bkbcontent\b/.test(className) && !/\bkbcontent1\b/.test(className)) {
      divs.push($(el).html());
    }
  });

  let rawChunks = [];
  if (divs.length > 0) {
    divs.forEach((divHtml) => {
      rawChunks.push(...splitCellIntoCourseBlocks(divHtml));
    });
  } else {
    rawChunks = splitCellIntoCourseBlocks(cellHtml);
  }

  const pendingTeachers = {};
  const courseBlocks = [];

  rawChunks.forEach((chunk) => {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      return;
    }

    const hasWeek = lines.some(isWeekLine);
    const hasSection = lines.some(isSectionLine);
    const isRemarkOnly = lines.every((line) => /^备注[:：]?/.test(line));

    if (isRemarkOnly) {
      if (courseBlocks.length > 0) {
        courseBlocks[courseBlocks.length - 1] = `${courseBlocks[courseBlocks.length - 1]}\n${lines.join("\n")}`;
      }
      return;
    }

    // 若无周次和节次且行数大于等于2，说明这块是前置/后置输出的“独立教师描述行”
    if (!hasWeek && !hasSection && lines.length >= 2) {
      pendingTeachers[lines[0]] = lines.slice(1).join("\n");
      return;
    }

    const courseName = lines[0];
    const hasTeacherLine = lines.slice(1).some((line) => {
      return !isWeekLine(line) && !isSectionLine(line) && !/^备注[:：]?/.test(line);
    });

    const blockLines = lines.slice();
    if (!hasTeacherLine && pendingTeachers[courseName]) {
      blockLines.splice(1, 0, pendingTeachers[courseName]);
    }
    courseBlocks.push(blockLines.join("\n"));
  });

  // 反向再次遍历，查缺补漏将多余的 pending 教师合并进块中
  const finalBlocks = courseBlocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const courseName = lines[0];
    const hasTeacherLine = lines.slice(1).some((line) => {
      return !isWeekLine(line) && !isSectionLine(line) && !/^备注[:：]?/.test(line);
    });

    if (!hasTeacherLine && pendingTeachers[courseName]) {
      lines.splice(1, 0, pendingTeachers[courseName]);
      return lines.join("\n");
    }
    return block;
  });

  return finalBlocks;
}

/**
 * 从课程块文本中解析课程字段
 * @param {string} blockText 课程块文本
 * @param {Object} context 包含学期、星期、fallback 节次等信息的上下文
 * @returns {Object|null} 解析出的课程字段对象
 */
function parseCourseBlock(blockText, context) {
  const lines = blockText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  let courseName = "";
  let teacherName = "";
  let weekText = "";
  let sectionsText = "";
  let classroom = "";
  let note = "";

  const weekIndex = lines.findIndex((l) => isWeekLine(l));
  const sectionIndex = lines.findIndex((l) => isSectionLine(l));

  lines.forEach((line, index) => {
    const labeled = parseLabeledCourseField(line);
    if (labeled) {
      if (labeled.type === "courseName" && !courseName) {
        courseName = labeled.value;
      } else if (labeled.type === "teacherName" && !teacherName) {
        teacherName = labeled.value;
      } else if (labeled.type === "weekText") {
        weekText = labeled.value;
      } else if (labeled.type === "weekQualifier") {
        weekText = appendWeekQualifier(weekText, labeled.value);
      } else if (labeled.type === "sectionsText") {
        sectionsText = labeled.value;
      } else if (labeled.type === "classroom" && !classroom) {
        classroom = labeled.value;
      } else if (labeled.type === "note") {
        note = labeled.value;
      }
      return;
    }

    if (index === weekIndex || index === sectionIndex || /^备注[:：]/.test(line)) {
      if (index === weekIndex) {
        weekText = line;
      }
      if (index === sectionIndex) {
        sectionsText = line;
      }
      if (/^备注[:：]/.test(line)) {
        note = line.replace(/^备注[:：]/, "").trim();
      }
      return;
    }

    if (!courseName) {
      courseName = stripCourseFieldLabel(line);
    } else if (weekIndex >= 0 && index > weekIndex && !classroom) {
      classroom = stripClassroomFieldLabel(line);
    } else if (!teacherName) {
      teacherName = stripTeacherTitle(stripTeacherFieldLabel(line));
    } else if (!classroom) {
      classroom = stripClassroomFieldLabel(line);
    }
  });

  // 如果 sectionsText 存在，从中提取高精度的教室前缀
  if (sectionsText) {
    const match = sectionsText.match(/^([\s\S]*?)[\[［【]/);
    if (match) {
      const extractedClass = stripClassroomFieldLabel(match[1]);
      if (extractedClass) {
        classroom = extractedClass;
      }
    }
  }

  if (!courseName || /^星期[一二三四五六日]$/.test(courseName) || !weekText) {
    return null;
  }

  const { startWeek, endWeek, weeks, oddEven } = parseWeeks(weekText);
  const { startSection, endSection, sections } = parseSections(sectionsText, context.fallbackSections);

  const course = {
    courseName,
    displayCourseName: courseName,
    canonicalCourseName: courseName,
    teacherName: teacherName || "",
    classroom: classroom || "",
    weekDay: context.weekDay,
    weekday: context.weekDay, // 兼容大小写
    sections,
    startSection,
    endSection,
    weeks,
    startWeek,
    endWeek,
    weekText: weekText || "未标明周次",
    note,
    rawText: blockText,
    source: context.source || "personal-xskb",
  };

  if (oddEven) {
    course.oddEven = oddEven;
  }

  return course;
}

/**
 * 解析个人课表 HTML 并转换为项目已有的课程对象结构
 * @param {string} html 个人课表页面的 HTML 内容
 * @param {Object} context 包含学期等属性的上下文
 * @returns {Array<Object>} 解析得到的课程对象数组
 */
function parsePersonalScheduleHtml(html, context) {
  const $ = cheerio.load(html);
  const table = $("table#kbtable").length ? $("table#kbtable") : $("table").first();
  const courses = [];
  
  if (!table.length) {
    return [];
  }

  let dataRowIndex = 0;
  table.find("tr").each((rowIndex, trNode) => {
    const tr = $(trNode);
    const cells = tr.find("td, th");
    if (!cells.length) {
      return;
    }

    // 检查是否是表头行
    const firstCellText = $(cells[0]).text().trim();
    if (/星期|周[一二三四五六日]|节次|上午|下午|晚上|时间/.test(firstCellText) && cells.length > 5) {
      return;
    }

    const hasRowLabel = cells.length >= 8 || /大节|备注/.test(firstCellText);
    const rowLabel = hasRowLabel ? firstCellText : "";
    const dayCells = hasRowLabel ? cells.slice(1) : cells;
    const fallbackSections = getFallbackSections(rowLabel, dataRowIndex);

    // 遍历周一至周日的数据单元格
    dayCells.slice(0, 7).each((colIndex, tdNode) => {
      const td = $(tdNode);
      const cellHtml = td.html();
      const cellText = td.text().trim();

      // 跳过空单元格
      if (!cellText || /^[\s　-]*$/.test(cellText)) {
        return;
      }

      const weekDay = colIndex + 1;

      // 提取并重组课程块，自动拼接可能分离的教师与课表数据块
      const blocks = buildCourseTextFromQiangzhiCell(cellHtml);

      for (const block of blocks) {
        const parsed = parseCourseBlock(block, {
          weekDay,
          fallbackSections,
          source: context && context.source || "personal-xskb",
        });
        if (parsed) {
          // 调用已有的 toRenderableCourse 对课程数据进行高精度规范化（比如 PE 作息等）
          const rendered = toRenderableCourse(parsed);
          courses.push(rendered);
        }
      }
    });

    if (!/备注/.test(rowLabel)) {
      dataRowIndex += 1;
    }
  });

  // 对由于分场地导致的体育课进行多地点合并，并返回
  return mergeMultiVenueCourses(courses).sort((a, b) => {
    if (a.weekDay !== b.weekDay) {
      return a.weekDay - b.weekDay;
    }
    if (a.startSection !== b.startSection) {
      return a.startSection - b.startSection;
    }
    return a.courseName.localeCompare(b.courseName, "zh-Hans-CN");
  });
}

const STUDENT_NAME_MAX = 24;
const PAGE_REMARK_ITEM_MAX = 240;
const PAGE_REMARK_TOTAL_MAX = 1200;
const PAGE_REMARK_COUNT_MAX = 20;

function plainPageText(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function sanitizeStudentName(value) {
  const text = plainPageText(value)
    .replace(/[<>]/g, "")
    .replace(/^(学生姓名|姓名)\s*[:：]\s*/, "")
    .slice(0, STUDENT_NAME_MAX)
    .trim();
  if (text.length < 2 || text.length > STUDENT_NAME_MAX) return "";
  if (/\d{5,}/.test(text)) return "";
  if (/课程|备注|星期|节次|教师|学号|班级/.test(text)) return "";
  return text;
}

function htmlToRemarkLines(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function splitPageRemarkText(value) {
  return String(value || "")
    .split(/\r?\n+/)
    .map((line) => plainPageText(line).replace(/^备注\s*[:：]\s*/, ""))
    .map((line) => line.slice(0, PAGE_REMARK_ITEM_MAX))
    .filter((line) => line && line !== "备注");
}

function collectPageRemarks(lines) {
  const seen = new Set();
  const remarks = [];
  let total = 0;
  lines.forEach((line) => {
    if (remarks.length >= PAGE_REMARK_COUNT_MAX) return;
    if (seen.has(line)) return;
    if (total + line.length > PAGE_REMARK_TOTAL_MAX) return;
    seen.add(line);
    remarks.push(line);
    total += line.length;
  });
  return remarks;
}

function labelValue($, el) {
  const next = $(el).next();
  if (next.length) {
    const text = plainPageText(next.text());
    if (text) return text;
  }
  const parentNext = $(el).parent().next();
  if (parentNext.length) return plainPageText(parentNext.text());
  return "";
}

function parsePersonalSchedulePageMetadata(html) {
  const $ = cheerio.load(String(html || ""), { decodeEntities: true });
  $("script, style, iframe, object, noscript").remove();
  let studentName = "";
  $("td, th, span, label, div, p, li").each((_, el) => {
    if (studentName) return;
    const text = plainPageText($(el).clone().children().remove().end().text()) || plainPageText($(el).text());
    const inline = text.match(/(?:学生姓名|姓名)\s*[:：]\s*([^\s:：<>]{2,24})/);
    if (inline) {
      studentName = sanitizeStudentName(inline[1]);
      return;
    }
    if (/^(学生姓名|姓名)$/.test(text)) {
      studentName = sanitizeStudentName(labelValue($, el));
    }
  });

  const remarkLines = [];
  $("tr").each((_, tr) => {
    const cells = $(tr).children("td, th");
    if (!cells.length) return;
    const label = plainPageText($(cells[0]).text()).replace(/[:：]$/, "");
    if (label !== "备注") return;
    cells.toArray().slice(1).forEach((cell) => {
      splitPageRemarkText(htmlToRemarkLines($(cell).html())).forEach((line) => remarkLines.push(line));
    });
  });
  if (!remarkLines.length) {
    const body = htmlToRemarkLines($("body").html());
    const match = body.match(/备注\s*[:：]\s*([\s\S]{1,2000})/);
    if (match) splitPageRemarkText(match[1]).forEach((line) => remarkLines.push(line));
  }

  return {
    studentName,
    pageRemarks: collectPageRemarks(remarkLines),
  };
}

module.exports = {
  parsePersonalScheduleHtml,
  parsePersonalSchedulePageMetadata,
  parseCourseBlock,
  parseWeeks,
  parseSections,
  stripTeacherTitle,
  _test: {
    normalizeScheduleText,
    parseLabeledCourseField,
  },
};

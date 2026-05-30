/**
 * 个人课表获取服务
 * NOTE: 负责抓取个人课表页面、解析并完成学期切换 POST 联动，同时根据安全策略脱敏保存 debug HTML。
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { createClient } = require("../utils/requestClient");
const { parsePersonalScheduleHtml } = require("../utils/personal-schedule-parser");
const { safeLog, maskStudentId } = require("../utils/safeLogger");

/**
 * 脱敏保存调试用的 HTML 文件
 * @param {string} html 原始 HTML
 * @param {string} studentId 学号
 * @param {string} studentName 学生姓名
 */
function saveDebugHtml(html, studentId, studentName) {
  if (process.env.FOSU_PERSONAL_SAVE_HTML !== "true") {
    return;
  }

  try {
    let redacted = String(html || "");
    if (studentId) {
      redacted = redacted.replace(new RegExp(studentId, "g"), "[STUDENT_ID]");
    }
    if (studentName) {
      redacted = redacted.replace(new RegExp(studentName, "g"), "[STUDENT_NAME]");
    }
    // 脱敏 Cookie 与票据
    redacted = redacted
      .replace(/(JSESSIONID=)[^;\s"']+/gi, "$1[REDACTED]")
      .replace(/(ticket=)[^&\s"']+/gi, "$1[REDACTED]");

    const debugDir = path.resolve(__dirname, "../../.debug");
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    const filePath = path.join(debugDir, "personal-schedule-latest.html");
    fs.writeFileSync(filePath, redacted, "utf8");
    safeLog("personal-schedule-save-html", { path: filePath });
  } catch (error) {
    safeLog("personal-schedule-save-html-failed", { error: error.message });
  }
}

/**
 * 抓取并解析个人课表
 * @param {Object} jar 会话 CookieJar
 * @param {Object} student 学生基本信息 (包含 studentId, studentName)
 * @param {string} targetSemester 目标学期，如 "2025-2026-2"
 * @returns {Promise<Object>} 标准化个人课表结构
 */
async function fetchAndParseSchedule(jar, student, targetSemester) {
  const client = createClient({ jar });
  const xskbUrl = "https://100.fosu.edu.cn/xskb/xskb_list.do";

  safeLog("personal-schedule-fetch-start", {
    studentId: maskStudentId(student.studentId),
    targetSemester,
  });

  let response;
  try {
    response = await client.get(xskbUrl);
  } catch (error) {
    safeLog("personal-schedule-fetch-failed", { error: error.message });
    throw new Error("CAMPUS_NETWORK_REQUIRED");
  }

  let html = response.data;
  let $ = cheerio.load(html);

  // 1. 获取所有的可选学期 options
  const select = $("select#xnxq01id, select[name='xnxq01id']");
  const semesters = [];
  select.find("option").each((i, el) => {
    const code = $(el).val();
    const name = $(el).text().trim();
    if (code) {
      semesters.push({ code, name });
    }
  });

  const availableSemesters = semesters.map((s) => s.code);
  safeLog("personal-schedule-semesters-detected", { availableSemesters });

  // 2. 联动切换学期流程
  if (targetSemester) {
    // 检查页面当前选择的学期 (通常是 option[selected] 的 value 或 select.val())
    let currentSemester = select.find("option[selected]").val() || select.val() || "";
    
    // 如果没有 selected option，尝试通过选中的 option 内容匹配
    if (!currentSemester) {
      const selectedOpt = select.find("option:selected");
      if (selectedOpt.length) {
        currentSemester = selectedOpt.val();
      }
    }

    safeLog("personal-schedule-semester-check", {
      currentInPage: currentSemester,
      target: targetSemester,
    });

    if (currentSemester !== targetSemester) {
      // 检查指定的目标学期在 options 中是否存在 (允许部分匹配，防止格式差异如 2025-2026-2-1 与 2025-2026-2)
      const matched = semesters.find(
        (s) => s.code === targetSemester || s.code.startsWith(targetSemester)
      );

      if (!matched) {
        safeLog("personal-schedule-semester-not-found", {
          target: targetSemester,
          available: availableSemesters,
        });
        const err = new Error("SEMESTER_NOT_FOUND");
        err.availableSemesters = availableSemesters;
        throw err;
      }

      // 执行联动 POST 表单切换学期
      safeLog("personal-schedule-semester-switching", { code: matched.code });
      const postData = new URLSearchParams();
      postData.append("xnxq01id", matched.code);

      let switchRes;
      try {
        switchRes = await client.post(xskbUrl, postData.toString(), {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: xskbUrl,
          },
        });
      } catch (error) {
        throw new Error("CAMPUS_NETWORK_REQUIRED");
      }

      html = switchRes.data;
      $ = cheerio.load(html);
    }
  }

  // 3. 脱敏保存调试 HTML (根据环境变量)
  saveDebugHtml(html, student.studentId, student.studentName);

  // 4. 调用解析器进行 HTML 解析
  let courses;
  try {
    courses = parsePersonalScheduleHtml(html, { semester: targetSemester });
  } catch (error) {
    safeLog("personal-schedule-parse-error", { error: error.message });
    throw new Error("PERSONAL_SCHEDULE_PARSE_FAILED");
  }

  if (!courses || courses.length === 0) {
    throw new Error("PERSONAL_SCHEDULE_EMPTY");
  }

  safeLog("personal-schedule-sync-success", {
    studentId: maskStudentId(student.studentId),
    courseCount: courses.length,
  });

  return {
    success: true,
    student: {
      studentId: maskStudentId(student.studentId),
      studentName: student.studentName,
      className: "个人课表",
    },
    semester: targetSemester,
    source: "personal-xskb",
    updatedAt: new Date().toISOString(),
    schedule: {
      className: "个人课表",
      semester: targetSemester,
      courses,
    },
  };
}

module.exports = {
  fetchAndParseSchedule,
};

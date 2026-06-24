const fs = require("fs");
const path = require("path");
const {
  buildImportPreview,
  destroySession,
  fetchScheduleRows,
  findStudentScheduleApp,
  loginWithCas,
} = require("../server/src/services/fosuApaasImporter");
const { maskStudentId } = require("../server/src/utils/safeLogger");

const ENABLED = String(process.env.FOSU_LIVE_TEST_ENABLED || "").trim() === "true";
const DEBUG_SAFE = String(process.env.FOSU_IMPORT_DEBUG_SAFE || "").trim() === "true";
const DEBUG_FILE = path.join(__dirname, "..", "tmp", "fosu-import-debug-safe.json");

function toText(value) {
  return String(value == null ? "" : value).trim();
}

function phase(name) {
  console.log(`[phase] ${name}`);
}

function classifyImportError(error, currentPhase) {
  const code = String(error && (error.code || error.message) || "");
  if (/INVALID_CREDENTIALS|CAS_LOGIN_FAILED/i.test(code)) return "INVALID_CREDENTIALS";
  if (/CAPTCHA_REQUIRED/i.test(code)) return "CAPTCHA_REQUIRED";
  if (/RISK_CONTROL_REQUIRED/i.test(code)) return "RISK_CONTROL_REQUIRED";
  if (/ETIMEDOUT|ECONNABORTED|TIMEOUT|ENOTFOUND|ECONNRESET/i.test(code)) return "NETWORK_TIMEOUT";
  if (/SCHEDULE_EMPTY|SCHEDULE_ROWS_EMPTY/i.test(code)) return "SCHEDULE_ROWS_EMPTY";
  if (/APAAS_DASHBOARD_UNAVAILABLE|SCHEDULE_APP_NOT_FOUND/i.test(code)) return "SCHEDULE_APP_NOT_FOUND";
  if (/LOGIN_PAGE_CHANGED|APAAS_STRUCTURE_CHANGED|STRUCTURE_CHANGED/i.test(code)) return "STRUCTURE_CHANGED";
  if (/查找学生课表入口|进入学校课表系统/.test(currentPhase || "")) return "SCHEDULE_APP_NOT_FOUND";
  return "UNKNOWN_IMPORT_ERROR";
}

function publicEntryDiagnostics(entry) {
  if (!entry) return null;
  let pathOnly = "";
  try {
    const parsed = new URL(entry.url || "");
    pathOnly = parsed.pathname;
  } catch (error) {
    pathOnly = "";
  }
  return {
    titleMatched: Boolean(entry.title),
    path: pathOnly,
    mode: entry.mode || "",
    discoveredBy: entry.discoveredBy || "",
    fallback: Boolean(entry.fallback),
  };
}

function writeSafeDebug(payload) {
  if (!DEBUG_SAFE) return;
  fs.mkdirSync(path.dirname(DEBUG_FILE), { recursive: true });
  fs.writeFileSync(DEBUG_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[debug] 已保存脱敏诊断 JSON：${path.relative(process.cwd(), DEBUG_FILE)}`);
}

async function run() {
  if (!ENABLED) {
    console.log("真实联调未启用：请设置 FOSU_LIVE_TEST_ENABLED=true 后再运行。");
    return;
  }

  let studentId = toText(process.env.FOSU_TEST_STUDENT_ID);
  let password = String(process.env.FOSU_TEST_PASSWORD || "");
  if (!studentId || !password) {
    console.log("真实联调缺少环境变量：FOSU_TEST_STUDENT_ID 或 FOSU_TEST_PASSWORD。");
    return;
  }

  const studentIdMasked = maskStudentId(studentId);
  const debug = {
    success: false,
    studentIdMasked,
    phases: [],
    entry: null,
    rawRowCount: 0,
    scheduledCourseCount: 0,
    unscheduledCourseCount: 0,
    conflictCount: 0,
    errorType: "",
  };
  let currentPhase = "";
  let session = null;

  try {
    currentPhase = "获取登录页";
    debug.phases.push(currentPhase);
    phase(currentPhase);

    currentPhase = "提交统一身份认证";
    debug.phases.push(currentPhase);
    phase(currentPhase);
    session = await loginWithCas(studentId, password);
    password = "";

    currentPhase = "跟随跳转";
    debug.phases.push(currentPhase);
    phase(currentPhase);

    currentPhase = "进入学校课表系统";
    debug.phases.push(currentPhase);
    phase(currentPhase);

    currentPhase = "查找学生课表入口";
    debug.phases.push(currentPhase);
    phase(currentPhase);
    const entry = await findStudentScheduleApp(session);
    debug.entry = publicEntryDiagnostics(entry);

    currentPhase = "读取分页";
    debug.phases.push(currentPhase);
    phase(currentPhase);
    const rawRows = await fetchScheduleRows(session, entry);
    debug.rawRowCount = rawRows.length;
    if (!rawRows.length) {
      const empty = new Error("SCHEDULE_ROWS_EMPTY");
      empty.code = "SCHEDULE_ROWS_EMPTY";
      throw empty;
    }

    currentPhase = "规范化课程";
    debug.phases.push(currentPhase);
    phase(currentPhase);
    const preview = buildImportPreview(rawRows, {
      studentId,
      semester: process.env.FOSU_TEST_SEMESTER || "当前学期",
      importedAt: new Date().toISOString(),
      appEntry: entry,
    });

    const summary = {
      success: true,
      studentIdMasked,
      studentName: preview.profile.studentName || "",
      className: preview.profile.className || "",
      rawRowCount: preview.summary.rawRowCount || 0,
      scheduledCourseCount: preview.summary.scheduledCourseCount || 0,
      unscheduledCourseCount: preview.summary.unscheduledCourseCount || 0,
      conflictCount: preview.summary.conflictCount || 0,
    };
    Object.assign(debug, summary);
    writeSafeDebug(debug);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    password = "";
    const errorType = classifyImportError(error, currentPhase);
    debug.errorType = errorType;
    writeSafeDebug(debug);
    console.log(JSON.stringify({
      success: false,
      studentIdMasked,
      phase: currentPhase,
      errorType,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    studentId = "";
    password = "";
    destroySession(session);
  }
}

run().catch((error) => {
  console.log(JSON.stringify({
    success: false,
    errorType: classifyImportError(error, "UNKNOWN"),
  }, null, 2));
  process.exitCode = 1;
});

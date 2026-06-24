const express = require("express");
const { getClientIpInfo } = require("../utils/clientIp");
const { safeLog } = require("../utils/safeLogger");
const { verifySessionTokenDetailed } = require("../utils/apiSecurity");
const { createPublicKeyChallenge } = require("../services/fosuApaasImportSessionStore");
const {
  cancelStudentScheduleImport,
  confirmStudentScheduleImport,
  createStudentSchedulePreview,
} = require("../services/fosuApaasImportService");

const router = express.Router();

function requireMiniProgramSession(req, res, next) {
  req.clientIpInfo = req.clientIpInfo || getClientIpInfo(req);
  const result = verifySessionTokenDetailed(req.headers["x-fosu-session"]);
  if (!result.valid) {
    return res.status(401).json({
      success: false,
      code: result.code === "FOSU_SESSION_EXPIRED" ? "FOSU_SESSION_EXPIRED" : "FOSU_SESSION_REQUIRED",
      reasonCode: result.code || "FOSU_SESSION_REQUIRED",
      message: "会话已过期，请重新进入小程序。",
    });
  }
  req.fosuSession = result.payload;
  return next();
}

function normalizeImportErrorCode(error) {
  const code = error && (error.code || error.message) || "UNKNOWN_IMPORT_ERROR";
  if (code === "SCHOOL_SYSTEM_TIMEOUT" || code === "NETWORK_TIMEOUT") return code;
  if (/ETIMEDOUT|ECONNABORTED|TIMEOUT/i.test(code)) return "SCHOOL_SYSTEM_TIMEOUT";
  if (code === "SCHEDULE_EMPTY") return "SCHEDULE_ROWS_EMPTY";
  if (code === "LOGIN_PAGE_CHANGED" || code === "APAAS_STRUCTURE_CHANGED") return "STRUCTURE_CHANGED";
  if (code === "APAAS_DASHBOARD_UNAVAILABLE") return "SCHEDULE_APP_NOT_FOUND";
  return code;
}

function sendImportError(res, error) {
  const code = normalizeImportErrorCode(error);
  const status = code === "IMPORT_RATE_LIMITED" ? 429 : 200;
  const messages = {
    FOSU_IMPORT_DISABLED: "学号导入暂未开放，请使用 XLS 或班级课表导入。",
    IMPORT_KEY_EXPIRED: "加密会话已过期，请重新验证。",
    INVALID_ENCRYPTED_PAYLOAD: "本地加密失败，请重新进入页面后再试。",
    INVALID_STUDENT_ID: "请输入正确的学号。",
    IMPORT_RATE_LIMITED: "尝试次数过多，请稍后再试。",
    INVALID_CREDENTIALS: "学号或密码不正确，请检查后重试。",
    CAPTCHA_REQUIRED: "学校系统需要额外验证，暂时无法自动读取。你可以先使用 XLS 导入。",
    RISK_CONTROL_REQUIRED: "学校系统需要额外验证，暂时无法自动读取。你可以先使用 XLS 导入。",
    LOGIN_PAGE_CHANGED: "学校课表系统暂时无法读取，请稍后重试或使用其他导入方式。",
    SCHEDULE_APP_NOT_FOUND: "暂时没有找到个人课表入口，请稍后重试或使用其他导入方式。",
    APAAS_DASHBOARD_UNAVAILABLE: "暂时没有找到个人课表入口，请稍后重试或使用其他导入方式。",
    APAAS_SESSION_EXPIRED: "本次登录已失效，请重新验证。",
    APAAS_STRUCTURE_CHANGED: "学校课表系统暂时无法读取，请稍后重试或使用其他导入方式。",
    STRUCTURE_CHANGED: "学校课表系统暂时无法读取，请稍后重试或使用其他导入方式。",
    SCHEDULE_EMPTY: "没有读取到可导入的课表数据，请确认当前学期是否已有课表。",
    SCHEDULE_ROWS_EMPTY: "没有读取到可导入的课表数据，请确认当前学期是否已有课表。",
    SCHOOL_SYSTEM_TIMEOUT: "学校系统响应较慢，本次读取已超时。请立即重试一次，仍失败可稍后再试。",
    NETWORK_TIMEOUT: "网络连接超时，请立即重试一次，仍失败可稍后再试。",
    CLOUDBASE_IMPORT_NOT_CONFIGURED: "当前读取通道暂不可用，请稍后重试或使用 XLS 导入。",
    UNKNOWN_IMPORT_ERROR: "读取失败，请稍后重试或使用其他导入方式。",
    IMPORT_TOKEN_EXPIRED: "导入预览已过期，请重新验证。",
    INVALID_IMPORT_MODE: "导入方式不受支持。",
    INVALID_SELECTED_ARRANGEMENT: "课程选择已失效，请重新预览后再导入。",
    INVALID_EDITED_ARRANGEMENT: "课程编辑内容不完整，请检查周次、星期、节次和地点。",
  };
  const payload = {
    success: false,
    code,
    message: messages[code] || "学号导入暂时不可用，请稍后再试。",
  };
  if (error && error.retryAfterSeconds) {
    res.setHeader("Retry-After", String(error.retryAfterSeconds));
    payload.retryAfter = error.retryAfterSeconds;
  }
  return res.status(status).json(payload);
}

router.use(requireMiniProgramSession);

router.get("/public-key", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json(Object.assign({ success: true }, createPublicKeyChallenge()));
  } catch (error) {
    safeLog("fosu-apaas-public-key-failed", { code: error.code || error.message });
    return sendImportError(res, error);
  }
});

router.post("/preview", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const payload = await createStudentSchedulePreview(req, req.body || {});
    return res.json(payload);
  } catch (error) {
    return sendImportError(res, error);
  }
});

router.post("/confirm", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(confirmStudentScheduleImport(req, req.body || {}));
  } catch (error) {
    return sendImportError(res, error);
  }
});

router.post("/cancel", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(cancelStudentScheduleImport(req, req.body || {}));
  } catch (error) {
    return sendImportError(res, error);
  }
});

module.exports = router;

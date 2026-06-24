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

function sendImportError(res, error) {
  const code = error && (error.code || error.message) || "FOSU_IMPORT_FAILED";
  const status = code === "IMPORT_RATE_LIMITED" ? 429 : 200;
  const messages = {
    FOSU_IMPORT_DISABLED: "学号导入暂未开放，请使用 XLS 或班级课表导入。",
    IMPORT_KEY_EXPIRED: "加密会话已过期，请重新验证。",
    INVALID_ENCRYPTED_PAYLOAD: "本地加密失败，请重新进入页面后再试。",
    INVALID_STUDENT_ID: "请输入正确的学号。",
    IMPORT_RATE_LIMITED: "尝试次数过多，请稍后再试。",
    INVALID_CREDENTIALS: "学号或统一身份认证密码不正确。",
    CAPTCHA_REQUIRED: "统一身份认证需要验证码，暂不支持自动导入。请使用 XLS 或班级课表导入。",
    RISK_CONTROL_REQUIRED: "统一身份认证触发安全校验，暂不支持自动导入。请使用 XLS 或班级课表导入。",
    LOGIN_PAGE_CHANGED: "统一身份认证页面结构变化，暂时无法自动导入。",
    APAAS_DASHBOARD_UNAVAILABLE: "APaaS 暂时不可访问，请稍后再试。",
    APAAS_SESSION_EXPIRED: "APaaS 登录状态已失效，请重新验证。",
    APAAS_STRUCTURE_CHANGED: "APaaS 课表页面结构变化，暂时无法自动导入。",
    SCHEDULE_EMPTY: "未读取到 APaaS 课表数据，请确认当前账号有本科生学生课表。",
    IMPORT_TOKEN_EXPIRED: "导入预览已过期，请重新验证。",
    INVALID_IMPORT_MODE: "导入方式不受支持。",
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

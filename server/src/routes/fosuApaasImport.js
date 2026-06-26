const express = require("express");
const { getClientIpInfo } = require("../utils/clientIp");
const { safeLog } = require("../utils/safeLogger");
const { verifySessionTokenDetailed } = require("../utils/apiSecurity");
const { createPublicKeyChallenge } = require("../services/fosuApaasImportSessionStore");
const {
  cancelStudentScheduleImport,
  confirmRecentStudentScheduleImport,
  confirmStudentScheduleImport,
  createStudentSchedulePreview,
  getStudentSchedulePreviewJobStatus,
  startStudentSchedulePreviewJob,
} = require("../services/fosuApaasImportService");
const { getRecentImportForSession } = require("../services/fosuApaasRecentImportStore");

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
  if (code === "SCHOOL_SYSTEM_TIMEOUT" || code === "NETWORK_TIMEOUT" || code === "UPSTREAM_TIMEOUT") return code;
  if (/ETIMEDOUT|ECONNABORTED|TIMEOUT/i.test(code)) return "SCHOOL_SYSTEM_TIMEOUT";
  if (code === "SCHEDULE_EMPTY") return "SCHEDULE_ROWS_EMPTY";
  if (code === "LOGIN_PAGE_CHANGED" || code === "APAAS_STRUCTURE_CHANGED") return "STRUCTURE_CHANGED";
  if (code === "APAAS_DASHBOARD_UNAVAILABLE") return "SCHEDULE_APP_NOT_FOUND";
  return code;
}

function formatRetryAfter(seconds) {
  const value = Math.max(0, Number(seconds || 0) || 0);
  if (!value) return "";
  if (value < 60) return `${value}秒`;
  return `${Math.ceil(value / 60)}分钟`;
}

function enhanceImportErrorPayload(error, payload) {
  const code = payload && payload.code || normalizeImportErrorCode(error);
  const retryAfter = Number(error && error.retryAfterSeconds || payload && payload.retryAfter || 0) || 0;
  const waitText = formatRetryAfter(retryAfter);
  const retryableCodes = new Set([
    "NETWORK_TIMEOUT",
    "SCHOOL_SYSTEM_TIMEOUT",
    "UPSTREAM_TIMEOUT",
    "CLOUDBASE_SERVICE_UNAVAILABLE",
    "CLOUDBASE_IMPORT_FAILED",
  ]);
  const preciseMessages = {
    INVALID_CREDENTIALS: "学号或密码不正确。",
    SCHOOL_SYSTEM_TIMEOUT: "学校系统响应较慢，请稍后再试。",
    NETWORK_TIMEOUT: "连接超时，可立即重试一次。",
    UPSTREAM_TIMEOUT: "连接超时，可立即重试一次。",
    CAPTCHA_REQUIRED: "学校系统需要额外验证。",
    RISK_CONTROL_REQUIRED: "学校系统需要额外验证。",
    APAAS_SESSION_UNVERIFIED: "学校登录状态验证失败，已切换备用通道重试。",
    IMPORT_PREVIEW_JOB_NOT_FOUND: "读取任务已过期，请重新验证并读取课表。",
  };
  const next = Object.assign({}, payload || {}, {
    success: false,
    code,
  });
  if (preciseMessages[code]) {
    next.message = preciseMessages[code];
  }
  if (code === "IMPORT_RATE_LIMITED") {
    if (error && error.kind === "credential") {
      next.message = `连续多次密码错误，请${waitText ? `等待${waitText}后` : "稍后"}再试。`;
    } else if (error && error.kind === "network") {
      next.message = `学校系统响应较慢，请${waitText ? `等待${waitText}后` : "稍后"}再试。`;
    } else if (error && error.kind === "verification") {
      next.message = `学校系统需要额外验证，请${waitText ? `等待${waitText}后` : "稍后"}再试。`;
    } else if (waitText) {
      next.message = `尝试次数过多，请等待${waitText}后再试。`;
    }
  }
  if (retryAfter) {
    next.retryAfter = retryAfter;
  }
  if (retryableCodes.has(code)) {
    next.retriable = true;
  }
  return next;
}

function sendImportError(res, error) {
  const code = normalizeImportErrorCode(error);
  const status = code === "IMPORT_RATE_LIMITED" ? 429 : 200;
  const retryableCodes = new Set([
    "NETWORK_TIMEOUT",
    "SCHOOL_SYSTEM_TIMEOUT",
    "UPSTREAM_TIMEOUT",
    "CLOUDBASE_SERVICE_UNAVAILABLE",
    "CLOUDBASE_IMPORT_FAILED",
  ]);
  const messages = {
    FOSU_IMPORT_DISABLED: "学号导入暂未开放，请使用 XLS 或班级课表导入。",
    IMPORT_KEY_EXPIRED: "加密会话已过期，请重新验证。",
    INVALID_ENCRYPTED_PAYLOAD: "本地加密失败，请重新进入页面后再试。",
    INVALID_STUDENT_ID: "请输入正确的学号。",
    IMPORT_RATE_LIMITED: "尝试次数过多，请稍后再试。",
    INVALID_CREDENTIALS: "学号或密码不正确，请检查后重试。",
    CAPTCHA_REQUIRED: "学校系统需要额外验证，暂时无法自动读取。你可以先使用 XLS 导入。",
    RISK_CONTROL_REQUIRED: "学校系统需要额外验证，暂时无法自动读取。你可以先使用 XLS 导入。",
    ACCOUNT_LOCKED: "学校账号暂时无法登录，请稍后再试或联系学校处理。",
    SCHOOL_SYSTEM_REJECTED: "学校系统拒绝了本次读取，请稍后重试。",
    LOGIN_PAGE_CHANGED: "学校课表系统页面有变化，请稍后重试。",
    SCHEDULE_APP_NOT_FOUND: "暂时没有找到个人课表入口，请稍后重试或使用其他导入方式。",
    APAAS_DASHBOARD_UNAVAILABLE: "暂时没有找到个人课表入口，请稍后重试或使用其他导入方式。",
    APAAS_SESSION_EXPIRED: "本次登录已失效，请重新验证。",
    APAAS_STRUCTURE_CHANGED: "学校课表系统页面有变化，请稍后重试。",
    STRUCTURE_CHANGED: "学校课表系统页面有变化，请稍后重试。",
    SCHEDULE_EMPTY: "没有读取到可导入的课表数据，请确认当前学期是否已有课表。",
    SCHEDULE_ROWS_EMPTY: "没有读取到可导入的课表数据，请确认当前学期是否已有课表。",
    SCHOOL_SYSTEM_TIMEOUT: "学校系统响应较慢，请稍后再试。",
    NETWORK_TIMEOUT: "连接超时，可立即重试一次。",
    UPSTREAM_TIMEOUT: "连接超时，可立即重试一次。",
    CLOUDBASE_IMPORT_NOT_CONFIGURED: "当前读取通道暂不可用，请稍后重试或使用 XLS 导入。",
    CLOUDBASE_SERVICE_UNAVAILABLE: "当前读取通道暂时不可用，请稍后重试。",
    CLOUDBASE_IMPORT_FAILED: "当前读取通道暂时不可用，请稍后重试。",
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
  if (retryableCodes.has(code)) {
    payload.retriable = true;
  }
  if (code === "IMPORT_RATE_LIMITED") {
    if (error && error.kind === "credential") {
      payload.message = "连续多次密码错误，请稍后再试。";
    } else if (error && error.kind === "network") {
      payload.message = "学校系统响应较慢，请稍后再试。";
    } else if (error && error.kind === "verification") {
      payload.message = "学校系统需要额外验证，暂时无法自动读取。";
    }
  }
  if (error && error.retryAfterSeconds) {
    res.setHeader("Retry-After", String(error.retryAfterSeconds));
    payload.retryAfter = error.retryAfterSeconds;
  }
  return res.status(status).json(enhanceImportErrorPayload(error, payload));
}

function setPreviewDiagnosticsHeaders(res, payload) {
  const diagnostics = payload && (payload.importDiagnostics || payload.timing) || {};
  const channel = String(diagnostics.channel || payload && payload.channel || "").trim();
  if (channel) {
    res.setHeader("X-Fosu-Import-Channel", channel);
  }
  const totalMs = Number(diagnostics.totalMs || 0) || 0;
  const retryCount = Number(diagnostics.retryCount || 0) || 0;
  if (totalMs || retryCount) {
    res.setHeader("X-Fosu-Import-Timing", `totalMs=${totalMs}; retryCount=${retryCount}`);
  }
}

router.use(requireMiniProgramSession);

router.get("/public-key", (req, res) => {
  const startedAt = Date.now();
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const payload = Object.assign({ success: true }, createPublicKeyChallenge());
    safeLog("fosu-apaas-public-key-timing", { elapsedMs: Date.now() - startedAt });
    return res.json(payload);
  } catch (error) {
    safeLog("fosu-apaas-public-key-failed", { code: error.code || error.message, elapsedMs: Date.now() - startedAt });
    return sendImportError(res, error);
  }
});

router.post("/preview/start", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const payload = startStudentSchedulePreviewJob(req, req.body || {});
    return res.json(Object.assign({
      pollAfterMs: 1200,
      maxWaitMs: 60000,
    }, payload));
  } catch (error) {
    return sendImportError(res, error);
  }
});

router.get("/preview/status", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const payload = getStudentSchedulePreviewJobStatus(req, req.query && req.query.jobId);
    if (payload.status === "failed") {
      const errorPayload = enhanceImportErrorPayload(payload.error || { code: payload.code }, {
        success: false,
        code: payload.code || payload.error && payload.error.code || "UNKNOWN_IMPORT_ERROR",
        message: payload.message || "",
        retryAfter: payload.retryAfter || 0,
      });
      if (errorPayload.retryAfter) {
        res.setHeader("Retry-After", String(errorPayload.retryAfter));
      }
      return res.json(Object.assign({}, payload, {
        success: false,
        code: errorPayload.code,
        message: errorPayload.message,
        retryAfter: errorPayload.retryAfter || 0,
        retriable: errorPayload.retriable === true,
      }));
    }
    return res.json(payload);
  } catch (error) {
    return sendImportError(res, error);
  }
});

router.get("/recent", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      success: true,
      recentImport: getRecentImportForSession(req.fosuSession),
    });
  } catch (error) {
    return sendImportError(res, error);
  }
});

router.post("/recent/confirm", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(confirmRecentStudentScheduleImport(req, req.body || {}));
  } catch (error) {
    return sendImportError(res, error);
  }
});

router.post("/preview", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const payload = await createStudentSchedulePreview(req, req.body || {});
    setPreviewDiagnosticsHeaders(res, payload);
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

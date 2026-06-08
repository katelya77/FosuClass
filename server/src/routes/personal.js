const express = require("express");
const { scheduleLimiter } = require("../utils/rateLimit");
const { safeLog } = require("../utils/safeLogger");
const { parsePersonalXlsBuffer } = require("../utils/personal-xls-parser");

const router = express.Router();

const XLS_ONLY_RESPONSE = {
  success: false,
  code: "XLS_ONLY",
  message: "账号密码同步已下线，请使用 XLS 导入个人课表。",
};

function sendXlsOnly(req, res) {
  return res.status(410).json(Object.assign({}, XLS_ONLY_RESPONSE));
}

function handlePersonalError(res, error) {
  const code = error && error.code || "PERSONAL_XLS_IMPORT_FAILED";
  const message = error && error.message || "个人课表 XLS 解析失败，请检查文件后重试。";
  safeLog("personal-xls-route-error", { code, error: message });
  return res.status(200).json({
    success: false,
    code,
    message,
  });
}

router.all("/diagnose", sendXlsOnly);
router.all("/session/start", sendXlsOnly);
router.all("/session/verify-slider", sendXlsOnly);
router.all("/session/login-and-sync", sendXlsOnly);

router.post("/import-xls", scheduleLimiter, async (req, res) => {
  const { filename, fileBase64, targetTerm } = req.body || {};

  if (!fileBase64) {
    return res.status(200).json({
      success: false,
      code: "INVALID_PARAMS",
      message: "参数校验失败，缺少 fileBase64 文件内容",
    });
  }

  if (String(fileBase64).length > 15 * 1024 * 1024) {
    return res.status(200).json({
      success: false,
      code: "FILE_TOO_LARGE",
      message: "文件过大，上传的课表文件大小不能超过 10MB",
    });
  }

  try {
    const buffer = Buffer.from(fileBase64, "base64");
    const safeFilename = filename || "学生个人课表.xls";
    const result = parsePersonalXlsBuffer(buffer, targetTerm, safeFilename);

    return res.json({
      success: true,
      filename: safeFilename,
      term: result.term,
      metadata: result.metadata,
      courseCount: result.courses.length,
      courses: result.courses,
    });
  } catch (error) {
    return handlePersonalError(res, error);
  }
});

router.handlePersonalError = handlePersonalError;

module.exports = router;

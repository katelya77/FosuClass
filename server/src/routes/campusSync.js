const express = require("express");
const { getClientIpInfo } = require("../utils/clientIp");
const { verifySessionTokenDetailed } = require("../utils/apiSecurity");
const { availability, createJob, readJob } = require("../services/campusSyncBroker");

const router = express.Router();

function requireMiniProgramSession(req, res, next) {
  req.clientIpInfo = req.clientIpInfo || getClientIpInfo(req);
  const result = verifySessionTokenDetailed(req.headers["x-fosu-session"]);
  if (!result.valid) {
    return res.status(401).json({
      success: false,
      code: "FOSU_SESSION_REQUIRED",
      message: "会话已过期，请重新进入小程序。",
    });
  }
  req.fosuSession = result.payload;
  return next();
}

router.get("/availability", (req, res) => {
  res.json(Object.assign({ success: true }, availability()));
});

router.post("/jobs", requireMiniProgramSession, (req, res) => {
  try {
    const created = createJob(req, req.body || {});
    res.status(202).json(Object.assign({ success: true }, created));
  } catch (error) {
    const code = error && error.code || "INVALID_CREDENTIALS";
    const message = code === "INVALID_CREDENTIALS"
      ? "学校账号或密码不正确"
      : (code === "IMPORT_RATE_LIMITED" ? "尝试次数较多，请稍后再试。" : "课表同步服务暂时不可用");
    res.status(code === "IMPORT_RATE_LIMITED" ? 429 : 400).json({ success: false, code, message });
  }
});

router.get("/jobs/:jobId", requireMiniProgramSession, (req, res) => {
  try {
    res.json(Object.assign({ success: true }, readJob(req, req.params.jobId)));
  } catch (error) {
    res.status(404).json({ success: false, code: "JOB_NOT_FOUND", message: "读取学校课表超时，请稍后重试" });
  }
});

module.exports = router;

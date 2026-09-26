const crypto = require("crypto");
const express = require("express");
const { getClientIpInfo } = require("../utils/clientIp");
const { hashOpenid, verifySessionTokenDetailed } = require("../utils/apiSecurity");
const { availability, cancelJob, createJob, discardJob, readJob } = require("../services/campusSyncBroker");
const { assertJobBody } = require("../services/campusSyncSchema");
const proof = require("../services/campusSyncProof");
const abuse = require("../services/campusSyncAbuseGuard");
const telemetry = require("../services/campusSyncTelemetryService");
const { exchangeCode } = require("../services/wechatIdentityService");
const { recordAggregatedSecurityEvent } = require("../services/securityEventService");

const router = express.Router();

function requestId() {
  return crypto.randomBytes(8).toString("hex");
}

function send(res, status, code, message, extra) {
  return res.status(status).json(Object.assign({ success: false, code, message }, extra || {}));
}

function note(req, reasonCode, session) {
  const info = req.clientIpInfo || getClientIpInfo(req);
  recordAggregatedSecurityEvent("campus-sync-security", {
    route: req.path,
    method: req.method,
    anonymizedIp: info.anonymizedIp,
    openidHashPrefix: session && session.openidHash,
    sessionIdPrefix: session && session.sessionIdHash,
    reasonCode,
    requestId: req.campusRequestId || "",
    sourceBucket: session && session.openidHash ? String(session.openidHash).slice(0, 8) : (info.anonymizedIp || "anon"),
  });
}

function requireMiniProgramSession(req, res, next) {
  req.clientIpInfo = req.clientIpInfo || getClientIpInfo(req);
  req.campusRequestId = requestId();
  const header = req.headers["x-fosu-session"];
  if (!header) {
    const anonymous = abuse.noteAnonymous(req);
    note(req, "CAMPUS_SYNC_SESSION_REQUIRED");
    if (anonymous.limited) return send(res, 429, "IMPORT_RATE_LIMITED", "尝试次数较多，请稍后再试。");
    return send(res, 401, "FOSU_SESSION_REQUIRED", "会话已过期，请重新进入小程序。");
  }
  const result = verifySessionTokenDetailed(header);
  if (!result.valid) {
    abuse.noteAnonymous(req);
    note(req, result.code || "CAMPUS_SYNC_SESSION_REQUIRED");
    return send(res, 401, "FOSU_SESSION_REQUIRED", "会话已过期，请重新进入小程序。");
  }
  const suspended = abuse.suspension(result.payload.openidHash);
  if (suspended) {
    note(req, "ABUSE_TEMPORARY_BLOCK", result.payload);
    return send(res, 429, "IMPORT_RATE_LIMITED", "尝试次数较多，请稍后再试。");
  }
  req.fosuSession = result.payload;
  return next();
}

function quotaFields(error) {
  const quota = error && error.quota || {};
  const extra = {};
  ["retryAfterSeconds", "dailyLimit", "dailyUsed", "dailyRemaining", "resetAt"].forEach((key) => {
    if (quota[key] != null) extra[key] = quota[key];
  });
  return extra;
}

function publicError(error) {
  const code = error && error.code || "AGENT_OFFLINE";
  if (code === "INVALID_CREDENTIALS") return { status: 400, code, message: "学校账号验证未通过，请检查学号和密码后重新尝试。" };
  if (code === "EMPTY_PERSONAL_SCHEDULE") return { status: 400, code, message: "学校系统中当前学期暂未读取到可导入的课程。你的现有课表不会被修改。" };
  if (code === "STRUCTURE_CHANGED") return { status: 400, code, message: "学校课表页面可能发生了调整，本次没有修改你的现有课表。" };
  if (code === "SCHOOL_UNAVAILABLE") return { status: 503, code, message: "学校系统暂时没有正常响应，请稍后重新同步。" };
  if (code === "TIMEOUT") return { status: 504, code, message: "学校系统暂时没有正常响应，请稍后重新同步。" };
  if (code === "AGENT_OFFLINE") return { status: 503, code, message: "暂时无法连接学校系统，请稍后再试。" };
  if (code === "PROFILE_ID_MISMATCH") return { status: 400, code, message: "读取到的学籍学号与登录学号不一致，已停止同步。" };
  if (code === "IMPORT_RATE_LIMITED" || code === "CAMPUS_SYNC_RATE_LIMITED") {
    return { status: 429, code: code === "IMPORT_RATE_LIMITED" ? code : "CAMPUS_SYNC_RATE_LIMITED", message: "操作有些频繁，请稍后再试。", extra: quotaFields(error) };
  }
  if (code === "CAMPUS_SYNC_DAILY_LIMIT") return { status: 429, code, message: "今天的课表同步次数已用完，明天 00:00 后可再次同步。", extra: quotaFields(error) };
  if (code === "CAMPUS_SYNC_CONCURRENT_LIMIT" || code === "JOB_ALREADY_ACTIVE") {
    return { status: 429, code: "CAMPUS_SYNC_CONCURRENT_LIMIT", message: "已有一次课表同步正在进行，请等待完成。", extra: quotaFields(error) };
  }
  if (code === "CAMPUS_SYNC_BUSY" || code === "CAMPUS_SYNC_DEGRADED") return { status: 429, code: "CAMPUS_SYNC_BUSY", message: "当前同步人数较多，请稍后再试。", extra: quotaFields(error) };
  if (code === "CAMPUS_SYNC_MAINTENANCE") return { status: 503, code, message: "课表同步服务维护中，请稍后再试。" };
  if (code === "JOB_NOT_CANCELLABLE") return { status: 409, code, message: "这次同步已经开始，请等待结果。" };
  if (code === "JOB_NOT_FOUND") return { status: 404, code, message: "没有找到这次同步。" };
  if (code === "CAMPUS_SYNC_BODY_REJECTED") return { status: 400, code, message: "请求格式不正确。" };
  if (code === "CAMPUS_SYNC_WECHAT_PROOF_INVALID" || code === "CAMPUS_SYNC_WECHAT_IDENTITY_MISMATCH" || code === "CAMPUS_SYNC_REPLAY_BLOCKED") {
    return { status: 401, code, message: "请从佛课小表重新发起同步。" };
  }
  return { status: 400, code, message: "课表同步服务暂时不可用" };
}

router.get("/availability", (req, res) => {
  res.json(Object.assign({ success: true }, availability()));
});

router.post("/jobs", requireMiniProgramSession, async (req, res) => {
  const contentType = String(req.headers["content-type"] || "");
  if (contentType && contentType.indexOf("application/json") !== 0) {
    note(req, "CAMPUS_SYNC_BODY_REJECTED", req.fosuSession);
    return send(res, 415, "CAMPUS_SYNC_BODY_REJECTED", "请求格式不正确。");
  }
  try {
    const body = assertJobBody(req.body || {});
    if (!proof.consume(body.wxCode)) {
      abuse.noteSecurityFailure(req.fosuSession.openidHash);
      note(req, "CAMPUS_SYNC_REPLAY_BLOCKED", req.fosuSession);
      return send(res, 401, "CAMPUS_SYNC_REPLAY_BLOCKED", "请从佛课小表重新发起同步。");
    }
    let identity;
    try {
      identity = await exchangeCode(body.wxCode);
    } catch (error) {
      abuse.noteSecurityFailure(req.fosuSession.openidHash);
      note(req, "CAMPUS_SYNC_WECHAT_PROOF_INVALID", req.fosuSession);
      return send(res, 401, "CAMPUS_SYNC_WECHAT_PROOF_INVALID", "请从佛课小表重新发起同步。");
    }
    if (!identity || hashOpenid(identity.openid) !== req.fosuSession.openidHash) {
      abuse.noteSecurityFailure(req.fosuSession.openidHash);
      note(req, "CAMPUS_SYNC_WECHAT_IDENTITY_MISMATCH", req.fosuSession);
      return send(res, 401, "CAMPUS_SYNC_WECHAT_IDENTITY_MISMATCH", "请从佛课小表重新发起同步。");
    }
    const created = createJob(req, {
      studentId: body.studentId,
      password: body.password,
      semester: body.semester,
      requestId: req.campusRequestId,
    });
    return res.status(202).json(Object.assign({ success: true }, created));
  } catch (error) {
    const mapped = publicError(error);
    if (mapped.code === "CAMPUS_SYNC_BODY_REJECTED" || mapped.code === "CAMPUS_SYNC_WECHAT_PROOF_INVALID") {
      abuse.noteSecurityFailure(req.fosuSession && req.fosuSession.openidHash);
      note(req, mapped.code, req.fosuSession);
    }
    if (mapped.code === "INVALID_CREDENTIALS") telemetry.record({ status: "rejected", resultCode: "INVALID_CREDENTIALS", t: Date.now() });
    return send(res, mapped.status, mapped.code, mapped.message, mapped.extra);
  }
});

router.post("/jobs/:jobId/cancel", requireMiniProgramSession, (req, res) => {
  try {
    res.json(Object.assign({ success: true }, cancelJob(req, req.params.jobId)));
  } catch (error) {
    const mapped = publicError(error);
    if (mapped.code === "JOB_NOT_FOUND") note(req, "CAMPUS_SYNC_OWNER_MISMATCH", req.fosuSession);
    return send(res, mapped.status, mapped.code, mapped.code === "JOB_NOT_CANCELLABLE" ? "这次同步已经开始，请等待结果。" : mapped.message);
  }
});

router.post("/jobs/:jobId/discard", requireMiniProgramSession, (req, res) => {
  try {
    res.json(Object.assign({ success: true }, discardJob(req, req.params.jobId)));
  } catch (error) {
    const mapped = publicError(error);
    if (mapped.code === "JOB_NOT_FOUND") note(req, "CAMPUS_SYNC_OWNER_MISMATCH", req.fosuSession);
    return send(res, mapped.status, mapped.code, mapped.code === "JOB_NOT_CANCELLABLE" ? "这次同步还在进行。" : mapped.message);
  }
});

router.get("/jobs/:jobId", requireMiniProgramSession, (req, res) => {
  if (abuse.notePoll(req.fosuSession.openidHash).limited) {
    note(req, "CAMPUS_SYNC_RATE_LIMITED", req.fosuSession);
    return send(res, 429, "IMPORT_RATE_LIMITED", "尝试次数较多，请稍后再试。");
  }
  try {
    res.json(Object.assign({ success: true }, readJob(req, req.params.jobId)));
  } catch (error) {
    note(req, "CAMPUS_SYNC_OWNER_MISMATCH", req.fosuSession);
    return send(res, 404, "JOB_NOT_FOUND", "没有找到这次同步。");
  }
});

module.exports = router;

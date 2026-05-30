/**
 * 个人课表同步路由
 * NOTE: 暴露个人同步登录所必需的会话初始化、滑块验证、以及学号登录课表抓取同步端点。
 */

const express = require("express");
const router = express.Router();
const personalAuthService = require("../services/personal-auth-service");
const personalScheduleService = require("../services/personal-schedule-service");
const { destroySession } = require("../utils/fosu-cookie-jar");
const { scheduleLimiter } = require("../utils/rateLimit");
const { safeLog, maskStudentId } = require("../utils/safeLogger");

/**
 * 统一错误拦截映射函数，将抛出的异常映射为符合标准规范的业务错误响应
 * @param {express.Response} res Express 响应对象
 * @param {Error} error 抛出的错误对象
 */
function handlePersonalError(res, error) {
  const errMsg = error.message || "";
  
  if (errMsg.includes("EDU100_DNS_FAILED")) {
    return res.status(200).json({
      success: false,
      code: "EDU100_DNS_FAILED",
      message: "当前同步节点无法解析教务 100 网，请稍后再试。你仍可使用全校课表。",
    });
  }

  if (errMsg.includes("EDU100_UNREACHABLE")) {
    return res.status(200).json({
      success: false,
      code: "EDU100_UNREACHABLE",
      message: "当前同步节点无法访问教务 100 网，可能需要校园网或校 VPN 环境。",
    });
  }

  if (errMsg.includes("AUTHSERVER_UNREACHABLE")) {
    return res.status(200).json({
      success: false,
      code: "AUTHSERVER_UNREACHABLE",
      message: "暂时无法连接统一身份认证服务，请稍后再试。",
    });
  }

  if (errMsg.includes("LOGIN_PAGE_CHANGED")) {
    return res.status(200).json({
      success: false,
      code: "LOGIN_PAGE_CHANGED",
      message: "学校登录页面结构可能已更新，个人同步暂时不可用。",
    });
  }

  if (errMsg.includes("SLIDER_ENDPOINT_FAILED")) {
    return res.status(200).json({
      success: false,
      code: "SLIDER_ENDPOINT_FAILED",
      message: "滑块验证资源加载失败，请稍后再试。",
    });
  }

  if (errMsg.includes("SESSION_EXPIRED")) {
    return res.status(200).json({
      success: false,
      code: "SESSION_EXPIRED",
      message: "登录会话已过期，请重新点击开始验证。",
    });
  }

  if (errMsg.includes("SLIDER_VERIFY_FAILED")) {
    return res.status(200).json({
      success: false,
      code: "SLIDER_VERIFY_FAILED",
      message: "滑块验证失败，请重新拖动验证。",
    });
  }

  if (errMsg.includes("CAS_LOGIN_FAILED") || errMsg.includes("INVALID_CREDENTIALS")) {
    return res.status(200).json({
      success: false,
      code: "CAS_LOGIN_FAILED",
      message: "登录失败，请检查学号、密码或验证码。",
    });
  }

  if (errMsg.includes("SCHEDULE_PAGE_UNREACHABLE") || errMsg.includes("JWC_SESSION_FAILED")) {
    return res.status(200).json({
      success: false,
      code: "SCHEDULE_PAGE_UNREACHABLE",
      message: "已登录，但暂时无法打开个人课表页面。",
    });
  }

  if (errMsg.includes("PERSONAL_SCHEDULE_PARSE_FAILED") || errMsg.includes("SCHEDULE_PARSE_FAILED")) {
    return res.status(200).json({
      success: false,
      code: "SCHEDULE_PARSE_FAILED",
      message: "已打开个人课表页面，但解析课程失败。",
    });
  }

  if (errMsg.includes("SEMESTER_NOT_FOUND")) {
    return res.status(200).json({
      success: false,
      code: "SEMESTER_NOT_FOUND",
      message: "未在教务系统中找到所选学期的课程数据。",
      availableSemesters: error.availableSemesters || [],
    });
  }

  if (errMsg.includes("PERSONAL_SCHEDULE_EMPTY")) {
    return res.status(200).json({
      success: false,
      code: "PERSONAL_SCHEDULE_EMPTY",
      message: "教务系统中该学期没有您的课程安排记录。",
    });
  }

  safeLog("personal-route-unknown-error", { error: errMsg, stack: error.stack });
  return res.status(200).json({
    success: false,
    code: "UNKNOWN_ERROR",
    message: "同步服务出现未知异常，请稍后再试或联系管理员。",
    error: process.env.NODE_ENV === "development" ? errMsg : undefined,
  });
}

/**
 * 0. 网络连通性健康诊断
 * GET /api/fosu/personal/diagnose
 */
router.get("/diagnose", async (req, res) => {
  try {
    const data = await personalAuthService.checkFosuNetwork();
    res.json(data);
  } catch (error) {
    handlePersonalError(res, error);
  }
});

/**
 * 1. 初始化个人登录会话
 * POST /api/fosu/personal/session/start
 */
router.post("/session/start", scheduleLimiter, async (req, res) => {
  const { studentId } = req.body;
  
  try {
    const data = await personalAuthService.startPersonalSession(studentId);
    res.json(data);
  } catch (error) {
    handlePersonalError(res, error);
  }
});

/**
 * 2. 校验滑块移动距离
 * POST /api/fosu/personal/session/verify-slider
 */
router.post("/session/verify-slider", scheduleLimiter, async (req, res) => {
  const { sessionId, canvasLength, moveLength } = req.body;

  if (!sessionId || moveLength === undefined) {
    return res.status(200).json({
      success: false,
      code: "INVALID_PARAMS",
      message: "参数校验失败，缺少 sessionId 或 moveLength",
    });
  }

  try {
    const data = await personalAuthService.verifyPersonalSlider(
      sessionId,
      canvasLength || 340,
      moveLength
    );
    res.json(data);
  } catch (error) {
    handlePersonalError(res, error);
  }
});

/**
 * 3. 登录并同步个人课表
 * POST /api/fosu/personal/session/login-and-sync
 */
router.post("/session/login-and-sync", scheduleLimiter, async (req, res) => {
  let { sessionId, studentId, password, semester } = req.body;

  if (!sessionId || !studentId || !password || !semester) {
    return res.status(200).json({
      success: false,
      code: "INVALID_PARAMS",
      message: "参数校验失败，学号、密码及目标学期均不可为空",
    });
  }

  try {
    // 1. 统一认证登录并获取 jar 会话
    const { studentJar, student } = await personalAuthService.loginAndGetJar(
      sessionId,
      studentId,
      password
    );

    // 2. 联动抓取个人课表 HTML 并调用解析
    const result = await personalScheduleService.fetchAndParseSchedule(
      studentJar,
      student,
      semester
    );

    res.json(result);
  } catch (error) {
    handlePersonalError(res, error);
  } finally {
    // 3. 安全要求：无论成功还是失败，均立刻擦除密码局部变量并销毁内存会话以防泄露
    password = null;
    destroySession(sessionId);
  }
});

module.exports = router;

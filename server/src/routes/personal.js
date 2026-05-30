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
  
  if (errMsg.includes("CAMPUS_NETWORK_REQUIRED")) {
    return res.status(200).json({
      success: false,
      code: "CAMPUS_NETWORK_REQUIRED",
      message: "当前服务器暂时无法访问学校教务系统，请先使用全校课表选择班级。",
    });
  }

  if (errMsg.includes("LOGIN_PAGE_PARSE_FAILED")) {
    return res.status(200).json({
      success: false,
      code: "LOGIN_PAGE_PARSE_FAILED",
      message: "教务登录页参数解析失败，可能教务系统布局已变更，请联系开发者反馈。",
    });
  }

  if (errMsg.includes("SLIDER_TOKEN_NOT_FOUND")) {
    return res.status(200).json({
      success: false,
      code: "SLIDER_TOKEN_NOT_FOUND",
      message: "滑块验证码令牌解析失败，请检查教务网联通性或稍后再试。",
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
      message: "滑块验证失败，请重试。",
    });
  }

  if (errMsg.includes("INVALID_CREDENTIALS")) {
    return res.status(200).json({
      success: false,
      code: "INVALID_CREDENTIALS",
      message: "账号或密码不正确，请重新输入。",
    });
  }

  if (errMsg.includes("CAS_TICKET_MISSING") || errMsg.includes("JWC_SESSION_FAILED")) {
    return res.status(200).json({
      success: false,
      code: "JWC_SESSION_FAILED",
      message: "统一身份认证跳转教务网会话建立失败，请重试。",
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

  if (errMsg.includes("PERSONAL_SCHEDULE_PARSE_FAILED")) {
    return res.status(200).json({
      success: false,
      code: "PERSONAL_SCHEDULE_PARSE_FAILED",
      message: "课表数据解析失败，请反馈给开发者。",
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

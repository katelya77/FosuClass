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

const config = require("../config");
const { redactSecrets } = require("../utils/safeLogger");

/**
 * 统一错误拦截映射函数，将抛出的异常映射为符合标准规范的业务错误响应
 * @param {express.Response} res Express 响应对象
 * @param {Error} error 抛出的错误对象
 */
function handlePersonalError(res, error) {
  const errMsg = error.message || "";
  const errCode = error.code || "";
  
  let code = "UNKNOWN_ERROR";
  let message = "同步服务出现未知异常，请稍后再试或联系管理员。";
  let detail = process.env.NODE_ENV === "development" ? errMsg : undefined;

  // 1. 校园网不可达限制
  if (
    errMsg.includes("CAMPUS_NETWORK_REQUIRED") || 
    errMsg.includes("EDU100_UNREACHABLE") || 
    errMsg.includes("AUTHSERVER_UNREACHABLE")
  ) {
    code = "CAMPUS_NETWORK_REQUIRED";
    message = "公网服务器无法访问学校内网 100.fosu.edu.cn，账号密码同步不可用。该状态不代表你的手机网络，推荐使用 XLS 手动导入。";
  }
  // 2. DNS 解析失败
  else if (
    errMsg.includes("UPSTREAM_DNS_FAILED") || 
    errMsg.includes("DNS_FAILED") || 
    errMsg.includes("EDU100_DNS_FAILED") ||
    errCode === "ENOTFOUND" || 
    errCode === "EAI_AGAIN"
  ) {
    code = "UPSTREAM_DNS_FAILED";
    message = "公网服务器当前无法解析学校内网 100.fosu.edu.cn，账号密码同步不可用。推荐使用 XLS 手动导入。";
  }
  // 3. 连接超时
  else if (
    errMsg.includes("UPSTREAM_TIMEOUT") || 
    errMsg.includes("TIMEOUT") || 
    errMsg.includes("timeout") ||
    errCode === "ECONNABORTED" || 
    errCode === "ETIMEDOUT"
  ) {
    code = "UPSTREAM_TIMEOUT";
    message = "公网服务器连接学校教务网超时。该检测基于服务器环境，不代表你的手机网络状态，推荐使用 XLS 手动导入。";
  }
  // 4. 接口或页面不存在 (404)
  else if (
    errMsg.includes("UPSTREAM_404") || 
    errMsg.includes("404") || 
    errMsg.includes("status code 404")
  ) {
    code = "UPSTREAM_404";
    message = "学校教务页面未找到(404)，可能教务网接口已变更，个人同步暂时不可用。";
  }
  // 5. 滑块或登录令牌未找到
  else if (
    errMsg.includes("SLIDER_TOKEN_NOT_FOUND") || 
    errMsg.includes("SLIDER_ENDPOINT_FAILED")
  ) {
    code = "SLIDER_TOKEN_NOT_FOUND";
    message = "滑块验证资源加载失败或令牌解析失败，请稍后再试。";
  }
  // 6. 校园代理不可达
  else if (
    errMsg.includes("VPN_GATEWAY_UNAVAILABLE")
  ) {
    code = "VPN_GATEWAY_UNAVAILABLE";
    message = "校园代理网关未配置或暂时不可用，请联系管理员或使用全校课表。";
  }
  // 7. 登录失败
  else if (
    errMsg.includes("CAS_LOGIN_FAILED") || 
    errMsg.includes("INVALID_CREDENTIALS")
  ) {
    code = "CAS_LOGIN_FAILED";
    message = "登录失败，请检查学号、密码或验证码。";
  }
  // 8. 其他会话及流程错误
  else if (errMsg.includes("SESSION_EXPIRED")) {
    code = "SESSION_EXPIRED";
    message = "登录会话已过期，请重新点击检测或开始。";
  }
  else if (errMsg.includes("SLIDER_VERIFY_FAILED")) {
    code = "SLIDER_VERIFY_FAILED";
    message = "滑块验证失败，请重新拖动验证。";
  }
  else if (errMsg.includes("LOGIN_PAGE_CHANGED")) {
    code = "LOGIN_PAGE_CHANGED";
    message = "学校登录页面结构可能已更新，个人同步暂时不可用。";
  }
  else if (errMsg.includes("SCHEDULE_PAGE_UNREACHABLE") || errMsg.includes("JWC_SESSION_FAILED")) {
    code = "SCHEDULE_PAGE_UNREACHABLE";
    message = "已登录，但暂时无法打开个人课表页面。";
  }
  else if (errMsg.includes("PERSONAL_SCHEDULE_PARSE_FAILED") || errMsg.includes("SCHEDULE_PARSE_FAILED")) {
    code = "SCHEDULE_PARSE_FAILED";
    message = "已打开个人课表页面，但解析课程失败。";
  }
  else if (errMsg.includes("SEMESTER_NOT_FOUND")) {
    code = "SEMESTER_NOT_FOUND";
    message = "未在教务系统中找到所选学期的课程数据。";
  }
  else if (errMsg.includes("PERSONAL_SCHEDULE_EMPTY")) {
    code = "PERSONAL_SCHEDULE_EMPTY";
    message = "教务系统中该学期没有您的课程安排记录。";
  }

  // 严禁在日志中包含明文密码、验证码等敏感参数，进行脱敏
  const sanitizedDetail = detail ? redactSecrets(detail) : undefined;
  safeLog("personal-route-error", { code, error: errMsg, detail: sanitizedDetail });

  return res.status(200).json({
    success: false,
    code,
    message,
    detail: sanitizedDetail,
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

router.post("/session/login-and-sync", scheduleLimiter, async (req, res) => {
  let { sessionId, studentId, password, semester } = req.body;

  // 1. 判断是否开启校园代理，按需校验参数
  const useAgent = config.CAMPUS_AGENT_ENABLED;
  if (useAgent) {
    if (!studentId || !password || !semester) {
      return res.status(200).json({
        success: false,
        code: "INVALID_PARAMS",
        message: "参数校验失败，学号、密码及目标学期均不可为空",
      });
    }
  } else {
    if (!sessionId || !studentId || !password || !semester) {
      return res.status(200).json({
        success: false,
        code: "INVALID_PARAMS",
        message: "参数校验失败，学号、密码及目标学期均不可为空",
      });
    }
  }

  try {
    let result;
    if (useAgent) {
      // 2. 校园代理转发模式
      result = await personalScheduleService.fetchAndParseScheduleViaAgent(
        studentId,
        password,
        semester
      );
    } else {
      // 3. 直连校园网传统模式
      const { studentJar, student } = await personalAuthService.loginAndGetJar(
        sessionId,
        studentId,
        password
      );
      result = await personalScheduleService.fetchAndParseSchedule(
        studentJar,
        student,
        semester
      );
    }

    res.json(result);
  } catch (error) {
    handlePersonalError(res, error);
  } finally {
    // 4. 安全要求：无论成功还是失败，均立刻擦除密码局部变量并销毁内存会话以防泄露
    password = null;
    if (sessionId) {
      destroySession(sessionId);
    }
  }
});

const { parsePersonalXlsBuffer } = require("../utils/personal-xls-parser");

/**
 * 3. 导入个人理论课表 XLS
 * POST /api/fosu/personal/import-xls
 */
router.post("/import-xls", scheduleLimiter, async (req, res) => {
  const { filename, fileBase64, targetTerm } = req.body;

  if (!fileBase64) {
    return res.status(200).json({
      success: false,
      code: "INVALID_PARAMS",
      message: "参数校验失败，缺少 fileBase64 文件内容",
    });
  }

  // 预估大小限制：大约 10MB 的 XLS 文件
  if (fileBase64.length > 15 * 1024 * 1024) {
    return res.status(200).json({
      success: false,
      code: "FILE_TOO_LARGE",
      message: "文件过大，上传的课表文件大小不能超过 10MB",
    });
  }

  try {
    const buffer = Buffer.from(fileBase64, "base64");
    const result = parsePersonalXlsBuffer(buffer, targetTerm, filename || "学生个人课表.xls");

    return res.json({
      success: true,
      filename: filename || "学生个人课表.xls",
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

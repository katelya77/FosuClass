/**
 * 强智教务网相关 API 路由：定义从微信小程序请求的各教务接口。
 */

const express = require("express");
const router = express.Router();
const schoolCatalogService = require("../services/schoolCatalogService");
const scheduleService = require("../services/scheduleService");
const { scheduleLimiter } = require("../utils/rateLimit");

/**
 * 辅助错误处理函数：对教务系统的异常进行分类，并隐去任何敏感信息
 */
function handleRouteError(res, error, label) {
  const errMsg = error.message || "";
  
  if (errMsg.includes("NEED_CAPTCHA")) {
    return res.status(200).json({
      success: false,
      code: "NEED_CAPTCHA",
      message: "教务系统登录需要验证码，目前无法自动处理",
    });
  }
  
  if (errMsg.includes("NEED_LOGIN")) {
    return res.status(200).json({
      success: false,
      code: "NEED_LOGIN",
      message: "教务服务账号或密码错误，请联系管理员更新配置",
    });
  }

  // 默认请求网络错误
  return res.status(200).json({
    success: false,
    message: "暂时无法连接教务数据服务",
    error: process.env.NODE_ENV === "development" ? errMsg : undefined,
  });
}

/**
 * 1. 获取全校 Catalog
 * GET /api/fosu/catalog
 */
router.get("/catalog", async (req, res) => {
  const semester = req.query.semester;
  try {
    const data = await schoolCatalogService.getCatalog(semester);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-catalog-failed");
  }
});

/**
 * 2. 获取专业列表
 * GET /api/fosu/majors?collegeCode=04&grade=2025
 */
router.get("/majors", async (req, res) => {
  const { collegeCode, grade } = req.query;
  try {
    const data = await schoolCatalogService.getMajors(collegeCode, grade);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-majors-failed");
  }
});

/**
 * 3. 获取行政班级课表
 * POST /api/fosu/class-schedule
 */
router.post("/class-schedule", scheduleLimiter, async (req, res) => {
  try {
    const data = await scheduleService.getClassSchedule(req.body);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-class-schedule-failed");
  }
});

/**
 * 4. 获取教师课表
 * POST /api/fosu/teacher-schedule
 */
router.post("/teacher-schedule", scheduleLimiter, async (req, res) => {
  try {
    const data = await scheduleService.getTeacherSchedule(req.body);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-teacher-schedule-failed");
  }
});

/**
 * 5. 获取教室课表
 * POST /api/fosu/classroom-schedule
 */
router.post("/classroom-schedule", scheduleLimiter, async (req, res) => {
  try {
    const data = await scheduleService.getClassroomSchedule(req.body);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-classroom-schedule-failed");
  }
});

/**
 * 6. 获取课程课表
 * POST /api/fosu/course-schedule
 */
router.post("/course-schedule", scheduleLimiter, async (req, res) => {
  try {
    const data = await scheduleService.getCourseSchedule(req.body);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-course-schedule-failed");
  }
});

module.exports = router;

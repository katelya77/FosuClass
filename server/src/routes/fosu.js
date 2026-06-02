/**
 * 强智教务网相关 API 路由：定义从微信小程序请求的各教务接口。
 */

const express = require("express");
const router = express.Router();
const appConfigService = require("../services/appConfigService");
const schoolCatalogService = require("../services/schoolCatalogService");
const scheduleService = require("../services/scheduleService");
const releaseService = require("../services/releaseService");
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

function sendCacheableJson(req, res, payload, maxAgeSeconds) {
  const etag = payload && payload.etag;
  if (etag) {
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }
  }
  res.setHeader("Cache-Control", `public, max-age=${maxAgeSeconds || 60}`);
  return res.json(payload);
}

function normalizeScheduleResponse(kind, result) {
  if (!result.success) {
    return result;
  }
  const schedule = result.schedule || {};
  if (kind === "class") {
    return Object.assign({}, result, { classes: schedule ? [schedule] : [] });
  }
  if (kind === "teacher") {
    return Object.assign({}, result, { teachers: schedule ? [schedule] : [] });
  }
  if (kind === "classroom") {
    return Object.assign({}, result, { classrooms: schedule ? [schedule] : [] });
  }
  return Object.assign({}, result, { coursesList: schedule ? [schedule] : [] });
}

/**
 * 运行时配置：公告、最新动态和数据版本信息。
 * GET /api/fosu/app-config
 */
router.get("/app-config", (req, res) => {
  try {
    res.json(appConfigService.getPublicAppConfig());
  } catch (error) {
    handleRouteError(res, error, "get-app-config-failed");
  }
});

/**
 * 0. 系统启动 Bootstrap，聚合 Catalog 和计数信息
 * GET /api/fosu/bootstrap
 */
router.get("/bootstrap", async (req, res) => {
  const semester = req.query.semester;
  try {
    const data = await schoolCatalogService.getBootstrap(semester);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-bootstrap-failed");
  }
});

/**
 * 0.5. 根据筛选获取班级列表，按 adminClass 和 majorAggregate 分组
 * GET /api/fosu/classes
 */
router.get("/classes", async (req, res) => {
  try {
    const data = await schoolCatalogService.getClasses(req.query);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-classes-failed");
  }
});

router.get("/search/classes", scheduleLimiter, (req, res) => {
  try {
    const result = releaseService.searchActiveIndex("class", req.query.q, req.query);
    return sendCacheableJson(req, res, result, 120);
  } catch (error) {
    handleRouteError(res, error, "search-classes-failed");
  }
});

router.get("/search/teachers", scheduleLimiter, (req, res) => {
  try {
    const result = releaseService.searchActiveIndex("teacher", req.query.q, req.query);
    return sendCacheableJson(req, res, result, 120);
  } catch (error) {
    handleRouteError(res, error, "search-teachers-failed");
  }
});

router.get("/search/classrooms", scheduleLimiter, (req, res) => {
  try {
    const result = releaseService.searchActiveIndex("classroom", req.query.q, req.query);
    return sendCacheableJson(req, res, result, 120);
  } catch (error) {
    handleRouteError(res, error, "search-classrooms-failed");
  }
});

router.get("/search/courses", scheduleLimiter, (req, res) => {
  try {
    const result = releaseService.searchActiveIndex("course", req.query.q, req.query);
    return sendCacheableJson(req, res, result, 120);
  } catch (error) {
    handleRouteError(res, error, "search-courses-failed");
  }
});

router.get("/search-index", scheduleLimiter, (req, res) => {
  try {
    const type = String(req.query.type || "").trim();
    const query = Object.assign({}, req.query);
    if (query.term && !query.semester) {
      query.semester = query.term;
    }
    if (!["teacher", "classroom", "course", "class"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be teacher, classroom, course, or class",
      });
    }
    const result = releaseService.searchActiveIndex(type, query.q, query);
    const items = (result.items || []).map((item) => ({
      id: item.id,
      name: item.name || item.teacherName || item.roomName || item.classroomName || item.courseName || item.className || "",
      teacherName: item.teacherName,
      roomName: item.roomName || item.classroomName,
      courseName: item.courseName,
      className: item.className,
      college: item.college || item.collegeName || "",
      collegeCode: item.collegeCode || "",
      collegeName: item.collegeName || "",
      grade: item.grade || "",
      majorCode: item.majorCode || "",
      majorName: item.majorName || "",
      campus: item.campus || "",
      count: item.courseCount || 0,
      courseCount: item.courseCount || 0,
      firstCourseName: item.firstCourseName || "",
      displayType: item.displayType || "",
      isAggregated: Boolean(item.isAggregated),
      updatedAt: item.updatedAt || "",
      semester: item.semester || result.semester || "",
    }));
    return sendCacheableJson(req, res, Object.assign({}, result, { items }), 120);
  } catch (error) {
    handleRouteError(res, error, "get-search-index-failed");
  }
});

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
 * GET/POST /api/fosu/class-schedule
 */
async function handleClassScheduleRequest(req, res) {
  try {
    const data = await scheduleService.getClassSchedule(req.method === "GET" ? req.query : req.body);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-class-schedule-failed");
  }
}

router.get("/class-schedule", scheduleLimiter, handleClassScheduleRequest);
router.post("/class-schedule", scheduleLimiter, handleClassScheduleRequest);

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

router.get("/schedule/class/:id", scheduleLimiter, (req, res) => {
  try {
    const result = normalizeScheduleResponse("class", releaseService.readActiveSchedule("class", req.params.id));
    return sendCacheableJson(req, res, result, 300);
  } catch (error) {
    handleRouteError(res, error, "get-indexed-class-schedule-failed");
  }
});

router.get("/schedule/teacher/:id", scheduleLimiter, (req, res) => {
  try {
    const result = normalizeScheduleResponse("teacher", releaseService.readActiveSchedule("teacher", req.params.id));
    return sendCacheableJson(req, res, result, 300);
  } catch (error) {
    handleRouteError(res, error, "get-indexed-teacher-schedule-failed");
  }
});

router.get("/schedule/classroom/:id", scheduleLimiter, (req, res) => {
  try {
    const result = normalizeScheduleResponse("classroom", releaseService.readActiveSchedule("classroom", req.params.id));
    return sendCacheableJson(req, res, result, 300);
  } catch (error) {
    handleRouteError(res, error, "get-indexed-classroom-schedule-failed");
  }
});

router.get("/schedule/course/:id", scheduleLimiter, (req, res) => {
  try {
    const result = normalizeScheduleResponse("course", releaseService.readActiveSchedule("course", req.params.id));
    return sendCacheableJson(req, res, result, 300);
  } catch (error) {
    handleRouteError(res, error, "get-indexed-course-schedule-failed");
  }
});

router.get("/schedule-detail", scheduleLimiter, (req, res) => {
  try {
    const type = String(req.query.type || "").trim();
    const id = String(req.query.id || "").trim();
    if (!["teacher", "classroom", "course", "class"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be teacher, classroom, course, or class",
      });
    }
    if (!id) {
      return res.status(400).json({ success: false, message: "id is required" });
    }
    const result = normalizeScheduleResponse(type, releaseService.readActiveSchedule(type, id));
    return sendCacheableJson(req, res, result, 300);
  } catch (error) {
    handleRouteError(res, error, "get-schedule-detail-failed");
  }
});

module.exports = router;

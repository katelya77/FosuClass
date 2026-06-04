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

function getActivePlatformSnapshot(req) {
  const active = releaseService.getActiveReleaseInfo() || {};
  const publicConfig = appConfigService.getPublicAppConfig();
  const data = publicConfig && publicConfig.data ? publicConfig.data : {};
  const dataVersion = data.dataVersion || {};
  const updatedAt = active.publishedAt ||
    active.updatedAt ||
    dataVersion.classScheduleUpdatedAt ||
    data.updatedAt ||
    "";
  const releaseVersion = active.releaseVersion || active.version || dataVersion.releaseVersion || "";
  const term = active.term || active.semester || data.currentSemester || data.term || "2025-2026-2";
  return {
    term,
    releaseVersion,
    activeReleaseVersion: releaseVersion,
    updatedAt,
    publishedAt: updatedAt,
    cacheEpoch: new Date(updatedAt).getTime() || Date.now(),
    counts: active.counts || {},
    manifestUrl: releaseVersion
      ? `/api/fosu/periodic-data?releaseVersion=${encodeURIComponent(releaseVersion)}`
      : "/api/fosu/periodic-data",
  };
}

function buildPlatformUrls(snapshot) {
  const releaseVersion = snapshot.releaseVersion || "";
  return {
    appConfig: "/api/fosu/app-config",
    bootstrap: "/api/fosu/bootstrap",
    prefetch: "/api/fosu/prefetch",
    periodicData: "/api/fosu/periodic-data",
    searchIndex: releaseVersion
      ? `/api/fosu/search-index?releaseVersion=${encodeURIComponent(releaseVersion)}`
      : "/api/fosu/search-index",
    scheduleDetail: "/api/fosu/schedule-detail",
    releasePackManifest: releaseVersion
      ? `/api/fosu/release-pack/manifest?releaseVersion=${encodeURIComponent(releaseVersion)}`
      : "/api/fosu/release-pack/manifest",
    releasePackIndex: "/api/fosu/release-pack/index",
    releasePackDetail: "/api/fosu/release-pack/detail",
    releasePackEmptyRoom: releaseVersion
      ? `/api/fosu/release-pack/empty-room?releaseVersion=${encodeURIComponent(releaseVersion)}`
      : "/api/fosu/release-pack/empty-room",
    emptyClassrooms: releaseVersion
      ? `/api/fosu/empty-classrooms?releaseVersion=${encodeURIComponent(releaseVersion)}`
      : "/api/fosu/empty-classrooms",
    clientDiagnosis: "/api/fosu/client-diagnosis",
  };
}

/**
 * 运行时配置：公告、最新动态和数据版本信息。
 * GET /api/fosu/app-config
 */
router.get("/app-config", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const rawConfig = appConfigService.getPublicAppConfig();
    if (rawConfig && rawConfig.success && rawConfig.data) {
      const activeVer = rawConfig.data.dataVersion?.releaseVersion || "";
      const term = rawConfig.data.currentSemester || "2025-2026-2";
      const dataUpdatedAt = rawConfig.data.dataVersion?.classScheduleUpdatedAt || rawConfig.data.updatedAt || "";
      rawConfig.data.term = term;
      rawConfig.data.releaseVersion = activeVer;
      rawConfig.data.activeReleaseVersion = activeVer;
      rawConfig.data.publishedAt = dataUpdatedAt;
      rawConfig.data.dataUpdatedAt = dataUpdatedAt;
      rawConfig.data.cacheVersion = activeVer;
      rawConfig.data.cacheEpoch = new Date(dataUpdatedAt).getTime() || Date.now();
      rawConfig.data.counts = releaseService.getActiveReleaseInfo()?.counts || {};
    }
    res.json(rawConfig);
  } catch (error) {
    handleRouteError(res, error, "get-app-config-failed");
  }
});

router.get("/prefetch", (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const activeSnapshot = getActivePlatformSnapshot(req);
    return res.json({
      success: true,
      activeSnapshot,
      term: activeSnapshot.term,
      releaseVersion: activeSnapshot.releaseVersion,
      updatedAt: activeSnapshot.updatedAt,
      cacheEpoch: activeSnapshot.cacheEpoch,
      counts: activeSnapshot.counts,
      manifestUrl: activeSnapshot.manifestUrl,
      urls: buildPlatformUrls(activeSnapshot),
    });
  } catch (error) {
    handleRouteError(res, error, "get-prefetch-failed");
  }
});

router.get("/periodic-data", (req, res) => {
  try {
    const hasVersion = Boolean(req.query.releaseVersion || req.query.version);
    if (hasVersion) {
      res.setHeader("Cache-Control", "public, max-age=300");
    } else {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    const activeSnapshot = getActivePlatformSnapshot(req);
    const releaseVersion = req.query.releaseVersion || req.query.version || activeSnapshot.releaseVersion;
    const indexMeta = {};
    ["class", "teacher", "classroom", "course"].forEach((kind) => {
      const index = releaseService.readActiveIndex(kind, releaseVersion);
      indexMeta[kind] = {
        success: Boolean(index && index.success),
        count: Array.isArray(index && index.items) ? index.items.length : 0,
        code: index && (index.code || index.reasonCode || ""),
      };
    });
    const emptyIndex = releaseService.readEmptyRoomIndex(releaseVersion);
    indexMeta.emptyRoom = {
      success: Boolean(emptyIndex && emptyIndex.success),
      count: Array.isArray(emptyIndex && emptyIndex.rooms) ? emptyIndex.rooms.length : 0,
      buildings: Array.isArray(emptyIndex && emptyIndex.buildings) ? emptyIndex.buildings : [],
      code: emptyIndex && (emptyIndex.code || emptyIndex.reasonCode || ""),
    };

    return res.json({
      success: true,
      activeSnapshot,
      manifest: {
        term: activeSnapshot.term,
        releaseVersion: releaseVersion || activeSnapshot.releaseVersion,
        updatedAt: activeSnapshot.updatedAt,
        cacheEpoch: activeSnapshot.cacheEpoch,
        counts: activeSnapshot.counts,
      },
      releases: releaseService.listReleases(5),
      indexes: indexMeta,
      urls: buildPlatformUrls(activeSnapshot),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    handleRouteError(res, error, "get-periodic-data-failed");
  }
});

/**
 * 0. 系统启动 Bootstrap，聚合 Catalog 和计数信息
 * GET /api/fosu/bootstrap
 */
function sendReleasePackJson(req, res, payload, releaseVersion, maxAgeSeconds) {
  if (releaseVersion) {
    return sendCacheableJson(req, res, payload, maxAgeSeconds || 300);
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return res.json(payload);
}

router.get("/release-pack/manifest", scheduleLimiter, (req, res) => {
  try {
    const releaseVersion = String(req.query.releaseVersion || req.query.version || "").trim();
    const manifest = releaseService.getReleasePackManifest(releaseVersion);
    if (!manifest.success) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(200).json(manifest);
    }
    const payload = Object.assign({
      success: true,
      schemaVersion: manifest.schemaVersion || 1,
    }, manifest, {
      releaseVersion: manifest.releaseVersion || manifest.version || releaseVersion,
      version: manifest.version || manifest.releaseVersion || releaseVersion,
    });
    return sendReleasePackJson(req, res, payload, releaseVersion, 300);
  } catch (error) {
    handleRouteError(res, error, "get-release-pack-manifest-failed");
  }
});

router.get("/release-pack/index/:type", scheduleLimiter, (req, res) => {
  try {
    const type = String(req.params.type || "").trim();
    const releaseVersion = String(req.query.releaseVersion || req.query.version || "").trim();
    if (!["teacher", "classroom", "course", "class"].includes(type)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_TYPE",
        message: "type must be teacher, classroom, course, or class",
      });
    }
    const result = releaseService.readActiveIndex(type, releaseVersion);
    if (!result.success) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      const code = result.code || result.reasonCode || "INDEX_NOT_FOUND";
      return res.status(code === "RELEASE_NOT_FOUND" ? 404 : 200).json(Object.assign({
        success: false,
        schemaVersion: 1,
        type,
        items: [],
        total: 0,
      }, result, { code, reasonCode: code }));
    }
    const payload = Object.assign({
      schemaVersion: 1,
      type,
      term: result.term || result.semester || req.query.term || "",
      releaseVersion: result.releaseVersion || result.version || releaseVersion,
      total: Array.isArray(result.items) ? result.items.length : 0,
    }, result);
    return sendReleasePackJson(req, res, payload, releaseVersion, 300);
  } catch (error) {
    handleRouteError(res, error, "get-release-pack-index-failed");
  }
});

router.get("/release-pack/detail/:type/:id", scheduleLimiter, (req, res) => {
  try {
    const type = String(req.params.type || "").trim();
    const id = String(req.params.id || "").trim();
    const releaseVersion = String(req.query.releaseVersion || req.query.version || "").trim();
    if (!["teacher", "classroom", "course", "class"].includes(type)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_TYPE",
        message: "type must be teacher, classroom, course, or class",
      });
    }
    const result = releaseService.readActiveSchedule(type, id, releaseVersion);
    if (!result.success) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      const code = result.code || result.reasonCode || "DETAIL_NOT_FOUND";
      return res.status(code === "NOT_FOUND" || code === "DETAIL_NOT_FOUND" || code === "RELEASE_NOT_FOUND" ? 404 : 200).json({
        success: false,
        schemaVersion: 1,
        code,
        reasonCode: code,
        type,
        id,
        releaseVersion: result.releaseVersion || result.version || releaseVersion,
        message: code,
      });
    }
    const normalized = normalizeScheduleResponse(type, result);
    const payload = Object.assign({
      schemaVersion: 1,
      type,
      id,
      detail: result.schedule || null,
      term: result.term || result.semester || req.query.term || "",
      releaseVersion: result.releaseVersion || result.version || releaseVersion,
    }, normalized);
    return sendReleasePackJson(req, res, payload, releaseVersion, 3600);
  } catch (error) {
    handleRouteError(res, error, "get-release-pack-detail-failed");
  }
});

router.get("/release-pack/empty-room", scheduleLimiter, (req, res) => {
  try {
    const releaseVersion = String(req.query.releaseVersion || req.query.version || "").trim();
    const result = releaseService.readEmptyRoomIndex(releaseVersion);
    if (!result.success) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      const code = result.code || result.reasonCode || "EMPTY_ROOM_INDEX_NOT_FOUND";
      return res.status(code === "RELEASE_NOT_FOUND" ? 404 : 200).json(Object.assign({
        success: false,
        schemaVersion: 1,
        rooms: [],
        buildings: [],
      }, result, { code, reasonCode: code }));
    }
    const payload = Object.assign({
      schemaVersion: result.schemaVersion || 1,
      releaseVersion: result.releaseVersion || result.version || releaseVersion,
      term: result.term || result.semester || req.query.term || "",
    }, result);
    return sendReleasePackJson(req, res, payload, releaseVersion, 3600);
  } catch (error) {
    handleRouteError(res, error, "get-release-pack-empty-room-failed");
  }
});

router.get("/bootstrap", async (req, res) => {
  const semester = req.query.semester;
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const data = await schoolCatalogService.getBootstrap(semester);
    if (data && data.success) {
      const activeVer = data.version || data.versions?.snapshot || "";
      const term = data.semester || "2025-2026-2";
      const dataUpdatedAt = data.updatedAt || (data.metaDetails && data.metaDetails.catalogUpdatedAt) || "";
      data.term = term;
      data.releaseVersion = activeVer;
      data.activeReleaseVersion = activeVer;
      data.publishedAt = dataUpdatedAt;
      data.dataUpdatedAt = dataUpdatedAt;
      data.cacheVersion = activeVer;
      data.cacheEpoch = new Date(dataUpdatedAt).getTime() || Date.now();
    }
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
    const releaseVersion = query.releaseVersion || query.version || "";
    if (!["teacher", "classroom", "course", "class"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be teacher, classroom, course, or class",
      });
    }
    const result = releaseService.searchActiveIndex(type, query.q, query);
    if (!result.success) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      const code = result.code || result.reasonCode || "INTERNAL_ERROR";
      return res.json({
        success: false,
        code,
        reasonCode: code,
        message: code,
        term: query.semester || query.term || "",
        releaseVersion: result.releaseVersion || result.version || releaseVersion || "",
        updatedAt: result.updatedAt || "",
        items: [],
        total: 0,
      });
    }
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

    // Standardized meta block
    const activeInfo = releaseService.getActiveReleaseInfo() || {};
    const meta = {
      term: result.semester || result.term || query.semester || activeInfo.term || "",
      releaseVersion: result.version || result.releaseVersion || activeInfo.releaseVersion || "",
      dataUpdatedAt: result.updatedAt || result.dataUpdatedAt || activeInfo.publishedAt || "",
      source: result.dataSource || "",
      counts: activeInfo.counts || {}
    };

    const payload = Object.assign({}, result, {
      term: meta.term,
      releaseVersion: meta.releaseVersion,
      updatedAt: meta.dataUpdatedAt,
      items,
      total: result.total || items.length,
      meta,
    });

    if (releaseVersion) {
      return sendCacheableJson(req, res, payload, 300); // 5 mins cache
    } else {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.json(payload);
    }
  } catch (error) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.status(200).json({
      success: false,
      code: error && error.code ? error.code : "INDEX_BUILD_FAILED",
      reasonCode: error && error.code ? error.code : "INDEX_BUILD_FAILED",
      message: "search-index failed",
      items: [],
      total: 0,
    });
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
    const releaseVersion = req.query.releaseVersion || req.query.version || "";
    if (!["teacher", "classroom", "course", "class"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be teacher, classroom, course, or class",
      });
    }
    if (!id) {
      return res.status(400).json({ success: false, message: "id is required" });
    }
    const result = normalizeScheduleResponse(type, releaseService.readActiveSchedule(type, id, releaseVersion));
    
    // Standardized meta block
    const activeInfo = releaseService.getActiveReleaseInfo() || {};
    const meta = {
      term: result.semester || result.term || req.query.term || activeInfo.term || "",
      releaseVersion: result.version || result.releaseVersion || activeInfo.releaseVersion || "",
      dataUpdatedAt: result.updatedAt || result.dataUpdatedAt || activeInfo.publishedAt || "",
      source: result.dataSource || "",
      counts: activeInfo.counts || {}
    };

    const payload = Object.assign({}, result, { meta });

    if (releaseVersion) {
      return sendCacheableJson(req, res, payload, 3600); // 1 hour cache
    } else {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.json(payload);
    }
  } catch (error) {
    handleRouteError(res, error, "get-schedule-detail-failed");
  }
});

router.get("/empty-classrooms", scheduleLimiter, (req, res) => {
  try {
    const releaseVersion = req.query.releaseVersion || req.query.version || "";
    const result = releaseService.queryEmptyClassrooms(req.query || {});
    if (!result.success) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.json(Object.assign({
        rooms: [],
        total: 0,
      }, result));
    }
    if (releaseVersion) {
      return sendCacheableJson(req, res, result, 600);
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.json(result);
  } catch (error) {
    handleRouteError(res, error, "get-empty-classrooms-failed");
  }
});

router.get("/client-diagnosis", scheduleLimiter, (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const activeInfo = releaseService.getActiveReleaseInfo() || {};
    const requestedReleaseVersion = String(req.query.releaseVersion || req.query.version || activeInfo.releaseVersion || activeInfo.version || "").trim();
    const term = String(req.query.term || req.query.semester || activeInfo.term || activeInfo.semester || "").trim();
    const kinds = ["class", "teacher", "classroom", "course"];
    const indexResults = {};
    const indexCounts = {};
    const cacheStatus = {};
    const indexExists = {};

    kinds.forEach((kind) => {
      const result = releaseService.readActiveIndex(kind, requestedReleaseVersion);
      indexResults[kind] = result;
      indexCounts[kind] = Array.isArray(result.items) ? result.items.length : 0;
      indexExists[kind] = Boolean(result.success);
      cacheStatus[kind] = result.success ? (result.dataSource || "index") : (result.code || result.reasonCode || "INDEX_NOT_FOUND");
    });

    const releaseCounts = activeInfo.counts || {};
    const fallbackIndex = indexResults.class || indexResults.teacher || indexResults.classroom || indexResults.course || {};
    const effectiveReleaseVersion = activeInfo.releaseVersion || activeInfo.version || fallbackIndex.releaseVersion || fallbackIndex.version || "";
    const effectiveTerm = term || activeInfo.term || activeInfo.semester || fallbackIndex.term || fallbackIndex.semester || "";
    const releasePack = effectiveReleaseVersion ? releaseService.getReleasePackStatus(effectiveReleaseVersion) : null;
    return res.json({
      success: true,
      activeReleaseVersion: effectiveReleaseVersion,
      activeTerm: activeInfo.term || activeInfo.semester || fallbackIndex.term || fallbackIndex.semester || "",
      term: effectiveTerm,
      requestedReleaseVersion,
      requestedTerm: term,
      indexExists,
      hasClassIndex: Boolean(indexResults.class && indexResults.class.success),
      hasTeacherIndex: Boolean(indexResults.teacher && indexResults.teacher.success),
      hasClassroomIndex: Boolean(indexResults.classroom && indexResults.classroom.success),
      hasCourseIndex: Boolean(indexResults.course && indexResults.course.success),
      counts: Object.assign({}, releaseCounts, { indexes: indexCounts }),
      releaseCounts,
      indexCounts,
      releasePack,
      releasePackHealthy: Boolean(releasePack && releasePack.healthy),
      serverTime: new Date().toISOString(),
      cacheStatus,
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "client diagnosis failed",
      serverTime: new Date().toISOString(),
    });
  }
});

module.exports = router;

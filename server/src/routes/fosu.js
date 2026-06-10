/**
 * 强智教务网相关 API 路由：定义从微信小程序请求的各教务接口。
 */

const express = require("express");
const router = express.Router();
const appConfigService = require("../services/appConfigService");
const schoolCatalogService = require("../services/schoolCatalogService");
const scheduleService = require("../services/scheduleService");
const releaseService = require("../services/releaseService");
const termRegistryService = require("../services/termRegistryService");
const runtimePointerService = require("../services/runtimePointerService");
const teachingCalendarService = require("../services/teachingCalendarService");
const { statJsonFile } = require("../utils/jsonFileStore");
const { scheduleLimiter } = require("../utils/rateLimit");
const { safeLog } = require("../utils/safeLogger");
const { createStaticAccessTicket } = require("../utils/staticAccessTicket");
const {
  ALLOWED_KEYS: CLIENT_CHECK_ALLOWED_KEYS,
  normalizeClientCheckPayload,
  recordClientCheckSuccess,
} = require("../services/clientCheckService");
const { recordSecurityEvent } = require("../services/securityEventService");
const { getSecurityMode } = require("../services/securityModeService");
const { routeSecurityPolicyMiddleware } = require("../security/routeSecurityPolicy");
const {
  bootstrapFosuSession,
  optionalSessionGuard,
  publicFosuGuard,
  validateJsonBody,
} = require("../utils/apiSecurity");

router.use(publicFosuGuard);
router.use(routeSecurityPolicyMiddleware);

const staticTicketCache = new Map();
const STATIC_TICKET_CACHE_MAX = Math.max(20, Number(process.env.FOSU_STATIC_TICKET_CACHE_MAX || 500) || 500);
const STATIC_TICKET_REUSE_SKEW_MS = 60 * 1000;

const scheduleQueryFields = [
  "semester",
  "term",
  "className",
  "keyword",
  "teacherName",
  "classroomName",
  "courseName",
  "releaseVersion",
  "version",
  "weekStart",
  "weekEnd",
  "sectionStart",
  "sectionEnd",
];

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

function shouldExposeRuntimeStats() {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" || process.env.FOSU_RUNTIME_STATS === "1";
}

function createRequestStats(route) {
  return {
    requestId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    route,
    startedAt: Date.now(),
    fileReadCount: 0,
    jsonParseCount: 0,
    payloadBytes: 0,
    cacheHit: false,
    source: "",
    releaseVersion: "",
    term: "",
  };
}

function finishRequestStats(req, res, stats, payload) {
  if (!stats || !shouldExposeRuntimeStats()) return;
  stats.totalMs = Date.now() - stats.startedAt;
  stats.payloadBytes = Buffer.byteLength(JSON.stringify(payload || {}), "utf-8");
  delete stats.startedAt;
  res.setHeader("X-Fosu-Request-Stats", JSON.stringify(stats));
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
  const fallbackActiveTerm = termRegistryService.getActiveTerm();
  const term = active.term || active.semester || data.currentSemester || data.term || fallbackActiveTerm && fallbackActiveTerm.term || "";
  return {
    term,
    releaseVersion,
    activeReleaseVersion: releaseVersion,
    updatedAt,
    publishedAt: updatedAt,
    cacheEpoch: active.cacheEpoch || new Date(updatedAt).getTime() || Date.now(),
    forceRefreshToken: active.forceRefreshToken || "",
    packStatus: active.releasePack || active.packStatus || {},
    minClientCacheSchema: 5,
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
    clientCheck: "/api/fosu/security/client-check",
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
      const fallbackActiveTerm = termRegistryService.getActiveTerm();
      const term = rawConfig.data.currentSemester || fallbackActiveTerm && fallbackActiveTerm.term || "";
      const dataUpdatedAt = rawConfig.data.dataVersion?.classScheduleUpdatedAt || rawConfig.data.updatedAt || "";
      rawConfig.data.term = term;
      rawConfig.data.releaseVersion = activeVer;
      rawConfig.data.activeReleaseVersion = activeVer;
      rawConfig.data.publishedAt = dataUpdatedAt;
      rawConfig.data.dataUpdatedAt = dataUpdatedAt;
      rawConfig.data.cacheVersion = activeVer;
      const activeInfo = releaseService.getActiveReleaseInfo() || {};
      rawConfig.data.cacheEpoch = rawConfig.data.cacheEpoch || activeInfo.cacheEpoch || new Date(dataUpdatedAt).getTime() || Date.now();
      rawConfig.data.forceRefreshToken = activeInfo.forceRefreshToken || "";
      rawConfig.data.packStatus = activeInfo.releasePack || activeInfo.packStatus || {};
      rawConfig.data.minClientCacheSchema = 5;
      rawConfig.data.counts = activeInfo.counts || {};
      const manifest = activeVer ? releaseService.getReleasePackManifest(activeVer) : null;
      if (manifest && manifest.success) {
        rawConfig.data.staticBasePath = manifest.staticBasePath;
        rawConfig.data.staticBaseUrl = manifest.staticBaseUrl;
        rawConfig.data.staticReleaseUrl = manifest.staticReleaseUrl;
        rawConfig.data.indexUrls = manifest.indexUrls;
        rawConfig.data.emptyRoomUrl = manifest.emptyRoomUrl;
        rawConfig.data.detailUrlPattern = manifest.detailUrlPattern;
        rawConfig.data.shards = manifest.shards;
      }
    }
    if (rawConfig && rawConfig.data && rawConfig.data.etag) {
      res.setHeader("ETag", rawConfig.data.etag);
      if (req.headers["if-none-match"] === rawConfig.data.etag) {
        return res.status(304).end();
      }
    }
    res.json(rawConfig);
  } catch (error) {
    handleRouteError(res, error, "get-app-config-failed");
  }
});

router.get("/terms", (req, res) => {
  try {
    const registry = termRegistryService.readRegistry();
    const payload = {
      success: true,
      activeTerm: registry && registry.activeTerm || "",
      availableTerms: termRegistryService.getPublicTerms(),
      updatedAt: registry && registry.updatedAt || "",
      cacheEpoch: registry && registry.updatedAt ? new Date(registry.updatedAt).getTime() : Date.now(),
      etag: termRegistryService.getRegistryEtag(registry),
    };
    return sendCacheableJson(req, res, payload, 60);
  } catch (error) {
    handleRouteError(res, error, "get-terms-failed");
  }
});

router.post("/session/bootstrap", scheduleLimiter, validateJsonBody(["code"]), async (req, res) => {
  try {
    const session = await bootstrapFosuSession(req.body && req.body.code);
    recordSecurityEvent("security-session-bootstrap-success", {
      route: req.path,
      method: req.method,
      mode: session.securityMode,
      anonymizedIp: req.clientIpInfo && req.clientIpInfo.anonymizedIp,
      openidHashPrefix: session.payload && session.payload.openidHash,
      sessionIdPrefix: session.payload && session.payload.sessionIdHash,
    });
    return res.json({
      success: true,
      sessionToken: session.sessionToken,
      expiresIn: session.expiresIn,
      expiresAt: session.expiresAt,
      securityMode: session.securityMode,
      staticAccessMode: session.staticAccessMode,
      serverTime: session.serverTime,
    });
  } catch (error) {
    recordSecurityEvent("security-session-bootstrap-failed", {
      route: req.path,
      method: req.method,
      mode: getSecurityMode().mode,
      anonymizedIp: req.clientIpInfo && req.clientIpInfo.anonymizedIp,
      reasonCode: error.code || error.message,
    });
    safeLog("fosu-session-bootstrap-failed", {
      code: error.code || error.message,
      statusCode: error.statusCode || 500,
    });
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.message || "SESSION_BOOTSTRAP_FAILED",
      message: "小程序会话初始化失败。",
    });
  }
});

function cleanupStaticTicketCache() {
  const now = Date.now();
  for (const [key, value] of staticTicketCache.entries()) {
    if (!value || Number(value.expiresAtMs || 0) <= now + STATIC_TICKET_REUSE_SKEW_MS) {
      staticTicketCache.delete(key);
    }
  }
  if (staticTicketCache.size <= STATIC_TICKET_CACHE_MAX) return;
  Array.from(staticTicketCache.entries())
    .sort((left, right) => Number(left[1].expiresAtMs || 0) - Number(right[1].expiresAtMs || 0))
    .slice(0, staticTicketCache.size - STATIC_TICKET_CACHE_MAX)
    .forEach(([key]) => staticTicketCache.delete(key));
}

function getAllowedStaticTicketReleases() {
  const active = releaseService.getActiveReleaseInfo() || {};
  const allowed = new Set([active.releaseVersion, active.version].filter(Boolean));
  releaseService.listReleases(3).forEach((item) => {
    if (item && item.releaseVersion) allowed.add(item.releaseVersion);
    if (item && item.version) allowed.add(item.version);
  });
  return allowed;
}

router.post("/static-access/bootstrap", validateJsonBody(["releaseVersion"]), (req, res) => {
  const security = getSecurityMode();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (security.staticAccessMode !== "ticket" && !security.requireStaticTicket) {
    return res.json({
      success: true,
      mode: security.staticAccessMode,
      releaseVersion: String(req.body && req.body.releaseVersion || ""),
      ticket: "",
      expiresAt: "",
      pathPrefix: "",
      headerName: "X-Fosu-Static-Ticket",
      serverTime: new Date().toISOString(),
    });
  }

  if (!req.fosuSession) {
    return res.status(401).json({
      success: false,
      code: "FOSU_SESSION_REQUIRED",
      reasonCode: "FOSU_SESSION_REQUIRED",
      message: "会话已过期，请重新进入小程序。",
    });
  }

  const releaseVersion = String(req.body && req.body.releaseVersion || "").trim();
  const allowedReleases = getAllowedStaticTicketReleases();
  if (!releaseVersion || !allowedReleases.has(releaseVersion)) {
    return res.status(403).json({
      success: false,
      code: "STATIC_TICKET_RELEASE_NOT_ALLOWED",
      reasonCode: "STATIC_TICKET_RELEASE_NOT_ALLOWED",
      message: "Release 版本不可签发访问票据。",
    });
  }

  cleanupStaticTicketCache();
  const sessionKey = req.fosuSession.sessionIdHash || req.fosuSession.openidHash || "anonymous";
  const cacheKey = `${sessionKey}:${releaseVersion}`;
  const cached = staticTicketCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + STATIC_TICKET_REUSE_SKEW_MS) {
    return res.json(cached.response);
  }

  try {
    const ttlSeconds = Number(process.env.FOSU_STATIC_TICKET_TTL_SECONDS || 600) || 600;
    const pathPrefix = `/static/releases/${releaseVersion}/`;
    const ticket = createStaticAccessTicket({ releaseVersion, pathPrefix, ttlSeconds });
    const expiresAtMs = Date.now() + Math.min(ttlSeconds, 900) * 1000;
    const response = {
      success: true,
      mode: "ticket",
      releaseVersion,
      ticket,
      expiresAt: new Date(expiresAtMs).toISOString(),
      pathPrefix,
      headerName: "X-Fosu-Static-Ticket",
      serverTime: new Date().toISOString(),
    };
    staticTicketCache.set(cacheKey, { expiresAtMs, response });
    recordSecurityEvent("security-static-ticket-issued", {
      route: req.path,
      method: req.method,
      mode: security.mode,
      anonymizedIp: req.clientIpInfo && req.clientIpInfo.anonymizedIp,
      openidHashPrefix: req.fosuSession.openidHash,
      sessionIdPrefix: req.fosuSession.sessionIdHash,
    });
    return res.json(response);
  } catch (error) {
    recordSecurityEvent("security-config-invalid", {
      route: req.path,
      method: req.method,
      mode: security.mode,
      anonymizedIp: req.clientIpInfo && req.clientIpInfo.anonymizedIp,
      reasonCode: error.code || "STATIC_TICKET_ISSUE_FAILED",
    });
    return res.status(error.statusCode || 503).json({
      success: false,
      code: error.code || "STATIC_TICKET_ISSUE_FAILED",
      reasonCode: error.code || "STATIC_TICKET_ISSUE_FAILED",
      message: "静态访问票据签发失败。",
    });
  }
});

router.post("/security/client-check", validateJsonBody(CLIENT_CHECK_ALLOWED_KEYS), (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (!req.fosuSession) {
    recordSecurityEvent("security-client-check-failed", {
      route: req.path,
      method: req.method,
      mode: getSecurityMode().mode,
      anonymizedIp: req.clientIpInfo && req.clientIpInfo.anonymizedIp,
      reasonCode: req.fosuSessionWarning || "FOSU_SESSION_REQUIRED",
    });
    return res.status(401).json({
      success: false,
      code: "FOSU_SESSION_REQUIRED",
      reasonCode: req.fosuSessionWarning || "FOSU_SESSION_REQUIRED",
      message: "客户端安全握手需要有效 Session。",
    });
  }

  let payload;
  try {
    payload = normalizeClientCheckPayload(req.body || {});
  } catch (error) {
    recordSecurityEvent("security-client-check-failed", {
      route: req.path,
      method: req.method,
      mode: getSecurityMode().mode,
      anonymizedIp: req.clientIpInfo && req.clientIpInfo.anonymizedIp,
      reasonCode: error.code || "CLIENT_CHECK_INVALID_PAYLOAD",
    });
    return res.status(error.statusCode || 400).json({
      success: false,
      code: error.code || "CLIENT_CHECK_INVALID_PAYLOAD",
      reasonCode: error.code || "CLIENT_CHECK_INVALID_PAYLOAD",
      message: "客户端安全握手上报字段不合法。",
      fields: error.fields || [],
    });
  }

  if (payload.sessionHeaderAttached !== true) {
    recordSecurityEvent("security-client-check-failed", {
      route: req.path,
      method: req.method,
      mode: payload.securityMode,
      anonymizedIp: req.clientIpInfo && req.clientIpInfo.anonymizedIp,
      openidHashPrefix: req.fosuSession.openidHash,
      sessionIdPrefix: req.fosuSession.sessionIdHash,
      reasonCode: "CLIENT_SESSION_HEADER_NOT_ATTACHED",
    });
    return res.status(400).json({
      success: false,
      code: "CLIENT_SESSION_HEADER_NOT_ATTACHED",
      reasonCode: "CLIENT_SESSION_HEADER_NOT_ATTACHED",
      message: "客户端尚未证明受保护 API 已携带 Session Header。",
    });
  }

  recordClientCheckSuccess(req, payload);
  return res.json({
    success: true,
    accepted: true,
    serverTime: new Date().toISOString(),
  });
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
  const stats = createRequestStats("/api/fosu/periodic-data");
  try {
    const hasVersion = Boolean(req.query.releaseVersion || req.query.version);
    if (hasVersion) {
      res.setHeader("Cache-Control", "public, max-age=300");
    } else {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    let pointer = null;
    try {
      pointer = runtimePointerService.ensureActivePointer();
    } catch (error) {
      pointer = runtimePointerService.readActivePointer();
    }
    if (pointer) {
      stats.fileReadCount += 1;
      stats.jsonParseCount += 1;
      stats.cacheHit = true;
    }
    const activeSnapshot = getActivePlatformSnapshot(req);
    const releaseVersion = req.query.releaseVersion || req.query.version || (pointer && pointer.releaseVersion) || activeSnapshot.releaseVersion;
    const manifest = releaseVersion ? releaseService.getReleasePackManifest(releaseVersion, req.query) : null;
    stats.fileReadCount += releaseVersion ? 1 : 0;
    stats.jsonParseCount += releaseVersion ? 1 : 0;
    const counts = Object.assign({}, manifest && manifest.counts || {}, activeSnapshot.counts || {});
    const indexCounts = manifest && manifest.pack && manifest.pack.index || {};
    const emptyRoomHealth = manifest && manifest.packHealth && manifest.packHealth.emptyRoom || {};
    const indexMeta = {
      class: { success: Boolean(indexCounts.class || counts.classScheduleCount), count: Number(indexCounts.class || counts.classScheduleCount || counts.classSchedulesCount || 0) || 0, code: "" },
      teacher: { success: Boolean(indexCounts.teacher || counts.teacherScheduleCount), count: Number(indexCounts.teacher || counts.teacherScheduleCount || 0) || 0, code: "" },
      classroom: { success: Boolean(indexCounts.classroom || counts.classroomScheduleCount), count: Number(indexCounts.classroom || counts.classroomScheduleCount || 0) || 0, code: "" },
      course: { success: Boolean(indexCounts.course || counts.courseScheduleCount), count: Number(indexCounts.course || counts.courseScheduleCount || 0) || 0, code: "" },
      emptyRoom: {
        success: Boolean(emptyRoomHealth.classroomCount || manifest && manifest.emptyRoomUrl),
        count: Number(emptyRoomHealth.classroomCount || 0) || 0,
        buildings: [],
        buildingCount: Number(emptyRoomHealth.buildingCount || 0) || 0,
        code: "",
      },
    };
    const etag = manifest && manifest.etag || `"periodic-${releaseVersion || "none"}-${activeSnapshot.cacheEpoch || 0}"`;
    res.setHeader("ETag", etag);
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }
    const payload = {
      success: true,
      activeSnapshot,
      manifest: {
        term: pointer && pointer.activeTerm || activeSnapshot.term,
        releaseVersion: releaseVersion || activeSnapshot.releaseVersion,
        updatedAt: manifest && manifest.updatedAt || activeSnapshot.updatedAt,
        cacheEpoch: pointer && pointer.cacheEpoch || activeSnapshot.cacheEpoch,
        counts,
      },
      releases: releaseService.listReleases(5),
      indexes: indexMeta,
      urls: buildPlatformUrls(activeSnapshot),
      serverTime: new Date().toISOString(),
    };
    stats.source = pointer ? "runtime-pointer+manifest" : "manifest";
    stats.releaseVersion = payload.manifest.releaseVersion;
    stats.term = payload.manifest.term;
    finishRequestStats(req, res, stats, payload);
    return res.json(payload);
  } catch (error) {
    handleRouteError(res, error, "get-periodic-data-failed");
  }
});

router.get("/runtime/active", (req, res) => {
  const stats = createRequestStats("/api/fosu/runtime/active");
  try {
    const pointer = runtimePointerService.ensureActivePointer();
    if (!pointer) {
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: false, code: "ACTIVE_RUNTIME_POINTER_MISSING" });
    }
    const fileStats = runtimePointerService.getActivePointerStats();
    if (fileStats) {
      res.setHeader("ETag", fileStats.etag);
      res.setHeader("Last-Modified", fileStats.lastModified);
      if (req.headers["if-none-match"] === fileStats.etag) return res.status(304).end();
    }
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    stats.fileReadCount = 1;
    stats.jsonParseCount = 1;
    stats.cacheHit = true;
    stats.source = pointer.source || "runtime-pointer";
    stats.releaseVersion = pointer.releaseVersion;
    stats.term = pointer.activeTerm;
    finishRequestStats(req, res, stats, pointer);
    return res.json(pointer);
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      success: false,
      code: error.code || "ACTIVE_RUNTIME_POINTER_UNAVAILABLE",
      reasonCode: error.code || "ACTIVE_RUNTIME_POINTER_UNAVAILABLE",
      message: "runtime pointer 暂不可用，请检查 active release 与 term registry。",
    });
  }
});

router.get("/teaching-calendar", (req, res) => {
  const stats = createRequestStats("/api/fosu/teaching-calendar");
  try {
    const active = releaseService.getActiveReleaseInfo() || {};
    const term = String(req.query.term || req.query.semester || active.term || active.semester || "").trim();
    const releaseVersion = String(req.query.releaseVersion || req.query.version || active.releaseVersion || active.version || "").trim();
    let calendar = releaseVersion ? teachingCalendarService.readReleaseCalendar(releaseVersion) : null;
    if (calendar && term && calendar.term !== term) {
      return res.status(409).json({
        success: false,
        code: "CALENDAR_TERM_MISMATCH",
        term,
        calendarTerm: calendar.term,
      });
    }
    if (!calendar && term) {
      calendar = teachingCalendarService.readTermCalendar(term);
    }
    if (!calendar) {
      return res.status(404).json({ success: false, code: "CALENDAR_NOT_FOUND" });
    }
    const payload = Object.assign({}, calendar, {
      releaseVersion: calendar.releaseVersion || releaseVersion,
    });
    const etag = `"calendar-${payload.term}-${payload.releaseVersion || "none"}-${new Date(payload.updatedAt || 0).getTime() || 0}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", payload.releaseVersion ? "public, max-age=300" : "public, max-age=60");
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    stats.fileReadCount = 1;
    stats.jsonParseCount = 1;
    stats.cacheHit = true;
    stats.source = calendar.source || "";
    stats.releaseVersion = payload.releaseVersion || "";
    stats.term = payload.term || "";
    finishRequestStats(req, res, stats, payload);
    return res.json(payload);
  } catch (error) {
    handleRouteError(res, error, "get-teaching-calendar-failed");
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
    const manifest = releaseService.getReleasePackManifest(releaseVersion, req.query);
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
    const shard = String(req.query.shard || "").replace(/^\/+/, "");
    const result = releaseService.readReleasePackStaticIndex(type, releaseVersion, shard, req.query) ||
      releaseService.readActiveIndex(type, releaseVersion, req.query);
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
    const result = releaseService.readReleasePackStaticDetail(type, id, releaseVersion, req.query) ||
      releaseService.readActiveSchedule(type, id, releaseVersion, req.query);
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
    const result = releaseService.readReleasePackStaticEmptyRoom(releaseVersion, req.query) ||
      releaseService.readEmptyRoomIndex(releaseVersion, req.query);
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
  const semester = req.query.term || req.query.semester;
  const stats = createRequestStats("/api/fosu/bootstrap");
  try {
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    const data = await schoolCatalogService.getBootstrap(semester);
    if (data && data.success) {
      const activeVer = data.version || data.versions?.snapshot || "";
      const term = data.term || data.semester || "";
      const dataUpdatedAt = data.updatedAt || (data.metaDetails && data.metaDetails.catalogUpdatedAt) || "";
      data.term = term;
      data.releaseVersion = activeVer;
      data.activeReleaseVersion = activeVer;
      data.publishedAt = dataUpdatedAt;
      data.dataUpdatedAt = dataUpdatedAt;
      data.cacheVersion = activeVer;
      const activeInfo = releaseService.getActiveReleaseInfo() || {};
      data.cacheEpoch = activeInfo.cacheEpoch || new Date(dataUpdatedAt).getTime() || Date.now();
      data.forceRefreshToken = activeInfo.forceRefreshToken || "";
      data.packStatus = activeInfo.releasePack || activeInfo.packStatus || {};
      data.minClientCacheSchema = 5;
      const etag = `"bootstrap-${data.term || ""}-${data.releaseVersion || data.version || ""}-${new Date(data.updatedAt || 0).getTime() || 0}"`;
      res.setHeader("ETag", etag);
      if (req.headers["if-none-match"] === etag) return res.status(304).end();
      stats.fileReadCount = data.dataSource === "snapshot-fallback" ? 1 : 2;
      stats.jsonParseCount = stats.fileReadCount;
      stats.cacheHit = data.dataSource !== "snapshot-fallback";
      stats.source = data.dataSource || "";
      stats.releaseVersion = data.releaseVersion || data.version || "";
      stats.term = data.term || data.semester || "";
    }
    finishRequestStats(req, res, stats, data);
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
  const semester = req.query.term || req.query.semester;
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
    const data = await schoolCatalogService.getMajors(collegeCode, grade, req.query.term || req.query.semester);
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
router.post("/class-schedule", scheduleLimiter, validateJsonBody(scheduleQueryFields), handleClassScheduleRequest);

/**
 * 4. 获取教师课表
 * POST /api/fosu/teacher-schedule
 */
router.post("/teacher-schedule", scheduleLimiter, validateJsonBody(scheduleQueryFields), async (req, res) => {
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
router.post("/classroom-schedule", scheduleLimiter, validateJsonBody(scheduleQueryFields), async (req, res) => {
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
router.post("/course-schedule", scheduleLimiter, validateJsonBody(scheduleQueryFields), async (req, res) => {
  try {
    const data = await scheduleService.getCourseSchedule(req.body);
    res.json(data);
  } catch (error) {
    handleRouteError(res, error, "get-course-schedule-failed");
  }
});

router.get("/schedule/class/:id", scheduleLimiter, (req, res) => {
  try {
    const result = normalizeScheduleResponse("class", releaseService.readActiveSchedule("class", req.params.id, req.query.releaseVersion || req.query.version || "", req.query));
    return sendCacheableJson(req, res, result, 300);
  } catch (error) {
    handleRouteError(res, error, "get-indexed-class-schedule-failed");
  }
});

router.get("/schedule/teacher/:id", scheduleLimiter, (req, res) => {
  try {
    const result = normalizeScheduleResponse("teacher", releaseService.readActiveSchedule("teacher", req.params.id, req.query.releaseVersion || req.query.version || "", req.query));
    return sendCacheableJson(req, res, result, 300);
  } catch (error) {
    handleRouteError(res, error, "get-indexed-teacher-schedule-failed");
  }
});

router.get("/schedule/classroom/:id", scheduleLimiter, (req, res) => {
  try {
    const result = normalizeScheduleResponse("classroom", releaseService.readActiveSchedule("classroom", req.params.id, req.query.releaseVersion || req.query.version || "", req.query));
    return sendCacheableJson(req, res, result, 300);
  } catch (error) {
    handleRouteError(res, error, "get-indexed-classroom-schedule-failed");
  }
});

router.get("/schedule/course/:id", scheduleLimiter, (req, res) => {
  try {
    const result = normalizeScheduleResponse("course", releaseService.readActiveSchedule("course", req.params.id, req.query.releaseVersion || req.query.version || "", req.query));
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
    const result = normalizeScheduleResponse(type, releaseService.readActiveSchedule(type, id, releaseVersion, req.query));
    
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
    const releasePack = effectiveReleaseVersion ? releaseService.getReleasePackQuickHealth(effectiveReleaseVersion) : null;
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

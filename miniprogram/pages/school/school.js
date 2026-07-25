const BRAND = require("../../config/brand");
const classroomSearch = require("../../utils/classroomSearch");

const tabs = [
  { key: "class", label: "班级" },
  { key: "teacher", label: "教师" },
  { key: "classroom", label: "教室" },
  { key: "course", label: "课程" },
];

const TEACHER_SEARCH_PLACEHOLDER = "搜索教师姓名（例如：张三）";
const CLASSROOM_SEARCH_PLACEHOLDER = "搜索教室（例如：C7-305）";
const COURSE_SEARCH_PLACEHOLDER = "搜索课程（例如：有机化学）";
const CLASS_SEARCH_PLACEHOLDER = "搜索班级（例如：25动物科学3班）";
const DEFAULT_TERM = "";
const SCHEDULE_DETAIL_CACHE_TTL = 6 * 60 * 60 * 1000;
const APP_CONFIG_TIMEOUT = 12000;
const BOOTSTRAP_TIMEOUT = 20000;
const SCHOOL_REQUEST_TIMEOUT = 25000;
const SCHOOL_RESULT_PAGE_SIZE = 20;
const SCHOOL_RESULT_PAGE_STEP = 20;
const SCHOOL_KEYWORD_DEBOUNCE_MS = 300;
const AI_PENDING_SCHOOL_QUERY_KEY = "FOSU_AI_PENDING_SCHOOL_QUERY";
const FOSU_RELEASE_NOTICE_STATE_KEY = "FOSU_RELEASE_NOTICE_STATE";
const SCHOOL_BACKGROUND_REFRESH_MIN_INTERVAL_MS = 45 * 1000;

const request = require("../../utils/request");
const appConfigService = require("../../services/appConfigService");
const platformDataService = require("../../services/platformDataService");
const releasePackService = require("../../services/releasePackService");
const startupCoordinator = require("../../services/startupCoordinator");
const platformUtils = require("../../utils/platform");
const {
  SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY,
  getRecentSchedules,
  addRecentSchedule,
  removeRecentSchedule,
  clearRecentSchedules,
  clearAllSchoolCaches,
  clearLegacyTeacherIndexCaches,
  getSchoolCatalogCacheKey,
  getSchoolFilterCacheKey,
  getSchoolIndexCacheKey,
  getScheduleDetailCacheKey,
  readSameVersionIndexCache,
  writeSameVersionIndexCache,
} = require("../../utils/storage");

function formatUpdateTime(updatedAt) {
  const date = updatedAt ? new Date(updatedAt) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function safeDecodeURIComponent(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function getFallbackTerm() {
  const config = appConfigService.getGlobalConfig && appConfigService.getGlobalConfig() || {};
  return config.currentSemester ||
    config.term ||
    config.termConfig && config.termConfig.term ||
    DEFAULT_TERM;
}

function getReleaseContentKey(snapshot) {
  const active = snapshot || {};
  return [
    active.term || DEFAULT_TERM,
    active.releaseVersion || "",
  ].join(":");
}

function getReleaseInvalidationKey(snapshot) {
  const active = snapshot || {};
  return [
    active.term || DEFAULT_TERM,
    active.releaseVersion || "",
    active.cacheEpoch || "",
    active.forceRefreshToken || "",
  ].join(":");
}

function normalizeStoredReleaseKey(key) {
  const parts = String(key || "").split(":");
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return String(key || "");
}

function readReleaseNoticeState() {
  try {
    return wx.getStorageSync(FOSU_RELEASE_NOTICE_STATE_KEY) || {};
  } catch (error) {
    return {};
  }
}

function writeReleaseNoticeState(patch) {
  try {
    wx.setStorageSync(FOSU_RELEASE_NOTICE_STATE_KEY, Object.assign({}, readReleaseNoticeState(), patch || {}));
  } catch (error) {
    // ignore
  }
}

function isValidClassName(name) {
  if (!name) return false;
  const excludeKeywords = ['体育', '化学', '解剖', '微积分', '物理', '英语', '毛泽东', '马克思', '形势与政策', '创业', '心理', '美育', '军事', '劳动', '思想道德', '大学', '程序设计', '基础', '俱乐部', '指导'];
  for (const kw of excludeKeywords) {
    if (name.includes(kw)) return false;
  }
  const reg = /\d/;
  if (!reg.test(name)) return false;
  return true;
}

function formatClassResultItem(item) {
  const source = item || {};
  const isAggregated = Boolean(source.isAggregated || source.displayType === "major-schedule" || source.displayType === "major-shared-schedule");
  const rawClassName = source.className || source.name || "";
  const className = safeDecodeURIComponent(rawClassName);
  const courseCount = Number(source.courseCount || source.count || (Array.isArray(source.courses) ? source.courses.length : 0)) || 0;
  return Object.assign({}, source, {
    detailId: source.detailId || source.id || source.classId || className,
    scheduleKey: `${source.semester || ""}-${source.collegeCode || ""}-${source.grade || ""}-${source.majorCode || ""}-${className}`,
    displayTitle: className,
    displaySubtitle: `${source.majorName || "未知专业"} · ${source.grade || ""}级 · ${courseCount}门课`,
    statusText: isAggregated ? "专业聚合" : "行政班",
    isAggregated,
    courses: Array.isArray(source.courses) ? source.courses : [],
  });
}

function splitClassResultGroups(items) {
  const list = (items || [])
    .map(formatClassResultItem)
    .filter(item => item.isAggregated || isValidClassName(item.className));
  
  const admin = list.filter((item) => !item.isAggregated);
  
  const activeAdminMajorGrades = new Set(admin.map(item => `${item.majorCode}_${item.grade}`));
  const aggregate = list.filter((item) => item.isAggregated && !activeAdminMajorGrades.has(`${item.majorCode}_${item.grade}`));

  return {
    list,
    admin,
    aggregate,
    noticeText: !admin.length && aggregate.length
      ? "暂未拆出行政班，已展示该专业完整排课。"
      : "",
  };
}

function getClassEmptyState(reasonCode) {
  if (reasonCode === "NO_SCHEDULE_SYNCED" || reasonCode === "NO_SYNC_DATA") {
    return {
      title: "暂未同步该专业课表",
      desc: "暂未同步该专业课表，可稍后再试或联系维护者补充同步。",
    };
  }

  if (reasonCode === "NO_MATCHED_CLASS") {
    return {
      title: "没有匹配到班级",
      desc: "已同步该专业课表，但没有匹配到所选班级。",
    };
  }

  if (reasonCode === "INVALID_FILTER") {
    return {
      title: "请选择完整筛选项",
      desc: "请选择学院、年级和专业后再查询班级课表。",
    };
  }

  return {
    title: "请选择上方筛选并查询",
    desc: "查询后将展示行政班级课表，结果仅供参考。",
  };
}

function normalizeIndexedScheduleItem(type, item, version) {
  const source = item || {};
  const name = source.name || source.teacherName || source.displayName || source.title || source.roomName || source.classroomName || source.courseName || "";
  const courseCount = Number(source.courseCount || source.count || (Array.isArray(source.courses) ? source.courses.length : 0)) || 0;
  const common = Object.assign({}, source, {
    detailId: source.id || name,
    scheduleVersion: version || source.version || "",
    courses: Array.isArray(source.courses) ? source.courses : [],
    courseCount,
    hasDetail: source.hasDetail !== false,
    detailHint: source.hasDetail === false && courseCount > 0 ? "课程数据可用，详情待补齐" : "",
  });
  if (type === "teacher") {
    return Object.assign(common, {
      teacherName: source.teacherName || source.name || source.displayName || source.title || name,
      displayName: source.displayName || source.teacherName || source.name || source.title || name,
      title: source.title || source.teacherTitle || source.professionalTitle || "",
      college: source.college || source.collegeName || "教师课表",
    });
  }
  if (type === "classroom") {
    return Object.assign(common, {
      roomName: source.roomName || source.classroomName || name,
    });
  }
  return Object.assign(common, {
    courseName: source.courseName || source.displayCourseName || source.canonicalCourseName || name,
  });
}

Page({
  data: {
    brand: BRAND,
    tabs,
    activeTab: "class",
    keyword: "",
    showAggregate: false,
    
    // 搜索框占位符
    TEACHER_SEARCH_PLACEHOLDER,
    CLASSROOM_SEARCH_PLACEHOLDER,
    COURSE_SEARCH_PLACEHOLDER,
    CLASS_SEARCH_PLACEHOLDER,
    
    // 下拉选择选项
    semesters: [],
    colleges: [],
    grades: [],
    majors: [],
    
    selectedSemesterIndex: 0,
    selectedCollegeIndex: -1,
    selectedGradeIndex: -1,
    selectedMajorIndex: -1,
    
    // 班级筛选项
    classesOptions: [],
    selectedClassIndex: -1,
    
    // 教师筛选项（无可靠职称数据时 titleFilterEnabled=false，隐藏无效控件）
    titleOptions: ["正高级", "副高级", "中级", "助理级", "员级", "其他"],
    selectedTitleIndex: -1,
    titleFilterEnabled: false,
    
    // 教室/课程筛选项
    campusOptions: ["仙溪校区", "江湾校区", "河滨校区"],
    selectedCampusIndex: -1,
    
    // 查询得到的结果列表
    classesResult: [],
    classAdminResults: [],
    classAggregateResults: [],
    teachersResult: [],
    teacherHitCount: 0,
    teacherDataSourceText: "",
    teacherDiagnosticText: "",
    classroomsResult: [],
    coursesResult: [],
    classAdminTotal: 0,
    classAggregateTotal: 0,
    classroomsTotal: 0,
    coursesTotal: 0,
    classroomEmptyTitle: "输入教室名称并查询",
    classroomEmptyDesc: "例如输入 C7-305 或 C7，即可获取教室的周课表安排。",
    classroomQueryType: "",
    classroomMapReturn: null,
    hasMoreClassAdmin: false,
    hasMoreClassAggregate: false,
    hasMoreTeachers: false,
    hasMoreClassrooms: false,
    hasMoreCourses: false,
    
    loading: false,
    updatedAtText: "",
    dataSourceText: "课程数据",
    catalogEmpty: false,
    classEmptyTitle: "请选择上方筛选并查询",
    classEmptyDesc: "查询后将展示行政班级课表，结果仅供参考。",
    classNoticeText: "",
    restoreHint: "",
    catalogVersion: "",
    catalogUpdatedAt: "",
    appConfig: { notices: [] },
    schoolNotice: null,
    activeSnapshot: null,
    dataVersionText: "",
    runtimeDisclaimer: BRAND.disclaimer,
    recentSchedules: [],
    openedRecentKey: "",
    touchStartX: 0,
    touchStartY: 0,
    dataLoadState: "loading",
    loadingState: "none",
    loadMoreState: "idle",
    loadMoreText: "",
  },
  
  // 缓存清理后自动重载标志
  needAutoSearch: false,
  isFirstLoad: true,

  onLoad(options) {
    this.sharedQuery = options || {};
    this._pendingDirectSchoolQuery = this.normalizeDirectSchoolQuery(options || {});
    this.isFirstLoad = false;
    this._schoolRequestSeq = 0;
    this._activeInitSeq = 0;
    this._lastInitAt = 0;
    this.resetPagedResultStore();
    this._lastSchoolMapQuery = this.buildMapReturnFromOptions(options || {});
    // Drop poisoned teacher full-index caches (filtered search hits written as full index).
    try {
      if (typeof clearLegacyTeacherIndexCaches === "function") clearLegacyTeacherIndexCaches();
    } catch (e) { /* ignore */ }
    this.initPageData({ reason: "onLoad" });
  },

  onUnload() {
    if (this.keywordSearchTimer) {
      clearTimeout(this.keywordSearchTimer);
      this.keywordSearchTimer = null;
    }
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    this._schoolRequestSeq += 1;
    this._activeInitSeq += 1;
    this._loadMoreBusy = false;
  },

  onShow() {
    // 拦截设置页清除缓存引发的重载标志
    const needAutoReload = wx.getStorageSync("FOSU_SCHOOL_NEED_AUTO_RELOAD");
    if (needAutoReload) {
      wx.removeStorageSync("FOSU_SCHOOL_NEED_AUTO_RELOAD");
      this.resetPagedResultStore();
      this.setData({
        classesResult: [],
        classAdminResults: [],
        classAggregateResults: [],
        teachersResult: [],
        teacherHitCount: 0,
        classroomsResult: [],
        coursesResult: [],
        classAdminTotal: 0,
        classAggregateTotal: 0,
        classroomsTotal: 0,
        coursesTotal: 0,
        hasMoreClassAdmin: false,
        hasMoreClassAggregate: false,
        hasMoreTeachers: false,
        hasMoreClassrooms: false,
        hasMoreCourses: false,
        updatedAtText: "",
      });
      this.isFirstLoad = false;
      this.initPageData({ reason: "autoReload", forceNetwork: true });
      return;
    }

    const { getSettings } = require("../../utils/storage");
    const settings = getSettings();
    const showHistorical = settings.showHistoricalGrades || false;

    if (this.originalCatalogData && this.lastShowHistoricalGrades !== showHistorical) {
      this.lastShowHistoricalGrades = showHistorical;
      this.applyCatalogFilter();
    }
    this.loadRecentSchedules();

    const aiPendingQuery = this.consumeAiPendingSchoolQuery();
    if (aiPendingQuery) {
      this.applyAiPendingSchoolQuery(aiPendingQuery);
      return;
    }

    const now = Date.now();
    if (!this._lastInitAt || now - this._lastInitAt >= SCHOOL_BACKGROUND_REFRESH_MIN_INTERVAL_MS) {
      if (this.data.activeSnapshot) {
        this.checkActiveSnapshotFreshness();
      } else {
        this.initPageData({ reason: "onShow" });
      }
    }

    // 检查是否是从强制选择课表的引导跳转过来的
    const isInitSelect = wx.getStorageSync("initSelectMode");
    if (isInitSelect) {
      wx.removeStorageSync("initSelectMode");
      wx.showToast({
        title: "请选择学院、年级、专业和班级，并设为我的课表",
        icon: "none",
        duration: 3500
      });
    }
  },

  consumeAiPendingSchoolQuery() {
    let query = null;
    try {
      query = wx.getStorageSync(AI_PENDING_SCHOOL_QUERY_KEY);
      if (query) {
        wx.removeStorageSync(AI_PENDING_SCHOOL_QUERY_KEY);
      }
    } catch (error) {
      query = null;
    }
    if (!query || typeof query !== "object" || Array.isArray(query)) return null;
    return query;
  },

  buildMapReturnFromOptions(options = {}) {
    const placeId = safeDecodeURIComponent(options.mapPlaceId || options.placeId || "");
    const mapCode = safeDecodeURIComponent(options.mapCode || options.buildingCode || options.q || options.keyword || "").trim();
    if (!placeId && !mapCode) return null;
    const query = [];
    if (placeId) query.push(`placeId=${encodeURIComponent(placeId)}`);
    if (mapCode) query.push(`q=${encodeURIComponent(mapCode)}`);
    return {
      label: mapCode ? `查看 ${mapCode} 地图位置` : "返回校园地图位置",
      url: `/packageMaps/pages/campus-map/campus-map${query.length ? `?${query.join("&")}` : ""}`,
      code: mapCode,
      placeId,
    };
  },

  normalizeDirectSchoolQuery(options = {}) {
    const type = ["teacher", "classroom", "course", "class"].includes(options.type) ? options.type : "";
    const keyword = safeDecodeURIComponent(options.q || options.keyword || "").trim();
    if (!type || !keyword) return null;
    return Object.assign({}, options, { type, q: keyword });
  },

  applyDirectSchoolQueryIfNeeded() {
    const query = this._pendingDirectSchoolQuery;
    if (!query) return false;
    this._pendingDirectSchoolQuery = null;
    this.applyAiPendingSchoolQuery(Object.assign({}, query, {
      fromDirectLink: true,
      ts: Date.now(),
    }));
    return true;
  },

  applyAiPendingSchoolQuery(query, attempt = 0) {
    const type = ["teacher", "classroom", "course", "class"].includes(query.type) ? query.type : "teacher";
    const keyword = safeDecodeURIComponent(query.q || query.keyword || "").trim();
    const term = safeDecodeURIComponent(query.term || query.semester || "");
    const releaseVersion = safeDecodeURIComponent(query.releaseVersion || "");
    const selectedSemesterIndex = term
      ? this.data.semesters.findIndex((item) => item && item.value === term)
      : -1;
    const patch = {
      activeTab: type,
      keyword,
      teachersResult: [],
      teacherHitCount: 0,
      classroomsResult: [],
      coursesResult: [],
      classAdminTotal: 0,
      classAggregateTotal: 0,
      classroomsTotal: 0,
      coursesTotal: 0,
      hasMoreClassAdmin: false,
      hasMoreClassAggregate: false,
      hasMoreTeachers: false,
      hasMoreClassrooms: false,
      hasMoreCourses: false,
      updatedAtText: "",
      restoreHint: "已根据关键词打开查询",
    };
    if (type === "classroom") {
      patch.classroomMapReturn = this.buildMapReturnFromOptions(query);
    }
    if (selectedSemesterIndex >= 0) patch.selectedSemesterIndex = selectedSemesterIndex;
    if (releaseVersion) patch.catalogVersion = releaseVersion;

    const runSearch = () => {
      if (!keyword) return;
      if (type === "teacher") {
        this.searchTeacherSchedule();
        return;
      }
      if (type === "classroom") {
        this.searchClassroomSchedule();
        return;
      }
      if (type === "course") {
        this.searchCourseSchedule();
        return;
      }
      this.setData({
        classEmptyTitle: "已填入查询关键词",
        classEmptyDesc: keyword ? `请按「${keyword}」继续选择学院、年级或专业。` : "请继续选择班级筛选条件。",
      });
    };

    this.resetPagedResultStore();
    this.setData(patch, () => {
      const ready = Boolean(this.data.activeSnapshot || this.data.catalogVersion || (this.data.semesters && this.data.semesters.length));
      if (ready) {
        runSearch();
        return;
      }
      if (attempt === 0) {
        this.initPageData({ reason: "aiPendingQuery" });
      }
      if (attempt < 4) {
        setTimeout(() => this.applyAiPendingSchoolQuery(query, attempt + 1), 200);
      }
    });
  },

  // 统一页面初始化与 app-config / catalog 获取
  legacyInitPageData() {
    this.loadRecentSchedules();
    this.setData({
      dataLoadState: "loading",
      catalogEmpty: false
    });

    const retryFn = () => {
      this.initPageData();
    };
    this.startLoadingStateTimer(retryFn);

    console.log("[school] app-config loading start");
    appConfigService.loadAppConfig({ force: true })
      .then((config) => {
        const schoolNotice = appConfigService.getPrimaryNotice(config, "school", ["banner", "card"]);
        const latestUpdatedAt = appConfigService.getLatestDataUpdatedAt(config);

        const activeRelease = config.dataVersion || {};
        const term = config.currentSemester || getFallbackTerm();
        const releaseVersion = activeRelease.releaseVersion || "";
        const cacheEpoch = config.cacheEpoch || activeRelease.cacheEpoch || config.updatedAt || activeRelease.classScheduleUpdatedAt || "";

        console.log("[school] app-config", { term, releaseVersion, scheduleUpdatedAt: cacheEpoch });

        // 如果后端确实没有发布 release
        if (!releaseVersion) {
          this.clearLoadingStateTimer();
          this.setData({
            dataLoadState: "noRelease",
            catalogEmpty: true
          });
          return;
        }

        const remoteReleaseKey = `${term}:${releaseVersion}`;
        const localReleaseKey = normalizeStoredReleaseKey(wx.getStorageSync("FOSU_LOCAL_RELEASE_KEY"));

        let didRefresh = false;
        if (localReleaseKey && localReleaseKey !== remoteReleaseKey) {
          console.log("🔄 检测到课表新版本，自动清理全校缓存：", localReleaseKey, "->", remoteReleaseKey);
          const { clearAllSchoolCaches } = require("../../utils/storage");
          clearAllSchoolCaches();

          this.setData({
            classesResult: [],
            classAdminResults: [],
            classAggregateResults: [],
            teachersResult: [],
            classroomsResult: [],
            coursesResult: [],
            updatedAtText: "",
          });

          didRefresh = true;
          this.needAutoSearch = true;
          if (this.shouldShowReleaseNotice({ term, releaseVersion })) {
            this.pendingReleaseNoticeText = "检测到新版本，已刷新";
          }
        }

        wx.setStorageSync("FOSU_LOCAL_RELEASE_KEY", remoteReleaseKey);

        this.setData({
          appConfig: config,
          schoolNotice,
          dataVersionText: latestUpdatedAt ? `数据更新于 ${appConfigService.formatConfigTime(latestUpdatedAt)}` : "",
          runtimeDisclaimer: config.disclaimer || BRAND.disclaimer,
          catalogVersion: releaseVersion,
        });

        if (didRefresh) {
          this.loadRecentSchedules();
        }

        this.loadCatalogData(term, releaseVersion);
      })
      .catch((err) => {
        this.clearLoadingStateTimer();
        console.error("[school] app-config failed", err);
        if (err.code === "REQUEST_TIMEOUT" || err.code === "TIMEOUT") {
          this.setData({ dataLoadState: "timeout" });
        } else {
          this.setData({ dataLoadState: "networkError" });
        }
      });
  },

  // 异步及静默更新全校筛选项
  legacyLoadCatalogData(term, releaseVersion) {
    const catalogCacheKey = `school:catalog:${term}:${releaseVersion}`;
    let cachedCatalog = null;
    try {
      cachedCatalog = wx.getStorageSync(catalogCacheKey);
    } catch (e) {
      console.warn("读取 catalog 缓存失败", e);
    }

    const renderCatalog = (data) => {
      this.originalCatalogData = data;
      this.applyCatalogFilter();
      this.setData({
        catalogEmpty: false,
        catalogVersion: data.version || releaseVersion,
        catalogUpdatedAt: data.updatedAt || "",
      });

      if (this.applyDirectSchoolQueryIfNeeded()) {
        return;
      }
      if (this.hasSharedQuery()) {
        this.applySharedQueryIfNeeded();
      } else {
        this.restoreFilterCache();
      }

      if (this.needAutoSearch) {
        this.needAutoSearch = false;
        this.triggerActiveTabSearch();
      }
    };

    const fetchCatalogFromNetwork = () => {
      console.log("[school] request catalog bootstrap");
      request.get("/api/fosu/bootstrap", { semester: term }, { showLoading: false, silentError: true, timeout: 15000 })
        .then((res) => {
          if (res && res.success && res.catalog && Array.isArray(res.catalog.colleges) && res.catalog.colleges.length > 0) {
            const catalogData = {
              ...res.catalog,
              dataSource: res.dataSource || "cache",
              updatedAt: res.updatedAt || "",
              version: res.version || res.versions?.snapshot || res.updatedAt || "",
              success: true
            };
            this.clearLoadingStateTimer();
            this.setData({ dataLoadState: "success" });

            try {
              wx.setStorageSync(catalogCacheKey, catalogData);
            } catch (e) {}

            renderCatalog(catalogData);
          } else {
            console.warn("Bootstrap missing catalog, fallback to catalog API");
            fallbackToCatalogNetwork();
          }
        })
        .catch((err) => {
          console.warn("Bootstrap failed, fallback to catalog API", err);
          fallbackToCatalogNetwork();
        });
    };

    const fallbackToCatalogNetwork = () => {
      console.log("[school] request catalog fallback");
      request.get("/api/fosu/catalog", { semester: term }, { showLoading: false, silentError: true, timeout: 30000 })
        .then((data) => {
          if (data && data.success && Array.isArray(data.colleges) && data.colleges.length > 0) {
            this.clearLoadingStateTimer();
            this.setData({ dataLoadState: "success" });

            try {
              wx.setStorageSync(catalogCacheKey, data);
            } catch (e) {}

            renderCatalog(data);
          } else {
            handleCatalogError(new Error("Catalog empty"));
          }
        })
        .catch((err) => {
          handleCatalogError(err);
        });
    };

    const handleCatalogError = (err) => {
      this.clearLoadingStateTimer();
      console.error("[school] catalog load failed", err);
      if (cachedCatalog) {
        // 有缓存时，静默刷新失败不清空页面，默默提示
        wx.showToast({
          title: "网络连接慢，已载入本地缓存",
          icon: "none",
          duration: 2000
        });
      } else {
        if (err.code === "REQUEST_TIMEOUT" || err.code === "TIMEOUT") {
          this.setData({ dataLoadState: "timeout" });
        } else {
          this.setData({ dataLoadState: "networkError" });
        }
      }
    };

    if (cachedCatalog) {
      console.log("[school] catalog cache hit", { key: catalogCacheKey });
      renderCatalog(cachedCatalog);
      this.setData({
        dataLoadState: "success",
        restoreHint: "已加载缓存，正在校验更新"
      });
      // 启动后台校验刷新
      fetchCatalogFromNetwork();
    } else {
      fetchCatalogFromNetwork();
    }
  },

  legacyGetReleaseVersionForCache(fallbackVersion) {
    return fallbackVersion || this.data.catalogVersion || this.data.appConfig?.dataVersion?.releaseVersion || this.data.catalogUpdatedAt || "unknown";
  },

  legacyBuildIndexCacheKey(type, params, version) {
    const source = params || {};
    const term = source.semester || source.term || (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || getFallbackTerm();
    const releaseVersion = this.getReleaseVersionForCache(version);
    return getSchoolIndexCacheKey(term, releaseVersion, type, source);
  },

  legacyReadIndexCache(type, params) {
    try {
      const cacheKey = this.buildIndexCacheKey(type, params);
      const cached = wx.getStorageSync(cacheKey);
      if (!cached || Date.now() - cached.savedAt > 7 * 24 * 60 * 60 * 1000) return null;
      return cached.data || null;
    } catch (error) {
      return null;
    }
  },

  legacyWriteIndexCache(type, params, data) {
    try {
      const cacheKey = this.buildIndexCacheKey(type, params, data && data.version);
      wx.setStorageSync(cacheKey, {
        savedAt: Date.now(),
        data,
      });
    } catch (error) {
      // 索引缓存失败不影响在线查询。
    }
  },

  legacyFetchSearchIndex(type, params, options = {}) {
    const query = Object.assign({ type }, params || {});
    if (!query.term && !query.semester) {
      query.term = (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || getFallbackTerm();
    }
    if (!query.releaseVersion) {
      query.releaseVersion = this.getReleaseVersionForCache();
    }

    const cached = this.readIndexCache(type, query);
    if (cached) {
      const payload = Object.assign({}, cached, { fromStorage: true });
      return Promise.resolve(payload);
    }

    return request.get("/api/fosu/search-index", query, Object.assign({ showLoading: false, silentError: true }, options))
      .then((data) => {
        this.writeIndexCache(type, query, data);
        return data;
      })
      .catch((err) => {
        throw err;
      });
  },

  applyCatalogFilter() {
    const data = this.originalCatalogData;
    if (!data) return;

    const { getSettings } = require("../../utils/storage");
    const settings = getSettings();
    const showHistorical = settings.showHistoricalGrades || false;

    let grades = data.grades || [];
    if (!showHistorical) {
      // 默认只显示最近 4 个有效本科年级
      const activeSemester = (data.semesters && data.semesters[0]?.value) || getFallbackTerm();
      const match = activeSemester.match(/^(\d{4})/);
      if (match) {
        const startYear = parseInt(match[1], 10);
        const activeGrades = [];
        for (let i = 3; i >= 0; i--) {
          activeGrades.push(String(startYear - i));
        }
        grades = grades.filter((g) => activeGrades.includes(g));
      } else {
        grades = grades.filter((g) => ["2022", "2023", "2024", "2025"].includes(g));
      }
    }

    // 严谨校验与更新选中的 index
    let newSelectedIndex = -1;
    if (this.data.selectedGradeIndex >= 0 && this.data.grades.length > 0) {
      const prevSelectedGrade = this.data.grades[this.data.selectedGradeIndex];
      newSelectedIndex = grades.indexOf(prevSelectedGrade);
    }

    this.setData({
      semesters: data.semesters || [],
      colleges: data.colleges || [],
      grades: grades,
      selectedGradeIndex: newSelectedIndex,
      // 如果年级索引越界重置为 -1，需连带清空之前联动的专业
      majors: newSelectedIndex < 0 ? [] : this.data.majors,
      selectedMajorIndex: newSelectedIndex < 0 ? -1 : this.data.selectedMajorIndex
    });
  },

  onTabChange(event) {
    const tabKey = event.currentTarget.dataset.key;
    this.resetPagedResultStore();
    this.setData({
      activeTab: tabKey,
      keyword: "",
      // 清空当前结果，避免误导
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      teachersResult: [],
      teacherHitCount: 0,
      classAdminTotal: 0,
      classAggregateTotal: 0,
      classroomsTotal: 0,
      coursesTotal: 0,
      classroomEmptyTitle: "输入教室名称并查询",
      classroomEmptyDesc: "例如输入 C7-305 或 C7，即可获取教室的周课表安排。",
      classroomQueryType: "",
      classroomMapReturn: null,
      hasMoreClassAdmin: false,
      hasMoreClassAggregate: false,
      hasMoreTeachers: false,
      hasMoreClassrooms: false,
      hasMoreCourses: false,
      teacherDataSourceText: "",
      teacherDiagnosticText: "",
      classroomsResult: [],
      coursesResult: [],
      updatedAtText: "",
      classEmptyTitle: "请选择上方筛选并查询",
      classEmptyDesc: "查询后将展示行政班级课表，结果仅供参考。",
      classNoticeText: "",
      loadMoreState: "idle",
      loadMoreText: "",
    });
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });
    if (this.keywordSearchTimer) {
      clearTimeout(this.keywordSearchTimer);
    }
    const activeTab = this.data.activeTab;
    const minKeywordLength = activeTab === "teacher" ? 1 : 2;
    if (!["teacher", "classroom", "course"].includes(activeTab) || keyword.trim().length < minKeywordLength) {
      return;
    }
    this.keywordSearchTimer = setTimeout(() => {
      if (this.data.keyword.trim() !== keyword.trim()) return;
      if (activeTab === "teacher") this.searchTeacherSchedule();
      if (activeTab === "classroom") this.searchClassroomSchedule();
      if (activeTab === "course") this.searchCourseSchedule();
    }, SCHOOL_KEYWORD_DEBOUNCE_MS);
  },

  fallbackToCatalog() {
    request.get("/api/fosu/catalog", {
      semester: getFallbackTerm(),
    }, { showLoading: false, silentError: true, timeout: 15000 })
      .then((data) => {
        if (data && data.success && Array.isArray(data.colleges) && data.colleges.length > 0) {
          this.originalCatalogData = data;
          this.applyCatalogFilter();
          this.setData({
            loading: false,
            catalogEmpty: false,
            catalogVersion: data.version || data.updatedAt || "",
            catalogUpdatedAt: data.updatedAt || "",
          });
          if (this.applyDirectSchoolQueryIfNeeded()) {
            return;
          }
          if (this.hasSharedQuery()) {
            this.applySharedQueryIfNeeded();
          } else {
            this.restoreFilterCache();
          }
          
          if (this.needAutoSearch) {
            this.needAutoSearch = false;
            this.triggerActiveTabSearch();
          }
        } else {
          console.warn("Catalog data is empty");
          this.setData({ loading: false, catalogEmpty: true });
        }
      })
      .catch((err) => {
        this.setData({ loading: false, catalogEmpty: true });
        console.error("fetchSchoolCatalog (fallback) fail", err);
      });
  },


  // ================== 本地缓存状态存取与联动 ==================

  loadRecentSchedules() {
    // NOTE: 使用封装的存储接口读取缓存，保障数据格式鲁棒
    const recent = getRecentSchedules();
    const activeVersion = this.getReleaseVersionForCache();
    const processed = recent.map((item) => {
      return Object.assign({}, item, {
        isOldVersion: item.releaseVersion ? (item.releaseVersion !== activeVersion) : true
      });
    });
    this.setData({
      recentSchedules: processed,
    });
  },

  saveRecentSchedule(item) {
    const meta = item || {};
    const semester = meta.semester || this.data.semesters[this.data.selectedSemesterIndex]?.value || getFallbackTerm();
    const courseCount = Array.isArray(meta.courses) ? meta.courses.length : 0;
    const record = {
      scheduleKey: meta.scheduleKey || `${semester}-${meta.classId || meta.className || meta.displayTitle}`,
      type: "class",
      title: meta.displayTitle || meta.className || "班级课表",
      className: meta.className || meta.displayTitle || "",
      collegeName: meta.collegeName || this.data.colleges[this.data.selectedCollegeIndex]?.name || "",
      collegeCode: meta.collegeCode || this.data.colleges[this.data.selectedCollegeIndex]?.code || "",
      grade: meta.grade || this.data.grades[this.data.selectedGradeIndex] || "",
      majorName: meta.majorName || this.data.majors[this.data.selectedMajorIndex]?.name || "",
      majorCode: meta.majorCode || this.data.majors[this.data.selectedMajorIndex]?.code || "",
      semester,
      courseCount,
      updatedAt: meta.updatedAtText || formatUpdateTime(meta.updatedAt || new Date()),
      courses: Array.isArray(meta.courses) ? meta.courses : [],
      schedule: meta,
      releaseVersion: meta.releaseVersion || meta.scheduleVersion || this.getReleaseVersionForCache(),
    };
    
    // NOTE: 直接通过 storage 模块的 addRecentSchedule 写入，避免在此处零散操作 Storage
    const next = addRecentSchedule(record);
    this.setData({ recentSchedules: next });
  },

  /**
   * 最近查看项的触摸开始事件
   * NOTE: 记录触摸起始坐标。当用户摸了其他项时，自动折叠已经滑出的删除按钮以保持界面整洁
   */
  onRecentTouchStart(e) {
    if (e.touches.length === 1) {
      const key = e.currentTarget.dataset.key;
      if (this.data.openedRecentKey && this.data.openedRecentKey !== key) {
        this.setData({
          openedRecentKey: ""
        });
      }
      this.setData({
        touchStartX: e.touches[0].clientX,
        touchStartY: e.touches[0].clientY
      });
    }
  },

  /**
   * 最近查看项的触摸移动事件
   */
  onRecentTouchMove(e) {
    // 预留，当前采用 touchend 统一裁决，无需做频繁 setData
  },

  /**
   * 最近查看项的触摸结束事件
   * NOTE: 计算 X、Y 偏移量差以确定滑动意图，合理规避斜向滑动等误触情况
   */
  onRecentTouchEnd(e) {
    if (e.changedTouches.length === 1) {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const startX = this.data.touchStartX;
      const startY = this.data.touchStartY;
      
      const diffX = startX - endX;
      const diffY = Math.abs(startY - endY);

      // 横向滑动距离超过 40 且纵向偏离在 35 以内则视为有效滑动
      if (diffX > 40 && diffY < 35) {
        const key = e.currentTarget.dataset.key;
        this.setData({
          openedRecentKey: key
        });
      } else if (diffX < -40 && diffY < 35) {
        const key = e.currentTarget.dataset.key;
        if (this.data.openedRecentKey === key) {
          this.setData({
            openedRecentKey: ""
          });
        }
      }
    }
  },

  /**
   * 关闭所有被滑出的删除按钮
   */
  closeRecentSwipe() {
    if (this.data.openedRecentKey) {
      this.setData({
        openedRecentKey: ""
      });
    }
  },

  /**
   * 删除单条最近查看记录
   * NOTE: 删除只在本地缓存触发，不需要请求后端，完成删除后主动收起滑动状态
   */
  deleteRecentSchedule(e) {
    const key = e.currentTarget.dataset.key;
    const next = removeRecentSchedule(key);
    this.setData({
      recentSchedules: next,
      openedRecentKey: ""
    });
    wx.showToast({
      title: "已删除",
      icon: "success",
      duration: 1000
    });
  },

  /**
   * 清空所有最近查看历史记录
   * NOTE: 提供确认弹窗引导以防误操作
   */
  clearRecentSchedules() {
    wx.showModal({
      title: "提示",
      content: "确定清空最近查看记录吗？",
      confirmColor: "#c62828",
      success: (res) => {
        if (res.confirm) {
          clearRecentSchedules();
          this.setData({
            recentSchedules: [],
            openedRecentKey: ""
          });
          wx.showToast({
            title: "已清空",
            icon: "success",
            duration: 1000
          });
        }
      }
    });
  },

  /**
   * 点击最近查看的课表记录
   * NOTE: 如果有滑出的删除按钮，本次点击仅执行“收起”操作，以防用户误触跳转
   */
  goRecentSchedule(e) {
    if (this.data.openedRecentKey) {
      this.closeRecentSwipe();
      return;
    }
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.recentSchedules[index];
    if (!item) return;

    const activeVersion = this.getReleaseVersionForCache();
    const type = item.type || "class";
    const displayName = item.className || item.title || item.name || "";

    // 只有当版本号一致，且课程数据存在时才直接跳转
    if (item.releaseVersion && item.releaseVersion === activeVersion && Array.isArray(item.courses) && item.courses.length > 0) {
      const schedule = item.schedule || item;
      this.navigateToScheduleView(type, displayName, item.courses || [], schedule);
    } else {
      // 否则，如果是旧版本或者是没缓存的，需要在新版本中找到对应的 id
      const semester = item.semester || (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || getFallbackTerm();
      
      wx.showLoading({ title: "正在校验新版本...", mask: true });

      // 发起 search-index 请求在新版中搜索该课表项
      request.get("/api/fosu/search-index", {
        type,
        q: displayName,
        term: semester,
        releaseVersion: activeVersion,
        limit: 10
      }, { showLoading: false, silentError: true })
        .then((res) => {
          wx.hideLoading();
          const items = res.items || [];
          // 精确匹配
          const matched = items.find(x => (x.className === displayName || x.name === displayName || x.teacherName === displayName || x.roomName === displayName || x.courseName === displayName));
          
          if (matched) {
            const queryItem = Object.assign({}, matched, {
              detailId: matched.id,
              semester: semester,
              scheduleVersion: activeVersion
            });
            this.openIndexedSchedule(type, queryItem, displayName);
          } else {
            wx.showModal({
              title: "提示",
              content: "该课表为旧版本数据，新版本中未找到对应班级/课表。",
              showCancel: false,
              confirmText: "知道了"
            });
          }
        })
        .catch((err) => {
          wx.hideLoading();
          // 如果请求超时或出错，降级尝试直接用原 detailId 打开新版
          const detailId = item.id || item.scheduleId || displayName;
          const queryItem = Object.assign({}, item, {
            detailId,
            semester,
            scheduleVersion: activeVersion
          });
          this.openIndexedSchedule(type, queryItem, displayName);
        });
    }
  },

  legacyGetFilterCacheKey() {
    const term = (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || getFallbackTerm();
    const releaseVersion = this.getReleaseVersionForCache();
    return getSchoolFilterCacheKey(term, releaseVersion);
  },

  saveFilterCache() {
    const {
      semesters, selectedSemesterIndex,
      colleges, selectedCollegeIndex,
      grades, selectedGradeIndex,
      majors, selectedMajorIndex,
      classesOptions, selectedClassIndex
    } = this.data;

    const cache = {
      semesterValue: semesters[selectedSemesterIndex]?.value || "",
      semesterLabel: semesters[selectedSemesterIndex]?.label || "",
      collegeCode: selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex]?.code : "",
      collegeName: selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex]?.name : "",
      grade: selectedGradeIndex >= 0 ? grades[selectedGradeIndex] : "",
      majorCode: selectedMajorIndex >= 0 ? majors[selectedMajorIndex]?.code : "",
      majorName: selectedMajorIndex >= 0 ? majors[selectedMajorIndex]?.name : "",
      classId: (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) ? classesOptions[selectedClassIndex].classId : "",
      className: (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) ? classesOptions[selectedClassIndex].className : "",
      classType: (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) ? (classesOptions[selectedClassIndex].isAggregated ? "aggregate" : "admin") : "",
      catalogVersion: this.data.catalogVersion || "",
      catalogUpdatedAt: this.data.catalogUpdatedAt || "",
      lastUpdatedAt: Date.now()
    };

    wx.setStorageSync(this.getFilterCacheKey(), cache);
  },

  hasSharedQuery() {
    const query = this.sharedQuery || {};
    return Boolean(query.className || query.collegeCode || query.grade || query.majorCode);
  },

  applySharedQueryIfNeeded() {
    if (!this.hasSharedQuery()) {
      return;
    }
    const query = this.sharedQuery || {};
    this.sharedQuery = {};

    const selectedSemesterIndex = query.semester
      ? Math.max(0, this.data.semesters.findIndex((item) => item.value === query.semester))
      : this.data.selectedSemesterIndex;
    const selectedCollegeIndex = query.collegeCode
      ? this.data.colleges.findIndex((item) => item.code === query.collegeCode)
      : this.data.selectedCollegeIndex;
    const selectedGradeIndex = query.grade
      ? this.data.grades.indexOf(query.grade)
      : this.data.selectedGradeIndex;

    if (selectedCollegeIndex < 0 || selectedGradeIndex < 0) {
      if (query.className) {
        this.openSharedClassByName(query);
      }
      return;
    }

    this.setData({
      selectedSemesterIndex: selectedSemesterIndex >= 0 ? selectedSemesterIndex : 0,
      selectedCollegeIndex,
      selectedGradeIndex,
    }, () => {
      this.fetchMajors().then((majors) => {
        const selectedMajorIndex = query.majorCode
          ? majors.findIndex((item) => item.code === query.majorCode)
          : -1;
        if (selectedMajorIndex < 0) {
          if (query.className) {
            this.openSharedClassByName(query);
          }
          return;
        }
        this.setData({
          selectedMajorIndex,
        }, () => {
          this.fetchClasses().then((classesOptions) => {
            const selectedClassIndex = query.className
              ? classesOptions.findIndex((item) => item.className === query.className)
              : -1;
            this.setData({
              selectedClassIndex,
            }, () => {
              this.saveFilterCache();
              if (query.className && selectedClassIndex >= 0) {
                this.searchClassSchedule();
              } else if (query.className) {
                this.openSharedClassByName(query);
              }
            });
          });
        });
      });
    });
  },

  openSharedClassByName(query) {
    request.post("/api/fosu/class-schedule", {
      semester: query.semester || getFallbackTerm(),
      className: query.className,
    }, { loadingTitle: "正在加载课表...", silentError: true })
      .then((data) => {
        if (data && data.success && data.classes && data.classes.length > 0) {
          const formatted = formatClassResultItem(data.classes[0]);
          formatted.updatedAt = data.updatedAt;
          this.saveRecentSchedule(formatted);
          this.navigateToScheduleView("class", formatted.className, formatted.courses, formatted);
        }
      })
      .catch((err) => {
        console.warn("open shared class failed", err);
      });
  },

  restoreFilterCache() {
    const cacheKey = this.getFilterCacheKey();
    const cache = wx.getStorageSync(cacheKey);
    if (!cache) {
      this.printSchoolDebugLog(false, "", "no cached filter");
      this.applySharedQueryIfNeeded();
      return;
    }

    let selectedSemesterIndex = 0;
    if (cache.semesterValue) {
      const semIdx = this.data.semesters.findIndex(s => s.value === cache.semesterValue);
      if (semIdx >= 0) selectedSemesterIndex = semIdx;
    }

    const finishDowngrade = (level, reason) => {
      this.printSchoolDebugLog(true, level, reason);
      this.saveFilterCache();
      this.showFilterChangedHint("部分筛选项已更新，已恢复到可用层级");
      this.applySharedQueryIfNeeded();
    };

    const collegeIdx = this.data.colleges.findIndex(c => c.code === cache.collegeCode);
    if (collegeIdx < 0) {
      this.setData({
        selectedSemesterIndex,
        selectedCollegeIndex: -1,
        selectedGradeIndex: -1,
        selectedMajorIndex: -1,
        selectedClassIndex: -1,
        majors: [],
        classesOptions: [],
      }, () => finishDowngrade("semester", `college missing: ${cache.collegeName || cache.collegeCode || "-"}`));
      return;
    }

    const gradeIdx = this.data.grades.indexOf(cache.grade);
    if (gradeIdx < 0) {
      this.setData({
        selectedSemesterIndex,
        selectedCollegeIndex: collegeIdx,
        selectedGradeIndex: -1,
        selectedMajorIndex: -1,
        selectedClassIndex: -1,
        majors: [],
        classesOptions: [],
      }, () => finishDowngrade("college", `grade missing: ${cache.grade || "-"}`));
      return;
    }

    this.setData({
      selectedSemesterIndex,
      selectedCollegeIndex: collegeIdx,
      selectedGradeIndex: gradeIdx
    }, () => {
      this.fetchMajors().then((majors) => {
        const majorIdx = majors.findIndex(m => m.code === cache.majorCode);
        if (majorIdx < 0) {
          this.setData({
            selectedMajorIndex: -1,
            selectedClassIndex: -1,
            classesOptions: [],
          }, () => finishDowngrade("grade", `major missing: ${cache.majorName || cache.majorCode || "-"}`));
          return;
        }

        this.setData({
          selectedMajorIndex: majorIdx
        }, () => {
          this.fetchClasses().then((classesOptions) => {
            let classIdx = -1;
            if (cache.classId) {
              classIdx = classesOptions.findIndex(c => c.classId === cache.classId);
            }
            if (classIdx < 0 && cache.className) {
              classIdx = classesOptions.findIndex(c => c.className === cache.className);
            }

            if (classIdx < 0) {
              this.setData({ selectedClassIndex: -1 }, () => {
                finishDowngrade("major", `class missing: ${cache.className || cache.classId || "-"}`);
              });
              return;
            }

            this.setData({
              selectedClassIndex: classIdx
            });
            this.printSchoolDebugLog(true, "class", "restored cached filter");
            this.applySharedQueryIfNeeded();
          }).catch(err => {
            this.setData({ selectedClassIndex: -1, classesOptions: [] }, () => {
              finishDowngrade("major", "class list failed: " + (err && err.message || "unknown"));
            });
          });
        });
      }).catch(err => {
        this.setData({ selectedMajorIndex: -1, selectedClassIndex: -1, majors: [], classesOptions: [] }, () => {
          finishDowngrade("grade", "major list failed: " + (err && err.message || "unknown"));
        });
      });
    });
  },

  showRestoreHint() {
    const { colleges, selectedCollegeIndex, grades, selectedGradeIndex, majors, selectedMajorIndex, classesOptions, selectedClassIndex } = this.data;
    const parts = [];
    if (selectedCollegeIndex >= 0 && colleges[selectedCollegeIndex]) {
      parts.push(colleges[selectedCollegeIndex].name);
    }
    if (selectedGradeIndex >= 0 && grades[selectedGradeIndex]) {
      parts.push(grades[selectedGradeIndex]);
    }
    if (selectedMajorIndex >= 0 && majors[selectedMajorIndex]) {
      parts.push(majors[selectedMajorIndex].name);
    }
    if (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) {
      parts.push(classesOptions[selectedClassIndex].className);
    }
    
    if (parts.length > 0) {
      const hint = `已恢复上次选择：${parts.join(" / ")}`;
      this.setData({
        restoreHint: hint
      });
      if (this.restoreTimer) {
        clearTimeout(this.restoreTimer);
      }
      this.restoreTimer = setTimeout(() => {
        this.setData({
          restoreHint: ""
        });
      }, 2000);
    }
  },

  showFilterChangedHint(message) {
    if (!this.shouldShowFilterHint()) return;
    const text = message || "部分筛选项已更新，请重新选择";
    this.setData({
      restoreHint: text
    });
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
    }
    this.restoreTimer = setTimeout(() => {
      this.setData({
        restoreHint: ""
      });
    }, 2600);
  },

  resetFilters() {
    wx.removeStorageSync(this.getFilterCacheKey());
    this.clearPagedResults(["classAdmin", "classAggregate"]);
    this.setData({
      selectedSemesterIndex: 0,
      selectedCollegeIndex: -1,
      selectedGradeIndex: -1,
      selectedMajorIndex: -1,
      selectedClassIndex: -1,
      majors: [],
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      classNoticeText: "",
      restoreHint: ""
    });
    wx.showToast({
      title: "已清除筛选缓存",
      icon: "success",
      duration: 1000
    });
  },

  printSchoolDebugLog(hit, level, reason) {
    if (platformUtils.isDeveloperEnv()) {
      console.log("[school] filter cache", {
        hit: Boolean(hit),
        restoredLevel: level || "",
        reason: reason || "",
      });
    }
  },

  // 2. 学期选择改变
  onSemesterChange(event) {
    this.clearPagedResults(["classAdmin", "classAggregate"]);
    this.setData({
      selectedSemesterIndex: Number(event.detail.value),
      selectedClassIndex: -1,
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      classNoticeText: "",
    }, () => {
      if (this.data.selectedCollegeIndex >= 0 && this.data.selectedGradeIndex >= 0 && this.data.selectedMajorIndex >= 0) {
        this.fetchClasses();
      }
      this.saveFilterCache();
    });
  },

  // 3. 学院选择改变
  onCollegeChange(event) {
    const index = Number(event.detail.value);
    // 切换学院立即清除旧结果（含教师），缓存键含 collegeCode 避免串味
    this.clearPagedResults(["classAdmin", "classAggregate", "teacher"]);
    this.setData({
      selectedCollegeIndex: index,
      selectedGradeIndex: -1,
      selectedMajorIndex: -1,
      selectedClassIndex: -1,
      majors: [], // 重置专业
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      teachersResult: [],
      teacherHitCount: 0,
      updatedAtText: "",
      classNoticeText: "",
    }, () => {
      this.saveFilterCache();
    });
  },

  // 4. 年级选择改变
  onGradeChange(event) {
    const index = Number(event.detail.value);
    this.clearPagedResults(["classAdmin", "classAggregate"]);
    this.setData({
      selectedGradeIndex: index,
      selectedMajorIndex: -1,
      selectedClassIndex: -1,
      majors: [], // 重置专业
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      classNoticeText: "",
    }, () => {
      this.fetchMajors();
      this.saveFilterCache();
    });
  },

  // 5. 联动查询专业
  fetchMajors() {
    const { colleges, selectedCollegeIndex, grades, selectedGradeIndex } = this.data;
    if (selectedCollegeIndex < 0 || selectedGradeIndex < 0) {
      return Promise.resolve([]);
    }

    const collegeCode = colleges[selectedCollegeIndex].code;
    const grade = grades[selectedGradeIndex];
    const localMajors = (this.originalCatalogData && Array.isArray(this.originalCatalogData.majors))
      ? this.originalCatalogData.majors.filter((major) => {
        return String(major.collegeCode || "") === String(collegeCode || "") &&
          String(major.grade || "") === String(grade || "");
      })
      : [];
    if (localMajors.length) {
      this.setData({
        majors: localMajors,
        loading: false,
      });
      return Promise.resolve(localMajors);
    }

    this.setData({ loading: true });
    return request.get("/api/fosu/majors", { collegeCode, grade }, { showLoading: false, timeout: SCHOOL_REQUEST_TIMEOUT })
      .then((data) => {
        const majors = data.majors || [];
        this.setData({
          majors: majors,
          loading: false,
        });
        return majors;
      })
      .catch((err) => {
        this.setData({ loading: false });
        console.error("fetchMajors fail", err);
        throw err;
      });
  },

  // 6. 专业选择改变
  onMajorChange(event) {
    this.clearPagedResults(["classAdmin", "classAggregate"]);
    this.setData({
      selectedMajorIndex: Number(event.detail.value),
      selectedClassIndex: -1,
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      classNoticeText: "",
    }, () => {
      this.fetchClasses();
      this.saveFilterCache();
    });
  },

  // 6.5. 异步获取班级列表
  fetchClasses() {
    const { semesters, selectedSemesterIndex, colleges, selectedCollegeIndex, grades, selectedGradeIndex, majors, selectedMajorIndex } = this.data;
    if (selectedCollegeIndex < 0 || selectedGradeIndex < 0 || selectedMajorIndex < 0) {
      return Promise.resolve([]);
    }

    const semester = semesters[selectedSemesterIndex].value;
    const collegeCode = colleges[selectedCollegeIndex].code;
    const grade = grades[selectedGradeIndex];
    const majorCode = majors[selectedMajorIndex].code;

    this.setData({ loading: true });
    return this.fetchSearchIndex("class", { semester, collegeCode, grade, majorCode, limit: 100 })
      .then((res) => {
        const classesOptions = [];
        if (res && res.success) {
          const items = (res.items || []).map(formatClassResultItem);
          const adminClasses = items.filter((item) => !item.isAggregated);
          const majorAggregates = items.filter((item) => item.isAggregated);

          adminClasses.forEach(c => {
            classesOptions.push({
              classId: c.detailId || c.classId || c.id,
              className: c.className,
              label: c.className,
              detailId: c.detailId || c.id || c.classId || c.className,
              scheduleVersion: res.version || c.scheduleVersion || "",
              courseCount: c.courseCount || 0,
              semester: c.semester || semester,
              collegeCode: c.collegeCode || collegeCode,
              grade: c.grade || grade,
              majorCode: c.majorCode || majorCode,
              majorName: c.majorName || "",
              displayType: c.displayType || "",
              isAggregated: false,
              group: "admin"
            });
          });

          majorAggregates.forEach(c => {
            classesOptions.push({
              classId: c.detailId || c.classId || c.id,
              className: c.className,
              label: c.className.includes("共享") ? c.className : `${c.className} (共享课表)`,
              detailId: c.detailId || c.id || c.classId || c.className,
              scheduleVersion: res.version || c.scheduleVersion || "",
              courseCount: c.courseCount || 0,
              semester: c.semester || semester,
              collegeCode: c.collegeCode || collegeCode,
              grade: c.grade || grade,
              majorCode: c.majorCode || majorCode,
              majorName: c.majorName || "",
              displayType: c.displayType || "major-shared-schedule",
              isAggregated: true,
              group: "aggregate"
            });
          });
        }
        this.setData({
          classesOptions,
          loading: false
        });
        return classesOptions;
      })
      .catch((err) => {
        if (err && err.stale) {
          return [];
        }
        console.warn("fetch class index fail, fallback to /api/fosu/classes", err);
        return request.get("/api/fosu/classes", { semester, collegeCode, grade, majorCode }, { showLoading: false })
          .then((res) => {
            const classesOptions = [];
            if (res && res.success) {
              (res.adminClasses || []).forEach(c => {
                classesOptions.push({
                  classId: c.classId,
                  className: c.className,
                  label: c.className,
                  isAggregated: false,
                  group: "admin"
                });
              });
              (res.majorAggregates || []).forEach(c => {
                classesOptions.push({
                  classId: c.classId,
                  className: c.className,
                  label: c.className.includes("共享") ? c.className : `${c.className} (共享课表)`,
                  isAggregated: true,
                  group: "aggregate"
                });
              });
            }
            this.setData({ classesOptions, loading: false });
            return classesOptions;
          })
          .catch((fallbackErr) => {
            this.setData({ loading: false });
            console.error("fetchClasses fail", fallbackErr);
            throw fallbackErr;
          });
      });
  },

  // 6.6. 班级选择改变
  onClassChange(event) {
    this.setData({
      selectedClassIndex: Number(event.detail.value)
    }, () => {
      this.saveFilterCache();
    });
  },

  // 7. 职称选择改变 (教师 Tab)
  onTitleChange(event) {
    this.setData({
      selectedTitleIndex: Number(event.detail.value),
    });
  },

  // 8. 校区选择改变 (教室 Tab)
  onCampusChange(event) {
    this.setData({
      selectedCampusIndex: Number(event.detail.value),
    });
  },

  // ================== 查询按钮动作 ==================

  searchClassSchedule() {
    const { semesters, selectedSemesterIndex, colleges, selectedCollegeIndex, grades, selectedGradeIndex, majors, selectedMajorIndex, classesOptions, selectedClassIndex } = this.data;

    if (selectedCollegeIndex < 0 || selectedGradeIndex < 0 || selectedMajorIndex < 0) {
      wx.showToast({
        title: "请选择完整筛选项",
        icon: "none",
      });
      return;
    }

    const semester = semesters[selectedSemesterIndex].value;
    const collegeCode = colleges[selectedCollegeIndex].code;
    const collegeName = colleges[selectedCollegeIndex].name;
    const grade = grades[selectedGradeIndex];
    const majorCode = majors[selectedMajorIndex].code;
    const majorName = majors[selectedMajorIndex].name;

    // 如果选到了具体班级，直接精准查询并跳转
    if (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) {
      const selectedClass = classesOptions[selectedClassIndex];
      this.openIndexedSchedule("class", Object.assign({
        semester,
        collegeCode,
        grade,
        majorCode,
        majorName,
      }, selectedClass), selectedClass.className);
      return;
    }

    const params = {
      semester,
      collegeCode,
      collegeName,
      grade,
      majorCode,
      majorName,
      limit: 100,
    };

    const renderFn = (data, isFromCache) => {
      const formatTime = formatUpdateTime(data.updatedAt);
      const grouped = splitClassResultGroups(data.items || []);
      grouped.list.forEach((item) => {
        item.updatedAt = data.updatedAt;
        item.scheduleVersion = data.version || item.scheduleVersion || "";
      });
      const emptyState = getClassEmptyState("");
      this.setClassPagedResults(grouped);
      this.setData({
        dataVersionText: formatTime ? `数据更新于 ${formatTime}` : "",
        updatedAtText: formatTime ? `课程数据 · 更新于 ${formatTime}` : "课程数据",
        classEmptyTitle: emptyState.title,
        classEmptyDesc: emptyState.desc,
        classNoticeText: grouped.noticeText,
      });
    };

    const catchFn = (err) => {
      const payload = err && err.payload ? err.payload : {};
      const emptyState = getClassEmptyState(payload.reasonCode);
      this.clearPagedResults(["classAdmin", "classAggregate"]);
      this.setData({
        updatedAtText: "",
        dataVersionText: "",
        classEmptyTitle: emptyState.title,
        classEmptyDesc: emptyState.desc,
        classNoticeText: "",
      });
    };

    this.executeSearch("class", params, renderFn, catchFn);
  },

  searchTeacherSchedule() {
    const { semesters, selectedSemesterIndex, colleges, selectedCollegeIndex, titleOptions, selectedTitleIndex, keyword } = this.data;

    if (!keyword.trim()) {
      wx.showToast({
        title: "请输入教师姓名",
        icon: "none",
      });
      return;
    }

    const semester = semesters[selectedSemesterIndex]?.value || getFallbackTerm();
    const collegeCode = selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex].code : "";
    const collegeName = selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex].name : "";
    const titleCode = this.data.titleFilterEnabled && selectedTitleIndex >= 0
      ? titleOptions[selectedTitleIndex]
      : "";

    // 切换学院时缓存键含 collegeCode/titleCode，避免跨学院结果污染
    const params = {
      semester,
      collegeCode,
      collegeName,
      titleCode,
      q: keyword.trim(),
      limit: 100,
    };

    const renderFn = (data, isFromCache) => {
      const formatTime = formatUpdateTime(data.updatedAt);
      const teachers = (data.items || []).map(item => normalizeIndexedScheduleItem("teacher", item, data.version));
      this.lastTeacherSearchDebug = data.debug || null;
      // 职称数据可靠时才启用职称筛选：至少 20% 条目有 title
      const titled = teachers.filter((t) => t.title || t.teacherTitle || t.professionalTitle || t.titleCode).length;
      const titleFilterEnabled = teachers.length >= 5 && titled / teachers.length >= 0.2;
      this.setSimplePagedResults("teacher", "teachersResult", teachers, "teacherHitCount", "hasMoreTeachers");
      this.setData({
        titleFilterEnabled,
        teacherDataSourceText: data.degradedSchema ? "索引待升级" : "教师索引",
        teacherDiagnosticText: "",
        dataVersionText: formatTime ? `数据更新于 ${formatTime}` : "",
        updatedAtText: teachers.length
          ? `${teachers.length} 个命中${collegeName ? " · " + collegeName : ""}${formatTime ? " · 更新于 " + formatTime : ""}`
          : (collegeName
            ? `在「${collegeName}」下未找到「${keyword.trim()}」，可清空学院后再搜`
            : "未找到相关教师，请检查姓名或切换关键词"),
      });
    };

    const catchFn = () => {
      this.clearPagedResults("teacher");
      this.setData({
        teacherDataSourceText: "教师索引",
        updatedAtText: "教师查询失败，请检查网络后重试",
        dataVersionText: "",
      });
    };

    this.executeSearch("teacher", params, renderFn, catchFn);
  },

  searchClassroomSchedule() {
    const { semesters, selectedSemesterIndex, campusOptions, selectedCampusIndex, keyword } = this.data;

    if (!keyword.trim()) {
      wx.showToast({
        title: "请输入教室名称 (如C7-503)",
        icon: "none",
      });
      return;
    }

    const semester = semesters[selectedSemesterIndex]?.value || getFallbackTerm();
    const campus = selectedCampusIndex >= 0 ? campusOptions[selectedCampusIndex] : "";
    const parsedQuery = classroomSearch.parseClassroomQuery(keyword.trim());

    const params = {
      semester,
      campus,
      q: parsedQuery.queryType === "text" ? keyword.trim() : parsedQuery.normalizedQuery,
      limit: parsedQuery.queryType === "text" ? 100 : 500,
    };

    const renderFn = (data, isFromCache) => {
      const formatTime = formatUpdateTime(data.updatedAt);
      const normalized = (data.items || []).map(item => normalizeIndexedScheduleItem("classroom", item, data.version));
      const classrooms = classroomSearch.filterAndSortClassrooms(normalized, parsedQuery);
      this.setSimplePagedResults("classroom", "classroomsResult", classrooms, "classroomsTotal", "hasMoreClassrooms");
      const hasResults = classrooms.length > 0;
      this.setData({
        classroomQueryType: parsedQuery.queryType,
        classroomMapReturn: this.data.classroomMapReturn || this.buildMapReturnFromOptions({ q: parsedQuery.buildingCode || parsedQuery.normalizedQuery }),
        classroomEmptyTitle: hasResults ? "" : (parsedQuery.queryType === "building" || parsedQuery.queryType === "exact-room" ? `未找到 ${parsedQuery.normalizedQuery}` : "未找到相关教室"),
        classroomEmptyDesc: hasResults ? "" : (parsedQuery.queryType === "text" ? "请换一个地点名或教室关键词再试。" : "不会补充其他楼栋结果，请检查楼栋代码或教室号。"),
        dataVersionText: formatTime ? `数据更新于 ${formatTime}` : "",
        updatedAtText: hasResults
          ? `${classrooms.length} 个命中 · ${parsedQuery.queryType === "text" ? "文本搜索" : parsedQuery.normalizedQuery}${formatTime ? " · 更新于 " + formatTime : ""}`
          : `未找到 ${parsedQuery.normalizedQuery}`,
      });
    };

    const catchFn = () => {
      this.clearPagedResults("classroom");
      this.setData({
        updatedAtText: "",
        dataVersionText: "",
        classroomQueryType: parsedQuery.queryType,
        classroomEmptyTitle: "教室查询失败",
        classroomEmptyDesc: "加载失败，点击重试或稍后再试。",
        loadMoreState: "error",
        loadMoreText: "加载失败，点击重试",
      });
    };

    this.executeSearch("classroom", params, renderFn, catchFn);
  },

  searchCourseSchedule() {
    const { semesters, selectedSemesterIndex, keyword } = this.data;

    if (!keyword.trim()) {
      wx.showToast({
        title: "请输入课程名 (如有机化学)",
        icon: "none",
      });
      return;
    }

    const semester = semesters[selectedSemesterIndex]?.value || getFallbackTerm();

    const params = {
      semester,
      q: keyword.trim(),
      limit: 100,
    };

    const renderFn = (data, isFromCache) => {
      const formatTime = formatUpdateTime(data.updatedAt);
      const courses = (data.items || []).map(item => normalizeIndexedScheduleItem("course", item, data.version));
      this.setSimplePagedResults("course", "coursesResult", courses, "coursesTotal", "hasMoreCourses");
      this.setData({
        dataVersionText: formatTime ? `数据更新于 ${formatTime}` : "",
        updatedAtText: formatTime ? `课程索引 · 更新于 ${formatTime}` : "课程索引",
      });
    };

    const catchFn = () => {
      this.clearPagedResults("course");
      this.setData({ updatedAtText: "", dataVersionText: "" });
    };

    this.executeSearch("course", params, renderFn, catchFn);
  },

  legacyGetScheduleDetailCache(type, id, version, term) {
    const activeVersion = this.getReleaseVersionForCache(version);
    const cacheKey = getScheduleDetailCacheKey(term || "unknown", activeVersion || "unknown", type, id);
    try {
      const cached = wx.getStorageSync(cacheKey);
      if (Date.now() - cached.savedAt > SCHEDULE_DETAIL_CACHE_TTL) return null;
      return cached.schedule || null;
    } catch (error) {
      return null;
    }
  },

  legacySetScheduleDetailCache(type, id, version, term, schedule) {
    const activeVersion = this.getReleaseVersionForCache(version);
    const cacheKey = getScheduleDetailCacheKey(term || "unknown", activeVersion || "unknown", type, id);
    try {
      wx.setStorageSync(cacheKey, {
        savedAt: Date.now(),
        schedule,
      });
    } catch (error) {
      // 缓存失败不影响课表查看。
    }
  },

  openIndexedSchedule(type, item, displayName) {
    const detailId = item.detailId || item.id || displayName;
    const semester = item.semester || this.data.semesters[this.data.selectedSemesterIndex]?.value || getFallbackTerm();
    const version = this.getReleaseVersionForCache(item.scheduleVersion);
    if (!type || !detailId || !version) {
      wx.showToast({ title: "课表详情参数缺失", icon: "none" });
      if (platformUtils.isDeveloperEnv()) {
        console.warn("[school] skip invalid schedule detail request", { type, detailId, version });
      }
      return;
    }
    const cachedDetail = releasePackService.readCachedDetail(type, detailId, {
      term: semester,
      releaseVersion: version,
    });
    const cached = cachedDetail ? (cachedDetail.schedule || cachedDetail.detail) : this.getScheduleDetailCache(type, detailId, version, semester);
    if (cached) {
      const cachedMeta = Object.assign({}, item, cached, { semester, scheduleVersion: version });
      if (type === "class") this.saveRecentSchedule(cachedMeta);
      this.navigateToScheduleView(type, displayName, cached.courses || [], cachedMeta);
      return;
    }

    wx.showLoading({ title: "正在打开课表...", mask: true });
    const detailPromise = type === "classroom"
      ? releasePackService.resolveClassroomDetail(displayName, {
        term: semester,
        releaseVersion: version,
        detailId,
      }, {
        timeout: SCHOOL_REQUEST_TIMEOUT,
        retries: 1,
      })
      : releasePackService.loadDetail(type, detailId, {
        term: semester,
        releaseVersion: version,
      }, {
        forceNetwork: true,
      });

    detailPromise
      .then((data) => {
        wx.hideLoading();
        const schedule = data.schedule || data.detail || {};
        const nextVersion = data.version || version;
        const resolvedDetailId = data.detailId || data.resolvedId || schedule.id || detailId;
        this.setScheduleDetailCache(type, resolvedDetailId, nextVersion, semester, schedule);
        const meta = Object.assign({}, item, schedule, {
          detailId: resolvedDetailId,
          semester,
          scheduleVersion: nextVersion,
        });
        if (type === "class") this.saveRecentSchedule(meta);
        this.navigateToScheduleView(type, displayName, schedule.courses || [], meta);
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: "课表详情加载失败", icon: "none" });
        if (platformUtils.isDeveloperEnv()) {
          console.warn("[school] openIndexedSchedule fail", err);
        }
      });
  },

  showTeacherSearchDiagnostics() {
    if (!platformUtils.isDeveloperEnv || !platformUtils.isDeveloperEnv()) {
      return;
    }
    const keyword = (this.data.keyword || "").trim();
    const normalize = (value) => String(value || "")
      .trim()
      .replace(/[\u3000\s]+/g, "")
      .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
      .replace(/\u3002/g, ".")
      .toLowerCase();
    const debug = this.lastTeacherSearchDebug || {};
    const samples = Array.isArray(debug.sampleItems)
      ? debug.sampleItems.map((item) => item.teacherName || item.name || item.id).filter(Boolean).join(" / ")
      : (this.data.teachersResult || []).slice(0, 5).map((item) => item.teacherName || item.name || item.id).filter(Boolean).join(" / ");
    this.setData({
      teacherDiagnosticText: [
        `release=${debug.releaseVersion || this.getReleaseVersionForCache() || "-"}`,
        `indexTotal=${debug.teacherIndexTotal ?? "-"}`,
        `keyword=${normalize(keyword)}`,
        `normalized=${debug.normalizedKeyword || normalize(keyword)}`,
        `before=${debug.beforeFilterCount ?? "-"}`,
        `collegeAfter=${debug.collegeFilteredCount ?? "-"}`,
        `keywordHits=${debug.keywordHitCount ?? this.data.teacherHitCount ?? 0}`,
        `samples=${samples || "-"}`,
      ].join("; "),
    });
  },

  // ================== 卡片点击进入课表详情 ==================

  viewClassSchedule(event) {
    const index = Number(event.currentTarget.dataset.index);
    const group = event.currentTarget.dataset.group;
    const source = group === "aggregate" ? this.data.classAggregateResults : this.data.classAdminResults;
    const item = source[index];
    if (!item) return;

    if (Array.isArray(item.courses) && item.courses.length > 0) {
      this.saveRecentSchedule(item);
      this.navigateToScheduleView("class", item.className, item.courses, item);
      return;
    }
    this.openIndexedSchedule("class", item, item.className);
  },

  viewTeacherSchedule(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.teachersResult[index];
    if (!item) return;

    if (Array.isArray(item.courses) && item.courses.length > 0) {
      this.navigateToScheduleView("teacher", item.teacherName, item.courses, item);
      return;
    }
    this.openIndexedSchedule("teacher", item, item.teacherName);
  },

  viewClassroomSchedule(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.classroomsResult[index];
    if (!item) return;

    if (Array.isArray(item.courses) && item.courses.length > 0) {
      this.navigateToScheduleView("classroom", item.roomName, item.courses, item);
      return;
    }
    this.openIndexedSchedule("classroom", item, item.roomName);
  },

  viewCourseSchedule(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.coursesResult[index];
    if (!item) return;

    if (Array.isArray(item.courses) && item.courses.length > 0) {
      this.navigateToScheduleView("course", item.courseName, item.courses, item);
      return;
    }
    this.openIndexedSchedule("course", item, item.courseName);
  },

  goEmptyRoom() {
    const term = this.getActiveTermForCache();
    const releaseVersion = this.getReleaseVersionForCache();
    const query = [
      `term=${encodeURIComponent(term)}`,
      releaseVersion ? `releaseVersion=${encodeURIComponent(releaseVersion)}` : "",
    ].filter(Boolean).join("&");
    wx.navigateTo({
      url: `/pages/empty-room/empty-room${query ? `?${query}` : ""}`,
    });
  },

  goCampusMap() {
    const keyword = String(this.data.keyword || "").trim();
    const parsed = classroomSearch.parseClassroomQuery(keyword);
    const q = parsed.buildingCode || (parsed.queryType === "text" ? keyword : parsed.normalizedQuery);
    wx.navigateTo({
      url: `/packageMaps/pages/campus-map/campus-map${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    });
  },

  returnClassroomMap() {
    const target = this.data.classroomMapReturn || null;
    wx.navigateTo({
      url: target && target.url || "/packageMaps/pages/campus-map/campus-map",
    });
  },

  goAiAssistant() {
    const keyword = String(this.data.keyword || "").trim();
    const question = keyword
      ? `帮我查${this.data.activeTab === "teacher" ? "老师" : (this.data.activeTab === "classroom" ? "教室" : "课程")} ${keyword}`
      : "帮我查老师课表";
    wx.navigateTo({
      url: `/packageXiaofu/pages/ai-assistant/ai-assistant?q=${encodeURIComponent(question)}`,
    });
  },

  navigateToScheduleView(type, name, courses, scheduleMeta) {
    // Prefer shared scheduleNavigationService URL builder (no courses in query).
    try {
      const scheduleNavigationService = require("../../services/scheduleNavigationService");
      const meta = scheduleMeta || {};
      const resolved = scheduleNavigationService.resolveScheduleNavigation({
        type,
        id: meta.detailId || meta.id,
        detailId: meta.detailId || meta.id,
        name,
        term: meta.semester || meta.term,
        releaseVersion: meta.scheduleVersion || meta.releaseVersion || meta.version,
        displayType: meta.displayType,
        isAggregated: meta.isAggregated,
        allowMissingReleaseVersion: true,
      });
      if (resolved.mode === "schedule-view" && resolved.url) {
        // Keep courses in memory path only when caller already loaded detail — schedule-view loads by id.
        wx.navigateTo({ url: resolved.url });
        return;
      }
    } catch (e) {
      // fall through to legacy builder
    }
    const semester = this.data.semesters[this.data.selectedSemesterIndex]?.value || getFallbackTerm();
    const meta = scheduleMeta || {};
    const displayType = meta.displayType || "";
    const isAggregated = meta.isAggregated ? "1" : "0";
    const detailId = meta.detailId || meta.id || meta.scheduleId || meta.classId || name || "";
    const releaseVersion = meta.scheduleVersion || meta.releaseVersion || this.getReleaseVersionForCache();
    
    wx.navigateTo({
      url: `/pages/schedule-view/schedule-view?type=${type}&id=${encodeURIComponent(detailId)}&name=${encodeURIComponent(name)}&semester=${encodeURIComponent(semester)}&term=${encodeURIComponent(semester)}&releaseVersion=${encodeURIComponent(releaseVersion)}&displayType=${encodeURIComponent(displayType)}&isAggregated=${isAggregated}`,
      success: (res) => {
        // 利用 EventChannel 传递大体积课程数据
        res.eventChannel.emit("acceptDataFromOpenerPage", {
          courses: courses || [],
          schedule: meta,
        });
      },
    });
  },

  toggleAggregate() {
    this.setData({
      showAggregate: !this.data.showAggregate
    }, () => {
      const classAdminResults = this.getPagedItems("classAdmin");
      const classAggregateResults = this.getPagedItems("classAggregate");
      this.setData({
        classesResult: classAdminResults.concat(this.data.showAggregate ? classAggregateResults : []),
        classAdminResults,
        classAggregateResults,
        hasMoreClassAdmin: this.hasMorePagedItems("classAdmin"),
        hasMoreClassAggregate: this.hasMorePagedItems("classAggregate"),
      });
    });
  },

  // ================== 多级加载计时器逻辑 ==================

  // 1. 初始化 app-config 与 catalog 专用加载计时器
  startLoadingStateTimer(retryFn) {
    this.clearLoadingStateTimer();
    this.retryFn = retryFn;
    this.setData({
      dataLoadState: "loading"
    });

    // 300ms 后切换至 skeleton 骨架展示
    this.loadingStateTimer300 = setTimeout(() => {
      this.setData({
        dataLoadState: "loading"
      });
    }, 300);

    // 3s 后如果还在加载中，说明网络慢，提示 “网络较慢，正在继续加载...”
    this.loadingStateTimer3000 = setTimeout(() => {
      this.setData({
        dataLoadState: "slow"
      });
    }, 3000);
  },

  clearLoadingStateTimer() {
    if (this.loadingStateTimer300) clearTimeout(this.loadingStateTimer300);
    if (this.loadingStateTimer3000) clearTimeout(this.loadingStateTimer3000);
  },

  // 2. 局部 search-index 专用加载计时器
  startLoadingTimer(retryFn, hasCache) {
    this.clearLoadingTimer();
    this.retryFn = retryFn;
    this.setData({
      loadingState: "loading",
      loading: true
    });

    // 300ms 后显示轻量 skeleton
    this.loadingTimer300 = setTimeout(() => {
      this.setData({
        loadingState: "skeleton"
      });
      // 只有在没有缓存时，才执行清空操作，防止闪烁/清空页面已显示数据
      if (!hasCache) {
        this.resetPagedResultStore();
        this.setData({
          classesResult: [],
          classAdminResults: [],
          classAggregateResults: [],
          teachersResult: [],
          teacherHitCount: 0,
          classroomsResult: [],
          coursesResult: [],
          classAdminTotal: 0,
          classAggregateTotal: 0,
          classroomsTotal: 0,
          coursesTotal: 0,
          hasMoreClassAdmin: false,
          hasMoreClassAggregate: false,
          hasMoreTeachers: false,
          hasMoreClassrooms: false,
          hasMoreCourses: false,
          updatedAtText: ""
        });
      }
    }, 300);

    // 3s 后显示 “网络较慢，正在继续加载...”
    this.loadingTimer3000 = setTimeout(() => {
      this.setData({
        loadingState: "slow"
      });
    }, 3000);
  },

  clearLoadingTimer() {
    if (this.loadingTimer300) clearTimeout(this.loadingTimer300);
    if (this.loadingTimer3000) clearTimeout(this.loadingTimer3000);
    this.setData({
      loading: false
    });
  },

  onRetryLoading() {
    if (typeof this.retryFn === "function") {
      this.retryFn();
    }
  },

  triggerActiveTabSearch() {
    const activeTab = this.data.activeTab;
    if (activeTab === "class") {
      const { selectedCollegeIndex, selectedGradeIndex, selectedMajorIndex } = this.data;
      if (selectedCollegeIndex >= 0 && selectedGradeIndex >= 0 && selectedMajorIndex >= 0) {
        this.searchClassSchedule();
      }
    } else if (activeTab === "teacher" && this.data.keyword.trim()) {
      this.searchTeacherSchedule();
    } else if (activeTab === "classroom" && this.data.keyword.trim()) {
      this.searchClassroomSchedule();
    } else if (activeTab === "course" && this.data.keyword.trim()) {
      this.searchCourseSchedule();
    }
  },

  resetPagedResultStore() {
    this._schoolResultStore = {
      classAdmin: [],
      classAggregate: [],
      teacher: [],
      classroom: [],
      course: [],
    };
    this._schoolResultVisible = {
      classAdmin: SCHOOL_RESULT_PAGE_SIZE,
      classAggregate: SCHOOL_RESULT_PAGE_SIZE,
      teacher: SCHOOL_RESULT_PAGE_SIZE,
      classroom: SCHOOL_RESULT_PAGE_SIZE,
      course: SCHOOL_RESULT_PAGE_SIZE,
    };
  },

  ensurePagedResultStore() {
    if (!this._schoolResultStore || !this._schoolResultVisible) {
      this.resetPagedResultStore();
    }
  },

  getPagedItems(key) {
    this.ensurePagedResultStore();
    const items = this._schoolResultStore[key] || [];
    const limit = this._schoolResultVisible[key] || SCHOOL_RESULT_PAGE_SIZE;
    return items.slice(0, limit);
  },

  hasMorePagedItems(key) {
    this.ensurePagedResultStore();
    const items = this._schoolResultStore[key] || [];
    const limit = this._schoolResultVisible[key] || SCHOOL_RESULT_PAGE_SIZE;
    return items.length > limit;
  },

  getLoadMoreStateForKey(key) {
    this.ensurePagedResultStore();
    const total = (this._schoolResultStore[key] || []).length;
    if (!total) return { state: "idle", text: "" };
    if (this.hasMorePagedItems(key)) return { state: "idle", text: "上滑或点击加载更多" };
    return { state: "done", text: "已加载全部" };
  },

  updateLoadMoreState(key) {
    const state = this.getLoadMoreStateForKey(key);
    this.setData({
      loadMoreState: state.state,
      loadMoreText: state.text,
    });
  },

  setClassPagedResults(grouped) {
    this.ensurePagedResultStore();
    this._schoolResultStore.classAdmin = grouped.admin || [];
    this._schoolResultStore.classAggregate = grouped.aggregate || [];
    this._schoolResultVisible.classAdmin = SCHOOL_RESULT_PAGE_SIZE;
    this._schoolResultVisible.classAggregate = SCHOOL_RESULT_PAGE_SIZE;
    const classAdminResults = this.getPagedItems("classAdmin");
    const classAggregateResults = this.getPagedItems("classAggregate");
    this.setData({
      classesResult: classAdminResults.concat(this.data.showAggregate ? classAggregateResults : []),
      classAdminResults,
      classAggregateResults,
      classAdminTotal: this._schoolResultStore.classAdmin.length,
      classAggregateTotal: this._schoolResultStore.classAggregate.length,
      hasMoreClassAdmin: this.hasMorePagedItems("classAdmin"),
      hasMoreClassAggregate: this.hasMorePagedItems("classAggregate"),
    });
    this.updateLoadMoreState("classAdmin");
  },

  setSimplePagedResults(key, dataKey, items, totalKey, hasMoreKey) {
    this.ensurePagedResultStore();
    this._schoolResultStore[key] = items || [];
    this._schoolResultVisible[key] = SCHOOL_RESULT_PAGE_SIZE;
    this.setData({
      [dataKey]: this.getPagedItems(key),
      [totalKey]: this._schoolResultStore[key].length,
      [hasMoreKey]: this.hasMorePagedItems(key),
    });
    this.updateLoadMoreState(key);
  },

  clearPagedResults(keys) {
    this.ensurePagedResultStore();
    const list = Array.isArray(keys) ? keys : [keys];
    const patch = {};
    list.forEach((key) => {
      this._schoolResultStore[key] = [];
      this._schoolResultVisible[key] = SCHOOL_RESULT_PAGE_SIZE;
      if (key === "classAdmin" || key === "classAggregate") {
        patch.classesResult = [];
        patch.classAdminResults = [];
        patch.classAggregateResults = [];
        patch.classAdminTotal = 0;
        patch.classAggregateTotal = 0;
        patch.hasMoreClassAdmin = false;
        patch.hasMoreClassAggregate = false;
      } else if (key === "teacher") {
        patch.teachersResult = [];
        patch.teacherHitCount = 0;
        patch.hasMoreTeachers = false;
      } else if (key === "classroom") {
        patch.classroomsResult = [];
        patch.classroomsTotal = 0;
        patch.hasMoreClassrooms = false;
      } else if (key === "course") {
        patch.coursesResult = [];
        patch.coursesTotal = 0;
        patch.hasMoreCourses = false;
      }
    });
    this.setData(patch);
    this.updateLoadMoreState((Array.isArray(keys) ? keys[0] : keys) || "teacher");
  },

  appendPagedResult(key) {
    this.ensurePagedResultStore();
    if (this._loadMoreBusy) return;
    if (!this.hasMorePagedItems(key)) {
      this.updateLoadMoreState(key);
      return;
    }
    this._loadMoreBusy = true;
    this.setData({ loadMoreState: "loading", loadMoreText: "正在加载更多" });
    this._schoolResultVisible[key] = (this._schoolResultVisible[key] || SCHOOL_RESULT_PAGE_SIZE) + SCHOOL_RESULT_PAGE_STEP;
    if (key === "classAdmin" || key === "classAggregate") {
      const classAdminResults = this.getPagedItems("classAdmin");
      const classAggregateResults = this.getPagedItems("classAggregate");
      this.setData({
        classesResult: classAdminResults.concat(this.data.showAggregate ? classAggregateResults : []),
        classAdminResults,
        classAggregateResults,
        hasMoreClassAdmin: this.hasMorePagedItems("classAdmin"),
        hasMoreClassAggregate: this.hasMorePagedItems("classAggregate"),
      });
      this._loadMoreBusy = false;
      this.updateLoadMoreState(this.hasMorePagedItems("classAdmin") ? "classAdmin" : "classAggregate");
      return;
    }
    if (key === "teacher") {
      this.setData({
        teachersResult: this.getPagedItems("teacher"),
        hasMoreTeachers: this.hasMorePagedItems("teacher"),
      });
      this._loadMoreBusy = false;
      this.updateLoadMoreState("teacher");
      return;
    }
    if (key === "classroom") {
      this.setData({
        classroomsResult: this.getPagedItems("classroom"),
        hasMoreClassrooms: this.hasMorePagedItems("classroom"),
      });
      this._loadMoreBusy = false;
      this.updateLoadMoreState("classroom");
      return;
    }
    if (key === "course") {
      this.setData({
        coursesResult: this.getPagedItems("course"),
        hasMoreCourses: this.hasMorePagedItems("course"),
      });
      this._loadMoreBusy = false;
      this.updateLoadMoreState("course");
    }
  },

  loadMoreActiveResults() {
    if (this._loadMoreBusy) return;
    const activeTab = this.data.activeTab;
    if (activeTab === "class") {
      if (this.data.hasMoreClassAdmin) {
        this.appendPagedResult("classAdmin");
        return;
      }
      if (this.data.showAggregate && this.data.hasMoreClassAggregate) {
        this.appendPagedResult("classAggregate");
      }
      return;
    }
    if (activeTab === "teacher" && this.data.hasMoreTeachers) {
      this.appendPagedResult("teacher");
      return;
    }
    if (activeTab === "classroom" && this.data.hasMoreClassrooms) {
      this.appendPagedResult("classroom");
      return;
    }
    if (activeTab === "course" && this.data.hasMoreCourses) {
      this.appendPagedResult("course");
    }
  },

  onReachBottom() {
    this.loadMoreActiveResults();
  },

  // ================== 查询内核执行器 (支持缓存兜底/版本隔离/静默刷新) ==================

  legacyExecuteSearch(type, params, renderFn, catchFn) {
    const query = Object.assign({ type }, params || {});
    const term = query.semester || query.term || (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || getFallbackTerm();
    query.term = term;
    delete query.semester; // 统一为 term

    const releaseVersion = query.releaseVersion || this.getReleaseVersionForCache();
    query.releaseVersion = releaseVersion;

    if (!releaseVersion) {
      console.warn("[school] 缺少 releaseVersion，先 loadAppConfig");
      appConfigService.loadAppConfig({ force: true }).then((config) => {
        const nextVersion = config.dataVersion?.releaseVersion;
        if (nextVersion) {
          this.setData({ catalogVersion: nextVersion });
          query.releaseVersion = nextVersion;
          this.executeSearch(type, query, renderFn, catchFn);
        } else {
          wx.showToast({ title: "未同步课程数据", icon: "none" });
        }
      }).catch(err => {
        console.error("[school] 缺少版本且重新 loadAppConfig 失败", err);
      });
      return;
    }

    const { readSameVersionIndexCache, writeSameVersionIndexCache } = require("../../utils/storage");

    // 1. 读取同版本缓存
    const cached = readSameVersionIndexCache(term, releaseVersion, type, query);

    const doNetworkRequest = () => {
      this.startLoadingTimer(doNetworkRequest, Boolean(cached));

      console.log("[school] request search-index", { type, term, releaseVersion, timeout: 30000 });

      request.get("/api/fosu/search-index", query, { showLoading: false, silentError: true, timeout: 30000 })
        .then((data) => {
          this.clearLoadingTimer();
          this.setData({ loadingState: "none" });
          writeSameVersionIndexCache(term, releaseVersion, type, data, query);
          
          console.log("[school] search-index success", { type, count: data?.items?.length || 0, duration: "N/A" });
          
          // 如果是班级且为空
          if (type === "class" && (!data.items || data.items.length === 0)) {
            this.setData({
              classEmptyTitle: "暂无匹配结果",
              classEmptyDesc: "请调整上方筛选条件，例如选择其他专业。",
            });
          }
          
          renderFn(data, false);
        })
        .catch((err) => {
          this.clearLoadingTimer();
          
          if (cached) {
            // 刷新失败但已有同版本缓存，不清空页面，默默提示
            this.setData({ loadingState: "none" });
            wx.showToast({
              title: "刷新失败，正在使用本地缓存",
              icon: "none",
              duration: 2000
            });
            console.warn("[school] search-index silent refresh failed", err);
          } else {
            console.error("[school] search-index failed", err);
            
            // 区分超时和普通错误
            if (err.code === "REQUEST_TIMEOUT" || err.code === "TIMEOUT") {
              this.setData({
                loadingState: "timeout"
              });
            } else {
              this.setData({
                loadingState: "networkError"
              });
            }
            catchFn(err);
          }
        });
    };

    if (cached) {
      console.log("[school] cache hit", { key: type, count: cached?.items?.length || 0 });
      renderFn(cached, true);
      this.setData({
        loadingState: "none",
        restoreHint: "已加载同版本缓存"
      });
    } else {
      // 发起网络请求
      doNetworkRequest();
    }
  },

  normalizeAppConfigForData(payload) {
    const data = payload && payload.data ? payload.data : payload;
    const config = Object.assign({
      currentSemester: DEFAULT_TERM,
      dataVersion: {},
      notices: [],
      news: [],
      disclaimer: BRAND.disclaimer,
    }, data || {});
    if (!Array.isArray(config.notices)) config.notices = [];
    if (!Array.isArray(config.news)) config.news = [];
    if (!config.dataVersion) config.dataVersion = {};
    return config;
  },

  getSnapshotReleaseKey(snapshot) {
    return getReleaseContentKey(snapshot);
  },

  getSnapshotInvalidationKey(snapshot) {
    return getReleaseInvalidationKey(snapshot);
  },

  buildActiveSnapshotFromAppConfig(payload) {
    const config = this.normalizeAppConfigForData(payload);
    const version = config.dataVersion || {};
    const scheduleUpdatedAt = config.scheduleUpdatedAt ||
      config.dataUpdatedAt ||
      config.publishedAt ||
      appConfigService.getLatestDataUpdatedAt(config) ||
      version.classScheduleUpdatedAt ||
      version.teacherScheduleUpdatedAt ||
      version.classroomScheduleUpdatedAt ||
      version.courseScheduleUpdatedAt ||
      "";
    const catalogUpdatedAt = config.catalogUpdatedAt || config.updatedAt || scheduleUpdatedAt || "";
    const releaseVersion = config.releaseVersion || config.activeReleaseVersion || version.releaseVersion || "";
    if (!releaseVersion) return null;

    return {
      term: config.term || config.currentSemester || DEFAULT_TERM,
      releaseVersion,
      // scheduleUpdatedAt is display-only; releaseVersion is the API/cache key.
      scheduleUpdatedAt,
      catalogUpdatedAt,
      cacheEpoch: config.cacheEpoch || version.cacheEpoch || catalogUpdatedAt || scheduleUpdatedAt || releaseVersion,
      forceRefreshToken: config.forceRefreshToken || version.forceRefreshToken || config.dataEpoch || "",
    };
  },

  buildActiveSnapshotFromBootstrap(payload) {
    const data = payload && payload.data ? payload.data : payload;
    if (!data || data.success === false) return null;
    const releaseVersion = data.releaseVersion || data.activeReleaseVersion || data.version || (data.versions && data.versions.snapshot) || "";
    if (!releaseVersion) return null;
    const scheduleUpdatedAt = data.dataUpdatedAt || data.publishedAt || data.updatedAt || "";
    const catalogUpdatedAt = data.catalogUpdatedAt || (data.metaDetails && data.metaDetails.catalogUpdatedAt) || data.updatedAt || scheduleUpdatedAt || "";
    return {
      term: data.term || data.semester || DEFAULT_TERM,
      releaseVersion,
      scheduleUpdatedAt,
      catalogUpdatedAt,
      cacheEpoch: data.cacheEpoch || catalogUpdatedAt || scheduleUpdatedAt || releaseVersion,
      forceRefreshToken: data.forceRefreshToken || data.dataEpoch || "",
    };
  },

  buildActiveSnapshotFromReleaseManifest(payload) {
    const manifest = payload && payload.manifest ? payload.manifest : payload;
    if (!manifest || manifest.success === false) return null;
    const releaseVersion = manifest.releaseVersion || manifest.version || "";
    if (!releaseVersion) return null;
    const updatedAt = manifest.updatedAt || manifest.publishedAt || "";
    return {
      term: manifest.term || manifest.semester || DEFAULT_TERM,
      releaseVersion,
      scheduleUpdatedAt: updatedAt,
      catalogUpdatedAt: manifest.catalogUpdatedAt || updatedAt,
      cacheEpoch: manifest.cacheEpoch || updatedAt || releaseVersion,
      forceRefreshToken: manifest.forceRefreshToken || manifest.dataEpoch || "",
    };
  },

  readCachedActiveSnapshot() {
    try {
      const cached = wx.getStorageSync(SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY);
      if (cached && cached.term && cached.releaseVersion) {
        return {
          term: cached.term,
          releaseVersion: cached.releaseVersion,
          scheduleUpdatedAt: cached.scheduleUpdatedAt || "",
          catalogUpdatedAt: cached.catalogUpdatedAt || "",
          cacheEpoch: cached.cacheEpoch || cached.releaseVersion,
          forceRefreshToken: cached.forceRefreshToken || "",
        };
      }
    } catch (error) {
      console.warn("[school] read activeSnapshot cache failed", error);
    }
    const term = getFallbackTerm();
    const lastGood = term ? releasePackService.getLastKnownGood(term) : null;
    return this.buildActiveSnapshotFromReleaseManifest(lastGood && lastGood.manifest);
  },

  writeCachedActiveSnapshot(snapshot) {
    if (!snapshot || !snapshot.term || !snapshot.releaseVersion) return;
    try {
      wx.setStorageSync(SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY, Object.assign({
        savedAt: Date.now(),
      }, snapshot));
    } catch (error) {
      console.warn("[school] write activeSnapshot cache failed", error);
    }
  },

  shouldShowReleaseNotice(snapshot) {
    if (!snapshot || !snapshot.releaseVersion) return false;
    const state = readReleaseNoticeState();
    if (
      state.lastNotifiedTerm === snapshot.term &&
      state.lastNotifiedReleaseVersion === snapshot.releaseVersion
    ) {
      return false;
    }
    writeReleaseNoticeState({
      lastNotifiedTerm: snapshot.term || "",
      lastNotifiedReleaseVersion: snapshot.releaseVersion || "",
      lastNotifiedAt: Date.now(),
    });
    return true;
  },

  shouldShowFilterHint() {
    const releaseVersion = this.getReleaseVersionForCache();
    if (!releaseVersion) return true;
    const state = readReleaseNoticeState();
    if (state.lastFilterHintReleaseVersion === releaseVersion) return false;
    writeReleaseNoticeState({
      lastFilterHintReleaseVersion: releaseVersion,
      lastFilterHintAt: Date.now(),
    });
    return true;
  },

  getStateFromError(error) {
    const code = error && (error.code || error.reasonCode || (error.payload && (error.payload.code || error.payload.reasonCode)));
    if (code === "NO_ACTIVE_RELEASE" || code === "NO_RELEASE_DATA") return "noRelease";
    if (code === "REQUEST_TIMEOUT" || code === "TIMEOUT") return "timeout";
    return "networkError";
  },

  async resolveActiveSnapshot(options = {}) {
    const forceNetwork = Boolean(options.forceNetwork);
    const cached = this.readCachedActiveSnapshot();
    if (cached && !forceNetwork) {
      const platformSnapshot = platformDataService.getCachedPlatformSnapshot();
      const platformLooksNewer = platformSnapshot && platformSnapshot.releaseVersion &&
        this.getSnapshotReleaseKey(platformSnapshot) !== this.getSnapshotReleaseKey(cached);
      if (platformLooksNewer) {
        this.writeCachedActiveSnapshot(platformSnapshot);
        return {
          activeSnapshot: platformSnapshot,
          appConfig: appConfigService.getGlobalConfig(),
          source: "platform-data-cache",
          fromStorage: true,
        };
      }
      this.refreshActiveSnapshotInBackground(cached);
      return {
        activeSnapshot: cached,
        appConfig: appConfigService.getGlobalConfig(),
        source: "active-snapshot-cache",
        fromStorage: true,
      };
    }

    if (this._activeSnapshotInflight && options.dedupe !== false) {
      return this._activeSnapshotInflight;
    }

    this._activeSnapshotInflight = this.resolveActiveSnapshotFromNetwork(cached, options)
      .finally(() => {
        this._activeSnapshotInflight = null;
      });
    return this._activeSnapshotInflight;
  },

  async resolveActiveSnapshotFromNetwork(cached, options = {}) {
    let lastError = null;
    let sawNoRelease = false;

    try {
      const pointer = await startupCoordinator.resolveRuntimePointer({
        timeout: 5000,
        retries: 0,
        forceNetwork: Boolean(options.forceNetwork),
      });
      const activeSnapshot = pointer && {
        term: pointer.activeTerm || pointer.term,
        releaseVersion: pointer.releaseVersion,
        scheduleUpdatedAt: pointer.updatedAt || "",
        catalogUpdatedAt: pointer.updatedAt || "",
        cacheEpoch: pointer.cacheEpoch,
        forceRefreshToken: pointer.forceRefreshToken,
        counts: {},
        termConfig: pointer.termConfig || null,
      };
      if (activeSnapshot && activeSnapshot.releaseVersion) {
        this.writeCachedActiveSnapshot(activeSnapshot);
        return {
          activeSnapshot,
          appConfig: appConfigService.getGlobalConfig(),
          source: pointer.fromStorage ? "runtime-pointer-cache" : "runtime-pointer",
          fromStorage: Boolean(pointer.fromStorage),
        };
      }
    } catch (error) {
      lastError = error;
      console.warn("[school] runtime pointer unavailable, trying release manifest", error);
    }

    try {
      const pack = await releasePackService.switchReleaseSafely({
        term: cached && cached.term || getFallbackTerm(),
        forceNetwork: Boolean(options.forceNetwork),
        skipWarmup: true,
      });
      const activeSnapshot = this.buildActiveSnapshotFromReleaseManifest(pack && pack.manifest);
      if (activeSnapshot) {
        this.writeCachedActiveSnapshot(activeSnapshot);
        return {
          activeSnapshot,
          appConfig: appConfigService.getGlobalConfig(),
          source: pack.fromStorage ? "release-pack-last-good" : "release-pack",
          fromStorage: Boolean(pack.fromStorage),
          warning: pack.fallback ? pack.fallbackReason : null,
        };
      }
    } catch (error) {
      lastError = error;
      const code = error && (error.code || error.reasonCode);
      if (code === "NO_ACTIVE_RELEASE" || code === "NO_RELEASE_DATA") {
        sawNoRelease = true;
      }
      console.warn("[school] release-pack unavailable, trying app-config", error);
      if (cached) {
        return {
          activeSnapshot: cached,
          appConfig: appConfigService.getGlobalConfig(),
          source: "active-snapshot-cache",
          fromStorage: true,
          warning: error,
        };
      }
    }

    try {
      const payload = await request.get("/api/fosu/app-config", {}, {
        showLoading: false,
        silentError: true,
        timeout: APP_CONFIG_TIMEOUT,
      });
      const config = this.normalizeAppConfigForData(payload);
      if (typeof appConfigService.cacheAppConfig === "function") {
        appConfigService.cacheAppConfig(config);
      }
      const activeSnapshot = this.buildActiveSnapshotFromAppConfig(config);
      if (activeSnapshot) {
        this.writeCachedActiveSnapshot(activeSnapshot);
        return { activeSnapshot, appConfig: config, source: "app-config" };
      }
      sawNoRelease = true;
    } catch (error) {
      lastError = error;
      const code = error && (error.code || error.reasonCode);
      if (code === "NO_ACTIVE_RELEASE" || code === "NO_RELEASE_DATA") {
        sawNoRelease = true;
      }
      if (cached && (code === "REQUEST_TIMEOUT" || code === "TIMEOUT")) {
        return {
          activeSnapshot: cached,
          appConfig: appConfigService.getGlobalConfig(),
          source: "active-snapshot-cache",
          fromStorage: true,
          warning: error,
        };
      }
      console.warn("[school] app-config unavailable, trying bootstrap", error);
    }

    try {
      const bootstrapQuery = cached && cached.term ? { semester: cached.term } : {};
      const payload = await request.get("/api/fosu/bootstrap", bootstrapQuery, {
        showLoading: false,
        silentError: true,
        timeout: BOOTSTRAP_TIMEOUT,
      });
      const activeSnapshot = this.buildActiveSnapshotFromBootstrap(payload);
      if (activeSnapshot) {
        this.writeCachedActiveSnapshot(activeSnapshot);
        return {
          activeSnapshot,
          appConfig: appConfigService.getGlobalConfig(),
          bootstrapData: payload,
          source: "bootstrap",
        };
      }
      sawNoRelease = true;
    } catch (error) {
      lastError = error;
      const code = error && (error.code || error.reasonCode);
      if (code === "NO_ACTIVE_RELEASE" || code === "NO_RELEASE_DATA") {
        sawNoRelease = true;
      }
      console.warn("[school] bootstrap unavailable", error);
    }

    if (cached) {
      return {
        activeSnapshot: cached,
        appConfig: appConfigService.getGlobalConfig(),
        source: "active-snapshot-cache",
        fromStorage: true,
        warning: lastError,
      };
    }

    return {
      activeSnapshot: null,
      state: sawNoRelease ? "noRelease" : this.getStateFromError(lastError),
      error: lastError,
    };
  },

  refreshActiveSnapshotInBackground(currentSnapshot) {
    if (this._snapshotRefreshRunning) return;
    if (releasePackService.readRuntimeCircuit && releasePackService.readRuntimeCircuit()) return;
    this._snapshotRefreshRunning = true;
    this.resolveActiveSnapshot({ forceNetwork: true })
      .then((result) => {
        const next = result && result.activeSnapshot;
        if (!next || !currentSnapshot) return;
        const nextReleaseKey = this.getSnapshotReleaseKey(next);
        const currentReleaseKey = this.getSnapshotReleaseKey(currentSnapshot);
        if (nextReleaseKey !== currentReleaseKey) {
          if (this.shouldShowReleaseNotice(next)) {
            this.pendingReleaseNoticeText = "检测到新版本，已刷新";
          }
          this.initPageData({ reason: "snapshotRefresh" });
          return;
        }
        if (this.getSnapshotInvalidationKey(next) !== this.getSnapshotInvalidationKey(currentSnapshot)) {
          this.writeCachedActiveSnapshot(next);
        }
      })
      .catch((error) => {
        console.warn("[school] background activeSnapshot refresh failed", error);
      })
      .finally(() => {
        this._snapshotRefreshRunning = false;
      });
  },

  checkActiveSnapshotFreshness() {
    const now = Date.now();
    if (this._lastBackgroundSnapshotCheckAt && now - this._lastBackgroundSnapshotCheckAt < SCHOOL_BACKGROUND_REFRESH_MIN_INTERVAL_MS) {
      return;
    }
    this._lastBackgroundSnapshotCheckAt = now;
    const current = this.data.activeSnapshot || this.readCachedActiveSnapshot();
    if (current) {
      this.refreshActiveSnapshotInBackground(current);
    }
  },

  buildCatalogFromClassIndex(indexPayload, snapshot = {}) {
    const items = Array.isArray(indexPayload && indexPayload.items) ? indexPayload.items : [];
    if (!items.length) return null;
    const term = snapshot.term || indexPayload.term || indexPayload.semester || DEFAULT_TERM;
    const collegesMap = {};
    const gradesSet = {};
    const majorsMap = {};
    items.forEach((item) => {
      const collegeCode = String(item.collegeCode || "").trim();
      const collegeName = String(item.collegeName || item.college || "").trim();
      const grade = String(item.grade || "").trim();
      const majorCode = String(item.majorCode || "").trim();
      const majorName = String(item.majorName || "").trim();
      if (collegeCode || collegeName) {
        const key = collegeCode || collegeName;
        collegesMap[key] = {
          code: collegeCode || key,
          name: collegeName || collegeCode || key,
        };
      }
      if (grade) gradesSet[grade] = true;
      if (majorCode || majorName) {
        const key = [collegeCode, grade, majorCode || majorName].join(":");
        majorsMap[key] = {
          collegeCode,
          code: majorCode || majorName,
          name: majorName || majorCode,
          grade,
        };
      }
    });
    const colleges = Object.keys(collegesMap)
      .map((key) => collegesMap[key])
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "zh-CN"));
    const grades = Object.keys(gradesSet).sort((left, right) => String(right).localeCompare(String(left)));
    const majors = Object.keys(majorsMap)
      .map((key) => majorsMap[key])
      .sort((left, right) => {
        const gradeDiff = String(right.grade || "").localeCompare(String(left.grade || ""));
        if (gradeDiff !== 0) return gradeDiff;
        return String(left.name || "").localeCompare(String(right.name || ""), "zh-CN");
      });
    if (!colleges.length || !grades.length) return null;
    return {
      success: true,
      dataSource: indexPayload.fromStorage ? "release-pack-index-cache" : "release-pack-index",
      semesters: [{ value: term, label: term }],
      colleges,
      grades,
      majors,
      updatedAt: snapshot.catalogUpdatedAt || snapshot.scheduleUpdatedAt || indexPayload.updatedAt || "",
      version: snapshot.releaseVersion || indexPayload.releaseVersion || indexPayload.version || "",
    };
  },

  async initPageData(options = {}) {
    const seq = ++this._activeInitSeq;
    this._lastInitAt = Date.now();
    this.loadRecentSchedules();
    this.setData({
      dataLoadState: "loading",
      loadingState: "none",
      catalogEmpty: false,
      restoreHint: "",
    });

    const retryFn = () => this.initPageData({ reason: "retry", forceNetwork: true });
    this.startLoadingStateTimer(retryFn);

    try {
      const resolved = await this.resolveActiveSnapshot({ forceNetwork: Boolean(options.forceNetwork) });
      if (seq !== this._activeInitSeq) return;

      if (!resolved || !resolved.activeSnapshot) {
        this.clearLoadingStateTimer();
        const state = resolved && resolved.state ? resolved.state : "networkError";
        this.setData({
          dataLoadState: state,
          catalogEmpty: state === "noRelease",
          loadingState: "none",
        });
        return;
      }

      const activeSnapshot = resolved.activeSnapshot;
      const releaseKey = this.getSnapshotReleaseKey(activeSnapshot);
      const localReleaseKey = normalizeStoredReleaseKey(wx.getStorageSync("FOSU_LOCAL_RELEASE_KEY") || "");
      let didRefresh = false;

      if (localReleaseKey && localReleaseKey !== releaseKey) {
        if (resolved.source === "release-pack" && !resolved.fromStorage) {
          releasePackService.clearOldReleaseCaches({
            keepLatestN: 2,
            keepReleases: [activeSnapshot.releaseVersion],
          });
        }
        didRefresh = true;
        this.needAutoSearch = true;
        if (this.shouldShowReleaseNotice(activeSnapshot)) {
          this.pendingReleaseNoticeText = "检测到新版本，已刷新";
        }
      }

      wx.setStorageSync("FOSU_LOCAL_RELEASE_KEY", releaseKey);
      this.writeCachedActiveSnapshot(activeSnapshot);

      const appConfig = this.normalizeAppConfigForData(resolved.appConfig || appConfigService.getGlobalConfig());
      const schoolNotice = appConfigService.getPrimaryNotice(appConfig, "school", ["banner", "card"]) || null;
      const displayUpdatedAt = activeSnapshot.scheduleUpdatedAt || activeSnapshot.catalogUpdatedAt || "";
      this.setData({
        activeSnapshot,
        appConfig,
        schoolNotice,
        dataVersionText: displayUpdatedAt ? `数据更新于 ${appConfigService.formatConfigTime(displayUpdatedAt)}` : "",
        runtimeDisclaimer: appConfig.disclaimer || BRAND.disclaimer,
        catalogVersion: activeSnapshot.releaseVersion,
        catalogUpdatedAt: activeSnapshot.catalogUpdatedAt || "",
      });

      if (didRefresh) {
        this.loadRecentSchedules();
      }

      this.loadCatalogData(activeSnapshot, { seq, bootstrapData: resolved.bootstrapData });
    } catch (error) {
      if (seq !== this._activeInitSeq) return;
      this.clearLoadingStateTimer();
      this.setData({
        dataLoadState: this.getStateFromError(error),
        loadingState: "none",
      });
    }
  },

  loadCatalogData(snapshotOrTerm, releaseVersionOrOptions, maybeOptions) {
    const snapshot = typeof snapshotOrTerm === "object"
      ? snapshotOrTerm
      : {
        term: snapshotOrTerm || getFallbackTerm(),
        releaseVersion: releaseVersionOrOptions || this.getReleaseVersionForCache(),
      };
    const options = typeof releaseVersionOrOptions === "object" ? releaseVersionOrOptions : (maybeOptions || {});
    const seq = options.seq || this._activeInitSeq;
    const term = snapshot.term || getFallbackTerm();
    const releaseVersion = snapshot.releaseVersion || "";
    const catalogCacheKey = getSchoolCatalogCacheKey(term, releaseVersion);
    const legacyCatalogKey = `school:catalog:${term}:${releaseVersion}`;

    let cachedCatalog = null;
    try {
      cachedCatalog = wx.getStorageSync(catalogCacheKey) || wx.getStorageSync(legacyCatalogKey);
    } catch (error) {
      console.warn("[school] read catalog cache failed", error);
    }

    const normalizeCatalog = (payload) => {
      const data = payload && payload.catalog ? payload.catalog : payload;
      if (!data || !Array.isArray(data.colleges) || data.colleges.length === 0) return null;
      return Object.assign({}, data, {
        dataSource: payload.dataSource || data.dataSource || "cache",
        updatedAt: payload.updatedAt || data.updatedAt || snapshot.catalogUpdatedAt || snapshot.scheduleUpdatedAt || "",
        version: payload.releaseVersion || payload.version || (payload.versions && payload.versions.snapshot) || data.version || releaseVersion,
        success: true,
      });
    };

    const writeCatalogCache = (catalogData) => {
      try {
        wx.setStorageSync(catalogCacheKey, catalogData);
      } catch (error) {
        console.warn("[school] write catalog cache failed", error);
      }
    };

    const renderCatalog = (catalogData, fromCache) => {
      if (seq !== this._activeInitSeq) return;
      this.originalCatalogData = catalogData;
      this.applyCatalogFilter();
      this.clearLoadingStateTimer();
      this.setData({
        dataLoadState: "success",
        catalogEmpty: false,
        catalogVersion: releaseVersion,
        catalogUpdatedAt: catalogData.updatedAt || snapshot.catalogUpdatedAt || "",
        restoreHint: this.pendingReleaseNoticeText || (fromCache ? "已显示本地缓存，正在校验更新" : ""),
      });
      this.pendingReleaseNoticeText = "";

      if (this.applyDirectSchoolQueryIfNeeded()) {
        return;
      }
      if (this.hasSharedQuery()) {
        this.applySharedQueryIfNeeded();
      } else {
        this.restoreFilterCache();
      }

      if (this.needAutoSearch) {
        this.needAutoSearch = false;
        this.triggerActiveTabSearch();
      }
    };

    const handleCatalogError = (error) => {
      if (seq !== this._activeInitSeq) return;
      console.warn("[school] catalog refresh failed", error);
      if (cachedCatalog) {
        this.clearLoadingStateTimer();
        this.setData({
          dataLoadState: "success",
          restoreHint: "已显示本地缓存，正在校验更新",
        });
        return;
      }
      this.clearLoadingStateTimer();
      const state = this.getStateFromError(error);
      this.setData({
        dataLoadState: state === "noRelease" ? "noRelease" : state,
        catalogEmpty: state === "noRelease",
      });
    };

    const fetchCatalogFromNetwork = () => {
      if (releasePackService.readRuntimeCircuit && releasePackService.readRuntimeCircuit()) {
        const error = new Error("RUNTIME_POINTER_CIRCUIT_OPEN");
        error.code = "RUNTIME_POINTER_CIRCUIT_OPEN";
        handleCatalogError(error);
        return;
      }
      request.get("/api/fosu/bootstrap", { semester: term }, {
        showLoading: false,
        silentError: true,
        timeout: BOOTSTRAP_TIMEOUT,
      })
        .then((payload) => {
          const catalogData = normalizeCatalog(payload);
          if (catalogData) {
            writeCatalogCache(catalogData);
            renderCatalog(catalogData, false);
            return;
          }
          return request.get("/api/fosu/catalog", { semester: term }, {
            showLoading: false,
            silentError: true,
            timeout: SCHOOL_REQUEST_TIMEOUT,
          }).then((fallback) => {
            const fallbackCatalog = normalizeCatalog(fallback);
            if (!fallbackCatalog) {
              const error = new Error("CATALOG_EMPTY");
              error.code = "CATALOG_EMPTY";
              throw error;
            }
            writeCatalogCache(fallbackCatalog);
            renderCatalog(fallbackCatalog, false);
          });
        })
        .catch(handleCatalogError);
    };

    const renderFromReleasePackIndex = (indexPayload, fromCache) => {
      const catalogData = this.buildCatalogFromClassIndex(indexPayload, snapshot);
      if (!catalogData) return false;
      writeCatalogCache(catalogData);
      renderCatalog(catalogData, fromCache);
      return true;
    };

    const cachedClassIndex = releasePackService.readCachedIndex("class", { term, releaseVersion });
    if (cachedCatalog) {
      renderCatalog(cachedCatalog, true);
      if (releasePackService.readRuntimeCircuit && releasePackService.readRuntimeCircuit()) return;
      fetchCatalogFromNetwork();
      return;
    }

    if (cachedClassIndex && renderFromReleasePackIndex(cachedClassIndex, true)) {
      if (releasePackService.readRuntimeCircuit && releasePackService.readRuntimeCircuit()) return;
      fetchCatalogFromNetwork();
      return;
    }

    const bootstrapCatalog = normalizeCatalog(options.bootstrapData);
    if (bootstrapCatalog) {
      writeCatalogCache(bootstrapCatalog);
      renderCatalog(bootstrapCatalog, false);
      releasePackService.warmupIndex(["class"], { term, releaseVersion, skipFallback: true })
        .catch(() => {});
      return;
    }

    fetchCatalogFromNetwork();
    if (cachedClassIndex) {
      releasePackService.loadIndex("class", { term, releaseVersion }, {
        forceNetwork: false,
        timeout: SCHOOL_REQUEST_TIMEOUT,
      })
        .then((indexPayload) => renderFromReleasePackIndex(indexPayload, false))
        .catch(() => {});
      return;
    }

    return;
  },

  getReleaseVersionForCache(fallbackVersion) {
    return fallbackVersion ||
      (this.data.activeSnapshot && this.data.activeSnapshot.releaseVersion) ||
      this.data.catalogVersion ||
      (this.data.appConfig && this.data.appConfig.dataVersion && this.data.appConfig.dataVersion.releaseVersion) ||
      "";
  },

  getActiveTermForCache(fallbackTerm) {
    return fallbackTerm ||
      (this.data.activeSnapshot && this.data.activeSnapshot.term) ||
      (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) ||
      DEFAULT_TERM;
  },

  getFilterCacheKey() {
    const term = this.getActiveTermForCache();
    const releaseVersion = this.getReleaseVersionForCache();
    return getSchoolFilterCacheKey(term, releaseVersion);
  },

  fetchSearchIndex(type, params, options = {}) {
    const seq = ++this._schoolRequestSeq;
    const query = Object.assign({ type }, params || {});
    const term = query.term || query.semester || this.getActiveTermForCache();
    const releaseVersion = query.releaseVersion || this.getReleaseVersionForCache();
    query.term = term;
    query.releaseVersion = releaseVersion;
    delete query.semester;

    if (!releaseVersion) {
      const error = new Error("NO_ACTIVE_SNAPSHOT");
      error.code = "NO_ACTIVE_SNAPSHOT";
      return Promise.reject(error);
    }

    const cached = releasePackService.readCachedSearchIndex(type, query) ||
      readSameVersionIndexCache(term, releaseVersion, type, query);
    if (cached) {
      return Promise.resolve(Object.assign({}, cached, { fromStorage: true }));
    }

    return releasePackService.searchIndex(type, query, Object.assign({
      forceNetwork: Boolean(options.forceNetwork),
      timeout: SCHOOL_REQUEST_TIMEOUT,
    }, options))
      .then((data) => {
        if (seq !== this._schoolRequestSeq) {
          const stale = new Error("STALE_REQUEST");
          stale.stale = true;
          throw stale;
        }
        writeSameVersionIndexCache(term, releaseVersion, type, data, query);
        return data;
      })
      .catch((error) => {
        if (type === "teacher") {
          throw error;
        }
        return request.get("/api/fosu/search-index", query, Object.assign({
          showLoading: false,
          silentError: true,
          timeout: SCHOOL_REQUEST_TIMEOUT,
        }, options))
          .then((data) => {
            if (seq !== this._schoolRequestSeq) {
              const stale = new Error("STALE_REQUEST");
              stale.stale = true;
              throw stale;
            }
            writeSameVersionIndexCache(term, releaseVersion, type, data, query);
            return data;
          })
          .catch(() => {
            throw error;
          });
      });
  },

  getScheduleDetailCache(type, id, version, term) {
    const activeVersion = this.getReleaseVersionForCache(version);
    const activeTerm = this.getActiveTermForCache(term);
    const cacheKey = getScheduleDetailCacheKey(activeTerm, activeVersion, type, id);
    try {
      const cached = wx.getStorageSync(cacheKey);
      if (!cached || Date.now() - cached.savedAt > SCHEDULE_DETAIL_CACHE_TTL) return null;
      return cached.schedule || null;
    } catch (error) {
      return null;
    }
  },

  setScheduleDetailCache(type, id, version, term, schedule) {
    const activeVersion = this.getReleaseVersionForCache(version);
    const activeTerm = this.getActiveTermForCache(term);
    const cacheKey = getScheduleDetailCacheKey(activeTerm, activeVersion, type, id);
    try {
      wx.setStorageSync(cacheKey, {
        savedAt: Date.now(),
        schedule,
      });
    } catch (error) {
      console.warn("[school] write detail cache failed", error);
    }
  },

  executeSearch(type, params, renderFn, catchFn) {
    const query = Object.assign({ type }, params || {});
    const term = query.term || query.semester || this.getActiveTermForCache();
    const releaseVersion = query.releaseVersion || this.getReleaseVersionForCache();
    query.term = term;
    query.releaseVersion = releaseVersion;
    delete query.semester;

    if (!releaseVersion) {
      this.resolveActiveSnapshot()
        .then((resolved) => {
          if (resolved && resolved.activeSnapshot) {
            this.setData({
              activeSnapshot: resolved.activeSnapshot,
              catalogVersion: resolved.activeSnapshot.releaseVersion,
            });
            this.executeSearch(type, query, renderFn, catchFn);
            return;
          }
          this.setData({ loadingState: resolved && resolved.state === "timeout" ? "timeout" : "networkError" });
        })
        .catch((error) => {
          this.setData({ loadingState: this.getStateFromError(error) === "timeout" ? "timeout" : "networkError" });
        });
      return;
    }

    const seq = ++this._schoolRequestSeq;
    const cached = releasePackService.readCachedSearchIndex(type, query) ||
      readSameVersionIndexCache(term, releaseVersion, type, query);
    const isRuntimeCircuitOpen = () => Boolean(
      releasePackService.readRuntimeCircuit && releasePackService.readRuntimeCircuit()
    );

    const doNetworkRequest = (hasCache) => {
      if (hasCache && isRuntimeCircuitOpen()) {
        this.setData({
          loadingState: "none",
          dataLoadState: "success",
          restoreHint: "已显示本地缓存，网络熔断中",
        });
        return;
      }
      if (!hasCache) {
        this.startLoadingTimer(() => doNetworkRequest(false), false);
      } else {
        this.retryFn = () => doNetworkRequest(true);
      }

      // Teacher Search Contract: full local/static index + client filter first.
      // Server is fallback only (never used to overwrite full teacher index cache).
      const requestIndex = () => {
        if (type === "teacher") {
          return releasePackService.searchIndex(type, query, {
            forceNetwork: true,
            timeout: SCHOOL_REQUEST_TIMEOUT,
            preferServerSearch: true,
            allowServerFallback: true,
          });
        }
        return releasePackService.searchIndex(type, query, {
          forceNetwork: true,
          timeout: SCHOOL_REQUEST_TIMEOUT,
        }).catch((packError) => request.get("/api/fosu/search-index", Object.assign({}, query, {
          type,
        }), {
          showLoading: false,
          silentError: true,
          timeout: SCHOOL_REQUEST_TIMEOUT,
        }).catch(() => {
          throw packError;
        }));
      };

      requestIndex()
        .then((data) => {
          if (seq !== this._schoolRequestSeq) return;
          this.clearLoadingTimer();
          this.setData({ loadingState: "none" });
          writeSameVersionIndexCache(term, releaseVersion, type, data, query);

          if (!data.items || data.items.length === 0) {
            this.setData({ dataLoadState: "empty" });
            if (type === "class") {
              this.setData({
                classEmptyTitle: "暂无匹配结果",
                classEmptyDesc: "暂无匹配结果，请调整筛选条件",
              });
            }
          } else {
            this.setData({ dataLoadState: "success" });
          }

          renderFn(data, false);
        })
        .catch((error) => {
          if (seq !== this._schoolRequestSeq) return;
          this.clearLoadingTimer();
          if (cached) {
            this.setData({
              loadingState: "none",
              dataLoadState: "success",
              restoreHint: "已显示本地缓存，正在校验更新",
            });
            console.warn("[school] search-index refresh failed; keeping cache", error);
            return;
          }

          const state = this.getStateFromError(error);
          if (state === "noRelease") {
            this.setData({
              dataLoadState: "noRelease",
              loadingState: "none",
              catalogEmpty: true,
            });
          } else {
            this.setData({
              loadingState: state === "timeout" ? "timeout" : "networkError",
            });
          }
          if (typeof catchFn === "function") {
            catchFn(error);
          }
        });
    };

    if (cached) {
      renderFn(cached, true);
      this.setData({
        dataLoadState: "success",
        loadingState: "none",
        restoreHint: "已显示同版本缓存",
      });
      if (isRuntimeCircuitOpen()) {
        this.setData({ restoreHint: "已显示本地缓存，网络熔断中" });
        return;
      }
      return;
    }

    doNetworkRequest(false);
  }
});

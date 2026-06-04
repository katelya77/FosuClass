const BRAND = require("../../config/brand");

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
const DEFAULT_TERM = "2025-2026-2";
const SCHEDULE_DETAIL_CACHE_TTL = 6 * 60 * 60 * 1000;
const APP_CONFIG_TIMEOUT = 12000;
const BOOTSTRAP_TIMEOUT = 20000;
const SCHOOL_REQUEST_TIMEOUT = 45000;

const request = require("../../utils/request");
const appConfigService = require("../../services/appConfigService");
const platformDataService = require("../../services/platformDataService");
const releasePackService = require("../../services/releasePackService");
const {
  SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY,
  getRecentSchedules,
  addRecentSchedule,
  removeRecentSchedule,
  clearRecentSchedules,
  clearAllSchoolCaches,
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
  const name = source.name || source.teacherName || source.roomName || source.classroomName || source.courseName || "";
  const common = Object.assign({}, source, {
    detailId: source.id || name,
    scheduleVersion: version || source.version || "",
    courses: Array.isArray(source.courses) ? source.courses : [],
    courseCount: Number(source.courseCount || source.count || (Array.isArray(source.courses) ? source.courses.length : 0)) || 0,
  });
  if (type === "teacher") {
    return Object.assign(common, {
      teacherName: source.teacherName || name,
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
    
    // 教师筛选项
    titleOptions: ["正高级", "副高级", "中级", "助理级", "员级", "其他"],
    selectedTitleIndex: -1,
    
    // 教室/课程筛选项
    campusOptions: ["仙溪校区", "江湾校区", "河滨校区"],
    selectedCampusIndex: -1,
    
    // 查询得到的结果列表
    classesResult: [],
    classAdminResults: [],
    classAggregateResults: [],
    teachersResult: [],
    classroomsResult: [],
    coursesResult: [],
    
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
  },
  
  // 缓存清理后自动重载标志
  needAutoSearch: false,
  isFirstLoad: true,

  onLoad(options) {
    this.sharedQuery = options || {};
    this.isFirstLoad = false;
    this._schoolRequestSeq = 0;
    this._activeInitSeq = 0;
    this._lastInitAt = 0;
    this.initPageData({ reason: "onLoad" });
  },

  onShow() {
    // 拦截设置页清除缓存引发的重载标志
    const needAutoReload = wx.getStorageSync("FOSU_SCHOOL_NEED_AUTO_RELOAD");
    if (needAutoReload) {
      wx.removeStorageSync("FOSU_SCHOOL_NEED_AUTO_RELOAD");
      this.setData({
        classesResult: [],
        classAdminResults: [],
        classAggregateResults: [],
        teachersResult: [],
        classroomsResult: [],
        coursesResult: [],
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

    const now = Date.now();
    if (!this._lastInitAt || now - this._lastInitAt >= 5000) {
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
        const term = config.currentSemester || "2025-2026-2";
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

        const remoteReleaseKey = `${term}:${releaseVersion}:${cacheEpoch}`;
        const localReleaseKey = wx.getStorageSync("FOSU_LOCAL_RELEASE_KEY");

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

          wx.showToast({
            title: "检测到课表新版本，已自动更新",
            icon: "none",
            duration: 2000
          });

          didRefresh = true;
          this.needAutoSearch = true;
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
        if (err.code === "REQUEST_TIMEOUT") {
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
      request.get("/api/fosu/bootstrap", { semester: term }, { showLoading: false, silentError: true, timeout: 12000 })
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
        if (err.code === "REQUEST_TIMEOUT") {
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
    const term = source.semester || source.term || (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || "2025-2026-2";
    const releaseVersion = this.getReleaseVersionForCache(version);
    return getSchoolIndexCacheKey(term, releaseVersion, type, source);
  },

  legacyReadIndexCache(type, params) {
    try {
      const cacheKey = this.buildIndexCacheKey(type, params);
      const cached = wx.getStorageSync(cacheKey);
      if (!cached || Date.now() - cached.savedAt > 30 * 60 * 1000) return null;
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
      query.term = (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || "2025-2026-2";
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
      const activeSemester = (data.semesters && data.semesters[0]?.value) || "2025-2026-2";
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
    this.setData({
      activeTab: tabKey,
      keyword: "",
      // 清空当前结果，避免误导
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      teachersResult: [],
      classroomsResult: [],
      coursesResult: [],
      updatedAtText: "",
      classEmptyTitle: "请选择上方筛选并查询",
      classEmptyDesc: "查询后将展示行政班级课表，结果仅供参考。",
      classNoticeText: "",
    });
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });
    if (this.keywordSearchTimer) {
      clearTimeout(this.keywordSearchTimer);
    }
    const activeTab = this.data.activeTab;
    if (!["teacher", "classroom", "course"].includes(activeTab) || keyword.trim().length < 2) {
      return;
    }
    this.keywordSearchTimer = setTimeout(() => {
      if (this.data.keyword.trim() !== keyword.trim()) return;
      if (activeTab === "teacher") this.searchTeacherSchedule();
      if (activeTab === "classroom") this.searchClassroomSchedule();
      if (activeTab === "course") this.searchCourseSchedule();
    }, 350);
  },

  fallbackToCatalog() {
    request.get("/api/fosu/catalog", {
      semester: "2025-2026-2",
    }, { showLoading: false, silentError: true, timeout: 8000 })
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
    const semester = meta.semester || this.data.semesters[this.data.selectedSemesterIndex]?.value || "2025-2026-2";
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
      const semester = item.semester || (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || "2025-2026-2";
      
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
    const term = (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || "2025-2026-2";
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
      semester: query.semester || "2025-2026-2",
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
      this.printSchoolDebugLog(false, "", "无缓存数据");
      this.applySharedQueryIfNeeded();
      return;
    }

    // 1. 恢复学期
    let selectedSemesterIndex = 0;
    if (cache.semesterValue) {
      const semIdx = this.data.semesters.findIndex(s => s.value === cache.semesterValue);
      if (semIdx >= 0) selectedSemesterIndex = semIdx;
    }

    // 2. 校验并恢复学院
    const collegeIdx = this.data.colleges.findIndex(c => c.code === cache.collegeCode);
    if (collegeIdx < 0) {
      this.setData({ selectedSemesterIndex });
      this.printSchoolDebugLog(true, "未恢复", `学院 ${cache.collegeName || cache.collegeCode} 在当前快照中已不存在`);
      wx.removeStorageSync(cacheKey);
      this.showFilterChangedHint("部分筛选项已更新，请重新选择");
      return;
    }

    // 3. 校验并恢复年级
    const gradeIdx = this.data.grades.indexOf(cache.grade);
    if (gradeIdx < 0) {
      this.setData({
        selectedSemesterIndex,
        selectedCollegeIndex: collegeIdx
      });
      this.printSchoolDebugLog(true, "学院级", `年级 ${cache.grade} 在当前年级列表中已不存在`);
      this.saveFilterCache();
      this.showFilterChangedHint("部分筛选项已更新，请重新选择");
      return;
    }

    // 4. 设置学期、学院、年级索引并异步拉取专业进行恢复
    this.setData({
      selectedSemesterIndex,
      selectedCollegeIndex: collegeIdx,
      selectedGradeIndex: gradeIdx
    }, () => {
      this.fetchMajors().then((majors) => {
        // 校验并恢复专业
        const majorIdx = majors.findIndex(m => m.code === cache.majorCode);
        if (majorIdx < 0) {
          this.printSchoolDebugLog(true, "学院+年级级", `专业 ${cache.majorName || cache.majorCode} 不存在于该学院或年级下`);
          this.saveFilterCache();
          this.showFilterChangedHint("部分筛选项已更新，请重新选择");
          return;
        }

        this.setData({
          selectedMajorIndex: majorIdx
        }, () => {
          // 校验并恢复班级
          this.fetchClasses().then((classesOptions) => {
            let classIdx = -1;
            if (cache.classId) {
              classIdx = classesOptions.findIndex(c => c.classId === cache.classId);
            }
            if (classIdx < 0 && cache.className) {
              classIdx = classesOptions.findIndex(c => c.className === cache.className);
            }

            if (classIdx < 0) {
              this.printSchoolDebugLog(true, "专业级", `班级 ${cache.className || cache.classId} 在该专业下已不存在`);
              this.saveFilterCache();
              this.showFilterChangedHint("部分筛选项已更新，请重新选择");
              return;
            }

            this.setData({
              selectedClassIndex: classIdx
            });
            this.printSchoolDebugLog(true, "班级级 (完全恢复)", "已完全恢复上次筛选状态");
            this.showRestoreHint();
            this.applySharedQueryIfNeeded();
          }).catch(err => {
            this.printSchoolDebugLog(true, "专业级", "拉取班级列表失败: " + err.message);
            this.showFilterChangedHint("部分筛选项已更新，请重新选择");
          });
        });
      }).catch(err => {
        this.printSchoolDebugLog(true, "学院+年级级", "拉取专业列表失败: " + err.message);
        this.showFilterChangedHint("部分筛选项已更新，请重新选择");
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
    const text = message || "部分筛选项已更新，请重新选择";
    this.setData({
      restoreHint: text
    });
    wx.showToast({
      title: text,
      icon: "none",
      duration: 1600
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
    const envVersion = wx.getSystemInfoSync().platform === 'devtools' || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.envVersion === 'develop');
    if (envVersion) {
      console.log("========== [开发环境全校页面调试日志] ==========");
      console.log("- 是否命中 FOSU_SCHOOL_FILTER_CACHE:", hit ? "是" : "否");
      if (hit) {
        console.log("- 恢复到了哪一级:", level);
        if (reason) {
          console.log("- 缓存失效原因 / 说明:", reason);
        }
      } else {
        console.log("- 未命中原因:", reason);
      }
      console.log("=================================================");
    }
  },

  // 2. 学期选择改变
  onSemesterChange(event) {
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
      classNoticeText: "",
    }, () => {
      this.saveFilterCache();
    });
  },

  // 4. 年级选择改变
  onGradeChange(event) {
    const index = Number(event.detail.value);
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

    this.setData({ loading: true });
    return request.get("/api/fosu/majors", { collegeCode, grade }, { showLoading: false })
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
    
      this.setData({
        classesResult: grouped.list,
        classAdminResults: grouped.admin,
        classAggregateResults: grouped.aggregate,
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
      this.setData({
        classesResult: [],
        classAdminResults: [],
        classAggregateResults: [],
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

    const semester = semesters[selectedSemesterIndex]?.value || "2025-2026-2";
    const collegeCode = selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex].code : "";
    const collegeName = selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex].name : "";
    const titleCode = selectedTitleIndex >= 0 ? titleOptions[selectedTitleIndex] : "";

    const params = {
      semester,
      collegeCode,
      collegeName,
      titleCode,
      q: keyword.trim(),
      limit: 50,
    };

    const renderFn = (data, isFromCache) => {
      const formatTime = formatUpdateTime(data.updatedAt);
      const teachers = (data.items || []).map(item => normalizeIndexedScheduleItem("teacher", item, data.version));
      this.setData({
        teachersResult: teachers,
        dataVersionText: formatTime ? `数据更新于 ${formatTime}` : "",
        updatedAtText: formatTime ? `课程索引 · 更新于 ${formatTime}` : "课程索引",
      });
    };

    const catchFn = () => {
      this.setData({ teachersResult: [], updatedAtText: "", dataVersionText: "" });
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

    const semester = semesters[selectedSemesterIndex]?.value || "2025-2026-2";
    const campus = selectedCampusIndex >= 0 ? campusOptions[selectedCampusIndex] : "";

    const params = {
      semester,
      campus,
      q: keyword.trim(),
      limit: 50,
    };

    const renderFn = (data, isFromCache) => {
      const formatTime = formatUpdateTime(data.updatedAt);
      const classrooms = (data.items || []).map(item => normalizeIndexedScheduleItem("classroom", item, data.version));
      this.setData({
        classroomsResult: classrooms,
        dataVersionText: formatTime ? `数据更新于 ${formatTime}` : "",
        updatedAtText: formatTime ? `课程索引 · 更新于 ${formatTime}` : "课程索引",
      });
    };

    const catchFn = () => {
      this.setData({ classroomsResult: [], updatedAtText: "", dataVersionText: "" });
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

    const semester = semesters[selectedSemesterIndex]?.value || "2025-2026-2";

    const params = {
      semester,
      q: keyword.trim(),
      limit: 50,
    };

    const renderFn = (data, isFromCache) => {
      const formatTime = formatUpdateTime(data.updatedAt);
      const courses = (data.items || []).map(item => normalizeIndexedScheduleItem("course", item, data.version));
      this.setData({
        coursesResult: courses,
        dataVersionText: formatTime ? `数据更新于 ${formatTime}` : "",
        updatedAtText: formatTime ? `课程索引 · 更新于 ${formatTime}` : "课程索引",
      });
    };

    const catchFn = () => {
      this.setData({ coursesResult: [], updatedAtText: "", dataVersionText: "" });
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
    const semester = item.semester || this.data.semesters[this.data.selectedSemesterIndex]?.value || "2025-2026-2";
    const version = this.getReleaseVersionForCache(item.scheduleVersion);
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
    releasePackService.loadDetail(type, detailId, {
      term: semester,
      releaseVersion: version,
    }, {
      forceNetwork: true,
    })
      .then((data) => {
        wx.hideLoading();
        const schedule = data.schedule || data.detail || {};
        const nextVersion = data.version || version;
        this.setScheduleDetailCache(type, detailId, nextVersion, semester, schedule);
        const meta = Object.assign({}, item, schedule, { semester, scheduleVersion: nextVersion });
        if (type === "class") this.saveRecentSchedule(meta);
        this.navigateToScheduleView(type, displayName, schedule.courses || [], meta);
      })
      .catch((err) => {
        request.get("/api/fosu/schedule-detail", {
          term: semester,
          type,
          id: detailId,
          releaseVersion: version,
        }, { showLoading: false, silentError: true })
          .then((data) => {
            wx.hideLoading();
            const schedule = data.schedule || {};
            const nextVersion = data.version || version;
            this.setScheduleDetailCache(type, detailId, nextVersion, semester, schedule);
            const meta = Object.assign({}, item, schedule, { semester, scheduleVersion: nextVersion });
            if (type === "class") this.saveRecentSchedule(meta);
            this.navigateToScheduleView(type, displayName, schedule.courses || [], meta);
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: "课表详情加载失败", icon: "none" });
            console.error("openIndexedSchedule fail", err);
          });
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

  navigateToScheduleView(type, name, courses, scheduleMeta) {
    const semester = this.data.semesters[this.data.selectedSemesterIndex]?.value || "2025-2026-2";
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
        this.setData({
          classesResult: [],
          classAdminResults: [],
          classAggregateResults: [],
          teachersResult: [],
          classroomsResult: [],
          coursesResult: [],
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

  // ================== 查询内核执行器 (支持缓存兜底/版本隔离/静默刷新) ==================

  legacyExecuteSearch(type, params, renderFn, catchFn) {
    const query = Object.assign({ type }, params || {});
    const term = query.semester || query.term || (this.data.semesters[this.data.selectedSemesterIndex] && this.data.semesters[this.data.selectedSemesterIndex].value) || "2025-2026-2";
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
            if (err.code === "REQUEST_TIMEOUT") {
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
        restoreHint: "已加载缓存，正在校验更新"
      });
      // 发起静默更新
      doNetworkRequest();
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
    const active = snapshot || {};
    return `${active.term || DEFAULT_TERM}:${active.releaseVersion || ""}`;
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
        };
      }
    } catch (error) {
      console.warn("[school] read activeSnapshot cache failed", error);
    }
    const lastGood = releasePackService.getLastKnownGood(DEFAULT_TERM);
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

  getStateFromError(error) {
    const code = error && (error.code || error.reasonCode || (error.payload && (error.payload.code || error.payload.reasonCode)));
    if (code === "NO_ACTIVE_RELEASE" || code === "NO_RELEASE_DATA") return "noRelease";
    if (code === "REQUEST_TIMEOUT") return "timeout";
    return "networkError";
  },

  async resolveActiveSnapshot(options = {}) {
    const forceNetwork = Boolean(options.forceNetwork);
    const cached = this.readCachedActiveSnapshot();
    if (cached && !forceNetwork) {
      const platformSnapshot = platformDataService.getCachedPlatformSnapshot();
      if (platformSnapshot && platformSnapshot.releaseVersion && this.getSnapshotReleaseKey(platformSnapshot) !== this.getSnapshotReleaseKey(cached)) {
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

    let lastError = null;
    let sawNoRelease = false;

    try {
      const pack = await releasePackService.switchReleaseSafely({
        term: cached && cached.term || DEFAULT_TERM,
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
      const payload = await request.get(`/api/fosu/app-config?ts=${Date.now()}`, {}, {
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
      if (cached && code === "REQUEST_TIMEOUT") {
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
      const payload = await request.get("/api/fosu/bootstrap", { semester: cached?.term || DEFAULT_TERM }, {
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
    this._snapshotRefreshRunning = true;
    this.resolveActiveSnapshot({ forceNetwork: true })
      .then((result) => {
        const next = result && result.activeSnapshot;
        if (!next || !currentSnapshot) return;
        if (this.getSnapshotReleaseKey(next) !== this.getSnapshotReleaseKey(currentSnapshot)) {
          wx.showToast({
            title: "检测到新课表版本，已刷新",
            icon: "none",
            duration: 1800,
          });
          this.initPageData({ reason: "snapshotRefresh" });
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
    const current = this.data.activeSnapshot || this.readCachedActiveSnapshot();
    if (current) {
      this.refreshActiveSnapshotInBackground(current);
    }
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
      const localReleaseKey = wx.getStorageSync("FOSU_LOCAL_RELEASE_KEY") || "";
      let didRefresh = false;

      if (localReleaseKey && localReleaseKey !== releaseKey) {
        releasePackService.clearOldReleaseCaches({
          keepLatestN: 2,
          keepReleases: [activeSnapshot.releaseVersion],
        });
        this.writeCachedActiveSnapshot(activeSnapshot);
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
        term: snapshotOrTerm || DEFAULT_TERM,
        releaseVersion: releaseVersionOrOptions || this.getReleaseVersionForCache(),
      };
    const options = typeof releaseVersionOrOptions === "object" ? releaseVersionOrOptions : (maybeOptions || {});
    const seq = options.seq || this._activeInitSeq;
    const term = snapshot.term || DEFAULT_TERM;
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
        restoreHint: fromCache ? "已显示本地缓存，正在校验更新" : "",
      });

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

    if (cachedCatalog) {
      renderCatalog(cachedCatalog, true);
      fetchCatalogFromNetwork();
      return;
    }

    const bootstrapCatalog = normalizeCatalog(options.bootstrapData);
    if (bootstrapCatalog) {
      writeCatalogCache(bootstrapCatalog);
      renderCatalog(bootstrapCatalog, false);
      return;
    }

    fetchCatalogFromNetwork();
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

    const doNetworkRequest = (hasCache) => {
      if (!hasCache) {
        this.startLoadingTimer(() => doNetworkRequest(false), false);
      } else {
        this.retryFn = () => doNetworkRequest(true);
      }

      const requestIndex = () => releasePackService.searchIndex(type, query, {
        forceNetwork: true,
        timeout: SCHOOL_REQUEST_TIMEOUT,
      }).catch((packError) => {
        return request.get("/api/fosu/search-index", query, {
          showLoading: false,
          silentError: true,
          timeout: SCHOOL_REQUEST_TIMEOUT,
        }).catch(() => {
          throw packError;
        });
      });

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
        restoreHint: "已显示本地缓存，正在校验更新",
      });
      doNetworkRequest(true);
      return;
    }

    doNetworkRequest(false);
  }
});

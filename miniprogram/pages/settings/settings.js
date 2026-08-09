const BRAND = require("../../config/brand");
const ASSISTANT_BRAND = require("../../config/assistantBrand");
const {
  BOOTSTRAP_CACHE_KEY,
  CURRENT_SCHEDULE_TARGET_KEY,
  clearAppCache,
  clearDataCaches,
  clearLocalSelection,
  getSettings,
  saveSettings,
} = require("../../utils/storage");
const teachingCalendarService = require("../../services/teachingCalendarService");
const {
  clampWeek,
  formatFullDateLabel,
  getTodayTeachingInfo,
  getWeekdayLabel,
} = require("../../utils/week");
const request = require("../../utils/request");
const appConfigService = require("../../services/appConfigService");
const releasePackService = require("../../services/releasePackService");
const staticOriginService = require("../../services/staticOriginService");
const xiaofuFloatService = require("../../services/xiaofuFloatService");
const platformUtils = require("../../utils/platform");
const { courseTimesMeta } = require("../../data/courseTimes");
const { contactConfig } = require("../../config/contact");

const APP_VERSION = "1.0.0";
const FEEDBACK_TYPES = ["课表错误", "数据过期", "页面问题", "功能建议", "其他"];

function getSelectedTerm(settings) {
  const calendar = teachingCalendarService.getImmediateActiveCalendar();
  const runtime = calendar.termConfig || {};
  const source = settings || {};
  return source.semesterId || source.semester || runtime.term;
}

function buildWeekOptions(totalWeeks) {
  const options = [];
  const calendar = teachingCalendarService.getImmediateActiveCalendar();
  const count = Number(totalWeeks || calendar.termConfig && calendar.termConfig.totalWeeks || 19) || 19;
  for (let week = 1; week <= count; week += 1) {
    options.push(`第${week}周`);
  }
  return options;
}

function formatFullDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sanitizeOriginUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  try {
    const url = new URL(text);
    return `${url.host}${url.pathname}`;
  } catch (error) {
    return text.split("?")[0].replace(/^https?:\/\//i, "") || "-";
  }
}

function formatOriginSuccessTime(origin) {
  const at = origin && origin.health && origin.health.lastSuccessAt;
  return at ? formatFullDateTime(Number(at)) : "-";
}

function friendlyStaticSourceName(name, label) {
  const normalized = String(name || "").toLowerCase();
  if (normalized === "cloudbase" || String(label || "").includes("高速")) return "高速静态源";
  if (normalized === "oracle" || String(label || "").includes("备用")) return "备用静态源";
  return "本地缓存";
}

function buildPublicStaticStatus(staticOrigin, staticOriginLabel, cloudbaseOrigin, oracleOrigin, oracleFallbackAt) {
  const cloudbaseSuccess = formatOriginSuccessTime(cloudbaseOrigin);
  const oracleSuccess = formatOriginSuccessTime(oracleOrigin);
  return {
    publicStaticSourceLabel: friendlyStaticSourceName(staticOrigin, staticOriginLabel),
    publicCloudbaseStatus: cloudbaseSuccess !== "-" ? `可用，最近成功 ${cloudbaseSuccess}` : "待验证",
    publicOracleStatus: oracleFallbackAt && oracleFallbackAt !== "-"
      ? `已启用备用，最近 ${oracleFallbackAt}`
      : (oracleSuccess !== "-" ? `备用可用，最近成功 ${oracleSuccess}` : "待命"),
  };
}

function getSelectedSchedule() {
  const target = wx.getStorageSync(CURRENT_SCHEDULE_TARGET_KEY) || null;
  const filter = wx.getStorageSync("FOSU_SCHOOL_FILTER_CACHE") || null;
  return {
    target,
    filter,
  };
}

function buildSelectedScheduleText(selected) {
  const target = selected && selected.target;
  if (target && target.name) {
    if (target.type === "personal-xls" || target.type === "personal-apaas") {
      const metadata = target.metadata || {};
      return [metadata.className, metadata.studentName, metadata.term]
        .filter(Boolean)
        .join(" · ") || target.title || target.name;
    }
    return target.type === "teacher"
      ? `${target.name} 老师`
      : (target.type === "classroom" ? `${target.name} 教室` : target.name);
  }
  const filter = selected && selected.filter;
  if (filter && (filter.className || filter.majorName || filter.collegeName)) {
    return [filter.collegeName, filter.grade, filter.majorName, filter.className]
      .filter(Boolean)
      .join(" / ");
  }
  return "未绑定课表";
}

function buildSelectedScheduleMeta(selected) {
  const target = selected && selected.target;
  if (!target) {
    return {
      sourceText: "",
      importText: "",
    };
  }
  if (target.type === "personal-xls" || target.type === "personal-apaas") {
    const isApaas = target.type === "personal-apaas";
    return {
      sourceText: isApaas ? "来源：学校课表系统" : "来源：100网 XLS 手动导入",
      importText: target.importedAt ? `导入时间：${formatFullDateTime(target.importedAt)}` : "",
    };
  }
  return {
    sourceText: target.type ? `来源：${target.type}` : "",
    importText: target.updateTime ? `更新时间：${target.updateTime}` : "",
  };
}

function summarizeSelectedSchedule(selected) {
  const target = selected && selected.target ? selected.target : null;
  const filter = selected && selected.filter ? selected.filter : null;
  return {
    target: target ? {
      type: target.type || "",
      name: target.name || "",
      classId: target.classId || "",
      className: target.className || "",
      semester: target.semester || "",
      displayType: target.displayType || "",
      isAggregated: Boolean(target.isAggregated),
      courseCount: Array.isArray(target.courses) ? target.courses.length : 0,
      updateTime: target.updateTime || "",
    } : null,
    filter: filter ? {
      semesterValue: filter.semesterValue || "",
      collegeCode: filter.collegeCode || "",
      collegeName: filter.collegeName || "",
      grade: filter.grade || "",
      majorCode: filter.majorCode || "",
      majorName: filter.majorName || "",
      classId: filter.classId || "",
      className: filter.className || "",
      classType: filter.classType || "",
      catalogVersion: filter.catalogVersion || "",
    } : null,
  };
}

Page({
  data: {
    brand: BRAND,
    assistantBrand: ASSISTANT_BRAND,
    settings: {},
    teachingInfo: {},
    termStartDate: "",
    termStartWeekdayText: "",
    totalTeachingWeeks: "",
    weekOptions: buildWeekOptions(),
    feedbackTypes: FEEDBACK_TYPES,
    feedbackVisible: false,
    feedbackSubmitting: false,
    feedbackForm: {
      typeIndex: 0,
      content: "",
    },
    contactConfig,
    selectedScheduleText: "未绑定课表",
    selectedScheduleSourceText: "",
    selectedScheduleImportText: "",
    appConfig: { dataVersion: {}, notices: [], news: [] },
    appConfigUpdatedText: "",
    noticeHistoryVisible: false,
    newsVisible: false,
    noticeHistory: [],
    newsList: [],
    versionDetailVisible: false,
    diagnosisExpanded: false,
    diagnosisCanShowFull: false,
    xiaofuFloatEnabled: true,
    xiaofuFloatEnabledText: "右下角常驻，可拖拽吸附",
    versionData: {
      appVersion: APP_VERSION,
      sdkVersion: "",
      courseTimesVersion: "",
      courseTimesUpdatedAt: "",
      snapshotVersion: "-",
      semester: "-",
      catalogUpdatedAt: "-",
      majorsUpdatedAt: "-",
      classSchedulesUpdatedAt: "-",
      collegesCount: "-",
      majorsCount: "-",
      classScheduleCount: "-",
      teacherScheduleCount: "-",
      classroomScheduleCount: "-",
      courseScheduleCount: "-",
      syncTimeText: "-",
      dataSource: "-",
      selectedScheduleText: "未绑定课表",
      disclaimer: BRAND.disclaimer,
      appConfigReleaseVersion: "-",
      manifestReleaseVersion: "-",
      localActiveReleaseVersion: "-",
      lastGoodReleaseVersion: "-",
      staticOrigin: "-",
      staticOriginLabel: "-",
      staticOriginUrl: "-",
      manifestStatus: "-",
      pointerSource: "-",
      recentCloudbaseSuccessAt: "-",
      recentOracleFallbackAt: "-",
      freshnessStatus: "-",
      freshnessCheckedAt: "-",
      cloudbaseReleaseVersion: "-",
      oracleReleaseVersion: "-",
      cacheEpoch: "-",
      forceRefreshToken: "-",
      emptyRoomCacheText: "no",
      lastNetworkErrorText: "-",
      lastSuccessElapsedText: "-",
    },
  },

  onShow() {
    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ["shareAppMessage", "shareTimeline"],
      });
    }
    this.loadSettings();
    this.loadAppConfig();
  },

  loadAppConfig() {
    appConfigService.loadAppConfig()
      .then((config) => {
        const normalizedConfig = appConfigService.normalizeConfig
          ? appConfigService.normalizeConfig(config)
          : Object.assign({ dataVersion: {}, notices: [], news: [] }, config || {});
        const latestUpdatedAt = appConfigService.getLatestDataUpdatedAt(normalizedConfig);
        this.setData({
          appConfig: normalizedConfig,
          appConfigUpdatedText: latestUpdatedAt ? appConfigService.formatConfigTime(latestUpdatedAt) : "",
          noticeHistory: Array.isArray(normalizedConfig.notices) ? normalizedConfig.notices : [],
          newsList: Array.isArray(normalizedConfig.news) ? normalizedConfig.news : [],
        });
      })
      .catch((err) => {
        console.warn("设置页公告配置加载失败", err);
      });
  },

  loadSettings() {
    const settings = getSettings();
    const calendar = teachingCalendarService.getImmediateActiveCalendar();
    const termConfig = calendar.termConfig || {};
    const teachingInfo = getTodayTeachingInfo(new Date(), calendar.weeks || [], termConfig);
    const effectiveWeek = settings.manualWeekOverride ? clampWeek(settings.currentWeek, termConfig) : teachingInfo.weekNo;
    const selectedSchedule = getSelectedSchedule();
    const selectedMeta = buildSelectedScheduleMeta(selectedSchedule);
    const startWeekdayText = getWeekdayLabel(termConfig.termStartDate) || "周一";
    const xiaofuFloatEnabled = xiaofuFloatService.isEnabled();
    this.setData({
      settings: Object.assign({}, settings, {
        currentWeek: effectiveWeek,
        semester: settings.semester || settings.semesterId || termConfig.term || "",
        semesterId: settings.semesterId || termConfig.term || "",
      }),
      teachingInfo,
      termStartDate: formatFullDateLabel(termConfig.termStartDate) || "日期待同步",
      termStartWeekdayText: startWeekdayText,
      totalTeachingWeeks: termConfig.totalWeeks ? `${termConfig.totalWeeks}周` : "日期待同步",
      weekOptions: buildWeekOptions(termConfig.totalWeeks),
      selectedScheduleText: buildSelectedScheduleText(selectedSchedule),
      selectedScheduleSourceText: selectedMeta.sourceText,
      selectedScheduleImportText: selectedMeta.importText,
      xiaofuFloatEnabled,
      xiaofuFloatEnabledText: xiaofuFloatEnabled ? "右下角常驻，可拖拽吸附" : "已关闭，可在这里重新开启",
    });
    teachingCalendarService.loadActiveTeachingCalendar()
      .then((latest) => {
        const latestConfig = latest.termConfig || {};
        if (
          latest.releaseVersion !== calendar.releaseVersion ||
          latestConfig.termStartDate !== termConfig.termStartDate ||
          Number(latestConfig.totalWeeks || 0) !== Number(termConfig.totalWeeks || 0)
        ) {
          const latestInfo = getTodayTeachingInfo(new Date(), latest.weeks || [], latestConfig);
          const nextWeek = settings.manualWeekOverride ? clampWeek(settings.currentWeek, latestConfig) : latestInfo.weekNo;
          this.setData({
            settings: Object.assign({}, this.data.settings, {
              currentWeek: nextWeek,
              semester: this.data.settings.semester || latestConfig.term || "",
              semesterId: this.data.settings.semesterId || latestConfig.term || "",
            }),
            teachingInfo: latestInfo,
            termStartDate: formatFullDateLabel(latestConfig.termStartDate) || "日期待同步",
            termStartWeekdayText: getWeekdayLabel(latestConfig.termStartDate) || "周一",
            totalTeachingWeeks: latestConfig.totalWeeks ? `${latestConfig.totalWeeks}周` : "日期待同步",
            weekOptions: buildWeekOptions(latestConfig.totalWeeks),
          });
        }
      })
      .catch(() => {});
  },

  onWeekChange(event) {
    const currentWeek = Number(event.detail.value) + 1;
    saveSettings({
      currentWeek,
      manualWeekOverride: true,
    });
    this.loadSettings();
  },

  restoreAutoWeek() {
    const calendar = teachingCalendarService.getImmediateActiveCalendar();
    const teachingInfo = getTodayTeachingInfo(new Date(), calendar.weeks || [], calendar.termConfig || {});
    saveSettings({
      currentWeek: teachingInfo.weekNo,
      manualWeekOverride: false,
    });
    this.loadSettings();
    wx.showToast({
      title: "已恢复自动",
      icon: "success",
    });
  },

  onSwitchChange(event) {
    const key = event.currentTarget.dataset.key;
    saveSettings({
      [key]: event.detail.value,
    });
    this.loadSettings();
  },

  onXiaofuFloatToggle(event) {
    const enabled = event.detail.value === true;
    if (enabled) {
      xiaofuFloatService.enableEverywhere();
    } else {
      xiaofuFloatService.setEnabled(false);
    }
    this.setData({
      xiaofuFloatEnabled: enabled,
      xiaofuFloatEnabledText: enabled ? "右下角常驻，可拖拽吸附" : "已关闭，可在这里重新开启",
    });
    wx.showToast({ title: enabled ? `已开启${ASSISTANT_BRAND.assistantName}浮窗` : `已关闭${ASSISTANT_BRAND.assistantName}浮窗`, icon: "none" });
  },

  goSchool() {
    wx.switchTab({
      url: "/pages/school/school",
    });
  },

  goTimetable() {
    wx.navigateTo({
      url: "/pages/timetable/timetable",
    });
  },

  goImportXls() {
    wx.navigateTo({
      url: "/pages/personal-sync/personal-sync",
    });
  },

  goLogin() {
    wx.navigateTo({
      url: "/pages/personal-sync/personal-sync",
    });
  },

  goCustomCourses() {
    wx.navigateTo({
      url: "/pages/custom-courses/custom-courses",
    });
  },

  goCampusMap() {
    wx.navigateTo({
      url: "/packageMaps/pages/campus-map/campus-map",
    });
  },

  goSmartCourseReminders() {
    wx.navigateTo({
      url: "/packageXiaofu/pages/ai-assistant/ai-assistant?panel=reminders",
    });
  },
  
  goContribute() {
    wx.navigateTo({
      url: "/pages/contribute/contribute",
    });
  },

  showFeedback() {
    this.setData({
      feedbackVisible: true,
    });
  },

  hideFeedback() {
    if (this.data.feedbackSubmitting) {
      return;
    }
    this.setData({
      feedbackVisible: false,
    });
  },

  onFeedbackTypeChange(event) {
    this.setData({
      "feedbackForm.typeIndex": Number(event.detail.value),
    });
  },

  onFeedbackContentInput(event) {
    this.setData({
      "feedbackForm.content": event.detail.value,
    });
  },

  buildFeedbackPayload() {
    const selectedSchedule = getSelectedSchedule();
    const selectedScheduleSummary = summarizeSelectedSchedule(selectedSchedule);
    const sysInfo = platformUtils.getWxSystemInfo();
    const bootstrap = getApp().globalData.bootstrapData || wx.getStorageSync(BOOTSTRAP_CACHE_KEY) || {};
    const settings = this.data.settings || getSettings();
    const bootstrapVersions = bootstrap.versions && typeof bootstrap.versions === "object" ? bootstrap.versions : {};
    return {
      type: FEEDBACK_TYPES[this.data.feedbackForm.typeIndex] || "其他",
      content: this.data.feedbackForm.content,
      page: "pages/settings/settings",
      selectedSchedule: selectedScheduleSummary,
      selectedClass: selectedScheduleSummary.target || selectedScheduleSummary.filter || null,
      semester: bootstrap.semester || settings.semesterId || settings.semester,
      appVersion: APP_VERSION,
      dataVersion: bootstrap.version || bootstrapVersions.snapshot || bootstrap.updatedAt || "",
      platform: `${sysInfo.platform || "unknown"} / ${sysInfo.system || ""} / SDK ${sysInfo.SDKVersion || ""}`,
    };
  },

  submitFeedback() {
    const content = String(this.data.feedbackForm.content || "").trim();
    if (!content) {
      wx.showToast({
        title: "请填写反馈内容",
        icon: "none",
      });
      return;
    }

    this.setData({ feedbackSubmitting: true });
    request.post("/api/feedback", this.buildFeedbackPayload(), { loadingTitle: "正在提交..." })
      .then(() => {
        this.setData({
          feedbackSubmitting: false,
          feedbackVisible: false,
          feedbackForm: {
            typeIndex: 0,
            content: "",
          },
        });
        wx.showToast({
          title: "已收到反馈",
          icon: "success",
        });
      })
      .catch((err) => {
        this.setData({ feedbackSubmitting: false });
        console.error("submit feedback failed", err);
      });
  },

  showContactFallback() {
    const lines = [
      contactConfig.wechatHint,
      `备用邮箱：${contactConfig.email}`,
      "反馈课表错误时建议附带：班级、周次、课程名、截图",
    ];
    wx.showModal({
      title: "联系开发者",
      content: lines.join("\n"),
      showCancel: false,
      confirmText: "知道了",
    });
  },

  refreshBootstrapData() {
    wx.showLoading({ title: "正在刷新..." });
    clearDataCaches();
    request.get("/api/fosu/bootstrap", {}, { showLoading: false, silentError: true })
      .then((res) => {
        wx.hideLoading();
        if (res && res.success) {
          getApp().globalData.bootstrapData = res;
          wx.setStorageSync(BOOTSTRAP_CACHE_KEY, res);
          getApp().loadAppConfigData({ force: true }).then(() => this.loadAppConfig());
          this.showDataVersionDetail();
          wx.showToast({
            title: "已更新到最新数据",
            icon: "success",
          });
        } else {
          wx.showToast({
            title: "刷新失败",
            icon: "none",
          });
        }
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({
          title: "刷新失败",
          icon: "none",
        });
        console.error("refresh bootstrap failed", err);
      });
  },

  clearLocalSelectionOnly() {
    wx.showModal({
      title: "清除本地选择",
      content: "将清空当前课表选择和全校页筛选记录，下次进入时重新选择。",
      confirmText: "清除",
      confirmColor: "#c62828",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        clearLocalSelection();
        this.loadSettings();
        wx.showToast({
          title: "已清除",
          icon: "success",
        });
      },
    });
  },

  showDeveloperApi() {
    wx.showModal({
      title: "开发者接口调试",
      content: "开发诊断信息仅用于排查课表数据问题。提交调试前请确认已脱敏敏感登录信息。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  clearCache() {
    wx.showModal({
      title: "清除缓存",
      content: "将恢复默认班级、当前周 and 显示设置。",
      confirmText: "清除",
      confirmColor: "#c62828",
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        clearAppCache();
        clearLocalSelection();
        this.loadSettings();
        wx.showToast({
          title: "已清除",
          icon: "success",
        });
      },
    });
  },

  onWeekendModeChange(event) {
    const mode = Number(event.detail.value) === 1 ? "detail" : "overview";
    saveSettings({
      weekendShowMode: mode,
    });
    this.loadSettings();
    wx.showToast({
      title: "模式已更改",
      icon: "success",
    });
  },

  resetToNewUser() {
    wx.showModal({
      title: "重置为新用户状态",
      content: "确定要重置当前所有的课表状态，回到首次打开小程序的引导界面吗？",
      confirmColor: "#c62828",
      success: (res) => {
        if (res.confirm) {
          const { clearCurrentScheduleTarget, clearLocalSelection } = require("../../utils/storage");
          clearCurrentScheduleTarget();
          clearLocalSelection();
          wx.removeStorageSync("lastTodayReminderDate");
          this.loadSettings();
          wx.showToast({
            title: "已重置状态",
            icon: "success"
          });
          setTimeout(() => {
            wx.switchTab({
              url: "/pages/index/index"
            });
          }, 800);
        }
      }
    });
  },

  showAbout() {
    // 连续点击 5 次关于，触发开发者模式彩蛋
    this.clickCount = (this.clickCount || 0) + 1;
    if (this.clickCount >= 5) {
      this.clickCount = 0;
      this.showDeveloperApi();
      return;
    }
    wx.showModal({
      title: "关于" + BRAND.appName,
      content: BRAND.appName + "是个人开发的课程时间管理工具，主要用于查看课程安排、今日课程提醒和作息时间。本工具非学校官方服务，课程数据由开发者整理维护及用户反馈修正，仅供学习生活参考，具体安排请以任课教师通知及正式通知为准。\n\n联系邮箱：" + BRAND.contactEmail,
      showCancel: false,
      confirmText: "知道了",
    });
  },

  showPrivacy() {
    wx.showModal({
      title: "隐私说明",
      content: BRAND.appName + "严格保护您的隐私，小程序绝不会在前端保存您的学校账号密码。学号导入仅用于本次登录读取本人课表数据，导入完成后会清除临时状态。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  showDataVersionDetail() {
    const sysInfo = platformUtils.getWxSystemInfo();
    const isDeveloperEnv = platformUtils.isDeveloperEnv();
    const selectedTerm = getSelectedTerm(this.data.settings);
    const localActive = releasePackService.getLocalActiveRelease(selectedTerm);
    const lastGood = releasePackService.getLastKnownGood(selectedTerm);
    const requestDiag = typeof request.getRequestDiagnostics === "function" ? request.getRequestDiagnostics() : {};
    const localManifest = localActive && localActive.manifest || null;
    const localTerm = localActive && localActive.term || "";
    const localReleaseVersion = localActive && localActive.releaseVersion || "";
    const indexCounts = {};
    ["class", "teacher", "classroom", "course"].forEach((type) => {
      const cached = releasePackService.readCachedIndex(type, { term: localTerm, releaseVersion: localReleaseVersion });
      indexCounts[type] = cached && Array.isArray(cached.items) ? cached.items.length : 0;
    });
    const emptyRoomCache = releasePackService.readCachedEmptyRoom({ term: localTerm, releaseVersion: localReleaseVersion });
    const lastError = requestDiag.lastError || {};
    const lastSuccess = requestDiag.lastSuccess || {};
    const staticLastHit = staticOriginService.getLastHit ? staticOriginService.getLastHit() : null;
    const originSnapshot = staticOriginService.getOriginSnapshot ? staticOriginService.getOriginSnapshot() : [];
    const cloudbaseOrigin = originSnapshot.find((item) => item.name === "cloudbase") || null;
    const oracleOrigin = originSnapshot.find((item) => item.name === "oracle") || null;
    const app = getApp && getApp();
    const runtimePointer = app && app.globalData && app.globalData.runtimePointer || null;
    const activeRelease = app && app.globalData && app.globalData.activeRelease || {};
    const freshness = releasePackService.readFreshnessDiagnostics ? releasePackService.readFreshnessDiagnostics() : null;
    const staticOrigin = staticLastHit && staticLastHit.name || localManifest && localManifest.staticOrigin || activeRelease.staticOrigin || "-";
    const staticOriginLabel = staticLastHit && staticLastHit.label || localManifest && localManifest.staticOriginLabel || activeRelease.staticOriginLabel || "-";
    const staticOriginUrl = sanitizeOriginUrl(staticLastHit && staticLastHit.url || localManifest && localManifest.staticOriginUrl || activeRelease.staticOriginUrl || "");
    const manifestStatus = activeRelease.manifestStatus || localManifest && localManifest.manifestStatus || (localManifest ? "complete" : runtimePointer ? "pointer-only" : "-");
    const pointerSource = runtimePointer && (runtimePointer.pointerSource || runtimePointer.staticOrigin || runtimePointer.source) || activeRelease.pointerSource || "-";
    const oracleFallbackAt = staticLastHit && staticLastHit.name === "oracle"
      ? formatFullDateTime(staticLastHit.at)
      : formatOriginSuccessTime(oracleOrigin);
    const publicStaticStatus = buildPublicStaticStatus(staticOrigin, staticOriginLabel, cloudbaseOrigin, oracleOrigin, oracleFallbackAt);
    
    this.setData({
      versionDetailVisible: true,
      diagnosisCanShowFull: isDeveloperEnv,
      "versionData.sdkVersion": sysInfo.SDKVersion || "未知",
      "versionData.courseTimesVersion": courseTimesMeta.version,
      "versionData.courseTimesUpdatedAt": courseTimesMeta.updatedAt,
      "versionData.localActiveReleaseVersion": localReleaseVersion || "-",
      "versionData.lastGoodReleaseVersion": lastGood && lastGood.releaseVersion || "-",
      "versionData.manifestReleaseVersion": localManifest && localManifest.releaseVersion || "-",
      "versionData.staticOrigin": staticOrigin,
      "versionData.staticOriginLabel": staticOriginLabel,
      "versionData.staticOriginUrl": staticOriginUrl,
      "versionData.publicStaticSourceLabel": publicStaticStatus.publicStaticSourceLabel,
      "versionData.publicCloudbaseStatus": publicStaticStatus.publicCloudbaseStatus,
      "versionData.publicOracleStatus": publicStaticStatus.publicOracleStatus,
      "versionData.manifestStatus": manifestStatus,
      "versionData.pointerSource": pointerSource,
      "versionData.recentCloudbaseSuccessAt": formatOriginSuccessTime(cloudbaseOrigin),
      "versionData.recentOracleFallbackAt": oracleFallbackAt,
      "versionData.freshnessStatus": freshness && freshness.freshnessStatus || "-",
      "versionData.freshnessCheckedAt": freshness && freshness.checkedAt ? formatFullDateTime(freshness.checkedAt) : "-",
      "versionData.cloudbaseReleaseVersion": freshness && freshness.cloudbaseReleaseVersion || "-",
      "versionData.oracleReleaseVersion": freshness && freshness.oracleReleaseVersion || "-",
      "versionData.cacheEpoch": localActive && localActive.cacheEpoch || "-",
      "versionData.forceRefreshToken": localActive && localActive.forceRefreshToken || "-",
      "versionData.classIndexCount": indexCounts.class || 0,
      "versionData.teacherIndexCount": indexCounts.teacher || 0,
      "versionData.classroomIndexCount": indexCounts.classroom || 0,
      "versionData.courseIndexCount": indexCounts.course || 0,
      "versionData.emptyRoomCacheText": emptyRoomCache ? "yes" : "no",
      "versionData.lastNetworkErrorText": lastError.code ? `${lastError.code} · ${lastError.url || "-"} · ${lastError.elapsedMs || 0}ms` : "-",
      "versionData.lastSuccessElapsedText": lastSuccess.elapsedMs ? `${lastSuccess.elapsedMs}ms · ${lastSuccess.url || ""}` : "-",
    });

    wx.showLoading({ title: "加载中..." });
    request.get("/api/fosu/bootstrap", { term: getSelectedTerm(this.data.settings) }, { showLoading: false, timeout: 15000 })
      .then((res) => {
        wx.hideLoading();
        if (res && res.success) {
          const counts = res.counts || {};
          const metaDetails = res.metaDetails || {};
          const selectedSchedule = getSelectedSchedule();
          const selectedScheduleText = buildSelectedScheduleText(selectedSchedule);
          const syncTimeText = formatFullDateTime(res.updatedAt);

          let dataSource = res.dataSource || "cache-first";
          if (dataSource === "snapshot") {
            dataSource = "全校数据快照 (snapshot)";
          } else if (dataSource === "fosu-realtime") {
            dataSource = "后台服务直连实时 (realtime)";
          } else if (dataSource === "cache") {
            dataSource = "服务端本地缓存 (cache)";
          }

          // 远端诊断数据
          const remoteReleaseVersion = res.version || (res.catalog && res.catalog.version) || "-";
          const remoteTerm = res.semester || "-";
          const remoteScheduleUpdatedAt = formatFullDateTime(metaDetails.classSchedulesUpdatedAt || res.updatedAt);
          const remoteCatalogUpdatedAt = formatFullDateTime(metaDetails.catalogUpdatedAt);

          this.setData({
            versionData: {
              appVersion: APP_VERSION,
              sdkVersion: sysInfo.SDKVersion || "未知",
              courseTimesVersion: courseTimesMeta.version,
              courseTimesUpdatedAt: courseTimesMeta.updatedAt,
              
              snapshotVersion: res.version || "legacy",
              semester: res.semester || "-",
              catalogUpdatedAt: formatFullDateTime(metaDetails.catalogUpdatedAt),
              majorsUpdatedAt: formatFullDateTime(metaDetails.majorsUpdatedAt),
              classSchedulesUpdatedAt: formatFullDateTime(metaDetails.classSchedulesUpdatedAt),
              collegesCount: counts.collegeCount || counts.collegesCount || "-",
              majorsCount: counts.majorCount || counts.majorsCount || "-",
              classScheduleCount: counts.classScheduleCount || counts.classSchedulesCount || counts.classesCount || "-",
              teacherScheduleCount: counts.teacherScheduleCount || "-",
              classroomScheduleCount: counts.classroomScheduleCount || "-",
              courseScheduleCount: counts.courseScheduleCount || "-",
              
              syncTimeText,
              dataSource,
              selectedScheduleText,
              disclaimer: metaDetails.disclaimer || BRAND.disclaimer,

              // 诊断字段数据绑定
              appConfigReleaseVersion: (this.data.appConfig && this.data.appConfig.dataVersion && this.data.appConfig.dataVersion.releaseVersion) || "-",
              remoteReleaseVersion,
              remoteTerm,
              remoteScheduleUpdatedAt,
              remoteCatalogUpdatedAt,
              localReleaseVersion,
              localTerm,
              localActiveReleaseVersion: localReleaseVersion || "-",
              lastGoodReleaseVersion: lastGood && lastGood.releaseVersion || "-",
              manifestReleaseVersion: localManifest && localManifest.releaseVersion || "-",
              staticOrigin,
              staticOriginLabel,
              staticOriginUrl,
              publicStaticSourceLabel: publicStaticStatus.publicStaticSourceLabel,
              publicCloudbaseStatus: publicStaticStatus.publicCloudbaseStatus,
              publicOracleStatus: publicStaticStatus.publicOracleStatus,
              manifestStatus,
              pointerSource,
              recentCloudbaseSuccessAt: formatOriginSuccessTime(cloudbaseOrigin),
              recentOracleFallbackAt: oracleFallbackAt,
              freshnessStatus: freshness && freshness.freshnessStatus || "-",
              freshnessCheckedAt: freshness && freshness.checkedAt ? formatFullDateTime(freshness.checkedAt) : "-",
              cloudbaseReleaseVersion: freshness && freshness.cloudbaseReleaseVersion || "-",
              oracleReleaseVersion: freshness && freshness.oracleReleaseVersion || "-",
              cacheEpoch: localActive && localActive.cacheEpoch || "-",
              forceRefreshToken: localActive && localActive.forceRefreshToken || "-",
              classIndexCount: indexCounts.class || 0,
              teacherIndexCount: indexCounts.teacher || 0,
              classroomIndexCount: indexCounts.classroom || 0,
              courseIndexCount: indexCounts.course || 0,
              emptyRoomCacheText: emptyRoomCache ? "yes" : "no",
              lastNetworkErrorText: lastError.code ? `${lastError.code} · ${lastError.url || "-"} · ${lastError.elapsedMs || 0}ms` : "-",
              lastSuccessElapsedText: lastSuccess.elapsedMs ? `${lastSuccess.elapsedMs}ms · ${lastSuccess.url || ""}` : "-",
            }
          });
        }
      })
      .catch((err) => {
        wx.hideLoading();
        console.error("fetch bootstrap in settings failed", err);
      });
  },

  toggleAdvancedDiagnosis() {
    if (!this.data.diagnosisCanShowFull) {
      wx.showToast({
        title: "体验版/开发版可查看高级诊断",
        icon: "none",
      });
      return;
    }
    this.setData({
      diagnosisExpanded: !this.data.diagnosisExpanded,
    });
  },

  safeRefreshReleaseData() {
    wx.showLoading({ title: "检查中..." });
    releasePackService.switchReleaseSafely({ forceNetwork: true, dedupe: true })
      .then(() => {
        wx.hideLoading();
        this.showDataVersionDetail();
        wx.showToast({ title: "已安全刷新", icon: "success" });
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showToast({ title: "刷新失败，已保留缓存", icon: "none" });
        console.warn("safeRefreshReleaseData failed", { code: error && (error.code || error.reasonCode) });
      });
  },

  refreshReleaseManifestOnly() {
    wx.showLoading({ title: "拉取中..." });
    releasePackService.getActiveManifest({ forceNetwork: true, dedupe: true })
      .then(() => {
        wx.hideLoading();
        this.showDataVersionDetail();
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showToast({ title: "manifest 拉取失败", icon: "none" });
        console.warn("refreshReleaseManifestOnly failed", { code: error && (error.code || error.reasonCode) });
      });
  },

  warmupReleaseIndexes() {
    const localActive = releasePackService.getLocalActiveRelease(getSelectedTerm(this.data.settings));
    if (!localActive) {
      wx.showToast({ title: "暂无本地 release", icon: "none" });
      return;
    }
    wx.showLoading({ title: "预热中..." });
    releasePackService.warmupIndex(["class", "teacher", "classroom", "course"], {
      term: localActive.term,
      releaseVersion: localActive.releaseVersion,
      manifest: localActive.manifest,
      forceNetwork: true,
      skipFallback: true,
    })
      .then(() => {
        wx.hideLoading();
        this.showDataVersionDetail();
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showToast({ title: "预热失败，缓存未切换", icon: "none" });
        console.warn("warmupReleaseIndexes failed", { code: error && (error.code || error.reasonCode) });
      });
  },

  cleanupOldReleaseCaches() {
    const result = releasePackService.clearOldReleaseCaches({ keepLatestN: 2 });
    this.showDataVersionDetail();
    wx.showToast({ title: `已清理 ${result.removed || 0} 项`, icon: "none" });
  },

  exportDiagnosisLog() {
    const data = JSON.stringify({
      versionData: this.data.versionData,
      request: typeof request.getRequestDiagnostics === "function" ? request.getRequestDiagnostics() : {},
    }, null, 2).replace(/(token|password|secret|cookie)["']?\s*:\s*["'][^"']+["']/gi, "$1: \"[redacted]\"");
    wx.setClipboardData({
      data,
      success: () => wx.showToast({ title: "诊断日志已复制", icon: "success" }),
    });
  },

  diagnoseClearAllCaches() {
    wx.showModal({
      title: "数据诊断清理",
      content: "确定要清理全校所有缓存吗？清理后返回全校页将自动重新拉取最新索引与课表数据。",
      confirmColor: "#c62828",
      success: (res) => {
        if (res.confirm) {
          const { clearAllSchoolCaches } = require("../../utils/storage");
          clearAllSchoolCaches();
          wx.removeStorageSync("FOSU_LOCAL_RELEASE_KEY");
          wx.setStorageSync("FOSU_SCHOOL_NEED_AUTO_RELOAD", true);

          wx.showToast({
            title: "清理成功",
            icon: "success",
            duration: 1500
          });

          // 重新拉取 bootstrap 刷新弹窗内部 counts 和字段的显示
          this.showDataVersionDetail();
        }
      }
    });
  },

  showNoticeHistory() {
    this.setData({
      noticeHistoryVisible: true,
    });
  },

  hideNoticeHistory() {
    this.setData({
      noticeHistoryVisible: false,
    });
  },

  showNewsList() {
    this.setData({
      newsVisible: true,
    });
  },

  hideNewsList() {
    this.setData({
      newsVisible: false,
    });
  },

  hideDataVersionDetail() {
    this.setData({
      versionDetailVisible: false
    });
  },

  onShareAppMessage() {
    return {
      title: BRAND.appName + "｜查看课程安排",
      path: "/pages/index/index",
    };
  },

  onShareTimeline() {
    return {
      title: BRAND.appName + "｜查看课程安排",
      query: "",
    };
  },

  noop() {}
});

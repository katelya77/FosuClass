const request = require("../../utils/request");
const { getCurrentScheduleTarget, getSettings, setCurrentScheduleTarget } = require("../../utils/storage");
const aiAssistantService = require("../../services/aiAssistantService");
const appConfigService = require("../../services/appConfigService");
const personalTermOptionsService = require("../../services/personalTermOptionsService");
const { encryptCredentialPayload } = require("../../services/fosuStudentImportCrypto");
const { getRuntimeTermConfig } = require("../../utils/week");

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const WEEKDAY_TABS = [
  { label: "全部", value: "all" },
  { label: "周一", value: 1 },
  { label: "周二", value: 2 },
  { label: "周三", value: 3 },
  { label: "周四", value: 4 },
  { label: "周五", value: 5 },
  { label: "周六", value: 6 },
  { label: "周日", value: 7 },
];
const STUDENT_IMPORT_STEPS = [
  "正在连接学校课表系统",
  "正在验证账号",
  "正在读取本人课表数据",
  "正在整理课程数据",
];

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
}

function getCourseWeekday(course) {
  return Number(course.weekDay || course.weekday || 0) || 0;
}

function decorateCourses(courses) {
  const weekText = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return (Array.isArray(courses) ? courses : []).map((course, index) => {
    const weekday = getCourseWeekday(course);
    const start = Number(course.startSection || 0) || 0;
    const end = Number(course.endSection || start || 0) || 0;
    return Object.assign({}, course, {
      previewKey: [
        course.courseName || "course",
        weekday,
        start,
        end,
        course.classroom || course.roomName || "",
        index,
      ].join("-"),
      displayTime: `${weekText[weekday] || "周次"} ${start && end ? `第${start}-${end}节` : "节次待定"}`,
    });
  });
}

function buildFingerprint(result = {}) {
  const courses = Array.isArray(result.courses) ? result.courses : [];
  const text = JSON.stringify({
    term: result.term,
    courseCount: courses.length,
    sample: courses.slice(0, 20).map((course) => [
      course.courseName,
      course.teacherName,
      course.classroom,
      getCourseWeekday(course),
      course.startSection,
      course.endSection,
      course.weekText,
    ]),
  });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildXlsScheduleDisplay(result) {
  const metadata = (result && result.metadata) || {};
  const term = metadata.term || (result && result.term) || "";
  const title = metadata.className ? `${metadata.className}课表` : "个人课表";
  const subtitle = [metadata.className, term, "XLS导入"].filter(Boolean).join(" · ") || "XLS导入";
  return {
    title,
    subtitle,
    sourceText: "100网 XLS 手动导入",
  };
}

function sanitizeMetadata(metadata = {}) {
  return {
    studentName: metadata.studentName || "",
    term: metadata.term || "",
    className: metadata.className || "",
    majorName: metadata.majorName || "",
    collegeName: metadata.collegeName || "",
    printDate: metadata.printDate || "",
    source: metadata.source || "fosu-100-print-xls",
    sourceFileName: metadata.sourceFileName || "",
  };
}

function maskStudentId(studentId) {
  const value = String(studentId || "").trim();
  if (value.length <= 8) return value ? `${value.slice(0, 2)}****` : "";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function buildApaasScheduleDisplay(result) {
  const profile = result && result.profile || {};
  const summary = result && result.summary || {};
  const title = profile.studentName ? `${profile.studentName}的个人课表` : "个人课表";
  return {
    title,
    subtitle: [profile.className || "班级未确认", summary.semester || "当前学期", "学号导入"].filter(Boolean).join(" · "),
    sourceText: "学校课表系统",
  };
}

function sanitizeApaasMetadata(result) {
  const profile = result && result.profile || {};
  const summary = result && result.summary || {};
  return {
    studentId: profile.studentId || "",
    studentIdMasked: maskStudentId(profile.studentId),
    studentName: profile.studentName || "",
    className: profile.className || "",
    classNameConfidence: profile.classNameConfidence || "low",
    term: summary.semester || "",
    source: "fosu_apaas",
    rawRowCount: summary.rawRowCount || 0,
    scheduledCourseCount: summary.scheduledCourseCount || 0,
    unscheduledCourseCount: summary.unscheduledCourseCount || 0,
    conflictCount: summary.conflictCount || 0,
  };
}

function getExistingPersonalCoursesForStudentImport() {
  const current = getCurrentScheduleTarget && getCurrentScheduleTarget();
  const personalTypes = ["personal-xls", "personal-apaas", "local-personal"];
  if (!current || personalTypes.indexOf(String(current.type || "")) < 0) {
    return [];
  }
  return Array.isArray(current.courses) ? current.courses : [];
}

function getStudentImportErrorCode(error) {
  const payload = error && error.payload || {};
  return payload.code || payload.reasonCode || error && (error.code || error.reasonCode || error.message) || "";
}

function shouldRetryStudentPreview(error) {
  const code = getStudentImportErrorCode(error);
  return code === "IMPORT_KEY_EXPIRED" || code === "INVALID_ENCRYPTED_PAYLOAD";
}

async function requestStudentSchedulePreview(form, password) {
  const keyResult = await request.get("/api/schedule-import/fosu/public-key", {}, {
    showLoading: false,
    silentError: true,
    timeout: 10000,
    retries: 0,
  });
  const encrypted = await encryptCredentialPayload(keyResult, {
    studentId: form.studentId,
    password,
    nonce: keyResult.nonce,
    timestamp: Date.now(),
  });
  return request.post("/api/schedule-import/fosu/preview", Object.assign({
    keyId: keyResult.keyId,
  }, encrypted), {
    showLoading: false,
    silentError: true,
    timeout: 45000,
    retries: 0,
    dedupe: false,
  });
}

Page({
  data: {
    activeImportMethod: "method",
    studentImportEnabled: true,
    studentImportSteps: STUDENT_IMPORT_STEPS,
    studentLoadingStepIndex: 0,
    studentImportStage: "form",
    studentImportLoading: false,
    studentImportConfirming: false,
    studentForm: {
      studentId: "",
      password: "",
      privacyConfirmed: false,
    },
    studentPreviewResult: null,
    studentPreviewToken: "",
    studentImportedSchedule: null,
    selectedFile: null,
    loadingXls: false,
    syncSuccess: false,
    syncResult: null,
    semesterOptions: [],
    semesterOptionLabels: [],
    termRecords: [],
    semesterIndex: 0,
    semesterPickerEnabled: false,
    selectedTermStatusText: "",
    previewSearchKey: "",
    previewDayFilter: "all",
    weekdayTabs: WEEKDAY_TABS,
    filteredCourses: [],
  },

  onLoad(options = {}) {
    const settings = getSettings();
    const currentSemesterId = settings.semesterId || settings.semester || getRuntimeTermConfig().term;
    const requestedTab = String(options.tab || "").trim();
    const requestedMethod = requestedTab === "student"
      ? "student"
      : (requestedTab === "xls" ? "xls" : "method");
    this.setData({ activeImportMethod: requestedMethod });
    const applyTerms = (config) => {
      const built = personalTermOptionsService.buildImportTermOptions(
        config.availableTerms || [],
        currentSemesterId,
        getRuntimeTermConfig().term
      );
      const records = built.records;
      const index = built.selectedIndex;
      this.setData({
        termRecords: records,
        semesterOptions: built.semesterOptions,
        semesterOptionLabels: built.semesterOptionLabels,
        semesterIndex: index >= 0 ? index : 0,
        semesterPickerEnabled: built.pickerEnabled,
        selectedTermStatusText: this.getTermStatusText(records[index >= 0 ? index : 0]),
        studentImportEnabled: config && config.appConfig ? config.appConfig.enableFosuStudentImport !== false : true,
      });
    };
    applyTerms(appConfigService.getGlobalConfig());
    appConfigService.loadAppConfig({ silent: true }).then(applyTerms).catch(() => {});
  },

  selectImportMethod(event) {
    const method = event.currentTarget.dataset.method;
    if (method === "student" && !this.data.studentImportEnabled) {
      wx.showToast({ title: "学号导入暂未开放", icon: "none" });
      return;
    }
    if (method === "class") {
      wx.switchTab({ url: "/pages/school/school" });
      return;
    }
    if (method === "custom") {
      wx.navigateTo({ url: "/pages/custom-courses/custom-courses" });
      return;
    }
    this.setData({
      activeImportMethod: method || "method",
      syncSuccess: false,
      studentImportStage: "form",
      studentPreviewResult: null,
      studentPreviewToken: "",
    });
  },

  backToImportMethods() {
    this.setData({
      activeImportMethod: "method",
      syncSuccess: false,
      selectedFile: null,
      studentImportStage: "form",
      studentImportLoading: false,
      studentImportConfirming: false,
      studentPreviewResult: null,
      studentPreviewToken: "",
      studentForm: Object.assign({}, this.data.studentForm, { password: "" }),
    });
  },

  onSemesterChange(event) {
    if (!this.data.semesterPickerEnabled) return;
    const nextIndex = Number(event.detail.value);
    const record = this.data.termRecords[nextIndex];
    if (record && !record.importable) {
      wx.showToast({ title: "该学期尚未发布，暂不能导入", icon: "none" });
      return;
    }
    this.setData({
      semesterIndex: nextIndex,
      selectedTermStatusText: this.getTermStatusText(record),
    });
  },

  getTermStatusText(record) {
    if (!record) return "";
    if (!record.importable) return "该学期尚未发布，暂不能导入";
    if (record.archived) return "历史学期，导入后仅作为本地课表使用";
    if (!this.data.semesterPickerEnabled) return "当前仅有一个可导入学期";
    return "";
  },

  onStudentIdInput(event) {
    const value = String(event.detail.value || "").replace(/[^\d]/g, "").slice(0, 20);
    this.setData({ "studentForm.studentId": value });
  },

  onStudentPasswordInput(event) {
    this.setData({ "studentForm.password": String(event.detail.value || "") });
  },

  onStudentPrivacyChange(event) {
    const values = event.detail.value || [];
    this.setData({ "studentForm.privacyConfirmed": values.indexOf("confirmed") >= 0 });
  },

  startStudentLoadingSteps() {
    if (this.studentStepTimer) {
      clearInterval(this.studentStepTimer);
    }
    this.setData({ studentLoadingStepIndex: 0 });
    this.studentStepTimer = setInterval(() => {
      const next = Math.min(STUDENT_IMPORT_STEPS.length - 1, this.data.studentLoadingStepIndex + 1);
      this.setData({ studentLoadingStepIndex: next });
      if (next >= STUDENT_IMPORT_STEPS.length - 1 && this.studentStepTimer) {
        clearInterval(this.studentStepTimer);
        this.studentStepTimer = null;
      }
    }, 1800);
  },

  stopStudentLoadingSteps() {
    if (this.studentStepTimer) {
      clearInterval(this.studentStepTimer);
      this.studentStepTimer = null;
    }
  },

  validateStudentForm() {
    const form = this.data.studentForm || {};
    const studentId = String(form.studentId || "").trim();
    if (!/^\d{6,20}$/.test(studentId)) {
      wx.showToast({ title: "请输入正确学号", icon: "none" });
      return null;
    }
    if (!String(form.password || "")) {
      wx.showToast({ title: "请输入学校账号密码", icon: "none" });
      return null;
    }
    if (!form.privacyConfirmed) {
      wx.showToast({ title: "请先确认隐私说明", icon: "none" });
      return null;
    }
    return {
      studentId,
      password: String(form.password || ""),
    };
  },

  async validateAndPreviewStudentImport() {
    if (this.data.studentImportLoading) return;
    const form = this.validateStudentForm();
    if (!form) return;

    this.setData({
      studentImportLoading: true,
      studentImportStage: "loading",
      studentPreviewResult: null,
      studentPreviewToken: "",
    });
    this.startStudentLoadingSteps();

    let plainPassword = form.password;
    try {
      let preview;
      try {
        preview = await requestStudentSchedulePreview(form, plainPassword);
      } catch (error) {
        if (!shouldRetryStudentPreview(error)) {
          throw error;
        }
        preview = await requestStudentSchedulePreview(form, plainPassword);
      }
      plainPassword = "";
      this.setData({ "studentForm.password": "" });

      const displayInfo = buildApaasScheduleDisplay(preview);
      const metadata = sanitizeApaasMetadata(preview);
      this.stopStudentLoadingSteps();
      this.setData({
        studentImportLoading: false,
        studentImportStage: "preview",
        studentPreviewToken: preview.importPreviewToken || "",
        studentPreviewResult: Object.assign({}, preview, {
          displayInfo,
          metadata,
          maskedStudentId: metadata.studentIdMasked,
        }),
      });
      wx.showToast({ title: "读取成功", icon: "success" });
    } catch (error) {
      plainPassword = "";
      this.stopStudentLoadingSteps();
      this.setData({
        studentImportLoading: false,
        studentImportStage: "form",
        "studentForm.password": "",
      });
      const payload = error && error.payload || {};
      this.showStudentImportError(payload.code || error.code, payload.message || error.message);
    }
  },

  onXlsBtnTap() {
    if (this.data.selectedFile) {
      this.parseUploadedXls();
      return;
    }
    this.chooseXlsFile();
  },

  chooseXlsFile() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["xls", "xlsx"],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        if (file.size > MAX_FILE_SIZE) {
          wx.showModal({
            title: "文件过大",
            content: "课表文件大小不能超过 5MB，请重新选择。",
            showCancel: false,
          });
          return;
        }
        this.setData({
          selectedFile: {
            name: file.name,
            path: file.path,
            size: file.size,
            sizeStr: formatFileSize(file.size),
          },
        });
      },
      fail: (error) => {
        if (String(error && error.errMsg || "").indexOf("cancel") < 0) {
          wx.showToast({ title: "文件选择失败", icon: "none" });
        }
      },
    });
  },

  clearSelectedFile() {
    this.setData({
      selectedFile: null,
      loadingXls: false,
    });
  },

  parseUploadedXls() {
    const file = this.data.selectedFile;
    if (!file || this.data.loadingXls) return;
    const selectedRecord = this.data.termRecords[this.data.semesterIndex];
    if (!selectedRecord || !selectedRecord.importable) {
      wx.showToast({ title: "目标学期暂不能导入", icon: "none" });
      return;
    }

    this.setData({ loadingXls: true });
    wx.showLoading({ title: "解析课表中..." });

    wx.getFileSystemManager().readFile({
      filePath: file.path,
      encoding: "base64",
      success: (readRes) => {
        request.post("/api/fosu/personal/import-xls", {
          filename: file.name,
          fileBase64: readRes.data,
          source: "fosu-100-print-xls",
          targetTerm: this.data.semesterOptions[this.data.semesterIndex],
        }, {
          silentError: true,
          timeout: 30000,
          retries: 1,
        })
          .then((res) => {
            wx.hideLoading();
            if (!res || res.success === false) {
              this.setData({ loadingXls: false });
              this.showFriendlyError(res && res.code, res && res.message || "课表解析失败");
              return;
            }
            const displayInfo = buildXlsScheduleDisplay(res);
            const fingerprint = buildFingerprint(res);
            const nextResult = Object.assign({}, res, {
              displayInfo,
              fingerprint,
              metadata: sanitizeMetadata(res.metadata || {}),
            });
            this.setData({
              syncSuccess: true,
              loadingXls: false,
              syncResult: nextResult,
              previewSearchKey: "",
              previewDayFilter: "all",
              filteredCourses: decorateCourses(res.courses),
            });
            wx.showToast({ title: "解析成功", icon: "success" });
          })
          .catch((error) => {
            wx.hideLoading();
            this.setData({ loadingXls: false });
            const payload = error && error.payload || {};
            this.showFriendlyError(payload.code, payload.message || error.message || "网络请求失败");
          });
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ loadingXls: false });
        wx.showModal({
          title: "文件读取失败",
          content: "无法读取微信文件，请重新从聊天记录选择课表 XLS。",
          showCancel: false,
        });
      },
    });
  },

  onPreviewSearch(event) {
    this.setData({ previewSearchKey: String(event.detail.value || "").trim().toLowerCase() });
    this.applyPreviewFilters();
  },

  onPreviewDayFilterTap(event) {
    this.setData({ previewDayFilter: event.currentTarget.dataset.day });
    this.applyPreviewFilters();
  },

  applyPreviewFilters() {
    const result = this.data.syncResult || {};
    const searchKey = this.data.previewSearchKey;
    const dayFilter = this.data.previewDayFilter;
    let filtered = Array.isArray(result.courses) ? result.courses : [];

    if (dayFilter !== "all") {
      const targetDay = Number(dayFilter);
      filtered = filtered.filter((course) => getCourseWeekday(course) === targetDay);
    }
    if (searchKey) {
      filtered = filtered.filter((course) => {
        return String(course.courseName || "").toLowerCase().indexOf(searchKey) >= 0 ||
          String(course.teacherName || "").toLowerCase().indexOf(searchKey) >= 0 ||
          String(course.classroom || course.roomName || "").toLowerCase().indexOf(searchKey) >= 0;
      });
    }
    this.setData({ filteredCourses: decorateCourses(filtered) });
  },

  cancelImport() {
    this.setData({
      syncSuccess: false,
      syncResult: null,
      selectedFile: null,
      loadingXls: false,
      previewSearchKey: "",
      previewDayFilter: "all",
      filteredCourses: [],
    });
  },

  cancelStudentImport() {
    const token = this.data.studentPreviewToken;
    if (token) {
      request.post("/api/schedule-import/fosu/cancel", {
        importPreviewToken: token,
      }, {
        showLoading: false,
        silentError: true,
        timeout: 8000,
        retries: 0,
        dedupe: false,
      }).catch(() => {});
    }
    this.setData({
      studentImportStage: "form",
      studentImportLoading: false,
      studentImportConfirming: false,
      studentPreviewResult: null,
      studentPreviewToken: "",
      studentImportedSchedule: null,
      studentForm: Object.assign({}, this.data.studentForm, { password: "" }),
    });
  },

  confirmStudentImport() {
    const token = this.data.studentPreviewToken;
    if (!token || this.data.studentImportConfirming) return;
    this.setData({ studentImportConfirming: true });
    request.post("/api/schedule-import/fosu/confirm", {
      importPreviewToken: token,
      mode: "replace_fosu_source",
      existingCourses: getExistingPersonalCoursesForStudentImport(),
    }, {
      loadingTitle: "正在导入...",
      silentError: true,
      timeout: 20000,
      retries: 0,
      dedupe: false,
    })
      .then((res) => {
        const schedule = res && res.schedule;
        if (!schedule || !Array.isArray(schedule.courses)) {
          throw Object.assign(new Error("IMPORT_RESULT_INVALID"), { code: "IMPORT_RESULT_INVALID" });
        }
        const target = Object.assign({}, schedule, {
          updateTime: schedule.updateTime || new Date().toISOString().slice(0, 10),
          importedAt: schedule.importedAt || new Date().toISOString(),
        });
        if (setCurrentScheduleTarget(target)) {
          aiAssistantService.rememberLatestScheduleImport(target);
          this.setData({
            studentImportConfirming: false,
            studentImportStage: "done",
            studentImportedSchedule: target,
            studentPreviewToken: "",
          });
          wx.showToast({ title: "导入成功", icon: "success" });
          setTimeout(() => {
            wx.switchTab({ url: "/pages/index/index" });
          }, 900);
          return;
        }
        throw Object.assign(new Error("LOCAL_SAVE_FAILED"), { code: "LOCAL_SAVE_FAILED" });
      })
      .catch((error) => {
        this.setData({ studentImportConfirming: false });
        const payload = error && error.payload || {};
        this.showStudentImportError(payload.code || error.code, payload.message || error.message);
      });
  },

  viewImportedSchedule() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  bindToLocal() {
    const result = this.data.syncResult;
    if (!result) return;
    const metadata = sanitizeMetadata(result.metadata || {});
    const displayInfo = result.displayInfo || buildXlsScheduleDisplay(result);
    const importedAt = new Date().toISOString();
    const target = {
      type: "personal-xls",
      name: displayInfo.title,
      title: displayInfo.title,
      subtitle: displayInfo.subtitle,
      classId: `personal-xls-${result.fingerprint || buildFingerprint(result)}`,
      semester: metadata.term || result.term,
      term: metadata.term || result.term,
      courses: Array.isArray(result.courses) ? result.courses : [],
      updateTime: importedAt.slice(0, 10),
      importedAt,
      sourceText: displayInfo.sourceText,
      metadata,
      scheduleFingerprint: result.fingerprint || buildFingerprint(result),
    };

    if (setCurrentScheduleTarget(target)) {
      aiAssistantService.rememberLatestScheduleImport(target);
      wx.showToast({ title: "已设为当前课表", icon: "success" });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }

    wx.showModal({
      title: "设置失败",
      content: "无法保存个人课表，缓存可能已满，请清理后重试。",
      showCancel: false,
    });
  },

  showStudentImportError(code, defaultMsg) {
    let content = defaultMsg || "学号导入暂时不可用，请稍后再试。";
    if (code === "CLIENT_CRYPTO_UNAVAILABLE") {
      content = "当前环境暂时无法完成安全提交，请升级微信后重试，或使用 XLS 导入。";
    } else if (code === "INVALID_CREDENTIALS") {
      content = "学号或密码不正确，请检查后重试。";
    } else if (code === "CAPTCHA_REQUIRED" || code === "RISK_CONTROL_REQUIRED") {
      content = "学校系统需要额外验证，暂时无法自动读取。你可以先使用 XLS 导入。";
    } else if (code === "SCHEDULE_APP_NOT_FOUND") {
      content = "暂时没有找到个人课表入口，请稍后重试或使用其他导入方式。";
    } else if (code === "APAAS_STRUCTURE_CHANGED" || code === "LOGIN_PAGE_CHANGED" || code === "STRUCTURE_CHANGED") {
      content = "学校课表系统暂时无法读取，请稍后重试或使用其他导入方式。";
    } else if (code === "SCHEDULE_EMPTY" || code === "SCHEDULE_ROWS_EMPTY") {
      content = "没有读取到可导入的课表数据，请确认当前学期是否已有课表。";
    } else if (code === "NETWORK_TIMEOUT") {
      content = "连接超时，请稍后重试。";
    } else if (code === "UNKNOWN_IMPORT_ERROR") {
      content = "读取失败，请稍后重试或使用其他导入方式。";
    } else if (code === "IMPORT_RATE_LIMITED") {
      content = "尝试次数过多，请 10 分钟后再试。";
    } else if (code === "IMPORT_KEY_EXPIRED") {
      content = "本次安全验证已失效，请重新点击“验证并读取课表”。";
    } else if (code === "IMPORT_TOKEN_EXPIRED") {
      content = "预览结果已过期，请重新验证后再导入。";
    } else if (code === "FOSU_IMPORT_DISABLED") {
      content = "学号导入暂未开放，请使用 XLS 或班级课表导入。";
    } else if (code === "LOCAL_SAVE_FAILED") {
      content = "课程已读取，但本地保存失败。请清理缓存后重试。";
    }
    wx.showModal({
      title: "提示",
      content,
      showCancel: false,
      confirmText: "知道了",
    });
  },

  goBack() {
    wx.navigateBack();
  },

  onUnload() {
    this.stopStudentLoadingSteps();
    if (this.data.studentPreviewToken) {
      request.post("/api/schedule-import/fosu/cancel", {
        importPreviewToken: this.data.studentPreviewToken,
      }, {
        showLoading: false,
        silentError: true,
        timeout: 5000,
        retries: 0,
        dedupe: false,
      }).catch(() => {});
    }
  },

  showFriendlyError(code, defaultMsg) {
    let content = defaultMsg || "课表解析失败，请检查文件后重试。";
    if (code === "FILE_TOO_LARGE") {
      content = "课表文件过大，请重新下载或压缩后再导入。";
    } else if (code === "INVALID_PARAMS") {
      content = "文件内容为空，请重新选择 XLS/XLSX 文件。";
    } else if (code === "SCHEDULE_PARSE_FAILED" || code === "PERSONAL_SCHEDULE_PARSE_FAILED") {
      content = "无法识别课表结构，请确认文件来自 100 网“打印”导出的个人理论课表。";
    }
    wx.showModal({
      title: "提示",
      content,
      showCancel: false,
      confirmText: "知道了",
    });
  },
});

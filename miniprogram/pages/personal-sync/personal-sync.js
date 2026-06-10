const request = require("../../utils/request");
const { getSettings, setCurrentScheduleTarget } = require("../../utils/storage");
const aiAssistantService = require("../../services/aiAssistantService");
const appConfigService = require("../../services/appConfigService");
const personalTermOptionsService = require("../../services/personalTermOptionsService");
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

Page({
  data: {
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

  onLoad() {
    const settings = getSettings();
    const currentSemesterId = settings.semesterId || settings.semester || getRuntimeTermConfig().term;
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
      });
    };
    applyTerms(appConfigService.getGlobalConfig());
    appConfigService.loadAppConfig({ silent: true }).then(applyTerms).catch(() => {});
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

  goBack() {
    wx.navigateBack();
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

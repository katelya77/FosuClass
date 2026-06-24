const request = require("../../utils/request");
const { getCurrentScheduleTarget, getSettings, setCurrentScheduleTarget } = require("../../utils/storage");
const aiAssistantService = require("../../services/aiAssistantService");
const appConfigService = require("../../services/appConfigService");
const personalTermOptionsService = require("../../services/personalTermOptionsService");
const { encryptCredentialPayload } = require("../../services/fosuStudentImportCrypto");
const { getRuntimeTermConfig, getTodayTeachingInfo } = require("../../utils/week");

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
  "连接学校课表系统",
  "验证账号",
  "读取课程",
  "整理课表",
  "生成预览",
];

const STUDENT_PREVIEW_WEEK_MIN = 1;
const STUDENT_PREVIEW_WEEK_MAX = 19;
const STUDENT_WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const STUDENT_SECTION_LABELS = Array.from({ length: 14 }, (_, index) => `第${index + 1}节`);
const STUDENT_BUCKET_KEYS = ["recommended", "pending", "unplaced", "suspected"];
const STUDENT_BUCKET_LEGACY_KEYS = {
  recommended: "autoInclude",
  pending: "needsConfirm",
  unplaced: "unscheduled",
  suspected: "suspectedNotMine",
};
const STUDENT_GROUP_TITLES = {
  recommended: "已推荐",
  pending: "待确认",
  unplaced: "未排入",
  suspected: "疑似非本班",
  autoInclude: "已推荐",
  needsConfirm: "待确认",
  suspectedNotMine: "疑似非本班",
  unscheduled: "未排入",
};
const STUDENT_BUCKET_HELP = {
  recommended: "系统已按班级、时间和本地课表匹配整理好，默认会导入。",
  pending: "这些课程可能属于你，但信息不够确定，需要你手动选择。",
  unplaced: "这些课程缺少固定周次、星期或节次，不会直接放进课表格。",
  suspected: "这些课程更像其他班级安排，默认不会导入。",
};
const STUDENT_DECISION_STATUS = {
  auto_include: { text: "推荐", className: "status-auto" },
  needs_confirm: { text: "待确认", className: "status-confirm" },
  suspected_not_mine: { text: "疑似非本班", className: "status-suspect" },
  unscheduled: { text: "未排入", className: "status-unscheduled" },
};

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

function clampPreviewWeek(week) {
  const value = Number(week || 0) || 16;
  return Math.max(STUDENT_PREVIEW_WEEK_MIN, Math.min(STUDENT_PREVIEW_WEEK_MAX, value));
}

function resolveStudentCurrentPreviewWeek() {
  const settings = getSettings && getSettings() || {};
  const termConfig = getRuntimeTermConfig();
  if (settings.manualWeekOverride && settings.currentWeek) {
    return clampPreviewWeek(settings.currentWeek);
  }
  const todayInfo = getTodayTeachingInfo(new Date(), [], termConfig);
  if (todayInfo && todayInfo.isInTerm && todayInfo.weekNo) {
    return clampPreviewWeek(todayInfo.weekNo);
  }
  if (settings.currentWeek) {
    return clampPreviewWeek(settings.currentWeek);
  }
  return 0;
}

function toNumberList(values, max) {
  return (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((item) => Number.isInteger(item) && item > 0 && (!max || item <= max))
    .sort((left, right) => left - right);
}

function parseStudentNumberRange(text, max) {
  const value = String(text || "")
    .replace(/[，、；;]/g, ",")
    .replace(/[~～—–至到]/g, "-")
    .replace(/[第周节]/g, "")
    .replace(/\s+/g, "");
  const result = [];
  value.split(",").forEach((part) => {
    if (!part) return;
    if (part.indexOf("-") >= 0) {
      const pieces = part.split("-");
      const start = Number(pieces[0]);
      const end = Number(pieces[1]);
      if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
        for (let current = start; current <= end && (!max || current <= max); current += 1) {
          result.push(current);
        }
      }
      return;
    }
    const single = Number(part);
    if (Number.isInteger(single) && single > 0 && (!max || single <= max)) {
      result.push(single);
    }
  });
  return Array.from(new Set(result)).sort((left, right) => left - right);
}

function formatStudentWeekText(weeks) {
  const list = toNumberList(weeks, 60);
  if (!list.length) return "";
  const ranges = [];
  let start = list[0];
  let prev = list[0];
  for (let index = 1; index <= list.length; index += 1) {
    const current = list[index];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  return `${ranges.join(",")}周`;
}

function formatStudentSectionText(sections) {
  const list = toNumberList(sections, 14);
  if (!list.length) return "";
  const consecutive = list.every((item, index) => index === 0 || item === list[index - 1] + 1);
  return consecutive
    ? `第${list[0]}-${list[list.length - 1]}节`
    : `第${list.join(",")}节`;
}

function applyEditedArrangement(arrangement, editedMap = {}) {
  const id = arrangement && arrangement.arrangementId;
  const edited = id && editedMap[id] || null;
  if (!edited) return Object.assign({}, arrangement);
  const sections = toNumberList(edited.sections && edited.sections.length
    ? edited.sections
    : parseStudentNumberRange(edited.sectionText, 14), 14);
  const weeks = toNumberList(edited.weeks && edited.weeks.length
    ? edited.weeks
    : parseStudentNumberRange(edited.weekText, 60), 60);
  return Object.assign({}, arrangement, edited, {
    weekday: Number(edited.weekday || arrangement.weekday || 0) || 0,
    sections,
    startSection: sections[0] || null,
    endSection: sections[sections.length - 1] || null,
    sectionText: formatStudentSectionText(sections) || edited.sectionText || arrangement.sectionText || "",
    weeks,
    weekText: formatStudentWeekText(weeks) || edited.weekText || arrangement.weekText || "",
    roomName: edited.roomName || arrangement.roomName || "",
    hasCompleteTime: Boolean((Number(edited.weekday || arrangement.weekday || 0) || 0) && sections.length && weeks.length),
    edited: true,
  });
}

function normalizeStudentPreviewBuckets(previewOrGroups) {
  const source = previewOrGroups && (previewOrGroups.buckets || previewOrGroups.groups)
    ? (previewOrGroups.buckets || previewOrGroups.groups)
    : (previewOrGroups || {});
  return STUDENT_BUCKET_KEYS.reduce((result, bucketKey) => {
    const legacyKey = STUDENT_BUCKET_LEGACY_KEYS[bucketKey];
    result[bucketKey] = Array.isArray(source[bucketKey])
      ? source[bucketKey]
      : (Array.isArray(source[legacyKey]) ? source[legacyKey] : []);
    return result;
  }, {});
}

function flattenStudentPreviewArrangements(preview) {
  const buckets = normalizeStudentPreviewBuckets(preview);
  return STUDENT_BUCKET_KEYS.reduce((list, bucketKey) => {
    (buckets[bucketKey] || []).forEach((group) => {
      (group.arrangements || []).forEach((arrangement) => {
        list.push(Object.assign({}, arrangement, {
          bucketKey,
          legacyBucketKey: STUDENT_BUCKET_LEGACY_KEYS[bucketKey],
          groupTitle: group.displayCourseName || arrangement.displayCourseName || arrangement.courseName || "",
          groupReason: group.reason || "",
        }));
      });
    });
    return list;
  }, []);
}

function arrangementActiveInWeek(arrangement, week) {
  return toNumberList(arrangement && arrangement.weeks, 60).indexOf(Number(week)) >= 0;
}

function rangesOverlap(left, right) {
  const leftSet = new Set(toNumberList(left, 80));
  return toNumberList(right, 80).some((item) => leftSet.has(item));
}

function markStudentPreviewConflicts(cells) {
  const selectedCells = cells.filter((cell) => cell.selected !== false);
  selectedCells.forEach((cell) => { cell.conflict = false; });
  for (let leftIndex = 0; leftIndex < selectedCells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selectedCells.length; rightIndex += 1) {
      const left = selectedCells[leftIndex];
      const right = selectedCells[rightIndex];
      if (Number(left.weekday) !== Number(right.weekday)) continue;
      if (!rangesOverlap(left.sections, right.sections)) continue;
      left.conflict = true;
      right.conflict = true;
    }
  }
}

function buildStudentPreviewGrid(arrangements, week, selectedMap, editedMap) {
  const targetWeek = clampPreviewWeek(week);
  const cells = (arrangements || [])
    .map((arrangement) => applyEditedArrangement(arrangement, editedMap))
    .filter((arrangement) => arrangement && arrangement.hasCompleteTime && arrangementActiveInWeek(arrangement, targetWeek))
    .map((arrangement) => {
      const selected = selectedMap && Object.prototype.hasOwnProperty.call(selectedMap, arrangement.arrangementId)
        ? Boolean(selectedMap[arrangement.arrangementId])
        : Boolean(arrangement.selectedByDefault);
      return {
        id: arrangement.arrangementId,
        arrangementId: arrangement.arrangementId,
        courseGroupId: arrangement.courseGroupId,
        courseName: arrangement.displayCourseName || arrangement.courseName,
        displayCourseName: arrangement.displayCourseName || arrangement.courseName,
        normalizedCourseName: arrangement.normalizedCourseName || arrangement.courseName || arrangement.displayCourseName || "",
        weekday: arrangement.weekday,
        sections: arrangement.sections,
        startSection: arrangement.startSection,
        endSection: arrangement.endSection,
        weekText: arrangement.weekText,
        roomName: arrangement.roomName || "",
        teacherName: arrangement.teacherName || "",
        classNameRaw: arrangement.classNameRaw || "",
        matchStatus: arrangement.matchStatus || "",
        importDecision: arrangement.importDecision,
        reason: arrangement.reason || "",
        selected,
        conflict: false,
      };
    });

  markStudentPreviewConflicts(cells);
  return {
    week: targetWeek,
    days: STUDENT_WEEKDAY_LABELS.map((label, index) => ({ weekday: index + 1, label })),
    sections: Array.from({ length: 14 }, (_, index) => ({ section: index + 1, label: `${index + 1}` })),
    cells,
  };
}

function decorateStudentArrangement(arrangement, selectedMap, editedMap) {
  const merged = applyEditedArrangement(arrangement, editedMap);
  const id = merged.arrangementId;
  const selected = selectedMap && Object.prototype.hasOwnProperty.call(selectedMap, id)
    ? Boolean(selectedMap[id])
    : Boolean(merged.selectedByDefault);
  const status = STUDENT_DECISION_STATUS[merged.importDecision] || { text: "待确认", className: "status-confirm" };
  const weekdayText = merged.weekday ? STUDENT_WEEKDAY_LABELS[merged.weekday - 1] : "";
  const sectionText = merged.sectionText || formatStudentSectionText(merged.sections);
  return Object.assign({}, merged, {
    selected,
    edited: Boolean(editedMap && editedMap[id]),
    statusText: selected ? status.text : "未选择",
    statusClass: selected ? status.className : "status-muted",
    timeText: weekdayText && sectionText ? `${weekdayText} ${sectionText}` : "时间待确认",
    roomText: merged.roomName || "未注明",
    teacherText: merged.teacherName || "未注明",
    reasonText: merged.reason || merged.groupReason || "请确认后再导入",
    canEdit: !merged.hasCompleteTime || merged.importDecision === "unscheduled",
  });
}

function decorateStudentGroups(groups, selectedMap, editedMap, expandedGroups = {}) {
  const buckets = normalizeStudentPreviewBuckets(groups);
  return STUDENT_BUCKET_KEYS.map((bucketKey) => {
    const groupList = (buckets[bucketKey] || []).map((group) => {
      const arrangements = (group.arrangements || []).map((arrangement) =>
        decorateStudentArrangement(Object.assign({}, arrangement, { bucketKey, groupReason: group.reason || "" }), selectedMap, editedMap)
      );
      const selectedCount = arrangements.filter((item) => item.selected).length;
      const viewKey = group.courseGroupId || `${bucketKey}-${group.displayCourseName || group.courseName || arrangements[0] && arrangements[0].arrangementId || "group"}`;
      return Object.assign({}, group, {
        bucketKey,
        viewKey,
        arrangements,
        arrangementCount: arrangements.length,
        selectedCount,
        countText: selectedCount ? `${selectedCount}/${arrangements.length} 已选` : `${arrangements.length} 项`,
        expanded: Boolean(expandedGroups[viewKey]),
      });
    });
    const arrangementCount = groupList.reduce((sum, group) => sum + group.arrangementCount, 0);
    const selectedCount = groupList.reduce((sum, group) => sum + group.selectedCount, 0);
    return {
      key: bucketKey,
      title: STUDENT_GROUP_TITLES[bucketKey],
      help: STUDENT_BUCKET_HELP[bucketKey],
      groups: groupList,
      arrangementCount,
      selectedCount,
      summaryText: selectedCount ? `${selectedCount}/${arrangementCount} 已选` : `${arrangementCount} 项`,
    };
  });
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
  return code === "IMPORT_KEY_EXPIRED" ||
    code === "INVALID_ENCRYPTED_PAYLOAD" ||
    code === "SCHOOL_SYSTEM_TIMEOUT" ||
    code === "NETWORK_TIMEOUT";
}

async function requestStudentSchedulePreview(form, password, extra = {}) {
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
    semester: extra.semester || "",
    selectedClassName: extra.selectedClassName || "",
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
    studentLoadingProgressStyle: "width: 14%;",
    studentImportSlow: false,
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
    studentPreviewWeek: 16,
    studentPreviewGrid: null,
    studentPreviewBuckets: [],
    studentAdvancedMode: false,
    studentAdvancedTabs: [],
    studentActiveBucket: "recommended",
    studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
    studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
    studentActiveBucketGroups: [],
    studentExpandedGroups: {},
    studentExpandedSections: {
      autoInclude: true,
      needsConfirm: false,
      unscheduled: false,
      suspectedNotMine: false,
    },
    studentSelectionMode: false,
    studentSelectedCount: 0,
    studentRecommendedCount: 0,
    studentPendingCount: 0,
    studentConflictCount: 0,
    studentEditingArrangement: null,
    editWeekdayLabels: STUDENT_WEEKDAY_LABELS,
    editWeekdayIndex: 0,
    editSectionLabels: STUDENT_SECTION_LABELS,
    editStartIndex: 0,
    editEndIndex: 1,
    editWeekText: "",
    editRoomName: "",
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
    this.studentPreviewArrangements = [];
    this.studentSelectedArrangementMap = {};
    this.studentEditedArrangementMap = {};
    this.setData({
      activeImportMethod: method || "method",
      syncSuccess: false,
      studentImportStage: "form",
      studentPreviewResult: null,
      studentPreviewToken: "",
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: {},
      studentSelectionMode: false,
      studentEditingArrangement: null,
    });
  },

  backToImportMethods() {
    this.studentPreviewArrangements = [];
    this.studentSelectedArrangementMap = {};
    this.studentEditedArrangementMap = {};
    this.setData({
      activeImportMethod: "method",
      syncSuccess: false,
      selectedFile: null,
      studentImportStage: "form",
      studentImportLoading: false,
      studentImportConfirming: false,
      studentPreviewResult: null,
      studentPreviewToken: "",
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: {},
      studentSelectionMode: false,
      studentEditingArrangement: null,
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
    if (this.studentSlowTimer) {
      clearTimeout(this.studentSlowTimer);
    }
    this.setData({
      studentLoadingStepIndex: 0,
      studentLoadingProgressStyle: "width: 14%;",
      studentImportSlow: false,
    });
    this.studentStepTimer = setInterval(() => {
      const next = Math.min(STUDENT_IMPORT_STEPS.length - 1, this.data.studentLoadingStepIndex + 1);
      const progress = Math.min(92, 14 + Math.round((next / (STUDENT_IMPORT_STEPS.length - 1)) * 76));
      this.setData({
        studentLoadingStepIndex: next,
        studentLoadingProgressStyle: `width: ${progress}%;`,
      });
      if (next >= STUDENT_IMPORT_STEPS.length - 1 && this.studentStepTimer) {
        clearInterval(this.studentStepTimer);
        this.studentStepTimer = null;
      }
    }, 1800);
    this.studentSlowTimer = setTimeout(() => {
      this.setData({ studentImportSlow: true });
    }, 8000);
  },

  stopStudentLoadingSteps() {
    if (this.studentStepTimer) {
      clearInterval(this.studentStepTimer);
      this.studentStepTimer = null;
    }
    if (this.studentSlowTimer) {
      clearTimeout(this.studentSlowTimer);
      this.studentSlowTimer = null;
    }
    this.setData({
      studentLoadingProgressStyle: "width: 100%;",
      studentImportSlow: false,
    });
  },

  getStudentPreviewRequestExtra() {
    const selectedRecord = this.data.termRecords[this.data.semesterIndex] || {};
    const settings = getSettings && getSettings() || {};
    const current = getCurrentScheduleTarget && getCurrentScheduleTarget() || {};
    return {
      semester: selectedRecord.term || this.data.semesterOptions[this.data.semesterIndex] || settings.semesterId || settings.semester || "",
      selectedClassName: settings.className || current.className || current.name || "",
    };
  },

  resetStudentPreviewState() {
    this.studentPreviewArrangements = [];
    this.studentSelectedArrangementMap = {};
    this.studentEditedArrangementMap = {};
    this.setData({
      studentPreviewWeek: 16,
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: {},
      studentSelectionMode: false,
      studentSelectedCount: 0,
      studentRecommendedCount: 0,
      studentPendingCount: 0,
      studentConflictCount: 0,
      studentEditingArrangement: null,
      editWeekdayIndex: 0,
      editStartIndex: 0,
      editEndIndex: 1,
      editWeekText: "",
      editRoomName: "",
    });
  },

  prepareStudentPreview(preview) {
    const arrangements = flattenStudentPreviewArrangements(preview);
    const selectedMap = {};
    arrangements.forEach((arrangement) => {
      if (arrangement && arrangement.arrangementId) {
        selectedMap[arrangement.arrangementId] = Boolean(arrangement.selectedByDefault);
      }
    });
    this.studentPreviewArrangements = arrangements;
    this.studentSelectedArrangementMap = selectedMap;
    this.studentEditedArrangementMap = {};
    this.setData({
      studentAdvancedMode: false,
      studentActiveBucket: "recommended",
      studentExpandedGroups: {},
    });
    const week = clampPreviewWeek(
      resolveStudentCurrentPreviewWeek() ||
      preview && preview.summary && preview.summary.currentPreviewWeek ||
      preview && preview.previewGrid && preview.previewGrid.week ||
      16
    );
    this.refreshStudentPreviewState(preview, week);
  },

  refreshStudentPreviewState(preview, week) {
    const result = preview || this.data.studentPreviewResult || {};
    const arrangements = this.studentPreviewArrangements || [];
    const selectedMap = this.studentSelectedArrangementMap || {};
    const editedMap = this.studentEditedArrangementMap || {};
    const targetWeek = clampPreviewWeek(week || this.data.studentPreviewWeek);
    const selectedCount = arrangements.filter((arrangement) => selectedMap[arrangement.arrangementId]).length;
    const expandedGroups = this.data.studentExpandedGroups || {};
    const buckets = decorateStudentGroups(result, selectedMap, editedMap, expandedGroups);
    const activeBucket = STUDENT_BUCKET_KEYS.indexOf(this.data.studentActiveBucket) >= 0
      ? this.data.studentActiveBucket
      : "recommended";
    const activeBucketModel = buckets.find((bucket) => bucket.key === activeBucket) || buckets[0] || {};
    const summary = result.summary || {};
    const recommendedCount = summary.recommendedArrangementCount || summary.arrangementAutoIncludeCount || summary.scheduledCourseCount || 0;
    const pendingCount = (summary.pendingArrangementCount || summary.needsConfirmCount || 0) +
      (summary.unplacedArrangementCount || summary.unscheduledCount || 0);
    const conflictCount = summary.conflictCount || 0;
    this.setData({
      studentPreviewWeek: targetWeek,
      studentPreviewGrid: buildStudentPreviewGrid(arrangements, targetWeek, selectedMap, editedMap),
      studentPreviewBuckets: buckets,
      studentAdvancedTabs: buckets.map((bucket) => Object.assign({}, bucket, {
        active: bucket.key === activeBucket,
        countText: `${bucket.arrangementCount || 0}`,
      })),
      studentActiveBucket: activeBucket,
      studentActiveBucketTitle: activeBucketModel.title || STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: activeBucketModel.help || STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: activeBucketModel.groups || [],
      studentSelectedCount: selectedCount,
      studentRecommendedCount: recommendedCount,
      studentPendingCount: pendingCount,
      studentConflictCount: conflictCount,
    });
  },

  onStudentPreviewWeekShift(event) {
    const delta = Number(event.currentTarget.dataset.delta || 0) || 0;
    const nextWeek = clampPreviewWeek(this.data.studentPreviewWeek + delta);
    this.refreshStudentPreviewState(this.data.studentPreviewResult, nextWeek);
  },

  toggleStudentSection(event) {
    const key = event.currentTarget.dataset.section;
    if (!key) return;
    const expanded = Object.assign({}, this.data.studentExpandedSections || {});
    expanded[key] = !expanded[key];
    this.setData({ studentExpandedSections: expanded }, () => {
      this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
    });
  },

  toggleStudentSelectionMode() {
    this.setData({ studentSelectionMode: !this.data.studentSelectionMode });
  },

  toggleStudentAdvancedMode() {
    const next = !this.data.studentAdvancedMode;
    this.setData({
      studentAdvancedMode: next,
      studentSelectionMode: next,
    }, () => {
      this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
    });
  },

  onStudentBucketTabTap(event) {
    const key = event.currentTarget.dataset.key;
    if (STUDENT_BUCKET_KEYS.indexOf(key) < 0) return;
    this.setData({ studentActiveBucket: key }, () => {
      this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
    });
  },

  toggleStudentGroup(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    const expanded = Object.assign({}, this.data.studentExpandedGroups || {});
    expanded[key] = !expanded[key];
    this.setData({ studentExpandedGroups: expanded }, () => {
      this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
    });
  },

  findStudentArrangement(arrangementId) {
    return (this.studentPreviewArrangements || []).find((arrangement) => arrangement.arrangementId === arrangementId) || null;
  },

  setStudentArrangementSelected(arrangementId, selected) {
    const arrangement = this.findStudentArrangement(arrangementId);
    if (!arrangement) return false;
    const edited = this.studentEditedArrangementMap && this.studentEditedArrangementMap[arrangementId];
    const merged = applyEditedArrangement(arrangement, this.studentEditedArrangementMap || {});
    if (selected && !merged.hasCompleteTime && !edited) {
      wx.showToast({ title: "请先编辑时间后加入", icon: "none" });
      this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
      return false;
    }
    this.studentSelectedArrangementMap = Object.assign({}, this.studentSelectedArrangementMap, {
      [arrangementId]: Boolean(selected),
    });
    this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
    return true;
  },

  toggleStudentArrangement(event) {
    const arrangementId = event.currentTarget.dataset.id;
    const currentlySelected = Boolean(this.studentSelectedArrangementMap && this.studentSelectedArrangementMap[arrangementId]);
    this.setStudentArrangementSelected(arrangementId, !currentlySelected);
  },

  toggleStudentArrangementSwitch(event) {
    const arrangementId = event.currentTarget.dataset.id;
    this.setStudentArrangementSelected(arrangementId, Boolean(event.detail && event.detail.value));
  },

  startEditStudentArrangement(event) {
    const arrangementId = event.currentTarget.dataset.id;
    const arrangement = this.findStudentArrangement(arrangementId);
    if (!arrangement) return;
    const merged = decorateStudentArrangement(arrangement, this.studentSelectedArrangementMap || {}, this.studentEditedArrangementMap || {});
    const startSection = Number(merged.startSection || 1) || 1;
    const endSection = Number(merged.endSection || Math.min(14, startSection + 1)) || startSection;
    this.setData({
      studentEditingArrangement: merged,
      editWeekdayIndex: Math.max(0, Math.min(6, Number(merged.weekday || 1) - 1)),
      editStartIndex: Math.max(0, Math.min(13, startSection - 1)),
      editEndIndex: Math.max(0, Math.min(13, endSection - 1)),
      editWeekText: merged.weekText || "",
      editRoomName: merged.roomName || "",
    });
  },

  cancelStudentArrangementEdit() {
    this.setData({ studentEditingArrangement: null });
  },

  onEditWeekdayChange(event) {
    this.setData({ editWeekdayIndex: Number(event.detail.value || 0) || 0 });
  },

  onEditStartSectionChange(event) {
    const index = Number(event.detail.value || 0) || 0;
    this.setData({
      editStartIndex: index,
      editEndIndex: Math.max(index, this.data.editEndIndex),
    });
  },

  onEditEndSectionChange(event) {
    this.setData({ editEndIndex: Number(event.detail.value || 0) || 0 });
  },

  onEditWeekTextInput(event) {
    this.setData({ editWeekText: String(event.detail.value || "").slice(0, 40) });
  },

  onEditRoomInput(event) {
    this.setData({ editRoomName: String(event.detail.value || "").slice(0, 50) });
  },

  saveStudentArrangementEdit() {
    const base = this.data.studentEditingArrangement;
    if (!base || !base.arrangementId) return;
    const weekday = this.data.editWeekdayIndex + 1;
    const startSection = this.data.editStartIndex + 1;
    const endSection = this.data.editEndIndex + 1;
    if (endSection < startSection) {
      wx.showToast({ title: "结束节次不能早于开始节次", icon: "none" });
      return;
    }
    const weeks = parseStudentNumberRange(this.data.editWeekText, 60);
    if (!weeks.length) {
      wx.showToast({ title: "请填写周次，例如 1-16周", icon: "none" });
      return;
    }
    const sections = [];
    for (let section = startSection; section <= endSection; section += 1) {
      sections.push(section);
    }
    const edited = {
      arrangementId: base.arrangementId,
      baseArrangementId: base.arrangementId,
      weekday,
      sections,
      startSection,
      endSection,
      sectionText: formatStudentSectionText(sections),
      weeks,
      weekText: formatStudentWeekText(weeks),
      roomName: String(this.data.editRoomName || "").trim(),
    };
    this.studentEditedArrangementMap = Object.assign({}, this.studentEditedArrangementMap, {
      [base.arrangementId]: edited,
    });
    this.studentSelectedArrangementMap = Object.assign({}, this.studentSelectedArrangementMap, {
      [base.arrangementId]: true,
    });
    this.setData({ studentEditingArrangement: null });
    this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
  },

  getSelectedStudentArrangementIds() {
    const selectedMap = this.studentSelectedArrangementMap || {};
    return Object.keys(selectedMap).filter((arrangementId) => selectedMap[arrangementId]);
  },

  getEditedStudentArrangements() {
    const editedMap = this.studentEditedArrangementMap || {};
    return Object.keys(editedMap).map((arrangementId) => editedMap[arrangementId]);
  },

  onStudentPreviewCourseTap(event) {
    const course = event.detail && event.detail.course || {};
    const weekdayText = course.weekday ? STUDENT_WEEKDAY_LABELS[course.weekday - 1] : "星期待确认";
    const sectionText = course.sectionText || formatStudentSectionText(course.sections) || "节次待确认";
    wx.showModal({
      title: course.displayCourseName || course.courseName || "课程详情",
      content: [
        `${weekdayText} ${sectionText}`,
        course.weekText || "周次待确认",
        `地点：${course.roomName || "未注明"}`,
        course.teacherName ? `教师：${course.teacherName}` : "",
      ].filter(Boolean).join("\n"),
      showCancel: false,
      confirmText: "知道了",
    });
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
    const selectedRecord = this.data.termRecords[this.data.semesterIndex];
    if (selectedRecord && !selectedRecord.importable) {
      wx.showToast({ title: "该学期暂不能导入", icon: "none" });
      return;
    }
    const previewExtra = this.getStudentPreviewRequestExtra();

    this.setData({
      studentImportLoading: true,
      studentImportStage: "loading",
      studentPreviewResult: null,
      studentPreviewToken: "",
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentLoadingStepIndex: 0,
      studentLoadingProgressStyle: "width: 14%;",
      studentImportSlow: false,
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: {},
      studentSelectionMode: false,
      studentEditingArrangement: null,
    });
    this.startStudentLoadingSteps();

    let plainPassword = form.password;
    try {
      let preview;
      try {
        preview = await requestStudentSchedulePreview(form, plainPassword, previewExtra);
      } catch (error) {
        if (!shouldRetryStudentPreview(error)) {
          throw error;
        }
        preview = await requestStudentSchedulePreview(form, plainPassword, previewExtra);
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
      this.prepareStudentPreview(this.data.studentPreviewResult);
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
    this.studentPreviewArrangements = [];
    this.studentSelectedArrangementMap = {};
    this.studentEditedArrangementMap = {};
    this.setData({
      studentImportStage: "form",
      studentImportLoading: false,
      studentImportConfirming: false,
      studentPreviewResult: null,
      studentPreviewToken: "",
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: {},
      studentSelectionMode: false,
      studentEditingArrangement: null,
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
      selectedArrangementIds: this.getSelectedStudentArrangementIds(),
      editedArrangements: this.getEditedStudentArrangements(),
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
            studentAdvancedMode: false,
            studentSelectionMode: false,
            studentEditingArrangement: null,
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
    } else if (code === "SCHOOL_SYSTEM_TIMEOUT") {
      content = "学校系统响应较慢，本次读取已超时。你可以立即重试一次，仍失败可稍后再试。";
    } else if (code === "NETWORK_TIMEOUT") {
      content = "网络连接超时。你可以立即重试一次，仍失败可稍后再试。";
    } else if (code === "UNKNOWN_IMPORT_ERROR") {
      content = "读取失败，请稍后重试或使用其他导入方式。";
    } else if (code === "IMPORT_RATE_LIMITED") {
      content = "尝试次数较多，请稍后再试。";
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

const request = require("../../utils/request");
const privacy = require("../../utils/privacy");
const { getCurrentScheduleTarget, getSettings, setCurrentScheduleTarget } = require("../../utils/storage");
const platform = require("../../utils/platform");
const aiAssistantService = require("../../services/aiAssistantService");
const appConfigService = require("../../services/appConfigService");
const personalTermOptionsService = require("../../services/personalTermOptionsService");
const recentStudentImportService = require("../../services/recentStudentImportService");
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
  pending: "信息需确认，已具备上课时间。",
  unplaced: "缺少周次、星期或节次，暂不能放入课表。",
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
    const sections = toNumberList(course.sections && course.sections.length
      ? course.sections
      : (start && end ? [start, end] : []), 14);
    const sectionText = start && end
      ? formatStudentSectionText(sections.length > 2 ? sections : Array.from({ length: end - start + 1 }, (_, sectionIndex) => start + sectionIndex))
      : "节次待定";
    return Object.assign({}, course, {
      previewKey: [
        course.courseName || "course",
        weekday,
        start,
        end,
        course.classroom || course.roomName || "",
        index,
      ].join("-"),
      displayTime: `${weekText[weekday] || "周次"} · ${sectionText}`,
      displayWeekText: formatStudentWeekDisplay(course.weeks, course.weekText),
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
  return `第${ranges.join(",")}周`;
}

function formatStudentSectionText(sections) {
  const list = toNumberList(sections, 14);
  if (!list.length) return "";
  if (list.length === 1) return `第${list[0]}节`;
  const consecutive = list.every((item, index) => index === 0 || item === list[index - 1] + 1);
  return consecutive
    ? `第${list[0]}-${list[list.length - 1]}节`
    : `第${list.join(",")}节`;
}

function formatStudentWeekDisplay(weeks, rawText) {
  const parsed = toNumberList(weeks && weeks.length ? weeks : parseStudentNumberRange(rawText, 60), 60);
  if (parsed.length) return formatStudentWeekText(parsed);
  const text = String(rawText || "").trim();
  if (!text) return "周次待确认";
  if (/待确认|待定|未定|未标明|未注明/.test(text)) return "周次待确认";
  if (/^第.+周$/.test(text)) return text;
  const compact = text.replace(/^第/, "").replace(/周$/, "");
  return compact ? `第${compact}周` : "周次待确认";
}

function buildStudentArrangementMetaText(arrangement) {
  const parts = [];
  if (arrangement.roomName) parts.push(arrangement.roomName);
  if (arrangement.teacherName) parts.push(arrangement.teacherName);
  parts.push(formatStudentWeekDisplay(arrangement.weeks, arrangement.weekText));
  return parts.filter(Boolean).join(" · ");
}

function splitStudentClassNameRaw(value) {
  return Array.from(new Set(String(value || "")
    .split(/[，、,;；\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean)));
}

function compactStudentClassNameRaw(value) {
  const list = splitStudentClassNameRaw(value);
  const fullText = list.join("、");
  if (!fullText) {
    return { fullText: "", previewText: "", truncated: false };
  }
  const previewItems = list.slice(0, 2);
  const previewText = previewItems.join("、");
  return {
    fullText,
    previewText: list.length > previewItems.length ? `${previewText}等${list.length}个班级` : previewText,
    truncated: list.length > previewItems.length || fullText.length > 28,
  };
}

function humanizeClassScopeReason(arrangement) {
  const status = String(arrangement && arrangement.classScopeStatus || "");
  const decision = String(arrangement && arrangement.importDecision || "");
  if (status === "match") return "包含当前班级，已推荐";
  if (status === "not_match") return "看起来不是当前班级，默认不选";
  if (decision === "auto_include") return "已和当前课表时间匹配，已推荐";
  return "未确认是否属于当前班级";
}

function classScopeReasonClass(arrangement) {
  const status = String(arrangement && arrangement.classScopeStatus || "");
  if (status === "match") return "scope-match";
  if (status === "not_match") return "scope-not-match";
  return "scope-unknown";
}

function applyEditedArrangement(arrangement, editedMap = {}) {
  const id = arrangement && arrangement.arrangementId;
  const edited = id && editedMap[id] || null;
  if (!edited) return Object.assign({}, arrangement, {
    classNameRaw: resolveClassNameText(arrangement),
  });
  const sections = toNumberList(edited.sections && edited.sections.length
    ? edited.sections
    : parseStudentNumberRange(edited.sectionText, 14), 14);
  const weeks = toNumberList(edited.weeks && edited.weeks.length
    ? edited.weeks
    : parseStudentNumberRange(edited.weekText, 60), 60);
  const weekday = Number(edited.weekday || arrangement.weekday || 0) || 0;
  const hasCompleteTime = Boolean(weekday && sections.length && weeks.length);
  const importDecision = hasCompleteTime && arrangement.importDecision === "unscheduled"
    ? "needs_confirm"
    : arrangement.importDecision;
  return Object.assign({}, arrangement, edited, {
    weekday,
    sections,
    startSection: sections[0] || null,
    endSection: sections[sections.length - 1] || null,
    sectionText: formatStudentSectionText(sections) || edited.sectionText || arrangement.sectionText || "",
    weeks,
    weekText: formatStudentWeekText(weeks) || edited.weekText || arrangement.weekText || "",
    roomName: edited.roomName || arrangement.roomName || "",
    classNameRaw: resolveClassNameText(arrangement),
    hasCompleteTime,
    importDecision,
    reason: importDecision === "needs_confirm" && arrangement.importDecision === "unscheduled"
      ? "已补全时间，待确认后导入"
      : arrangement.reason,
    edited: true,
  });
}

function normalizeStudentPreviewBuckets(previewOrGroups) {
  const hasBucketSource = previewOrGroups && (previewOrGroups.buckets || previewOrGroups.groups);
  const source = hasBucketSource
    ? (previewOrGroups.buckets || previewOrGroups.groups)
    : (previewOrGroups || {});
  if (!hasBucketSource && Array.isArray(previewOrGroups && previewOrGroups.courseGroups)) {
    return Object.assign(createEmptyStudentBuckets(), {
      recommended: previewOrGroups.courseGroups,
    });
  }
  if (!hasBucketSource && Array.isArray(previewOrGroups && previewOrGroups.allArrangements)) {
    return Object.assign(createEmptyStudentBuckets(), {
      recommended: [{
        displayCourseName: "",
        arrangements: previewOrGroups.allArrangements,
      }],
    });
  }
  const normalized = STUDENT_BUCKET_KEYS.reduce((result, bucketKey) => {
    const legacyKey = STUDENT_BUCKET_LEGACY_KEYS[bucketKey];
    result[bucketKey] = Array.isArray(source[bucketKey])
      ? source[bucketKey]
      : (Array.isArray(source[legacyKey]) ? source[legacyKey] : []);
    return result;
  }, {});
  const totalGroups = STUDENT_BUCKET_KEYS.reduce((sum, bucketKey) => sum + normalized[bucketKey].length, 0);
  if (!totalGroups && Array.isArray(previewOrGroups && previewOrGroups.courseGroups) && previewOrGroups.courseGroups.length) {
    return Object.assign(createEmptyStudentBuckets(), {
      recommended: previewOrGroups.courseGroups,
    });
  }
  return normalized;
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

function normalizePreviewCourseName(value) {
  return String(value || "")
    .trim()
    .replace(/\u3000/g, " ")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[【［]/g, "[")
    .replace(/[】］]/g, "]")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function stableStudentHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isArrangementScopedGroupId(groupId, arrangement) {
  const value = String(groupId || "");
  if (!value) return true;
  if (arrangement && value === String(arrangement.arrangementId || "")) return true;
  return /^arr[_-]/i.test(value) || /^recent-/i.test(value);
}

function resolveArrangementCourseName(arrangement) {
  return arrangement && (
    arrangement.normalizedCourseName ||
    arrangement.displayCourseName ||
    arrangement.courseName ||
    arrangement.groupTitle ||
    ""
  ) || "";
}

function buildStudentCourseGroupId(bucketKey, group, arrangement) {
  const sourceId = group && group.courseGroupId || arrangement && arrangement.courseGroupId || "";
  if (sourceId && !isArrangementScopedGroupId(sourceId, arrangement)) {
    return String(sourceId);
  }
  const normalizedName = normalizePreviewCourseName(resolveArrangementCourseName(arrangement));
  const category = String(arrangement && arrangement.category || group && group.category || "");
  return `group_${stableStudentHash([bucketKey, normalizedName, category].join("|"))}`;
}

function needsTimeCompletion(arrangement) {
  return !(
    Number(arrangement && arrangement.weekday || 0) ||
    Number(arrangement && arrangement.weekDay || 0)
  ) || !toNumberList(arrangement && arrangement.sections, 14).length ||
    !toNumberList(arrangement && arrangement.weeks, 60).length;
}

function resolveClassNameText(arrangement) {
  const classScope = arrangement && arrangement.classScope && typeof arrangement.classScope === "object"
    ? arrangement.classScope
    : {};
  const raw = arrangement && (
    arrangement.classNameRaw ||
    arrangement.className ||
    arrangement.classNameText ||
    arrangement.teachingClass ||
    arrangement.rawClassText ||
    classScope.raw ||
    ""
  );
  if (raw) return raw;
  const scopedClassNames = arrangement && (
    arrangement.audienceClassNames ||
    classScope.classNames ||
    classScope.audienceClasses ||
    classScope.segments
  );
  if (Array.isArray(scopedClassNames) && scopedClassNames.length) {
    return scopedClassNames
      .map((item) => item && typeof item === "object" ? (item.className || item.raw || item.name || "") : item)
      .filter(Boolean)
      .join("、");
  }
  const classNames = arrangement && (arrangement.classNames || arrangement.audienceClasses);
  return Array.isArray(classNames) ? classNames.filter(Boolean).join("、") : String(classNames || "");
}

function effectiveStudentBucketKey(sourceBucketKey, arrangement) {
  if (needsTimeCompletion(arrangement)) return "unplaced";
  const decision = String(arrangement && arrangement.importDecision || "");
  if (decision === "auto_include") return "recommended";
  if (decision === "suspected_not_mine") return "suspected";
  if (decision === "unscheduled") return "pending";
  return STUDENT_BUCKET_KEYS.indexOf(sourceBucketKey) >= 0 && sourceBucketKey !== "unplaced"
    ? sourceBucketKey
    : "pending";
}

function createEmptyStudentBuckets() {
  return STUDENT_BUCKET_KEYS.reduce((result, bucketKey) => {
    result[bucketKey] = [];
    return result;
  }, {});
}

function createEmptyStudentExpandedGroups() {
  return STUDENT_BUCKET_KEYS.reduce((result, bucketKey) => {
    result[bucketKey] = {};
    return result;
  }, {});
}

function normalizeStudentExpandedGroups(value = {}) {
  const result = createEmptyStudentExpandedGroups();
  STUDENT_BUCKET_KEYS.forEach((bucketKey) => {
    if (value[bucketKey] && typeof value[bucketKey] === "object") {
      result[bucketKey] = Object.assign({}, value[bucketKey]);
    }
  });
  return result;
}

function createStudentBucketAccumulator() {
  return STUDENT_BUCKET_KEYS.reduce((result, bucketKey) => {
    result[bucketKey] = new Map();
    return result;
  }, {});
}

function pushStudentArrangementGroup(accumulator, bucketKey, sourceGroup, arrangement) {
  if (!arrangement) return;
  const normalizedName = normalizePreviewCourseName(resolveArrangementCourseName(arrangement));
  const groupKey = normalizedName || String(sourceGroup && sourceGroup.displayCourseName || sourceGroup && sourceGroup.courseName || "course");
  const courseGroupId = buildStudentCourseGroupId(bucketKey, sourceGroup, arrangement);
  const map = accumulator[bucketKey];
  if (!map.has(groupKey)) {
    map.set(groupKey, {
      courseGroupId,
      normalizedCourseName: arrangement.normalizedCourseName || normalizedName,
      displayCourseName: sourceGroup && sourceGroup.displayCourseName || arrangement.displayCourseName || arrangement.courseName || "",
      courseName: sourceGroup && sourceGroup.courseName || arrangement.courseName || arrangement.displayCourseName || "",
      category: sourceGroup && sourceGroup.category || arrangement.category || "",
      confidence: sourceGroup && sourceGroup.confidence || arrangement.confidence || "",
      importDecision: arrangement.importDecision || sourceGroup && sourceGroup.importDecision || "",
      reason: sourceGroup && sourceGroup.reason || arrangement.groupReason || arrangement.reason || "",
      arrangements: [],
    });
  }
  const target = map.get(groupKey);
  const arrangementCourseGroupId = isArrangementScopedGroupId(arrangement.courseGroupId, arrangement)
    ? courseGroupId
    : (arrangement.courseGroupId || courseGroupId);
  target.arrangements.push(Object.assign({}, arrangement, {
    bucketKey,
    courseGroupId: arrangementCourseGroupId,
    classNameRaw: resolveClassNameText(arrangement),
  }));
}

function sortStudentArrangements(arrangements) {
  return (arrangements || []).slice().sort((left, right) => {
    if ((left.weekday || 99) !== (right.weekday || 99)) return (left.weekday || 99) - (right.weekday || 99);
    if ((left.startSection || 99) !== (right.startSection || 99)) return (left.startSection || 99) - (right.startSection || 99);
    return String(left.weekText || "").localeCompare(String(right.weekText || ""));
  });
}

function finalizeStudentBucketGroups(accumulator, bucketKey, expandedBucket = {}) {
  return Array.from((accumulator[bucketKey] || new Map()).values()).map((group) => {
    const arrangements = sortStudentArrangements(group.arrangements);
    const selectedCount = arrangements.filter((item) => item.selected).length;
    const viewKey = group.courseGroupId;
    return Object.assign({}, group, {
      bucketKey,
      viewKey,
      arrangements,
      arrangementCount: arrangements.length,
      selectedCount,
      countText: `${selectedCount}/${arrangements.length} 已选`,
      expanded: Boolean(expandedBucket && expandedBucket[viewKey]),
    });
  }).sort((left, right) => String(left.displayCourseName || left.courseName || "")
    .localeCompare(String(right.displayCourseName || right.courseName || ""), "zh-Hans-CN"));
}

function isSamePreviewCourse(left, right) {
  if (!left || !right) return false;
  if (left.courseGroupId && right.courseGroupId && left.courseGroupId === right.courseGroupId) return true;
  const leftName = normalizePreviewCourseName(left.normalizedCourseName || left.displayCourseName || left.courseName);
  const rightName = normalizePreviewCourseName(right.normalizedCourseName || right.displayCourseName || right.courseName);
  return Boolean(leftName && rightName && leftName === rightName);
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
      if (!rangesOverlap(left.weeks, right.weeks)) continue;
      if (isSamePreviewCourse(left, right)) continue;
      left.conflict = true;
      right.conflict = true;
    }
  }
}

function studentPreviewLayerPriority(cell) {
  let priority = 0;
  if (cell && cell.activeInPreviewWeek !== false) priority += 4;
  if (cell && cell.selected !== false) priority += 2;
  if (cell && cell.importDecision === "auto_include") priority += 1;
  if (cell && cell.importDecision === "needs_confirm") priority += 1;
  if (cell && cell.conflict) priority += 1;
  return priority;
}

function sortStudentPreviewGridCells(cells) {
  return (cells || []).slice().sort((left, right) => {
    const leftPriority = Number(left.previewLayerPriority || 0);
    const rightPriority = Number(right.previewLayerPriority || 0);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    if ((left.weekday || 99) !== (right.weekday || 99)) return (left.weekday || 99) - (right.weekday || 99);
    if ((left.startSection || 99) !== (right.startSection || 99)) return (left.startSection || 99) - (right.startSection || 99);
    if ((left.endSection || 99) !== (right.endSection || 99)) return (left.endSection || 99) - (right.endSection || 99);
    return String(left.id || left.courseName || "").localeCompare(String(right.id || right.courseName || ""));
  });
}

function buildStudentPreviewGrid(arrangements, week, selectedMap, editedMap) {
  const targetWeek = clampPreviewWeek(week);
  const prepared = (arrangements || [])
    .map((arrangement) => applyEditedArrangement(arrangement, editedMap))
    .filter((arrangement) => arrangement && !needsTimeCompletion(arrangement));
  const hasWeekendCourses = prepared.some((arrangement) => Number(arrangement.weekday) === 6 || Number(arrangement.weekday) === 7);
  const cells = prepared
    .filter((arrangement) => arrangement && !needsTimeCompletion(arrangement) && arrangementActiveInWeek(arrangement, targetWeek))
    .filter((arrangement) => Number(arrangement.weekday) >= 1 && Number(arrangement.weekday) <= 5)
    .map((arrangement) => {
      const selected = selectedMap && Object.prototype.hasOwnProperty.call(selectedMap, arrangement.arrangementId)
        ? Boolean(selectedMap[arrangement.arrangementId])
        : Boolean(arrangement.selectedByDefault);
      const displayWeekText = formatStudentWeekDisplay(arrangement.weeks, arrangement.weekText);
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
        weeks: arrangement.weeks,
        sectionText: arrangement.sectionText || formatStudentSectionText(arrangement.sections),
        weekText: displayWeekText,
        displayWeekText,
        roomName: arrangement.roomName || "",
        teacherName: arrangement.teacherName || "",
        classNameRaw: arrangement.classNameRaw || "",
        classScopeStatus: arrangement.classScopeStatus || "",
        classScopeReason: arrangement.classScopeReason || humanizeClassScopeReason(arrangement),
        matchStatus: arrangement.matchStatus || "",
        importDecision: arrangement.importDecision,
        reason: arrangement.reason || "",
        selected,
        activeInPreviewWeek: true,
        conflict: false,
      };
    });

  markStudentPreviewConflicts(cells);
  cells.forEach((cell) => {
    cell.previewLayerPriority = studentPreviewLayerPriority(cell);
    cell.zIndex = 1 + cell.previewLayerPriority;
  });
  return {
    week: targetWeek,
    hasWeekendCourses,
    days: STUDENT_WEEKDAY_LABELS.slice(0, 5).map((label, index) => ({ weekday: index + 1, label })),
    sections: Array.from({ length: 14 }, (_, index) => ({ section: index + 1, label: `${index + 1}` })),
    cells: sortStudentPreviewGridCells(cells),
  };
}

function decorateStudentArrangement(arrangement, selectedMap, editedMap, expandedClassNames = {}) {
  const merged = applyEditedArrangement(arrangement, editedMap);
  const id = merged.arrangementId;
  const selected = selectedMap && Object.prototype.hasOwnProperty.call(selectedMap, id)
    ? Boolean(selectedMap[id])
    : Boolean(merged.selectedByDefault);
  const status = STUDENT_DECISION_STATUS[merged.importDecision] || { text: "待确认", className: "status-confirm" };
  const weekdayText = merged.weekday ? STUDENT_WEEKDAY_LABELS[merged.weekday - 1] : "";
  const sectionText = merged.sectionText || formatStudentSectionText(merged.sections);
  const displayWeekText = formatStudentWeekDisplay(merged.weeks, merged.weekText);
  const classNameInfo = compactStudentClassNameRaw(resolveClassNameText(merged));
  const classNameExpanded = Boolean(expandedClassNames && expandedClassNames[id]);
  const needsCompletion = needsTimeCompletion(merged);
  return Object.assign({}, merged, {
    selected,
    edited: Boolean(editedMap && editedMap[id]),
    statusText: selected ? status.text : "未选择",
    statusClass: selected ? status.className : "status-muted",
    timeText: weekdayText && sectionText ? `${weekdayText} · ${sectionText}` : "时间待确认",
    displayWeekText,
    roomText: merged.roomName || "未注明",
    teacherText: merged.teacherName || "未注明",
    metaText: buildStudentArrangementMetaText(merged),
    classNameFullText: classNameInfo.fullText,
    classNamePreviewText: classNameExpanded ? classNameInfo.fullText : classNameInfo.previewText,
    classNameExpanded,
    classNameTruncated: classNameInfo.truncated,
    classScopeReasonText: merged.classScopeReason || humanizeClassScopeReason(merged),
    classScopeClass: classScopeReasonClass(merged),
    conflictText: merged.conflict ? "存在时间重叠，建议检查" : "",
    reasonText: merged.reason || merged.groupReason || "请确认后再导入",
    needsTimeCompletion: needsCompletion,
    canEdit: needsCompletion,
  });
}

function decorateStudentGroups(groups, selectedMap, editedMap, expandedGroups = {}, expandedClassNames = {}) {
  const buckets = normalizeStudentPreviewBuckets(groups);
  const accumulator = createStudentBucketAccumulator();
  STUDENT_BUCKET_KEYS.forEach((sourceBucketKey) => {
    (buckets[sourceBucketKey] || []).forEach((group) => {
      const rawArrangements = Array.isArray(group && group.arrangements)
        ? group.arrangements
        : (group && group.arrangementId ? [group] : []);
      rawArrangements.forEach((arrangement) => {
        const decorated = decorateStudentArrangement(Object.assign({}, arrangement, {
          sourceBucketKey,
          bucketKey: sourceBucketKey,
          groupTitle: group && (group.displayCourseName || group.courseName) || arrangement.displayCourseName || arrangement.courseName || "",
          groupReason: group && group.reason || "",
        }), selectedMap, editedMap, expandedClassNames);
        const bucketKey = effectiveStudentBucketKey(sourceBucketKey, decorated);
        pushStudentArrangementGroup(accumulator, bucketKey, group, decorated);
      });
    });
  });
  return STUDENT_BUCKET_KEYS.map((bucketKey) => {
    const groupList = finalizeStudentBucketGroups(accumulator, bucketKey, expandedGroups[bucketKey] || {});
    const arrangementCount = groupList.reduce((sum, group) => sum + group.arrangementCount, 0);
    const selectedCount = groupList.reduce((sum, group) => sum + group.selectedCount, 0);
    return {
      key: bucketKey,
      title: STUDENT_GROUP_TITLES[bucketKey],
      help: STUDENT_BUCKET_HELP[bucketKey],
      groups: groupList,
      arrangementCount,
      selectedCount,
      summaryText: `${selectedCount}/${arrangementCount} 已选`,
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
  const studentId = profile.studentId || "";
  return {
    studentId,
    studentIdMasked: profile.studentIdMasked || maskStudentId(studentId),
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

function resolveDisplayStudentId(metadata = {}, profile = {}) {
  return metadata.studentId || profile.studentId || metadata.studentIdMasked || profile.studentIdMasked || "";
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
    code === "INVALID_ENCRYPTED_PAYLOAD";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildStudentImportErrorFromStatus(status) {
  const error = new Error(status && status.message || status && status.code || "UNKNOWN_IMPORT_ERROR");
  error.code = status && status.code || "UNKNOWN_IMPORT_ERROR";
  error.reasonCode = error.code;
  error.retriable = Boolean(status && status.retriable);
  error.payload = status || {};
  return error;
}

async function buildEncryptedStudentPreviewPayload(form, password, extra = {}) {
  const keyResult = await request.get("/api/schedule-import/fosu/public-key", {}, {
    showLoading: false,
    silentError: true,
    timeout: 60000,
    retries: 1,
  });
  const encrypted = await encryptCredentialPayload(keyResult, {
    studentId: form.studentId,
    password,
    nonce: keyResult.nonce,
    timestamp: Date.now(),
  });
  const basePayload = {
    keyId: keyResult.keyId,
    semester: extra.semester || "",
    selectedClassName: extra.selectedClassName || "",
  };
  if (extra.forceRefresh === true) {
    basePayload.forceRefresh = true;
  }
  return Object.assign(basePayload, encrypted);
}

function requestStudentSchedulePreviewLegacy(payload) {
  return request.post("/api/schedule-import/fosu/preview", payload, {
    showLoading: false,
    silentError: true,
    timeout: 60000,
    retries: 0,
    dedupe: false,
  });
}

async function requestStudentSchedulePreviewStatus(jobId, onStatus) {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < 60000) {
    attempt += 1;
    const status = await request.get("/api/schedule-import/fosu/preview/status", { jobId }, {
      showLoading: false,
      silentError: true,
      timeout: 60000,
      retries: 0,
      dedupe: false,
      suppressWarn: true,
    });
    if (typeof onStatus === "function") {
      onStatus(status);
    }
    if (status && status.status === "success") {
      return status.result || status;
    }
    if (status && status.status === "failed") {
      throw buildStudentImportErrorFromStatus(status);
    }
    const elapsed = Date.now() - startedAt;
    const delay = elapsed < 10000 ? 1200 : (2600 + (attempt % 2) * 200);
    await sleep(delay);
  }
  throw buildStudentImportErrorFromStatus({
    code: "SCHOOL_SYSTEM_TIMEOUT",
    message: "学校系统响应较慢，请稍后再试。",
    retriable: true,
  });
}

async function requestStudentSchedulePreview(form, password, extra = {}, onStatus) {
  const payload = await buildEncryptedStudentPreviewPayload(form, password, extra);
  try {
    const started = await request.post("/api/schedule-import/fosu/preview/start", payload, {
      showLoading: false,
      silentError: true,
      timeout: 60000,
      retries: 0,
      dedupe: false,
    });
    if (typeof onStatus === "function") {
      onStatus(started);
    }
    if (started && started.jobId) {
      return requestStudentSchedulePreviewStatus(started.jobId, onStatus);
    }
    return started;
  } catch (error) {
    const code = getStudentImportErrorCode(error);
    if (code === "HTTP_4XX" || code === "HTTP_5XX" || code === "INVALID_PAYLOAD" || code === "NETWORK") {
      return requestStudentSchedulePreviewLegacy(payload);
    }
    throw error;
  }
}

function logStudentImportDiagnostics(preview) {
  if (!platform.isDeveloperEnv()) return;
  const diagnostics = preview && (preview.importDiagnostics || preview.timing) || {};
  console.info("[Fosu student import]", {
    channel: diagnostics.channel || preview && preview.channel || "",
    retryCount: Number(diagnostics.retryCount || 0) || 0,
    loginMs: Number(diagnostics.loginMs || 0) || 0,
    discoverMs: Number(diagnostics.discoverMs || 0) || 0,
    fetchRowsMs: Number(diagnostics.fetchRowsMs || 0) || 0,
    relayMs: Number(diagnostics.relayMs || 0) || 0,
    rowsCount: Number(diagnostics.rowsCount || diagnostics.rawRowCount || 0) || 0,
    bytesApprox: Number(diagnostics.bytesApprox || 0) || 0,
    fallbackReason: diagnostics.fallbackReason || "",
    hitCache: Boolean(diagnostics.hitCache || preview && preview.hitCache),
    normalizeMs: Number(diagnostics.normalizeMs || 0) || 0,
    totalMs: Number(diagnostics.totalMs || 0) || 0,
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
    studentImportStatusMessage: "",
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
    studentCachedPreviewMode: false,
    studentPreviewWeek: 16,
    studentPreviewGrid: null,
    studentPreviewBuckets: [],
    studentAdvancedMode: false,
    studentAdvancedTabs: [],
    studentActiveBucket: "recommended",
    studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
    studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
    studentActiveBucketGroups: [],
    studentExpandedGroups: createEmptyStudentExpandedGroups(),
    studentExpandedClassNames: {},
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
    studentClassConfidenceWarning: "",
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
    recentStudentImport: null,
    recentStudentImportChecking: false,
    studentCachedPreviewMode: false,
  },

  onLoad(options = {}) {
    const settings = getSettings();
    const currentSemesterId = settings.semesterId || settings.semester || getRuntimeTermConfig().term;
    const requestedTab = String(options.tab || "").trim();
    const requestedMethod = requestedTab === "student"
      ? "student"
      : (requestedTab === "xls" ? "xls" : "method");
    this.setData({ activeImportMethod: requestedMethod });
    this.loadRecentStudentImport();
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
      studentCachedPreviewMode: false,
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: createEmptyStudentExpandedGroups(),
      studentExpandedClassNames: {},
      studentSelectionMode: false,
      studentEditingArrangement: null,
      studentClassConfidenceWarning: "",
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
      studentCachedPreviewMode: false,
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: createEmptyStudentExpandedGroups(),
      studentExpandedClassNames: {},
      studentSelectionMode: false,
      studentEditingArrangement: null,
      studentClassConfidenceWarning: "",
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

  loadRecentStudentImport() {
    const cached = recentStudentImportService.readLocalRecentImport();
    if (cached) {
      this.setData({ recentStudentImport: cached });
    }
    this.setData({ recentStudentImportChecking: true });
    request.get("/api/schedule-import/fosu/recent", {}, {
      showLoading: false,
      silentError: true,
      timeout: 8000,
      retries: 0,
      dedupe: false,
      suppressWarn: true,
    })
      .then((res) => {
        const recent = res && res.recentImport;
        if (recent) {
          const saved = recentStudentImportService.writeLocalRecentImport(recent);
          this.setData({
            recentStudentImport: saved || recentStudentImportService.normalizeRecentImport(recent),
            recentStudentImportChecking: false,
          });
          return;
        }
        this.setData({
          recentStudentImport: cached || null,
          recentStudentImportChecking: false,
        });
      })
      .catch(() => {
        this.setData({ recentStudentImportChecking: false });
      });
  },

  useRecentStudentImport() {
    const record = this.data.recentStudentImport || recentStudentImportService.readLocalRecentImport();
    const target = recentStudentImportService.buildScheduleTarget(record);
    if (!target || !Array.isArray(target.courses) || !target.courses.length) {
      wx.showToast({ title: "最近同步记录不可用，请重新同步", icon: "none" });
      return;
    }
    if (setCurrentScheduleTarget(target)) {
      aiAssistantService.rememberLatestScheduleImport(target);
      wx.showToast({ title: "已切换到个人课表", icon: "success" });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/index/index" });
      }, 500);
      return;
    }
    wx.showToast({ title: "本地缓存保存失败", icon: "none" });
  },

  openRecentStudentImportEditor() {
    const record = this.data.recentStudentImport || recentStudentImportService.readLocalRecentImport();
    const preview = recentStudentImportService.buildCachedPreview(record);
    if (!preview || !Array.isArray(preview.allArrangements) || !preview.allArrangements.length) {
      wx.showToast({ title: "历史记录暂不可编辑，请重新同步", icon: "none" });
      return;
    }
    const displayInfo = buildApaasScheduleDisplay(preview);
    const metadata = sanitizeApaasMetadata(preview);
    const previewResult = Object.assign({}, preview, {
      displayInfo,
      metadata,
      displayStudentId: resolveDisplayStudentId(metadata, preview.profile || {}),
      maskedStudentId: metadata.studentIdMasked,
    });
    this.studentPreviewArrangements = [];
    this.studentSelectedArrangementMap = {};
    this.studentEditedArrangementMap = {};
    this.setData({
      activeImportMethod: "student",
      studentImportStage: "preview",
      studentImportLoading: false,
      studentImportConfirming: false,
      studentPreviewToken: "",
      studentCachedPreviewMode: true,
      studentPreviewResult: previewResult,
      studentEditingArrangement: null,
      studentClassConfidenceWarning: "",
    });
    this.prepareStudentPreview(previewResult, {
      openAdvanced: true,
      useExplicitSelection: true,
      selectedArrangementIds: preview.selectedArrangementIds || preview.defaultSelectedArrangementIds || [],
      editedArrangements: preview.editedArrangements || [],
    });
  },

  resyncStudentImport() {
    this.studentPreviewArrangements = [];
    this.studentSelectedArrangementMap = {};
    this.studentEditedArrangementMap = {};
    this.setData({
      activeImportMethod: "student",
      studentImportStage: "form",
      studentPreviewResult: null,
      studentPreviewToken: "",
      studentCachedPreviewMode: false,
      studentPreviewGrid: null,
      studentAdvancedMode: false,
      studentSelectionMode: false,
      studentEditingArrangement: null,
      studentForm: Object.assign({}, this.data.studentForm, { password: "" }),
    });
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

  ensureStudentPrivacyAuthorized() {
    return privacy.ensurePrivacyAuthorized().then((allowed) => {
      if (!allowed) {
        wx.showToast({ title: "请先完成系统授权", icon: "none" });
        return false;
      }
      return true;
    }).catch(() => {
      wx.showToast({ title: "隐私授权状态异常，请稍后重试", icon: "none" });
      return false;
    });
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

  applyStudentImportJobStatus(status = {}) {
    const progress = Math.max(8, Math.min(98, Number(status.progress || 0) || 8));
    const stepIndex = Math.max(0, Math.min(
      STUDENT_IMPORT_STEPS.length - 1,
      Math.floor((progress / 100) * STUDENT_IMPORT_STEPS.length)
    ));
    this.setData({
      studentLoadingStepIndex: stepIndex,
      studentLoadingProgressStyle: `width: ${progress}%;`,
      studentImportStatusMessage: status.message || this.data.studentImportStatusMessage || "",
    });
    if (progress >= 40 && this.studentSlowTimer) {
      clearTimeout(this.studentSlowTimer);
      this.studentSlowTimer = null;
    }
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
      studentImportStatusMessage: "",
    });
  },

  getStudentPreviewRequestExtra() {
    const selectedRecord = this.data.termRecords[this.data.semesterIndex] || {};
    const settings = getSettings && getSettings() || {};
    const current = getCurrentScheduleTarget && getCurrentScheduleTarget() || {};
    return {
      semester: selectedRecord.term || this.data.semesterOptions[this.data.semesterIndex] || settings.semesterId || settings.semester || "",
      selectedClassName: settings.className || current.className || current.name || "",
      forceRefresh: true,
    };
  },

  resetStudentPreviewState() {
    this.studentPreviewArrangements = [];
    this.studentSelectedArrangementMap = {};
    this.studentEditedArrangementMap = {};
    this.setData({
      studentPreviewWeek: 16,
      studentCachedPreviewMode: false,
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: createEmptyStudentExpandedGroups(),
      studentExpandedClassNames: {},
      studentSelectionMode: false,
      studentSelectedCount: 0,
      studentRecommendedCount: 0,
      studentPendingCount: 0,
      studentConflictCount: 0,
      studentClassConfidenceWarning: "",
      studentEditingArrangement: null,
      editWeekdayIndex: 0,
      editStartIndex: 0,
      editEndIndex: 1,
      editWeekText: "",
      editRoomName: "",
    });
  },

  prepareStudentPreview(preview, options = {}) {
    const arrangements = flattenStudentPreviewArrangements(preview);
    const selectedIds = Array.isArray(options.selectedArrangementIds)
      ? options.selectedArrangementIds
      : (Array.isArray(preview && preview.selectedArrangementIds) ? preview.selectedArrangementIds : []);
    const selectedSet = new Set(selectedIds);
    const useExplicitSelection = Boolean(options.useExplicitSelection || selectedIds.length);
    const selectedMap = {};
    arrangements.forEach((arrangement) => {
      if (arrangement && arrangement.arrangementId) {
        selectedMap[arrangement.arrangementId] = useExplicitSelection
          ? selectedSet.has(arrangement.arrangementId)
          : Boolean(arrangement.selectedByDefault);
      }
    });
    const editedMap = {};
    const editedArrangements = Array.isArray(options.editedArrangements)
      ? options.editedArrangements
      : (Array.isArray(preview && preview.editedArrangements) ? preview.editedArrangements : []);
    editedArrangements.forEach((edited) => {
      const id = edited && (edited.baseArrangementId || edited.arrangementId);
      if (id) editedMap[id] = edited;
    });
    this.studentPreviewArrangements = arrangements;
    this.studentSelectedArrangementMap = selectedMap;
    this.studentEditedArrangementMap = editedMap;
    this.setData({
      studentAdvancedMode: Boolean(options.openAdvanced),
      studentSelectionMode: Boolean(options.openAdvanced),
      studentActiveBucket: "recommended",
      studentExpandedGroups: createEmptyStudentExpandedGroups(),
      studentExpandedClassNames: {},
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
    const expandedGroups = normalizeStudentExpandedGroups(this.data.studentExpandedGroups || {});
    const expandedClassNames = this.data.studentExpandedClassNames || {};
    const buckets = decorateStudentGroups(result, selectedMap, editedMap, expandedGroups, expandedClassNames);
    const activeBucket = STUDENT_BUCKET_KEYS.indexOf(this.data.studentActiveBucket) >= 0
      ? this.data.studentActiveBucket
      : "recommended";
    const activeBucketModel = buckets.find((bucket) => bucket.key === activeBucket) || buckets[0] || {};
    const summary = result.summary || {};
    const profile = result.profile || {};
    const uiHints = result.uiHints || {};
    const recommendedCount = summary.recommendedArrangementCount || summary.arrangementAutoIncludeCount || summary.scheduledCourseCount || 0;
    const pendingCount = (summary.pendingArrangementCount || summary.needsConfirmCount || 0) +
      (summary.unplacedArrangementCount || summary.unscheduledCount || 0);
    const conflictCount = summary.conflictCount || 0;
    const classConfidenceWarning = uiHints.classNameWarningText ||
      (profile.classNameConfidence === "low" ? "班级未能完全确认，已避免推荐明显非本班课程。" : "");
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
      studentClassConfidenceWarning: classConfidenceWarning,
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

  canSelectStudentArrangement(arrangement) {
    if (!arrangement || !arrangement.arrangementId) return false;
    const editedMap = this.studentEditedArrangementMap || {};
    const merged = applyEditedArrangement(arrangement, editedMap);
    return Boolean(!needsTimeCompletion(merged) || editedMap[arrangement.arrangementId]);
  },

  getActiveStudentBucketArrangementIds() {
    return (this.data.studentActiveBucketGroups || []).reduce((ids, group) => {
      (group.arrangements || []).forEach((arrangement) => {
        if (arrangement && arrangement.arrangementId) ids.push(arrangement.arrangementId);
      });
      return ids;
    }, []);
  },

  setStudentArrangementsSelected(arrangementIds, selected) {
    const ids = Array.from(new Set(arrangementIds || [])).filter(Boolean);
    if (!ids.length) {
      wx.showToast({ title: "当前分组没有课程", icon: "none" });
      return;
    }
    const nextMap = Object.assign({}, this.studentSelectedArrangementMap || {});
    let changedCount = 0;
    let skippedCount = 0;
    ids.forEach((arrangementId) => {
      const arrangement = this.findStudentArrangement(arrangementId);
      if (!arrangement) return;
      if (selected && !this.canSelectStudentArrangement(arrangement)) {
        skippedCount += 1;
        return;
      }
      nextMap[arrangementId] = Boolean(selected);
      changedCount += 1;
    });
    this.studentSelectedArrangementMap = nextMap;
    this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
    if (skippedCount) {
      wx.showToast({ title: `已跳过${skippedCount}项未排时间课程`, icon: "none" });
    } else if (changedCount) {
      wx.showToast({ title: selected ? "已全选本栏" : "已清空本栏", icon: "none" });
    }
  },

  selectAllStudentActiveBucket() {
    this.setStudentArrangementsSelected(this.getActiveStudentBucketArrangementIds(), true);
  },

  clearStudentActiveBucketSelection() {
    this.setStudentArrangementsSelected(this.getActiveStudentBucketArrangementIds(), false);
  },

  resetStudentRecommendedSelection() {
    const nextMap = {};
    (this.studentPreviewArrangements || []).forEach((arrangement) => {
      if (!arrangement || !arrangement.arrangementId) return;
      nextMap[arrangement.arrangementId] = Boolean(arrangement.selectedByDefault);
    });
    this.studentSelectedArrangementMap = nextMap;
    this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
    wx.showToast({ title: "已恢复推荐选择", icon: "none" });
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
    const bucketKey = event.currentTarget.dataset.bucket || this.data.studentActiveBucket || "recommended";
    if (STUDENT_BUCKET_KEYS.indexOf(bucketKey) < 0) return;
    const expanded = normalizeStudentExpandedGroups(this.data.studentExpandedGroups || {});
    const bucketMap = Object.assign({}, expanded[bucketKey] || {});
    bucketMap[key] = !bucketMap[key];
    expanded[bucketKey] = bucketMap;
    this.setData({ studentExpandedGroups: expanded }, () => {
      this.refreshStudentPreviewState(this.data.studentPreviewResult, this.data.studentPreviewWeek);
    });
  },

  toggleStudentClassNameRaw(event) {
    const arrangementId = event.currentTarget.dataset.id;
    if (!arrangementId) return;
    const expanded = Object.assign({}, this.data.studentExpandedClassNames || {});
    expanded[arrangementId] = !expanded[arrangementId];
    this.setData({ studentExpandedClassNames: expanded }, () => {
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
    if (selected && needsTimeCompletion(merged) && !edited) {
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
        `${weekdayText} · ${sectionText}`,
        formatStudentWeekDisplay(course.weeks, course.weekText),
        `地点：${course.roomName || "未注明"}`,
        course.teacherName ? `教师：${course.teacherName}` : "",
        course.classNameRaw ? `上课班级：${compactStudentClassNameRaw(course.classNameRaw).fullText}` : "",
        course.classScopeReason ? `判断：${course.classScopeReason}` : "",
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
      wx.showToast({ title: "请先确认本人授权", icon: "none" });
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
      studentCachedPreviewMode: false,
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentLoadingStepIndex: 0,
      studentLoadingProgressStyle: "width: 14%;",
      studentImportSlow: false,
      studentImportStatusMessage: "",
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: createEmptyStudentExpandedGroups(),
      studentExpandedClassNames: {},
      studentSelectionMode: false,
      studentEditingArrangement: null,
      studentClassConfidenceWarning: "",
    });
    this.startStudentLoadingSteps();

    let plainPassword = form.password;
    try {
      let preview;
      try {
        preview = await requestStudentSchedulePreview(form, plainPassword, previewExtra, (status) => {
          this.applyStudentImportJobStatus(status);
        });
      } catch (error) {
        if (!shouldRetryStudentPreview(error)) {
          throw error;
        }
        preview = await requestStudentSchedulePreview(form, plainPassword, previewExtra, (status) => {
          this.applyStudentImportJobStatus(status);
        });
      }
      plainPassword = "";
      this.setData({ "studentForm.password": "" });
      logStudentImportDiagnostics(preview);

      const displayInfo = buildApaasScheduleDisplay(preview);
      const metadata = sanitizeApaasMetadata(preview);
      const recent = preview && preview.recentImport
        ? recentStudentImportService.writeLocalRecentImport(preview.recentImport)
        : null;
      const previewPatch = {
        studentImportLoading: false,
        studentImportStage: "preview",
        studentPreviewToken: preview.importPreviewToken || "",
        studentPreviewResult: Object.assign({}, preview, {
          displayInfo,
          metadata,
          displayStudentId: resolveDisplayStudentId(metadata, preview.profile || {}),
          maskedStudentId: metadata.studentIdMasked,
        }),
      };
      if (recent) {
        previewPatch.recentStudentImport = recent;
      }
      this.stopStudentLoadingSteps();
      this.setData(previewPatch);
      this.prepareStudentPreview(this.data.studentPreviewResult);
      wx.showToast({ title: "读取成功", icon: "success" });
    } catch (error) {
      plainPassword = "";
      this.stopStudentLoadingSteps();
      this.setData({
        studentImportLoading: false,
        studentImportStage: "form",
        "studentForm.password": "",
        studentImportStatusMessage: "",
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

  async chooseXlsFile() {
    const privacyAllowed = await this.ensureStudentPrivacyAuthorized();
    if (!privacyAllowed) return;
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
      studentCachedPreviewMode: false,
      studentPreviewGrid: null,
      studentPreviewBuckets: [],
      studentAdvancedMode: false,
      studentAdvancedTabs: [],
      studentActiveBucket: "recommended",
      studentActiveBucketTitle: STUDENT_GROUP_TITLES.recommended,
      studentActiveBucketHelp: STUDENT_BUCKET_HELP.recommended,
      studentActiveBucketGroups: [],
      studentExpandedGroups: createEmptyStudentExpandedGroups(),
      studentExpandedClassNames: {},
      studentSelectionMode: false,
      studentEditingArrangement: null,
      studentImportedSchedule: null,
      studentClassConfidenceWarning: "",
      studentForm: Object.assign({}, this.data.studentForm, { password: "" }),
    });
  },

  confirmRecentStudentImport() {
    if (this.data.studentImportConfirming || !this.data.studentSelectedCount) return;
    this.setData({ studentImportConfirming: true });
    request.post("/api/schedule-import/fosu/recent/confirm", {
      mode: "replace_fosu_source",
      selectedArrangementIds: this.getSelectedStudentArrangementIds(),
      editedArrangements: this.getEditedStudentArrangements(),
      existingCourses: getExistingPersonalCoursesForStudentImport(),
    }, {
      loadingTitle: "正在应用缓存...",
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
          updateTime: schedule.updateTime || recentStudentImportService.formatImportTime(new Date().toISOString()),
          importedAt: schedule.importedAt || new Date().toISOString(),
        });
        if (setCurrentScheduleTarget(target)) {
          if (res && res.recentImport) {
            const recent = recentStudentImportService.writeLocalRecentImport(res.recentImport);
            if (recent) {
              this.setData({ recentStudentImport: recent });
            }
          }
          aiAssistantService.rememberLatestScheduleImport(target);
          this.setData({
            studentImportConfirming: false,
            studentImportStage: "done",
            studentImportedSchedule: target,
            studentPreviewToken: "",
            studentCachedPreviewMode: false,
            studentAdvancedMode: false,
            studentSelectionMode: false,
            studentEditingArrangement: null,
          });
          wx.showToast({ title: "已用缓存更新课表", icon: "success" });
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

  confirmStudentImport() {
    if (this.data.studentCachedPreviewMode) {
      this.confirmRecentStudentImport();
      return;
    }
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
          updateTime: schedule.updateTime || recentStudentImportService.formatImportTime(new Date().toISOString()),
          importedAt: schedule.importedAt || new Date().toISOString(),
        });
        if (setCurrentScheduleTarget(target)) {
          if (res && res.recentImport) {
            const recent = recentStudentImportService.writeLocalRecentImport(res.recentImport);
            if (recent) {
              this.setData({ recentStudentImport: recent });
            }
          }
          aiAssistantService.rememberLatestScheduleImport(target);
          this.setData({
            studentImportConfirming: false,
            studentImportStage: "done",
            studentImportedSchedule: target,
            studentPreviewToken: "",
            studentCachedPreviewMode: false,
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
      content = "学校系统响应较慢，请稍后再试。";
    } else if (code === "NETWORK_TIMEOUT" || code === "UPSTREAM_TIMEOUT") {
      content = "连接超时，可立即重试一次。";
    } else if (code === "CLOUDBASE_SERVICE_UNAVAILABLE" || code === "CLOUDBASE_IMPORT_FAILED") {
      content = "当前读取通道暂时不可用，请稍后重试。";
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

const RESOURCE_DIMENSIONS = ["teacher", "classroom", "course"];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getResources(snapshot) {
  const source = snapshot && snapshot.resources && typeof snapshot.resources === "object"
    ? snapshot.resources
    : {};
  const top = snapshot && typeof snapshot === "object" ? snapshot : {};
  const directoryArray = (key) => {
    if (Array.isArray(source[key])) return source[key];
    if (Array.isArray(top[key])) return top[key];
    return null;
  };
  const scheduleArray = (key) => {
    if (Array.isArray(source[key])) return source[key];
    if (Array.isArray(top[key])) return top[key];
    return [];
  };
  return {
    teachers: directoryArray("teachers"),
    classrooms: directoryArray("classrooms"),
    courses: directoryArray("courses"),
    teacherSchedules: scheduleArray("teacherSchedules"),
    classroomSchedules: scheduleArray("classroomSchedules"),
    courseSchedules: scheduleArray("courseSchedules"),
  };
}

function firstText(item, keys) {
  for (const key of keys) {
    const value = String(item && item[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function countUnique(items, keys) {
  const values = new Set();
  asArray(items).forEach((item) => {
    const text = firstText(item, keys);
    if (text) values.add(text);
  });
  return values.size;
}

function countCourseEvents(items) {
  return asArray(items).reduce((sum, item) => {
    if (Array.isArray(item && item.courses)) return sum + item.courses.length;
    const count = Number(item && item.courseCount || 0);
    return sum + (Number.isFinite(count) && count > 0 ? count : 0);
  }, 0);
}

function countDirectory(items, keys) {
  if (!Array.isArray(items)) {
    return { value: null, status: "not-counted" };
  }
  return { value: countUnique(items, keys), status: "counted" };
}

function scheduleSourceMode(snapshot, scopeName, fallback) {
  const sources = snapshot && (snapshot.scopeSources || snapshot.meta && snapshot.meta.scopeSources) || {};
  const source = sources && sources[scopeName] || {};
  return source.sourceMode || fallback || "unknown";
}

function normalizeScopeFilters(snapshot, options = {}) {
  return Object.assign(
    {},
    snapshot && snapshot.scopeFilters || {},
    snapshot && snapshot.meta && snapshot.meta.scopeFilters || {},
    options.scopeFilters || {}
  );
}

function normalizeScopeSources(snapshot) {
  return Object.assign(
    {},
    snapshot && snapshot.scopeSources || {},
    snapshot && snapshot.meta && snapshot.meta.scopeSources || {}
  );
}

function isInvalidTeacherName(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  const rules = [
    /\u4e34\u73ed/,
    /\u4e13\u4e1a\u8bfe\u8868/,
    /\d{2,}.*\u73ed/,
    /\u73ed$/,
    /\u5927\u5b66/,
    /\u4f53\u80b2/,
    /\u5b9e\u9a8c/,
    /\u5b9e\u8df5/,
    /\u8bfe\u7a0b/,
    /\u6982\u8bba/,
    /\u7406\u8bba/,
    /\u57fa\u7840/,
    /\u8bbe\u8ba1/,
    /\u6784\u6210/,
    /\u62a4\u7406\u5b66/,
    /\u513f\u79d1\u5b66/,
    /\u5149\u5b66/,
    /\u79cd\u690d\u5b66/,
    /\u6210\u578b/,
    /\u6559\u5ba4/,
    /\u5ba4$/,
    /\u697c$/,
  ];
  return rules.some((rule) => rule.test(text));
}

function buildTeacherQualityDiagnostics(snapshot, teacherSchedules, scopeSources) {
  const names = asArray(teacherSchedules).map((item) => firstText(item, ["teacherName", "name", "displayName", "title"]));
  const invalidNames = names.filter(isInvalidTeacherName);
  const teacherScope = scopeSources.teacherSchedules || {};
  const diagnostics = [];
  const targetDiscoveryMode = teacherScope.targetDiscoveryMode || teacherScope.source || "";
  const usedCollegeTargets = targetDiscoveryMode === "college-select" || (
    Number(teacherScope.requested || 0) > 0 &&
    Number(teacherScope.requested || 0) <= 30 &&
    !Number.isFinite(Number(teacherScope.discoveredTeacherTargets))
  );

  if (usedCollegeTargets || invalidNames.length > 0 || teacherScope.coverageStatus === "invalid") {
    diagnostics.push({
      code: "ENTITY_NAME_CONTAMINATED",
      severity: "error",
      resource: "teacher",
      message: "教师名称疑似被班级名或课程名污染，当前直抓结果不可发布。",
      targetDiscoveryMode: targetDiscoveryMode || (usedCollegeTargets ? "college-select" : "unknown"),
      discoveredTeacherTargets: teacherScope.discoveredTeacherTargets == null ? null : teacherScope.discoveredTeacherTargets,
      requestGroupCount: Number(teacherScope.requestGroupCount || teacherScope.requested || 0) || 0,
      scheduleDocumentCount: asArray(teacherSchedules).length,
      invalidTeacherNameCount: invalidNames.length,
      invalidTeacherNameSamples: invalidNames.slice(0, 12),
      coverageStatus: "invalid",
      publishable: false,
    });
  }
  return diagnostics;
}

function buildClassCounts(snapshot) {
  const classSchedules = asArray(snapshot && (snapshot.classSchedules || snapshot.resources && snapshot.resources.classSchedules));
  const administrativeClasses = classSchedules.filter((item) => item.displayType === "class-schedule" && !item.isAggregated).length;
  const aggregateSchedules = classSchedules.filter((item) => item.displayType === "major-aggregate" || item.isAggregated).length;
  return {
    scheduleDocuments: classSchedules.length,
    administrativeClasses,
    aggregateSchedules: aggregateSchedules || Math.max(0, classSchedules.length - administrativeClasses),
    courseEvents: countCourseEvents(classSchedules),
  };
}

function buildResourceCounts(snapshot, options = {}) {
  const resources = getResources(snapshot);
  const teacherDirectory = countDirectory(
    Array.isArray(resources.teachers) ? resources.teachers : null,
    ["teacherName", "name", "displayName", "id"]
  );
  const classroomDirectory = countDirectory(
    Array.isArray(resources.classrooms) ? resources.classrooms : null,
    ["classroomName", "roomName", "name", "id"]
  );
  const courseDirectory = countDirectory(
    Array.isArray(resources.courses) ? resources.courses : null,
    ["courseName", "name", "title", "id"]
  );

  return {
    teacher: {
      directoryEntities: teacherDirectory.value,
      directoryEntitiesStatus: teacherDirectory.status,
      scheduleDocuments: resources.teacherSchedules.length,
      courseEvents: countCourseEvents(resources.teacherSchedules),
      sourceMode: scheduleSourceMode(snapshot, "teacherSchedules", options.teacherSourceMode),
    },
    classroom: {
      directoryEntities: classroomDirectory.value,
      directoryEntitiesStatus: classroomDirectory.status,
      scheduleDocuments: resources.classroomSchedules.length,
      courseEvents: countCourseEvents(resources.classroomSchedules),
      sourceMode: scheduleSourceMode(snapshot, "classroomSchedules", options.classroomSourceMode),
    },
    course: {
      directoryEntities: courseDirectory.value,
      directoryEntitiesStatus: courseDirectory.status,
      scheduleDocuments: resources.courseSchedules.length,
      courseEvents: countCourseEvents(resources.courseSchedules),
      sourceMode: scheduleSourceMode(snapshot, "courseSchedules", options.courseSourceMode),
    },
  };
}

function buildCatalogCounts(snapshot) {
  const catalog = snapshot && snapshot.catalog || {};
  return {
    colleges: asArray(catalog.colleges || snapshot && snapshot.colleges).length,
    grades: asArray(catalog.grades || snapshot && snapshot.grades).length,
    majors: asArray(catalog.majors || snapshot && snapshot.majors).length,
  };
}

function buildResourceCountContract(snapshot, options = {}) {
  const sourceSnapshot = snapshot || {};
  const scopeSources = normalizeScopeSources(sourceSnapshot);
  const resourceCounts = buildResourceCounts(sourceSnapshot, options);
  const diagnostics = []
    .concat(asArray(sourceSnapshot.diagnostics))
    .concat(asArray(sourceSnapshot.meta && sourceSnapshot.meta.diagnostics))
    .concat(buildTeacherQualityDiagnostics(sourceSnapshot, getResources(sourceSnapshot).teacherSchedules, scopeSources));
  const coverage = Object.assign(
    {},
    sourceSnapshot.coverage || {},
    sourceSnapshot.meta && sourceSnapshot.meta.coverage || {}
  );
  if (diagnostics.some((item) => item.resource === "teacher" && item.coverageStatus === "invalid")) {
    coverage.teacher = Object.assign({}, coverage.teacher || {}, {
      coverageStatus: "invalid",
      publishable: false,
    });
  }

  return {
    countSchemaVersion: 2,
    term: sourceSnapshot.term || sourceSnapshot.semester || sourceSnapshot.termConfig && sourceSnapshot.termConfig.term || options.term || "",
    class: buildClassCounts(sourceSnapshot),
    teacher: resourceCounts.teacher,
    classroom: resourceCounts.classroom,
    course: resourceCounts.course,
    catalog: buildCatalogCounts(sourceSnapshot),
    scopeFilters: normalizeScopeFilters(sourceSnapshot, options),
    scopeSources,
    coverage,
    diagnostics,
    derivedFromLegacy: Boolean(options.derivedFromLegacy || sourceSnapshot.derivedFromLegacy),
  };
}

function deriveLegacyResourceCountContract(snapshot, manifest = {}) {
  const counts = Object.assign({}, snapshot && snapshot.coverage || {}, manifest && manifest.counts || {});
  const base = buildResourceCountContract(snapshot || {}, {
    derivedFromLegacy: true,
    teacherSourceMode: "legacy-derived",
    classroomSourceMode: "legacy-derived",
    courseSourceMode: "legacy-derived",
  });
  const indexCounts = manifest && manifest.pack && manifest.pack.index || {};
  const teacherCount = Number(counts.teacherScheduleCount || indexCounts.teacher || 0) || base.teacher.scheduleDocuments;
  const classroomCount = Number(counts.classroomScheduleCount || indexCounts.classroom || 0) || base.classroom.scheduleDocuments;
  const courseCount = Number(counts.courseScheduleCount || indexCounts.course || 0) || base.course.scheduleDocuments;
  return Object.assign({}, base, {
    class: Object.assign({}, base.class, {
      scheduleDocuments: Number(counts.classScheduleCount || 0) || base.class.scheduleDocuments,
      administrativeClasses: Number(counts.adminClassCount || 0) || base.class.administrativeClasses,
      aggregateSchedules: Number(counts.majorAggregateCount || 0) || base.class.aggregateSchedules,
    }),
    teacher: Object.assign({}, base.teacher, {
      directoryEntities: base.teacher.directoryEntitiesStatus === "counted" ? base.teacher.directoryEntities : teacherCount || null,
      directoryEntitiesStatus: base.teacher.directoryEntitiesStatus === "counted" ? "counted" : (teacherCount ? "derived-from-legacy-index" : "not-counted"),
      scheduleDocuments: teacherCount,
      sourceMode: "legacy-derived",
    }),
    classroom: Object.assign({}, base.classroom, {
      directoryEntities: base.classroom.directoryEntitiesStatus === "counted" ? base.classroom.directoryEntities : classroomCount || null,
      directoryEntitiesStatus: base.classroom.directoryEntitiesStatus === "counted" ? "counted" : (classroomCount ? "derived-from-legacy-index" : "not-counted"),
      scheduleDocuments: classroomCount,
      sourceMode: "legacy-derived",
    }),
    course: Object.assign({}, base.course, {
      directoryEntities: base.course.directoryEntitiesStatus === "counted" ? base.course.directoryEntities : courseCount || null,
      directoryEntitiesStatus: base.course.directoryEntitiesStatus === "counted" ? "counted" : (courseCount ? "derived-from-legacy-index" : "not-counted"),
      scheduleDocuments: courseCount,
      sourceMode: "legacy-derived",
    }),
    catalog: {
      colleges: Number(counts.collegeCount || counts.collegesCount || 0) || base.catalog.colleges,
      grades: base.catalog.grades,
      majors: Number(counts.majorCount || counts.majorsCount || 0) || base.catalog.majors,
    },
    derivedFromLegacy: true,
  });
}

function flattenLegacyCounts(contract) {
  const value = contract || {};
  return {
    collegeCount: value.catalog && value.catalog.colleges || 0,
    collegesCount: value.catalog && value.catalog.colleges || 0,
    majorCount: value.catalog && value.catalog.majors || 0,
    majorsCount: value.catalog && value.catalog.majors || 0,
    gradeCount: value.catalog && value.catalog.grades || 0,
    classScheduleCount: value.class && value.class.scheduleDocuments || 0,
    adminClassCount: value.class && value.class.administrativeClasses || 0,
    majorAggregateCount: value.class && value.class.aggregateSchedules || 0,
    teacherScheduleCount: value.teacher && value.teacher.scheduleDocuments || 0,
    classroomScheduleCount: value.classroom && value.classroom.scheduleDocuments || 0,
    courseScheduleCount: value.course && value.course.scheduleDocuments || 0,
    teacherCount: value.teacher && value.teacher.directoryEntitiesStatus === "counted" ? value.teacher.directoryEntities : 0,
    classroomCount: value.classroom && value.classroom.directoryEntitiesStatus === "counted" ? value.classroom.directoryEntities : 0,
    courseCount: value.course && value.course.directoryEntitiesStatus === "counted" ? value.course.directoryEntities : 0,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function metricDiff(activeValue, stagingValue) {
  const activeNum = Number(activeValue || 0);
  const stagingNum = Number(stagingValue || 0);
  const delta = stagingNum - activeNum;
  return {
    active: activeNum,
    staging: stagingNum,
    delta,
    percent: activeNum ? Number(((delta / activeNum) * 100).toFixed(2)) : null,
  };
}

const METRIC_LABELS = {
  "teacher.scheduleDocuments": "教师课表",
  "teacher.directoryEntities": "教师目录",
  "teacher.courseEvents": "教师课程事件",
  "classroom.scheduleDocuments": "教室课表",
  "classroom.directoryEntities": "教室目录",
  "classroom.courseEvents": "教室课程事件",
  "course.scheduleDocuments": "课程课表",
  "course.directoryEntities": "课程目录",
  "course.courseEvents": "课程排课事件",
  "class.scheduleDocuments": "班级课表",
  "class.administrativeClasses": "行政班",
  "class.aggregateSchedules": "专业聚合",
};

function compareMetric(active, staging, resource, field) {
  const path = `${resource}.${field}`;
  const activeResource = active && active[resource] || {};
  const stagingResource = staging && staging[resource] || {};
  const diff = metricDiff(activeResource[field], stagingResource[field]);
  return Object.assign({
    path,
    resource,
    field,
    label: METRIC_LABELS[path] || path,
  }, diff);
}

function compareResourceCountContracts(active, staging) {
  const blockers = [];
  const warnings = [];
  const comparisons = [];
  const activeVersion = Number(active && active.countSchemaVersion || 0);
  const stagingVersion = Number(staging && staging.countSchemaVersion || 0);
  if (activeVersion !== stagingVersion) {
    blockers.push({
      code: "COUNT_CONTRACT_MISMATCH",
      message: `统计契约版本不一致，当前线上 v${activeVersion || "未知"}，本次暂存 v${stagingVersion || "未知"}。`,
    });
  }
  if ((active && active.term) && (staging && staging.term) && active.term !== staging.term) {
    blockers.push({
      code: "SCOPE_FILTER_MISMATCH",
      message: `学期不一致，当前线上 ${active.term}，本次暂存 ${staging.term}。`,
    });
  }
  if (!sameJson(active && active.scopeFilters, staging && staging.scopeFilters)) {
    blockers.push({
      code: "SCOPE_FILTER_MISMATCH",
      message: "统计过滤范围不一致，不能直接比较。",
    });
  }

  RESOURCE_DIMENSIONS.forEach((resource) => {
    const activeMode = active && active[resource] && active[resource].sourceMode || "unknown";
    const stagingMode = staging && staging[resource] && staging[resource].sourceMode || "unknown";
    if (activeMode !== stagingMode) {
      blockers.push({
        code: "SOURCE_MODE_MISMATCH",
        resource,
        message: `${METRIC_LABELS[`${resource}.scheduleDocuments`] || resource} 来源口径不一致，当前线上 ${sourceModeLabel(activeMode)}，本次暂存 ${sourceModeLabel(stagingMode)}。`,
      });
    }
    ["directoryEntities", "scheduleDocuments", "courseEvents"].forEach((field) => {
      comparisons.push(compareMetric(active, staging, resource, field));
    });
  });
  ["scheduleDocuments", "administrativeClasses", "aggregateSchedules", "courseEvents"].forEach((field) => {
    comparisons.push(compareMetric(active, staging, "class", field));
  });

  asArray(staging && staging.diagnostics).forEach((diagnostic) => {
    if (diagnostic && diagnostic.publishable === false) {
      blockers.push({
        code: diagnostic.code || "COVERAGE_INVALID",
        resource: diagnostic.resource || "",
        message: diagnostic.message || "数据覆盖质量不通过，禁止发布。",
        diagnostic,
      });
    }
  });
  if (staging && staging.coverage && staging.coverage.teacher && staging.coverage.teacher.publishable === false) {
    blockers.push({
      code: "COVERAGE_INVALID",
      resource: "teacher",
      message: "教师数据覆盖状态无效，禁止发布。",
    });
  }

  return {
    allowPublish: blockers.length === 0,
    blockers,
    warnings,
    comparisons,
  };
}

function sourceModeLabel(value) {
  const key = String(value || "unknown");
  const labels = {
    "legacy-derived": "历史派生口径",
    "derived": "历史派生口径",
    "derived-current-run": "本次班级课表派生",
    "network-direct": "100网直接抓取",
    unknown: "未标明",
  };
  return labels[key] || key;
}

function formatResourceMetricValue(metric) {
  if (metric == null || metric === "") return "未统计";
  const value = typeof metric === "object" && Object.prototype.hasOwnProperty.call(metric, "value")
    ? metric.value
    : metric;
  if (value == null) return "未统计";
  return String(value);
}

module.exports = {
  buildResourceCountContract,
  compareResourceCountContracts,
  deriveLegacyResourceCountContract,
  flattenLegacyCounts,
  formatResourceMetricValue,
  isInvalidTeacherName,
  sourceModeLabel,
};

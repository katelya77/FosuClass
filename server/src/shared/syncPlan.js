"use strict";

const ALL_SCOPES = Object.freeze([
  "classSchedules",
  "teacherSchedules",
  "classroomSchedules",
  "courseSchedules",
  "classrooms",
  "teachers",
  "courses",
]);

const DYNAMIC_SCOPES = Object.freeze([
  "classSchedules",
  "teacherSchedules",
  "classroomSchedules",
  "courseSchedules",
]);

const SOURCE_MODES = Object.freeze([
  "network-direct",
  "derived-current-run",
  "cache-explicit",
  "imported",
  "contributed",
]);

const CATALOG_POLICIES = Object.freeze(["network-only", "reuse-validated", "cache-only"]);
const SCHEDULE_POLICIES = Object.freeze(["network-only", "cache-only"]);
const PROGRESS_POLICIES = Object.freeze(["ignore", "resume"]);
const NEGATIVE_CACHE_POLICIES = Object.freeze(["ignore", "use", "revalidate"]);

const LEGACY_ACTIONS = Object.freeze({
  publish: "sync:publish",
  fresh: "sync:daily",
  quick: "sync:daily",
  all: "sync:daily",
  release: "sync:daily",
  resources: "sync:scopes",
  "upload-cache": "sync:upload-staging",
  "local-upload": "sync:upload-staging",
});

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let action = "all";
  const params = {};
  args.forEach((arg) => {
    if (typeof arg !== "string") return;
    if (arg.startsWith("--")) {
      const match = arg.match(/^--([^=]+)=(.*)$/);
      if (match) {
        params[match[1]] = match[2];
      } else {
        params[arg.slice(2)] = true;
      }
    } else if (!arg.startsWith("-")) {
      action = arg;
    }
  });
  return { action, params };
}

function validateTermId(term) {
  const value = String(term || "").trim();
  const match = value.match(/^(\d{4})-(\d{4})-([12])$/);
  return {
    valid: Boolean(match && Number(match[2]) === Number(match[1]) + 1),
    term: value,
  };
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

function normalizeScope(scope) {
  const aliases = {
    classes: "classSchedules",
    class: "classSchedules",
    teachers: "teacherSchedules",
    teacher: "teacherSchedules",
    classrooms: "classroomSchedules",
    classroom: "classroomSchedules",
    courses: "courseSchedules",
    course: "courseSchedules",
  };
  const value = String(scope || "").trim();
  return aliases[value] || value;
}

function expandScopeCompanions(scopes) {
  const result = new Set(scopes || []);
  if (result.has("teacherSchedules")) result.add("teachers");
  if (result.has("classroomSchedules")) result.add("classrooms");
  if (result.has("courseSchedules")) result.add("courses");
  return Array.from(result);
}

function getDynamicScopes(scopes) {
  const set = new Set(scopes || []);
  return DYNAMIC_SCOPES.filter((scope) => set.has(scope));
}

function getResourceTypesFromScopes(scopes) {
  const set = new Set(scopes || []);
  const types = [];
  if (set.has("teacherSchedules") || set.has("teachers")) types.push("teacher");
  if (set.has("classroomSchedules") || set.has("classrooms")) types.push("classroom");
  if (set.has("courseSchedules") || set.has("courses")) types.push("course");
  return types;
}

function includeClassSeedForResourceScopes(scopes, profile) {
  if (profile === "upload-staging" || profile === "resume") return scopes;
  const next = new Set(scopes || []);
  const needsCurrentRunSeed = next.has("teacherSchedules") || next.has("classroomSchedules") || next.has("courseSchedules");
  if (needsCurrentRunSeed) next.add("classSchedules");
  return Array.from(next);
}

function boolParam(params, names, fallback) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    if (params[name] === true || params[name] === "true" || params[name] === "1") return true;
    if (params[name] === false || params[name] === "false" || params[name] === "0") return false;
  }
  return Boolean(fallback);
}

function normalizePolicy(value, allowed, fallback) {
  const raw = String(value || "").trim();
  return allowed.includes(raw) ? raw : fallback;
}

function profileForAction(action) {
  const normalized = String(action || "").trim();
  const map = {
    daily: "daily",
    publish: "daily",
    "sync:publish": "daily",
    "sync:publish:routine": "daily",
    "sync:publish:full": "new-term",
    "daily:classes": "daily-classes",
    "daily:teachers": "daily-teachers",
    "daily:classrooms": "daily-classrooms",
    "daily:courses": "daily-courses",
    scopes: "scopes",
    "new-term": "new-term",
    "crawl:daily": "crawl-daily",
    "crawl:scopes": "crawl-scopes",
    "upload-staging": "upload-staging",
    resume: "resume",
  };
  return map[normalized] || normalized;
}

function defaultScopesForProfile(profile, params) {
  if (profile === "daily") return ALL_SCOPES.slice();
  if (profile === "daily-classes") return ALL_SCOPES.slice();
  if (profile === "daily-teachers") return ["teacherSchedules", "teachers"];
  if (profile === "daily-classrooms") return ["classroomSchedules", "classrooms"];
  if (profile === "daily-courses") return ["courseSchedules", "courses"];
  if (profile === "new-term") return ALL_SCOPES.slice();
  if (profile === "crawl-daily") return ALL_SCOPES.slice();
  if (profile === "scopes" || profile === "crawl-scopes") {
    const include = parseList(params.include).map(normalizeScope);
    return expandScopeCompanions(include.length ? include : DYNAMIC_SCOPES);
  }
  if (profile === "upload-staging") return [];
  if (profile === "resume") return [];
  return ALL_SCOPES.slice();
}

function defaultScopeSources(scopes, params, profile) {
  const allowDerived = boolParam(params, "allow-derived", false);
  const sourceModeParam = String(params["resource-source"] || params.resourceSource || "").trim().toLowerCase();
  const directRequested = sourceModeParam === "direct" || sourceModeParam === "network-direct";
  const sources = {};
  (scopes || []).forEach((scope) => {
    if (scope === "classSchedules") {
      sources[scope] = {
        mode: "network-direct",
        endpointFamily: "class-schedule",
      };
    } else if (profile === "daily-classes" && DYNAMIC_SCOPES.includes(scope)) {
      sources[scope] = {
        mode: "derived-current-run",
        endpointFamily: "class-schedule",
      };
    } else if (scope === "teacherSchedules") {
      sources[scope] = {
        mode: directRequested || !allowDerived ? "network-direct" : "derived-current-run",
        endpointFamily: directRequested || !allowDerived ? "teacher-schedule" : "class-schedule",
      };
    } else if (scope === "classroomSchedules") {
      sources[scope] = {
        mode: directRequested || !allowDerived ? "network-direct" : "derived-current-run",
        endpointFamily: directRequested || !allowDerived ? "classroom-schedule" : "class-schedule",
      };
    } else if (scope === "courseSchedules") {
      sources[scope] = {
        mode: directRequested || !allowDerived ? "network-direct" : "derived-current-run",
        endpointFamily: directRequested || !allowDerived ? "course-schedule" : "class-schedule",
      };
    }
  });
  return sources;
}

function buildSyncPlan(action, params = {}, env = process.env) {
  const rawAction = String(action || "all");
  const deprecatedTarget = LEGACY_ACTIONS[rawAction] || "";
  const effectiveAction = deprecatedTarget ? deprecatedTarget.replace(/^sync:/, "") : rawAction;
  const profile = profileForAction(effectiveAction);
  const isUploadOnly = profile === "upload-staging";
  const isResume = profile === "resume";
  const isCrawlOnly = profile === "crawl-daily" || profile === "crawl-scopes";
  const isNewTerm = profile === "new-term";
  const term = String(params.term || params.semester || env.PREFERRED_SEMESTER || "").trim();
  const scopes = includeClassSeedForResourceScopes(
    expandScopeCompanions(defaultScopesForProfile(profile, params)),
    profile
  );
  const dynamicScopes = getDynamicScopes(scopes);
  const catalogPolicy = normalizePolicy(
    params["catalog-policy"] || params.catalogPolicy,
    CATALOG_POLICIES,
    isNewTerm ? "network-only" : (isUploadOnly || isResume ? "cache-only" : "reuse-validated")
  );
  const schedulePolicy = normalizePolicy(
    params["schedule-policy"] || params.schedulePolicy,
    SCHEDULE_POLICIES,
    isUploadOnly ? "cache-only" : "network-only"
  );
  const progressPolicy = normalizePolicy(
    params["progress-policy"] || params.progressPolicy,
    PROGRESS_POLICIES,
    isResume ? "resume" : "ignore"
  );
  const negativeCachePolicy = normalizePolicy(
    params["negative-cache-policy"] || params.negativeCachePolicy,
    NEGATIVE_CACHE_POLICIES,
    "ignore"
  );
  const upload = !isCrawlOnly && !boolParam(params, ["no-upload"], false) && !isResume;
  const buildRelease = upload && !isUploadOnly && !boolParam(params, ["no-publish", "crawl-only"], false);
  const activate = isNewTerm
    ? boolParam(params, "activate", false)
    : buildRelease && !boolParam(params, ["no-activate"], false);
  const plan = {
    schemaVersion: 1,
    action: rawAction,
    mappedAction: effectiveAction,
    profile,
    term,
    termValid: validateTermId(term).valid,
    runId: String(params["run-id"] || params.runId || `${profile}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`),
    deprecated: Boolean(deprecatedTarget),
    deprecatedTarget,
    scopes,
    dynamicScopes,
    resourceTypes: getResourceTypesFromScopes(scopes),
    catalogPolicy,
    schedulePolicy,
    progressPolicy,
    negativeCachePolicy,
    mergeOldData: boolParam(params, "merge-old-data", false),
    crawl: !isUploadOnly,
    upload,
    buildRelease,
    activate,
    verifyClient: buildRelease && !boolParam(params, ["no-verify-client"], false),
    allowPartial: boolParam(params, "allow-partial", false),
    allowDerived: boolParam(params, "allow-derived", false),
    forceRefresh: schedulePolicy === "network-only" && !isUploadOnly && progressPolicy === "ignore",
    ignoreProgress: progressPolicy === "ignore",
    ignoreNoScheduleCache: negativeCachePolicy === "ignore",
    cacheOnlyExplicit: schedulePolicy === "cache-only" || catalogPolicy === "cache-only",
    filters: {
      grades: parseList(params.grades || env.SYNC_CLASS_GRADES || env.SYNC_GRADES),
      collegeCodes: parseList(params["college-codes"] || env.SYNC_CLASS_COLLEGE_CODES),
      majorCodes: parseList(params["major-codes"] || env.SYNC_CLASS_MAJOR_CODES),
    },
    termConfig: {
      term,
      termStartDate: String(params["term-start-date"] || params.start || env.SYNC_TERM_START_DATE || "").trim(),
      totalWeeks: params["total-weeks"] ? Number(params["total-weeks"]) : (env.SYNC_TOTAL_WEEKS ? Number(env.SYNC_TOTAL_WEEKS) : 0),
      weekStart: String(params["week-start"] || env.SYNC_WEEK_START || "monday").trim().toLowerCase(),
    },
    sourceRequirements: defaultScopeSources(scopes, params, profile),
    warnings: [],
  };
  if (plan.deprecated) {
    plan.warnings.push(`Deprecated command '${rawAction}' mapped to '${deprecatedTarget}'.`);
  }
  if (/\b(fresh|daily|crawl|sync)\b/.test(rawAction) && schedulePolicy === "cache-only" && !isUploadOnly) {
    plan.warnings.push("Cache-only is explicit and should not be used for fresh/daily/crawl actions.");
  }
  if (isNewTerm) {
    if (!plan.termConfig.termStartDate) plan.warnings.push("new-term requires --term-start-date.");
    if (!plan.termConfig.totalWeeks) plan.warnings.push("new-term requires --total-weeks.");
  }
  return plan;
}

function applyPlanToParams(plan, params = {}) {
  const next = Object.assign({}, params);
  next.term = plan.term || next.term;
  next.includeScopes = plan.scopes.slice();
  next.forceRefresh = Boolean(plan.forceRefresh);
  next.fresh = Boolean(plan.forceRefresh);
  next.ignoreProgress = Boolean(plan.ignoreProgress);
  next.ignoreNoScheduleCache = Boolean(plan.ignoreNoScheduleCache);
  next.mergeOldData = Boolean(plan.mergeOldData);
  next.crawlMode = plan.forceRefresh ? "full-fresh" : (plan.schedulePolicy === "cache-only" ? "cache-only" : "incremental");
  next.freshRunId = plan.runId;
  next.catalogPolicy = plan.catalogPolicy;
  next.schedulePolicy = plan.schedulePolicy;
  next.progressPolicy = plan.progressPolicy;
  next.negativeCachePolicy = plan.negativeCachePolicy;
  next.resourceSource = plan.profile === "daily-classes" || plan.allowDerived ? "derived" : "direct";
  next.allowDerived = plan.allowDerived;
  next.allowPartial = plan.allowPartial;
  next["term-start-date"] = next["term-start-date"] || plan.termConfig.termStartDate;
  next["total-weeks"] = next["total-weeks"] || (plan.termConfig.totalWeeks || "");
  next["week-start"] = next["week-start"] || plan.termConfig.weekStart;
  return next;
}

function printablePlan(plan) {
  return {
    term: plan.term,
    profile: plan.profile,
    scopes: plan.scopes,
    catalogPolicy: plan.catalogPolicy,
    schedulePolicy: plan.schedulePolicy,
    progressPolicy: plan.progressPolicy,
    negativeCachePolicy: plan.negativeCachePolicy,
    mergeOldData: plan.mergeOldData,
    crawl: plan.crawl,
    upload: plan.upload,
    buildRelease: plan.buildRelease,
    activate: plan.activate,
    verifyClient: plan.verifyClient,
    allowPartial: plan.allowPartial,
    allowDerived: plan.allowDerived,
    runId: plan.runId,
    sourceRequirements: plan.sourceRequirements,
    filters: plan.filters,
    warnings: plan.warnings,
  };
}

function renderPowerShellCommand(task, options = {}) {
  const term = options.term || "2025-2026-2";
  const start = options.termStartDate || options.start || "YYYY-MM-DD";
  const weekCount = Number(options.totalWeeks);
  const weeks = Number.isInteger(weekCount) && weekCount > 0 ? weekCount : "TOTAL_WEEKS";
  const scopes = Array.isArray(options.scopes) && options.scopes.length
    ? options.scopes.join(",")
    : "classSchedules,teacherSchedules,classroomSchedules,courseSchedules";
  const base = `npm run ${task}`;
  if (task === "sync:new-term") {
    return `${base} -- --term=${term} --term-start-date=${start} --total-weeks=${weeks} --week-start=${options.weekStart || "monday"}`;
  }
  if (task === "sync:scopes" || task === "crawl:scopes") {
    return `${base} -- --term=${term} --include=${scopes}`;
  }
  if (task === "sync:upload-staging") {
    return `$file = (Resolve-Path ".\\staging\\${term}-full.json").Path\n${base} -- --file="$file" --term=${term}`;
  }
  if (task === "sync:resume") {
    return `${base} -- --run-id=${options.runId || "RUN_ID"}`;
  }
  return `${base} -- --term=${term}`;
}

const OPERATION_ZH = Object.freeze({
  "sync:daily": ["日常同步：全部动态课表", "日常全校动态课表更新"],
  "sync:daily:classes": ["日常同步：班级课表", "班级课表变化同步"],
  "sync:daily:teachers": ["日常同步：教师课表", "教师维度课表刷新"],
  "sync:daily:classrooms": ["日常同步：教室课表", "教室维度课表刷新"],
  "sync:daily:courses": ["日常同步：课程课表", "课程维度课表刷新"],
  "sync:scopes": ["自定义同步范围", "按勾选范围执行受控刷新"],
  "sync:new-term": ["新学期全量采集", "新学期首轮全量建档"],
  "sync:upload-staging": ["上传本地暂存文件", "上传已生成的 Staging JSON"],
  "sync:resume": ["恢复中断任务", "继续指定 runId 的中断任务"],
});

function riskDisplay(risk) {
  return {
    low: "低",
    medium: "中",
    high: "高",
  }[risk] || risk || "中";
}

function requestScaleDisplay(code) {
  return {
    "full-campus": "全校范围",
    "scope-dependent": "按同步范围",
  }[code] || code || "按同步范围";
}

function getRecommendedOperations(options = {}) {
  const term = options.term || "2025-2026-2";
  const termStartDate = options.termStartDate || "YYYY-MM-DD";
  const weekCount = Number(options.totalWeeks);
  const totalWeeks = Number.isInteger(weekCount) && weekCount > 0 ? weekCount : "";
  const operations = [
    ["sync:daily", "daily_all_dynamic", true, true, false, true, true, true, "medium", "daily_all"],
    ["sync:daily:classes", "daily_classes", true, true, false, true, true, true, "medium", "class_changes"],
    ["sync:daily:teachers", "daily_teachers", true, true, false, true, true, true, "medium", "teacher_refresh"],
    ["sync:daily:classrooms", "daily_classrooms", true, true, false, true, true, true, "medium", "classroom_refresh"],
    ["sync:daily:courses", "daily_courses", true, true, false, true, true, true, "medium", "course_refresh"],
    ["sync:scopes", "selected_scopes", true, true, false, true, true, true, "medium", "controlled_partial"],
    ["sync:new-term", "new_term_full", true, false, false, true, true, false, "high", "new_semester"],
    ["sync:upload-staging", "upload_staging", false, false, true, true, false, false, "low", "upload_file"],
    ["sync:resume", "resume_run", true, true, false, true, true, true, "medium", "resume_run"],
  ];
  return operations.map(([id, name, intranetRequired, catalogCache, dynamicCache, upload, publish, activate, risk, scene]) => {
    const zh = OPERATION_ZH[id] || [name, scene];
    const estimatedRequestsCode = id === "sync:new-term" || id === "sync:daily" ? "full-campus" : "scope-dependent";
    return {
    id,
    name: zh[0],
    nameEn: name,
    displayName: zh[0],
    displayScene: zh[1],
    intranetRequired,
    usesCatalogCache: catalogCache,
    usesDynamicCache: dynamicCache,
    upload,
    publish,
    activate,
    risk,
    riskDisplay: riskDisplay(risk),
    estimatedRequests: requestScaleDisplay(estimatedRequestsCode),
    estimatedRequestsCode,
    estimatedDuration: intranetRequired ? "8-30 min" : "15-60 sec",
    scene,
    sceneCode: scene,
    command: renderPowerShellCommand(id, { term, termStartDate, totalWeeks }),
    };
  });
}

module.exports = {
  ALL_SCOPES,
  CATALOG_POLICIES,
  DYNAMIC_SCOPES,
  LEGACY_ACTIONS,
  NEGATIVE_CACHE_POLICIES,
  PROGRESS_POLICIES,
  SCHEDULE_POLICIES,
  SOURCE_MODES,
  applyPlanToParams,
  buildSyncPlan,
  expandScopeCompanions,
  getDynamicScopes,
  getRecommendedOperations,
  getResourceTypesFromScopes,
  parseCliArgs,
  printablePlan,
  renderPowerShellCommand,
  validateTermId,
};

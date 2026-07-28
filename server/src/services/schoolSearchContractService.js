/**
 * schoolSearchContractService.js — M3-T2 服务端统一搜索服务（school-search.v1）
 *
 * 四类（teacher/class/classroom/course）统一进程内搜索入口，供 Agent 进程内调用与
 * 全校页 HTTP 共用（消费者切换见 M3-T3+，本服务只提供唯一实现，不接线路由）。
 *
 * 契约单源：server/src/shared/schoolSearchContract.generated.js（只读消费，禁止手改）。
 * - requestFields / responseFields 决定请求归一化与响应形态（响应 = responseFields 超集 + decision）。
 * - DECISION 四常数是唯一/多候选截断的唯一来源（candidateOpenMax/actionCap/candidateListMax/offlineCandidateMax）。
 * - NAVIGATION / NAVIGATION_REASON_CODES 决定 schedule 导航与兜底 reason code。
 *
 * 数据访问复用 releaseService.searchActiveIndex（server/src/services/releaseService.js:3610），
 * 即 /api/fosu/search-index 路由（routes/fosu.js:910）与 Agent searchSchoolIndex
 * （services/ai/toolRegistry.js:1275）共用的同一进程内数据层；索引加载、版本校验、
 * last-known-good、derivedCache 语义全部留在 releaseService，本服务不另起第二份索引逻辑。
 *
 * 过滤谓词语义（releaseService.filterActiveIndexItems，releaseService.js:3526）与现网对齐：
 * - 学院过滤 code/name 任一命中；有学院筛选时排除「学院待确认」且无 codes 的教师；
 * - 教师精确姓名优先于模糊；全局精确命中存在时禁止模糊扩散（陈芳 vs 陈芳华）；
 * - teacher 响应仍经 teacher-search.v1 契约 normalizeResponse（migrationNote 兼容链）。
 *
 * 边界说明：
 * - 本服务是纯搜索层：自然语言称谓剥离（「老师」）、教室 building/exact-room 解析
 *   （classroomSearch.parseClassroomQuery）属于调用方 NL 层职责，不进入契约 requestFields。
 * - 纯同步、进程内、无网络、无新依赖。options._items 为测试注入（同 releaseService 约定），
 *   注入时跳过磁盘索引读取，不触碰 server/storage 真实数据。
 */
const releaseService = require("./releaseService");
const {
  CONTRACT_VERSION,
  INDEX_SCHEMA_VERSION,
  TEACHER_INDEX_SCHEMA_VERSION,
  CACHE_NAMESPACE,
  DECISION,
  NAVIGATION,
  NAVIGATION_REASON_CODES,
  normalizeEntityType,
  clampDecisionLimit,
} = require("../shared/schoolSearchContract.generated");

function text(value, max) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, max || 120);
}

function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

/**
 * 请求归一化：字段对齐契约 requestFields（keyword/semester/version/college/title/campusName
 * 为既有调用方别名，归一化后不进入契约字段集）。type 非法 → ""，由 search() 拒绝。
 */
function normalizeRequest(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    type: normalizeEntityType(source.type),
    q: text(source.q || source.keyword, 120),
    term: text(source.term || source.semester, 40),
    releaseVersion: text(source.releaseVersion || source.version, 80),
    collegeCode: text(source.collegeCode, 24),
    collegeName: text(source.collegeName || source.college, 80),
    titleCode: text(source.titleCode || source.title, 40),
    grade: text(source.grade, 24),
    majorCode: text(source.majorCode, 24),
    majorName: text(source.majorName, 80),
    campus: text(source.campus || source.campusName, 80),
    limit: numberInRange(source.limit, 30, 1, 100),
    offset: numberInRange(source.offset, 0, 0, 100000),
  };
}

/** cacheKey：CACHE_NAMESPACE + 契约版本 + schema + 全部 requestFields，releaseVersion 透传进命名空间。 */
function buildCacheKey(request) {
  const req = request && typeof request === "object" ? request : {};
  const encode = (value) => encodeURIComponent(text(value, 160));
  return [
    CACHE_NAMESPACE,
    CONTRACT_VERSION,
    "schema-" + INDEX_SCHEMA_VERSION,
    encode(req.type),
    encode(req.term || "unknown"),
    encode(req.releaseVersion || "unknown"),
    encode(req.q),
    encode(req.collegeCode),
    encode(req.collegeName),
    encode(req.titleCode),
    encode(req.grade),
    encode(req.majorCode),
    encode(req.majorName),
    encode(req.campus),
    String(numberInRange(req.limit, 30, 1, 100)),
    String(numberInRange(req.offset, 0, 0, 100000)),
  ].join(":");
}

function displayNameOf(type, item) {
  const source = item && typeof item === "object" ? item : {};
  if (type === "teacher") return text(source.teacherName || source.name || source.displayName, 120);
  if (type === "class") return text(source.className || source.name || source.displayName, 120);
  if (type === "classroom") return text(source.roomName || source.classroomName || source.name || source.displayName, 120);
  return text(source.courseName || source.displayCourseName || source.canonicalCourseName || source.name || source.displayName, 120);
}

/**
 * detailId 只取条目真实 id 字段（与 toolRegistry.js:2057 的 id 链一致，但不去掉名称兜底：
 * 名称不是 detailId，缺 id 时不得伪造，交由 navigation 兜底 reason code 跳全校页）。
 */
function resolveDetailId(item) {
  const source = item && typeof item === "object" ? item : {};
  return text(
    source.detailId || source.id || source.scheduleId
      || source.teacherId || source.classroomId || source.courseId || source.classId,
    128
  );
}

/** 全校页兜底 URL（与 toolRegistry buildActionUrl("/pages/school/school", { type, q }) 同语义）。 */
function buildSchoolUrl(type, context) {
  const q = text(context && context.q, 120);
  const base = `${NAVIGATION.schoolPath}?type=${encodeURIComponent(type)}`;
  return q ? `${base}&q=${encodeURIComponent(q)}` : base;
}

/** 课表详情页 URL（字段对齐 school.js:2268 的 schedule-view 跳链子集）。 */
function buildScheduleUrl(type, detailId, name, context) {
  const params = [
    `type=${encodeURIComponent(type)}`,
    `id=${encodeURIComponent(detailId)}`,
  ];
  if (name) params.push(`name=${encodeURIComponent(name)}`);
  const term = text(context && context.term, 40);
  const releaseVersion = text(context && context.releaseVersion, 80);
  if (term) params.push(`term=${encodeURIComponent(term)}`);
  if (releaseVersion) params.push(`releaseVersion=${encodeURIComponent(releaseVersion)}`);
  return `${NAVIGATION.scheduleViewPath}?${params.join("&")}`;
}

/**
 * 条目导航语义（契约 navigation）：
 * - 缺 detailId → 兜底跳全校页，reasonCode = DETAIL_ID_MISSING（不伪造 detailId）；
 * - 有 detailId 但缺 releaseVersion → 兜底跳全校页，reasonCode = RELEASE_VERSION_MISSING
 *   （全校页 school.js:2056 在 version 缺失时同样拒绝详情请求）；
 * - 两者齐备 → schedule-view 直开。
 */
function buildItemNavigation(type, item, context) {
  const ctx = context && typeof context === "object" ? context : {};
  const detailId = resolveDetailId(item);
  const name = displayNameOf(type, item);
  if (!detailId) {
    return {
      detailId: "",
      name,
      canOpen: false,
      reasonCode: NAVIGATION_REASON_CODES.detailIdMissing,
      path: NAVIGATION.schoolPath,
      url: buildSchoolUrl(type, ctx),
    };
  }
  if (!text(ctx.releaseVersion, 80)) {
    return {
      detailId,
      name,
      canOpen: false,
      reasonCode: NAVIGATION_REASON_CODES.releaseVersionMissing,
      path: NAVIGATION.schoolPath,
      url: buildSchoolUrl(type, ctx),
    };
  }
  return {
    detailId,
    name,
    canOpen: true,
    reasonCode: "",
    path: NAVIGATION.scheduleViewPath,
    url: buildScheduleUrl(type, detailId, name, ctx),
  };
}

function noneDecision(total) {
  return {
    kind: "none",
    total: Math.max(0, Number(total) || 0),
    item: null,
    detailId: "",
    canOpen: false,
    navigation: null,
    candidates: [],
    actions: [],
  };
}

/**
 * 唯一/多候选/无结果决策。decision 常数唯一来源是生成物 DECISION：
 * - unique：恰好 1 条，可直接打开（canOpen 取决于 navigation）；
 * - candidate：列表长度经 clampDecisionLimit(candidateListMax/offlineCandidateMax) 截断，
 *   直开动作预算 candidateOpenMax，单候选动作数 actionCap；
 * - none：0 条。
 */
function buildDecision(type, result, context) {
  const ctx = context && typeof context === "object" ? context : {};
  const items = Array.isArray(result && result.items) ? result.items : [];
  const total = Math.max(0, Number(result && result.total) || 0);
  if (!total || !items.length) return noneDecision(total);

  if (total === 1) {
    const navigation = buildItemNavigation(type, items[0], ctx);
    const actions = navigation.canOpen
      ? [{ name: "open_detail", url: navigation.url, detailId: navigation.detailId }]
      : [{ name: "open_school_page", url: navigation.url }];
    return {
      kind: "unique",
      total: 1,
      item: items[0],
      detailId: navigation.detailId,
      canOpen: navigation.canOpen,
      navigation,
      candidates: [],
      actions: actions.slice(0, clampDecisionLimit("actionCap", actions.length)),
    };
  }

  const capKey = ctx.offline === true ? "offlineCandidateMax" : "candidateListMax";
  const listCap = clampDecisionLimit(capKey, items.length);
  const actionCap = clampDecisionLimit("actionCap", DECISION.actionCap);
  let openBudget = clampDecisionLimit("candidateOpenMax", DECISION.candidateOpenMax);
  const candidates = items.slice(0, listCap).map((item) => {
    const navigation = buildItemNavigation(type, item, ctx);
    const actions = [];
    if (navigation.canOpen && openBudget > 0) {
      openBudget -= 1;
      actions.push({ name: "open_detail", url: navigation.url, detailId: navigation.detailId });
    }
    actions.push({ name: "open_school_page", url: buildSchoolUrl(type, ctx) });
    return {
      type,
      detailId: navigation.detailId,
      name: navigation.name,
      canOpen: navigation.canOpen,
      reasonCode: navigation.reasonCode,
      navigation,
      item,
      actions: actions.slice(0, actionCap),
    };
  });
  return {
    kind: "candidate",
    total,
    item: null,
    detailId: "",
    canOpen: false,
    navigation: null,
    candidates,
    actions: [],
  };
}

function buildResponse(request, result, context, decision) {
  const source = result && typeof result === "object" ? result : {};
  const term = text(source.term || source.semester || request.term, 40);
  const releaseVersion = text(source.releaseVersion || source.version || request.releaseVersion, 80);
  const success = source.success !== false;
  return {
    success,
    type: request.type,
    contractVersion: CONTRACT_VERSION,
    indexSchemaVersion: INDEX_SCHEMA_VERSION,
    teacherIndexSchemaVersion: request.type === "teacher"
      ? TEACHER_INDEX_SCHEMA_VERSION
      : (Number(source.teacherIndexSchemaVersion) || undefined),
    term,
    semester: text(source.semester || term, 40),
    releaseVersion,
    version: text(source.version || releaseVersion, 80),
    query: text(source.query || request.q, 120),
    total: Math.max(0, Number(source.total == null ? 0 : source.total) || 0),
    limit: numberInRange(source.limit, request.limit, 1, 100),
    offset: numberInRange(source.offset, request.offset, 0, 100000),
    items: success && Array.isArray(source.items) ? source.items : [],
    cacheKey: buildCacheKey(request),
    reasonCode: text(source.reasonCode, 80),
    code: text(source.code || source.reasonCode, 80),
    degradedSchema: source.degradedSchema === true,
    fromStorage: source.fromStorage === true,
    offline: context.offline === true,
    searchFallback: source.searchFallback === true,
    source: text(source.source, 80),
    dataSource: text(source.dataSource, 80),
    etag: text(source.etag, 80),
    updatedAt: text(source.updatedAt || source.generatedAt, 48),
    debug: source.debug && typeof source.debug === "object" ? source.debug : null,
    decision,
  };
}

/**
 * 统一搜索入口。纯同步、进程内。
 * @param {object} input 契约 requestFields（type/q/term/releaseVersion/collegeCode/collegeName/
 *   titleCode/grade/majorCode/majorName/campus/limit/offset；别名 keyword/semester/version/college/title/campusName）。
 * @param {object} [options] { offline: boolean, _items: Array } — _items 为测试注入（同
 *   releaseService.searchActiveIndex 约定），注入时跳过磁盘索引读取。
 */
function search(input, options) {
  const opts = options && typeof options === "object" ? options : {};
  const source = input && typeof input === "object" ? input : {};
  const request = normalizeRequest(source);
  const context = { offline: opts.offline === true || source.offline === true };

  if (!request.type) {
    const rejected = Object.assign({}, request, { type: text(source.type, 40) });
    return buildResponse(
      rejected,
      { success: false, code: "INVALID_TYPE", reasonCode: "INVALID_TYPE", items: [], total: 0 },
      context,
      noneDecision(0)
    );
  }

  const searchOptions = {
    term: request.term,
    semester: request.term,
    releaseVersion: request.releaseVersion,
    collegeCode: request.collegeCode,
    collegeName: request.collegeName,
    titleCode: request.titleCode,
    grade: request.grade,
    majorCode: request.majorCode,
    majorName: request.majorName,
    campus: request.campus,
    limit: request.limit,
    offset: request.offset,
  };
  // 测试注入：options._items 优先，其次 input._items（均不进入契约字段与响应）。
  const injected = Array.isArray(opts._items) ? opts._items : (Array.isArray(source._items) ? source._items : null);
  if (injected) searchOptions._items = injected;

  const result = releaseService.searchActiveIndex(request.type, request.q, searchOptions);
  const navContext = {
    q: request.q,
    term: text(result && (result.term || result.semester), 40) || request.term,
    releaseVersion: text(result && (result.releaseVersion || result.version), 80) || request.releaseVersion,
    offline: context.offline,
  };
  const decision = result && result.success === false
    ? noneDecision(0)
    : buildDecision(request.type, result, navContext);
  return buildResponse(request, result, context, decision);
}

module.exports = {
  search,
  normalizeRequest,
  buildCacheKey,
  buildDecision,
  buildItemNavigation,
};

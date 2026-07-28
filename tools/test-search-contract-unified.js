#!/usr/bin/env node
/**
 * test-search-contract-unified.js — school-search.v1 统一搜索服务专项（M3）
 *
 * 分段续写约定：M3 各任务按段追加断言组并登记进 GROUPS。
 *   第一段（M3-T2）：schoolSearchContractService service 层断言（g1–g8）。
 *   第二段（M3-T3）：②HTTP 路由 GET /release-pack/search 行为（g9）
 *                     ③Agent search_school_index ↔ HTTP 同查询同结果一致性（g10）。
 *   第三段（M3-T4）：全校页客户端切换服务端搜索 + 本地缓存降级（g11–g14，mock wx 环境）。
 *   第四段（M3-T5）：classroomSearch 单源切换（壳↔生成物）+ schedule-view URL 构建统一（g15）。
 *
 * 覆盖：
 *   g1 四类搜索各红绿例（teacher/class/classroom/course 命中与零命中）
 *   g2 过滤谓词：学院过滤（code/name 任一命中、「学院待确认」排除）、grade/majorCode/campus
 *   g3 教师精确命中优先 + 全局精确隔离（陈芳 vs 陈芳华）
 *   g4 unique / candidate / none 三决策形态
 *   g5 DECISION 常数确实消费于截断（candidateListMax/candidateOpenMax/actionCap/offlineCandidateMax）+ limit/offset 分页
 *   g6 缺 detailId 兜底 reason code（DETAIL_ID_MISSING 端到端 + RELEASE_VERSION_MISSING 纯函数）+ 不伪造 detailId
 *   g7 契约版本字段 / responseFields 超集形态锁 / cacheKey 命名空间 / releaseVersion 透传
 *   g8 非法 type 拒绝
 *   g9 HTTP 路由：合法/非法/缺省 type、决策形态、responseFields 超集、缓存策略、scheduleLimiter 静态断言
 *   g10 Agent↔HTTP 一致性：同一 fixture _items 注入下，工具输出与 service/路由输出 items/decision 深度一致
 *   g11 客户端在线契约响应原样透传 + 非法形态响应/非法 type 拒绝（不冒充在线、非法 type 不发网络）
 *   g12 失败/断网回退 local_cache：降级标识为真（degraded/stale/offline、contractVersion=local-fallback、cachedAt、fallbackReason）
 *   g13 离线候选列表 = DECISION.offlineCandidateMax 截断 + 本地决策不伪造 detailId（reason code 兜底）
 *   g14 school.js 消费 decision/DECISION 常数：唯一直开、多候选按契约候选名定位、缺 detailId 兜底留全校页、降级徽标
 *   g15 classroomSearch 单源（壳↔生成物引用直通、正本=生成物正文静态锁、行为 battery）+
 *       schedule-view URL 单一实现（静态断言 navigator 无独立实现、双调用方输出一致、
 *       week/weekday 透传回归锁、契约 NAVIGATION 常数对齐、reason code 兜底语义不变、
 *       与服务端 buildItemNavigation URL 形态一致）
 *
 * 隔离纪律：
 * - 纯 Node 无网络（HTTP 段仅挂 127.0.0.1 临时端口，模式同 test-fosu-search-index-contract.js，
 *   不引入新依赖）；全部经 _items 注入最小虚构数据集（releaseService.searchActiveIndex
 *   既有测试注入约定），不读 server/storage 真实数据；
 * - 路由测试经 stubServiceSearchWithFixtures 把同一 fixture 注入进程内 service 单例，
 *   生产路径不接收任何 _items 参数（service 只认数组且 query 无法构造数组）；
 * - fixture 人名沿用仓库既有虚构惯例（陈芳/陈芳华，见 releaseService.js 全局精确隔离注释与
 *   test-teacher-search-contract-unified.js），学院/班级/课程名均为示例形态，不含真实学号。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const express = require("../server/node_modules/express");

const contract = require("../server/src/shared/schoolSearchContract.generated");
const service = require("../server/src/services/schoolSearchContractService");
const fosuRouter = require("../server/src/routes/fosu");
const toolRegistry = require("../server/src/services/ai/toolRegistry");

const TERM = "2025-2026-2";
const RELEASE = "rel-test-2026";

// ---------------------------------------------------------------------------
// 最小虚构索引 fixture（_items 注入；人名/班级/课程均为虚构示例形态）
// ---------------------------------------------------------------------------
const TEACHER_ITEMS = [
  {
    id: "t-chenfang", name: "陈芳", teacherName: "陈芳",
    collegeCode: "04", collegeCodes: ["04"], collegeName: "动物科技学院", collegeNames: ["动物科技学院"],
    title: "副教授", semester: TERM,
  },
  {
    id: "t-chenfanghua", name: "陈芳华", teacherName: "陈芳华",
    collegeCode: "07", collegeCodes: ["07"], collegeName: "人文学院", collegeNames: ["人文学院"],
    semester: TERM,
  },
  {
    id: "t-lili", name: "李例", teacherName: "李例",
    collegeName: "学院待确认", collegeCodes: [], semester: TERM,
  },
  {
    // 无 id 字段：触发 DETAIL_ID_MISSING 兜底（不得伪造 detailId）
    name: "周示例", teacherName: "周示例",
    collegeCode: "04", collegeCodes: ["04"], collegeName: "动物科技学院", collegeNames: ["动物科技学院"],
    semester: TERM,
  },
];

const CLASS_ITEMS = [
  {
    id: "c-24dy1", className: "24动医1班", name: "24动医1班",
    collegeCode: "04", collegeName: "动物科技学院", grade: "2024",
    majorCode: "090401", majorName: "动物医学", semester: TERM,
  },
  {
    id: "c-24dy2", className: "24动医2班", name: "24动医2班",
    collegeCode: "04", collegeName: "动物科技学院", grade: "2024",
    majorCode: "090401", majorName: "动物医学", semester: TERM,
  },
];

const CLASSROOM_ITEMS = [
  { id: "r-b201", roomName: "B201", name: "B201", campus: "江湾", semester: TERM },
  { id: "r-b202", roomName: "B202", name: "B202", campus: "江湾", semester: TERM },
  { roomName: "B305", name: "B305", campus: "仙溪", semester: TERM }, // 无 id → 兜底
];

const COURSE_ITEMS = Array.from({ length: 10 }, (_, index) => {
  const seq = String(index + 1).padStart(2, "0");
  return {
    id: `k-demo-${seq}`,
    courseName: `示例课程${seq}`,
    name: `示例课程${seq}`,
    firstCourseName: `示例课程${seq}`,
    semester: TERM,
  };
});

const ITEMS_BY_TYPE = {
  teacher: TEACHER_ITEMS,
  class: CLASS_ITEMS,
  classroom: CLASSROOM_ITEMS,
  course: COURSE_ITEMS,
};

function searchType(type, extra) {
  return service.search(Object.assign({
    type,
    term: TERM,
    releaseVersion: RELEASE,
    _items: ITEMS_BY_TYPE[type],
  }, extra || {}));
}

// ---------------------------------------------------------------------------
// g1 四类搜索各红绿例
// ---------------------------------------------------------------------------
function runGroup1FourTypesGreenRed() {
  const green = [
    ["teacher", "陈芳", "陈芳"],
    ["class", "24动医1班", "24动医1班"],
    ["classroom", "B201", "B201"],
    ["course", "示例课程03", "示例课程03"],
  ];
  green.forEach(([type, q, expectedName]) => {
    const res = searchType(type, { q });
    assert.strictEqual(res.success, true, `g1 ${type} green success`);
    assert.strictEqual(res.type, type, `g1 ${type} green type echo`);
    assert.ok(res.total >= 1, `g1 ${type} green total >= 1`);
    assert.ok(res.items.length >= 1, `g1 ${type} green items >= 1`);
    assert.strictEqual(service.normalizeRequest({}).type, "", "g1 normalizeRequest empty type sanity");
    assert.ok(
      JSON.stringify(res.items[0]).includes(expectedName),
      `g1 ${type} green first item should contain ${expectedName}`
    );
  });

  ["teacher", "class", "classroom", "course"].forEach((type) => {
    const res = searchType(type, { q: "不存在的目标xyz" });
    assert.strictEqual(res.success, true, `g1 ${type} red success (empty hit is still a successful search)`);
    assert.strictEqual(res.total, 0, `g1 ${type} red total 0`);
    assert.strictEqual(res.items.length, 0, `g1 ${type} red items empty`);
    assert.strictEqual(res.decision.kind, "none", `g1 ${type} red decision none`);
  });
}

// ---------------------------------------------------------------------------
// g2 过滤谓词：学院过滤 / 「学院待确认」排除 / grade / majorCode / campus
// ---------------------------------------------------------------------------
function runGroup2FilterPredicates() {
  const hit = searchType("teacher", { q: "陈芳", collegeCode: "04" });
  assert.strictEqual(hit.total, 1, "g2 collegeCode 04 应命中陈芳");

  const miss = searchType("teacher", { q: "陈芳", collegeCode: "07" });
  assert.strictEqual(miss.total, 0, "g2 collegeCode 07 不应命中陈芳（全局精确隔离）");

  const byName = searchType("teacher", { q: "陈芳", collegeName: "动物科技学院" });
  assert.strictEqual(byName.total, 1, "g2 collegeName 命中陈芳");

  const pendingExcluded = searchType("teacher", { q: "李例", collegeCode: "04" });
  assert.strictEqual(pendingExcluded.total, 0, "g2 有学院筛选时「学院待确认」且无 codes 的教师必须排除");

  const pendingNoFilter = searchType("teacher", { q: "李例" });
  assert.strictEqual(pendingNoFilter.total, 1, "g2 无学院筛选时「学院待确认」教师可命中");

  const titleHit = searchType("teacher", { q: "陈芳", titleCode: "副教授" });
  assert.strictEqual(titleHit.total, 1, "g2 titleCode 命中");
  // 注意：matchesTitle 为 includes 语义（「副教授」包含「教授」），反例须用不相干职称。
  const titleMiss = searchType("teacher", { q: "陈芳", titleCode: "讲师" });
  assert.strictEqual(titleMiss.total, 0, "g2 titleCode 不命中时排除");

  const gradeHit = searchType("class", { q: "动医", grade: "2024" });
  assert.strictEqual(gradeHit.total, 2, "g2 class grade 2024 命中两班");
  const gradeMiss = searchType("class", { q: "动医", grade: "2023" });
  assert.strictEqual(gradeMiss.total, 0, "g2 class grade 2023 不命中");

  const majorHit = searchType("class", { q: "动医", majorCode: "090401" });
  assert.strictEqual(majorHit.total, 2, "g2 class majorCode 命中");
  const majorMiss = searchType("class", { q: "动医", majorCode: "000000" });
  assert.strictEqual(majorMiss.total, 0, "g2 class majorCode 不命中");

  const campusHit = searchType("classroom", { q: "B20", campus: "江湾" });
  assert.strictEqual(campusHit.total, 2, "g2 classroom campus 江湾 命中两间");
  const campusMiss = searchType("classroom", { q: "B20", campus: "仙溪" });
  assert.strictEqual(campusMiss.total, 0, "g2 classroom campus 仙溪 下 B201/B202 被排除（B305 不含 B20 子串）");
}

// ---------------------------------------------------------------------------
// g3 教师精确命中优先 + 全局精确隔离
// ---------------------------------------------------------------------------
function runGroup3TeacherExactPriority() {
  const exact = searchType("teacher", { q: "陈芳" });
  assert.strictEqual(exact.total, 1, "g3 全校精确命中只返回陈芳本人");
  assert.strictEqual(exact.items[0].teacherName, "陈芳", "g3 精确命中条目为陈芳（teacher 契约归一化字段）");
  assert.strictEqual(exact.decision.kind, "unique", "g3 精确唯一 → decision unique");

  const fuzzy = searchType("teacher", { q: "陈" });
  assert.strictEqual(fuzzy.total, 2, "g3 无精确命中时模糊返回陈芳+陈芳华");
  assert.strictEqual(fuzzy.decision.kind, "candidate", "g3 模糊多候选 → decision candidate");

  const isolated = searchType("teacher", { q: "陈芳", collegeCode: "07" });
  assert.strictEqual(isolated.total, 0, "g3 全局存在精确姓名时禁止模糊扩散到其他学院（陈芳 vs 陈芳华）");
  assert.strictEqual(isolated.decision.kind, "none", "g3 精确隔离后 decision none");
}

// ---------------------------------------------------------------------------
// g4 unique / candidate / none 三决策形态
// ---------------------------------------------------------------------------
function runGroup4DecisionShapes() {
  const unique = searchType("class", { q: "24动医1班" });
  assert.strictEqual(unique.decision.kind, "unique", "g4 class 唯一 → unique");
  assert.strictEqual(unique.decision.total, 1, "g4 unique total 1");
  assert.strictEqual(unique.decision.canOpen, true, "g4 unique 可直接打开");
  assert.strictEqual(unique.decision.detailId, "c-24dy1", "g4 unique detailId 来自条目真实 id");
  assert.strictEqual(unique.decision.navigation.path, contract.NAVIGATION.scheduleViewPath, "g4 unique 导航跳 schedule-view");
  assert.ok(unique.decision.navigation.url.includes("id=c-24dy1"), "g4 unique URL 含 detailId");
  assert.ok(unique.decision.navigation.url.includes(`releaseVersion=${RELEASE}`), "g4 unique URL 透传 releaseVersion");
  assert.strictEqual(unique.decision.item.className, "24动医1班", "g4 unique item 为命中条目");
  assert.strictEqual(unique.decision.candidates.length, 0, "g4 unique 无候选列表");

  const candidate = searchType("class", { q: "动医" });
  assert.strictEqual(candidate.decision.kind, "candidate", "g4 class 多候选 → candidate");
  assert.strictEqual(candidate.decision.total, 2, "g4 candidate total 2");
  assert.strictEqual(candidate.decision.candidates.length, 2, "g4 candidate 候选数 2");
  assert.strictEqual(candidate.decision.item, null, "g4 candidate 无单一 item");
  candidate.decision.candidates.forEach((c) => {
    assert.strictEqual(c.type, "class", "g4 candidate type 透传");
    assert.ok(c.detailId, "g4 candidate detailId 非空");
    assert.ok(Array.isArray(c.actions) && c.actions.length >= 1, "g4 candidate actions 非空");
  });

  const none = searchType("course", { q: "不存在xyz" });
  assert.strictEqual(none.decision.kind, "none", "g4 零命中 → none");
  assert.strictEqual(none.decision.total, 0, "g4 none total 0");
  assert.strictEqual(none.decision.canOpen, false, "g4 none 不可开");
  assert.strictEqual(none.decision.navigation, null, "g4 none 无导航");
  assert.deepStrictEqual(none.decision.candidates, [], "g4 none 候选为空");
  assert.deepStrictEqual(none.decision.actions, [], "g4 none 动作为空");
}

// ---------------------------------------------------------------------------
// g5 DECISION 常数确实消费于截断 + limit/offset 分页
// ---------------------------------------------------------------------------
function runGroup5DecisionTruncation() {
  const res = searchType("course", { q: "示例课程" });
  assert.strictEqual(res.total, 10, "g5 课程模糊命中 10 条");
  assert.strictEqual(res.items.length, 10, "g5 默认 limit 30 下载回 10 条");
  assert.strictEqual(res.decision.kind, "candidate", "g5 decision candidate");
  assert.strictEqual(
    res.decision.candidates.length,
    contract.DECISION.candidateListMax,
    "g5 候选列表必须被 DECISION.candidateListMax 截断"
  );
  assert.strictEqual(
    res.decision.candidates.length,
    contract.clampDecisionLimit("candidateListMax", 10),
    "g5 截断长度必须等于生成物 clampDecisionLimit 输出"
  );
  const directOpenCount = res.decision.candidates
    .filter((c) => c.actions.some((a) => a.name === "open_detail")).length;
  assert.strictEqual(
    directOpenCount,
    contract.DECISION.candidateOpenMax,
    "g5 直开动作数必须受 DECISION.candidateOpenMax 约束"
  );
  res.decision.candidates.forEach((c) => {
    assert.ok(
      c.actions.length <= contract.DECISION.actionCap,
      "g5 单候选动作数必须受 DECISION.actionCap 约束"
    );
  });
  // 超出 candidateOpenMax 的候选仍保留全校页动作，不带直开
  const tail = res.decision.candidates[contract.DECISION.candidateListMax - 1];
  assert.ok(
    tail.actions.every((a) => a.name === "open_school_page"),
    "g5 超出直开预算的候选只保留全校页动作"
  );

  const offline = service.search({
    type: "course", q: "示例课程", term: TERM, releaseVersion: RELEASE,
    offline: true, _items: COURSE_ITEMS,
  });
  assert.strictEqual(offline.offline, true, "g5 offline 标记透传响应");
  assert.strictEqual(
    offline.decision.candidates.length,
    contract.DECISION.offlineCandidateMax,
    "g5 offline 候选列表必须被 DECISION.offlineCandidateMax 截断"
  );

  const paged = searchType("course", { q: "示例课程", limit: 3, offset: 2 });
  assert.strictEqual(paged.items.length, 3, "g5 limit 3 只回 3 条");
  assert.strictEqual(paged.total, 10, "g5 分页不改变 total");
  assert.strictEqual(paged.limit, 3, "g5 limit 回显");
  assert.strictEqual(paged.offset, 2, "g5 offset 回显");
  assert.strictEqual(
    paged.decision.candidates.length,
    contract.clampDecisionLimit("candidateListMax", 3),
    "g5 分页页内候选同样经 candidateListMax 截断（页内 3 条全保留）"
  );
}

// ---------------------------------------------------------------------------
// g6 缺 detailId 兜底 reason code + 不伪造 detailId
// ---------------------------------------------------------------------------
function runGroup6NavigationFallback() {
  const noId = searchType("teacher", { q: "周示例" });
  assert.strictEqual(noId.decision.kind, "unique", "g6 无 id 教师唯一命中仍为 unique");
  assert.strictEqual(noId.decision.detailId, "", "g6 缺 id 时不得伪造 detailId");
  assert.strictEqual(noId.decision.canOpen, false, "g6 缺 id 不可直开");
  assert.strictEqual(
    noId.decision.navigation.reasonCode,
    contract.NAVIGATION_REASON_CODES.detailIdMissing,
    "g6 缺 detailId 兜底 reason code = DETAIL_ID_MISSING"
  );
  assert.strictEqual(
    noId.decision.navigation.path,
    contract.NAVIGATION.schoolPath,
    "g6 缺 detailId 兜底跳全校页"
  );
  assert.ok(noId.decision.navigation.url.includes("/pages/school/school"), "g6 兜底 URL 为全校页");
  assert.ok(noId.decision.navigation.url.includes("type=teacher"), "g6 兜底 URL 带 type");

  const noIdCandidate = searchType("classroom", { q: "B305" });
  assert.strictEqual(noIdCandidate.decision.kind, "unique", "g6 B305 唯一命中");
  assert.strictEqual(
    noIdCandidate.decision.navigation.reasonCode,
    contract.NAVIGATION_REASON_CODES.detailIdMissing,
    "g6 classroom 无 id 同样 DETAIL_ID_MISSING"
  );

  const missingVersion = service.buildItemNavigation(
    "teacher",
    { id: "t-chenfang", teacherName: "陈芳" },
    { q: "陈芳", term: TERM, releaseVersion: "" }
  );
  assert.strictEqual(
    missingVersion.reasonCode,
    contract.NAVIGATION_REASON_CODES.releaseVersionMissing,
    "g6 缺 releaseVersion 兜底 reason code = RELEASE_VERSION_MISSING"
  );
  assert.strictEqual(missingVersion.canOpen, false, "g6 缺 releaseVersion 不可直开");
  assert.strictEqual(missingVersion.path, contract.NAVIGATION.schoolPath, "g6 缺 releaseVersion 兜底跳全校页");
  assert.strictEqual(missingVersion.detailId, "t-chenfang", "g6 缺 version 时 detailId 如实保留不伪造");

  const direct = service.buildItemNavigation(
    "course",
    { id: "k-demo-01", courseName: "示例课程01" },
    { q: "示例课程01", term: TERM, releaseVersion: RELEASE }
  );
  assert.strictEqual(direct.canOpen, true, "g6 id+version 齐备可直开");
  assert.strictEqual(direct.reasonCode, "", "g6 直开无 reason code");
  assert.strictEqual(direct.path, contract.NAVIGATION.scheduleViewPath, "g6 直开跳 schedule-view");
}

// ---------------------------------------------------------------------------
// g7 契约版本字段 / responseFields 超集形态锁 / cacheKey / releaseVersion 透传
// ---------------------------------------------------------------------------
function runGroup7ContractShape() {
  const res = searchType("teacher", { q: "陈芳" });
  assert.strictEqual(res.contractVersion, "school-search.v1", "g7 contractVersion 锁定");
  assert.strictEqual(res.contractVersion, contract.CONTRACT_VERSION, "g7 contractVersion 来自生成物");
  assert.strictEqual(res.indexSchemaVersion, contract.INDEX_SCHEMA_VERSION, "g7 indexSchemaVersion 来自生成物");
  assert.strictEqual(
    res.teacherIndexSchemaVersion,
    contract.TEACHER_INDEX_SCHEMA_VERSION,
    "g7 teacher 响应 teacherIndexSchemaVersion 对齐生成物（teacher-search.v1 兼容链）"
  );
  assert.strictEqual(res.releaseVersion, RELEASE, "g7 releaseVersion 透传");
  assert.strictEqual(res.version, RELEASE, "g7 version 透传");
  assert.strictEqual(res.term, TERM, "g7 term 透传");

  contract.RESPONSE_FIELDS.forEach((field) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(res, field),
      `g7 响应必须含契约 responseField: ${field}`
    );
  });
  Object.keys(res).forEach((key) => {
    assert.ok(
      contract.isResponseField(key) || key === "decision",
      `g7 响应字段必须是 responseFields 超集（额外仅允许 decision）: ${key}`
    );
  });

  assert.ok(
    res.cacheKey.indexOf(`${contract.CACHE_NAMESPACE}:${contract.CONTRACT_VERSION}:`) === 0,
    "g7 cacheKey 必须以 CACHE_NAMESPACE + 契约版本开头"
  );
  assert.ok(res.cacheKey.includes(encodeURIComponent(RELEASE)), "g7 cacheKey 含 releaseVersion 命名空间段");
  const otherKey = searchType("teacher", { q: "陈芳", collegeCode: "04" }).cacheKey;
  assert.notStrictEqual(res.cacheKey, otherKey, "g7 不同过滤条件 cacheKey 必须区分");

  const courseRes = searchType("course", { q: "示例课程01" });
  assert.strictEqual(courseRes.contractVersion, contract.CONTRACT_VERSION, "g7 course contractVersion 一致");
  assert.strictEqual(courseRes.teacherIndexSchemaVersion, undefined, "g7 非 teacher 不自报 teacherIndexSchemaVersion");
}

// ---------------------------------------------------------------------------
// g8 非法 type 拒绝
// ---------------------------------------------------------------------------
function runGroup8InvalidTypeRejected() {
  const bad = service.search({ type: "student", q: "陈芳", term: TERM, releaseVersion: RELEASE, _items: TEACHER_ITEMS });
  assert.strictEqual(bad.success, false, "g8 非法 type success=false");
  assert.strictEqual(bad.code, "INVALID_TYPE", "g8 非法 type code=INVALID_TYPE");
  assert.strictEqual(bad.reasonCode, "INVALID_TYPE", "g8 非法 type reasonCode=INVALID_TYPE");
  assert.strictEqual(bad.type, "student", "g8 非法 type 原样回显便于排查");
  assert.strictEqual(bad.contractVersion, contract.CONTRACT_VERSION, "g8 拒绝响应仍带契约版本");
  assert.strictEqual(bad.total, 0, "g8 非法 type total 0");
  assert.deepStrictEqual(bad.items, [], "g8 非法 type items 空");
  assert.strictEqual(bad.decision.kind, "none", "g8 非法 type decision none");

  const missing = service.search({ q: "陈芳", term: TERM, _items: TEACHER_ITEMS });
  assert.strictEqual(missing.success, false, "g8 缺 type success=false（禁止默认 teacher）");
  assert.strictEqual(missing.code, "INVALID_TYPE", "g8 缺 type code=INVALID_TYPE");

  const weirdCase = searchType("teacher", { q: "陈芳" });
  assert.strictEqual(weirdCase.success, true, "g8 对照组正常");
  const upper = service.search({ type: "TEACHER", q: "陈芳", term: TERM, releaseVersion: RELEASE, _items: TEACHER_ITEMS });
  assert.strictEqual(upper.success, true, "g8 type 大小写归一化后接受");
  assert.strictEqual(upper.type, "teacher", "g8 type 归一化为小写");
}

// ---------------------------------------------------------------------------
// M3-T3 ②：HTTP 路由 GET /api/fosu/release-pack/search 行为
// 模式参照 test-fosu-search-index-contract.js（express + 127.0.0.1 临时端口 + fetch），
// fixture 经 service 单例 stub 注入（生产路由本身不接受 _items）。
// ---------------------------------------------------------------------------
function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function getJson(baseUrl, requestPath) {
  const response = await fetch(`${baseUrl}${requestPath}`);
  const data = await response.json();
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control") || "",
    data,
  };
}

/** 路由测试期把 fixture 注入进程内 service 单例；返回 restore 函数，finally 必须调用。 */
function stubServiceSearchWithFixtures() {
  const original = service.search;
  service.search = function (input, options) {
    const type = contract.normalizeEntityType(input && input.type);
    const items = type ? ITEMS_BY_TYPE[type] : null;
    // 非法/缺省 type 不注入：service 在触碰数据层前即拒绝（INVALID_TYPE），不会读磁盘索引
    return original(input, Object.assign({}, options, items ? { _items: items } : {}));
  };
  return function restore() {
    service.search = original;
  };
}

async function withSearchRouteServer(fn) {
  const restore = stubServiceSearchWithFixtures();
  const app = express();
  app.use("/api/fosu", fosuRouter);
  const server = await listen(app);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    restore();
  }
}

async function runGroup9HttpRouteBehavior() {
  // 静态断言：路由挂载与 release-pack 路由族同款 scheduleLimiter
  const fosuSource = fs.readFileSync(path.join(__dirname, "../server/src/routes/fosu.js"), "utf8");
  assert.ok(
    /router\.get\("\/release-pack\/search",\s*scheduleLimiter/.test(fosuSource),
    "g9 /release-pack/search 必须挂载 scheduleLimiter（与 release-pack 路由族一致）"
  );

  await withSearchRouteServer(async (baseUrl) => {
    // 合法 type：契约 responseFields 超集 + decision
    const ok = await getJson(baseUrl, `/api/fosu/release-pack/search?type=teacher&q=${encodeURIComponent("陈芳")}&term=${TERM}&releaseVersion=${RELEASE}`);
    assert.strictEqual(ok.status, 200, "g9 合法 type 状态 200");
    assert.strictEqual(ok.data.success, true, "g9 合法 type success");
    assert.strictEqual(ok.data.type, "teacher", "g9 type 回显");
    assert.strictEqual(ok.data.contractVersion, contract.CONTRACT_VERSION, "g9 contractVersion 锁定");
    assert.strictEqual(ok.data.decision.kind, "unique", "g9 陈芳精确唯一 → decision unique");
    assert.strictEqual(ok.data.decision.detailId, "t-chenfang", "g9 decision detailId 来自条目真实 id");
    contract.RESPONSE_FIELDS.forEach((field) => {
      assert.ok(
        Object.prototype.hasOwnProperty.call(ok.data, field),
        `g9 HTTP 响应必须含契约 responseField: ${field}`
      );
    });
    assert.ok(ok.cacheControl.includes("public"), "g9 带 releaseVersion 走 release-pack 路由族缓存策略");

    // 不带 releaseVersion：no-store（与 /release-pack/index/:type 无版本行为一致）
    const noVersion = await getJson(baseUrl, `/api/fosu/release-pack/search?type=class&q=${encodeURIComponent("动医")}&term=${TERM}`);
    assert.strictEqual(noVersion.status, 200, "g9 无版本状态 200");
    assert.ok(noVersion.cacheControl.includes("no-store"), "g9 无 releaseVersion 必须 no-store");
    assert.strictEqual(noVersion.data.decision.kind, "candidate", "g9 动医多候选 → candidate");

    // 别名归一化：keyword/semester/version 由契约层归一化
    const alias = await getJson(baseUrl, `/api/fosu/release-pack/search?type=course&keyword=${encodeURIComponent("示例课程01")}&semester=${TERM}&version=${RELEASE}`);
    assert.strictEqual(alias.status, 200, "g9 别名查询状态 200");
    assert.strictEqual(alias.data.success, true, "g9 别名 keyword success");
    assert.strictEqual(alias.data.query, "示例课程01", "g9 keyword 别名归一化为 q");
    assert.strictEqual(alias.data.decision.kind, "unique", "g9 别名查询 unique");

    // 非法 type：与 release-pack 路由族一致 400 + 契约拒绝体
    const bad = await getJson(baseUrl, `/api/fosu/release-pack/search?type=student&q=x&term=${TERM}&releaseVersion=${RELEASE}`);
    assert.strictEqual(bad.status, 400, "g9 非法 type 状态 400");
    assert.strictEqual(bad.data.success, false, "g9 非法 type success=false");
    assert.strictEqual(bad.data.code, "INVALID_TYPE", "g9 非法 type code=INVALID_TYPE");
    assert.strictEqual(bad.data.contractVersion, contract.CONTRACT_VERSION, "g9 拒绝体仍带契约版本");
    assert.strictEqual(bad.data.decision.kind, "none", "g9 非法 type decision none");

    // 缺 type：同样拒绝（禁止默认 teacher）
    const missing = await getJson(baseUrl, `/api/fosu/release-pack/search?q=x&term=${TERM}`);
    assert.strictEqual(missing.status, 400, "g9 缺 type 状态 400");
    assert.strictEqual(missing.data.code, "INVALID_TYPE", "g9 缺 type code=INVALID_TYPE");

    // 零命中：搜索本身成功 + decision none
    const none = await getJson(baseUrl, `/api/fosu/release-pack/search?type=teacher&q=${encodeURIComponent("不存在xyz")}&term=${TERM}&releaseVersion=${RELEASE}`);
    assert.strictEqual(none.status, 200, "g9 零命中状态 200");
    assert.strictEqual(none.data.success, true, "g9 零命中 success true（空结果是成功搜索）");
    assert.strictEqual(none.data.decision.kind, "none", "g9 零命中 decision none");
  });
}

// ---------------------------------------------------------------------------
// M3-T3 ③：Agent search_school_index ↔ HTTP 路由 同查询同结果一致性
// 同一 fixture _items 注入下：工具输出 items/decision 与 service 深度一致；
// HTTP 响应与 service 输出的 JSON 序列化形态深度一致。
// ---------------------------------------------------------------------------
async function runGroup10AgentHttpParity() {
  const cases = [
    { type: "teacher", q: "陈芳", expectKind: "unique" },
    { type: "class", q: "动医", expectKind: "candidate" },
    { type: "classroom", q: "B201", expectKind: "unique" },
    // 10 条命中：显式 limit=30 拉齐工具页大小，断言全量一致
    { type: "course", q: "示例课程", expectKind: "candidate", limit: 30 },
  ];

  // 工具默认列表上限必须消费生成物 DECISION.candidateListMax（兼容：total 保持页内长度语义）
  const capped = toolRegistry.executeTool("search_school_index", {
    type: "course", q: "示例课程", term: TERM, releaseVersion: RELEASE, _items: COURSE_ITEMS,
  }, {});
  assert.strictEqual(capped.success, true, "g10 工具默认分页 success");
  assert.strictEqual(capped.items.length, contract.DECISION.candidateListMax, "g10 工具默认 items 上限 = DECISION.candidateListMax");
  assert.strictEqual(capped.total, contract.DECISION.candidateListMax, "g10 工具 total 保持切换前页内长度语义（兼容锁）");

  for (const testCase of cases) {
    const fixtureItems = ITEMS_BY_TYPE[testCase.type];
    const serviceResult = service.search({
      type: testCase.type,
      q: testCase.q,
      term: TERM,
      releaseVersion: RELEASE,
      limit: testCase.limit || 30,
      _items: fixtureItems,
    });
    const toolResult = toolRegistry.executeTool("search_school_index", {
      type: testCase.type,
      q: testCase.q,
      term: TERM,
      releaseVersion: RELEASE,
      limit: testCase.limit,
      _items: fixtureItems,
    }, {});
    assert.strictEqual(toolResult.success, true, `g10 ${testCase.type} 工具 success`);
    assert.strictEqual(toolResult.type, testCase.type, `g10 ${testCase.type} 工具 type 回显`);
    assert.strictEqual(toolResult.contractVersion, contract.CONTRACT_VERSION, `g10 ${testCase.type} 工具透传 contractVersion`);
    assert.strictEqual(toolResult.decision.kind, testCase.expectKind, `g10 ${testCase.type} 工具 decision kind`);
    assert.deepStrictEqual(toolResult.items, serviceResult.items, `g10 ${testCase.type} 工具 items 与 service 深度一致`);
    assert.deepStrictEqual(toolResult.decision, serviceResult.decision, `g10 ${testCase.type} 工具 decision 与 service 深度一致`);
  }

  await withSearchRouteServer(async (baseUrl) => {
    for (const testCase of cases) {
      const serviceResult = service.search({
        type: testCase.type,
        q: testCase.q,
        term: TERM,
        releaseVersion: RELEASE,
        limit: testCase.limit || 30,
      });
      const query = [
        `type=${testCase.type}`,
        `q=${encodeURIComponent(testCase.q)}`,
        `term=${TERM}`,
        `releaseVersion=${RELEASE}`,
      ];
      if (testCase.limit) query.push(`limit=${testCase.limit}`);
      const http = await getJson(baseUrl, `/api/fosu/release-pack/search?${query.join("&")}`);
      assert.strictEqual(http.status, 200, `g10 ${testCase.type} HTTP 状态 200`);
      assert.deepStrictEqual(
        http.data,
        JSON.parse(JSON.stringify(serviceResult)),
        `g10 ${testCase.type} HTTP 响应与 service 输出 JSON 深度一致（含 items/decision/cacheKey）`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// M3-T4 ④：全校页客户端切换服务端搜索 + 本地缓存降级（mock wx 环境）
// 模式同 tools/test-school-*.js：先 require mock-env 挂 global.wx/Page/App，
// 再加载小程序模块；全程无真实网络，wx.request 由 mockRequest 接管。
// ---------------------------------------------------------------------------
let miniEnv = null;

function ensureMiniProgramEnv() {
  if (miniEnv) return miniEnv;
  const mockEnv = require("./mock-env");
  const releasePackServiceMini = require("../miniprogram/services/releasePackService");
  const miniContract = require("../miniprogram/shared/schoolSearchContract.generated");
  require("../miniprogram/pages/school/school.js");
  miniEnv = { mockEnv, releasePackServiceMini, miniContract };
  return miniEnv;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seedIndexCache(env, type, items, extra) {
  const payload = Object.assign({
    success: true,
    term: TERM,
    releaseVersion: RELEASE,
    updatedAt: "2026-06-01T00:00:00.000Z",
    items,
  }, extra || {});
  env.mockEnv.storage.set(
    env.releasePackServiceMini.getIndexCacheKey(TERM, RELEASE, type),
    { savedAt: Date.now(), data: payload }
  );
}

function mockRequestFailDisconnected() {
  global.wx.mockRequest = (options) => {
    setTimeout(() => options.fail({ errMsg: "request:fail disconnected" }), 1);
  };
}

// ---------------------------------------------------------------------------
// g11 在线响应透传 + 非法形态/非法 type 拒绝
// ---------------------------------------------------------------------------
async function runGroup11ClientOnlinePassthrough() {
  const env = ensureMiniProgramEnv();
  const { releasePackServiceMini, miniContract } = env;
  env.mockEnv.clearStorage();
  releasePackServiceMini.__resetForTest();

  const payload = {
    success: true,
    type: "teacher",
    contractVersion: miniContract.CONTRACT_VERSION,
    term: TERM,
    semester: TERM,
    releaseVersion: RELEASE,
    version: RELEASE,
    query: "陈芳",
    total: 1,
    limit: 30,
    offset: 0,
    items: [TEACHER_ITEMS[0]],
    decision: {
      kind: "unique",
      total: 1,
      item: TEACHER_ITEMS[0],
      detailId: "t-chenfang",
      canOpen: true,
      navigation: {
        detailId: "t-chenfang",
        name: "陈芳",
        canOpen: true,
        reasonCode: "",
        path: miniContract.NAVIGATION.scheduleViewPath,
        url: `/pages/schedule-view/schedule-view?type=teacher&id=t-chenfang&releaseVersion=${RELEASE}`,
      },
      candidates: [],
      actions: [{ name: "open_detail", url: "/pages/schedule-view/schedule-view?type=teacher&id=t-chenfang", detailId: "t-chenfang" }],
    },
  };
  let captured = null;
  global.wx.mockRequest = (options) => {
    captured = { url: options.url, data: options.data };
    setTimeout(() => options.success({ statusCode: 200, data: payload }), 1);
  };

  const res = await releasePackServiceMini.searchSchoolContract("teacher", { q: "陈芳", term: TERM, releaseVersion: RELEASE });
  assert.deepStrictEqual(res, payload, "g11 在线契约响应必须原样透传（客户端不重建 items/decision）");
  assert.ok(captured, "g11 必须发出在线请求");
  assert.ok(captured.url.includes("/api/fosu/release-pack/search"), "g11 必须命中统一搜索端点 /release-pack/search");
  assert.ok(!captured.url.includes("/api/fosu/search-index"), "g11 不得再走旧 /search-index 端点");
  assert.strictEqual(captured.data.type, "teacher", "g11 type 透传");
  assert.strictEqual(captured.data.q, "陈芳", "g11 q 透传");
  assert.strictEqual(captured.data.term, TERM, "g11 term 透传");
  assert.strictEqual(captured.data.releaseVersion, RELEASE, "g11 releaseVersion 透传");

  // 在线响应形态非法（缺 decision/契约版本不符）：不得冒充在线，转入降级链（无缓存 → 抛错）
  global.wx.mockRequest = (options) => {
    setTimeout(() => options.success({ statusCode: 200, data: { success: true } }), 1);
  };
  await assert.rejects(
    releasePackServiceMini.searchSchoolContract("teacher", { q: "陈芳", term: TERM, releaseVersion: RELEASE }),
    (error) => error && error.code === "INVALID_CONTRACT_RESPONSE",
    "g11 无 decision 的响应必须视为非法并进入降级链（无本地缓存时抛出 INVALID_CONTRACT_RESPONSE）"
  );

  // 非法 type：直接拒绝且不发网络
  let networkCalled = false;
  global.wx.mockRequest = () => { networkCalled = true; };
  await assert.rejects(
    releasePackServiceMini.searchSchoolContract("student", { q: "陈芳", term: TERM, releaseVersion: RELEASE }),
    (error) => error && error.code === "INVALID_TYPE",
    "g11 非法 type 必须拒绝"
  );
  assert.strictEqual(networkCalled, false, "g11 非法 type 不得发出网络请求");
}

// ---------------------------------------------------------------------------
// g12 失败/断网回退 local_cache + 降级标识为真
// ---------------------------------------------------------------------------
async function runGroup12ClientLocalFallbackDegraded() {
  const env = ensureMiniProgramEnv();
  const { releasePackServiceMini, miniContract } = env;
  env.mockEnv.clearStorage();
  releasePackServiceMini.__resetForTest();
  seedIndexCache(env, "teacher", TEACHER_ITEMS);
  mockRequestFailDisconnected();

  const res = await releasePackServiceMini.searchSchoolContract("teacher", { q: "陈芳", term: TERM, releaseVersion: RELEASE });
  assert.strictEqual(res.success, true, "g12 降级响应 success（本地缓存兜底可用）");
  assert.strictEqual(res.contractVersion, "local-fallback", "g12 降级响应 contractVersion 必须是真实标识 local-fallback");
  assert.strictEqual(res.contractVersion, releasePackServiceMini.LOCAL_FALLBACK_CONTRACT_VERSION, "g12 local-fallback 标识来自服务层导出常数");
  assert.notStrictEqual(res.contractVersion, miniContract.CONTRACT_VERSION, "g12 降级响应不得冒充服务端契约版本");
  assert.strictEqual(res.degraded, true, "g12 degraded=true");
  assert.strictEqual(res.source, "local_cache", "g12 source=local_cache");
  assert.strictEqual(res.stale, true, "g12 stale=true");
  assert.strictEqual(res.offline, true, "g12 offline=true");
  assert.strictEqual(res.fromStorage, true, "g12 fromStorage=true");
  assert.strictEqual(res.searchFallback, true, "g12 searchFallback=true");
  assert.strictEqual(res.releaseVersion, RELEASE, "g12 releaseVersion 透传");
  assert.strictEqual(res.term, TERM, "g12 term 透传");
  assert.strictEqual(res.cachedAt, "2026-06-01T00:00:00.000Z", "g12 cachedAt 来自缓存数据时间");
  assert.ok(res.fallbackReason, "g12 fallbackReason 非空");

  // 本地决策：精确命中唯一 → unique 可直开 schedule-view
  assert.strictEqual(res.decision.kind, "unique", "g12 精确唯一 → decision unique");
  assert.strictEqual(res.decision.detailId, "t-chenfang", "g12 detailId 来自缓存条目真实 id");
  assert.strictEqual(res.decision.canOpen, true, "g12 本地决策可直开");
  assert.strictEqual(res.decision.navigation.path, miniContract.NAVIGATION.scheduleViewPath, "g12 直开跳 schedule-view");
  assert.ok(res.decision.navigation.url.includes("id=t-chenfang"), "g12 URL 含 detailId");
  assert.ok(res.decision.navigation.url.includes(`releaseVersion=${RELEASE}`), "g12 URL 透传 releaseVersion");

  // 降级链同样保持全局精确隔离（陈芳 vs 陈芳华，学院过滤正确为空）
  const isolated = await releasePackServiceMini.searchSchoolContract("teacher", { q: "陈芳", collegeCode: "07", term: TERM, releaseVersion: RELEASE });
  assert.strictEqual(isolated.degraded, true, "g12 隔离查询同样走降级标识");
  assert.strictEqual(isolated.total, 0, "g12 降级链全局精确隔离（学院 07 不得模糊扩散出陈芳华）");
  assert.strictEqual(isolated.decision.kind, "none", "g12 隔离零命中 → decision none");

  // 红例：本地缓存索引也不存在 → 抛原始网络错误，不得伪造空结果冒充在线
  env.mockEnv.clearStorage();
  await assert.rejects(
    releasePackServiceMini.searchSchoolContract("teacher", { q: "陈芳", term: TERM, releaseVersion: RELEASE }),
    (error) => error && typeof error.code === "string" && error.code.length > 0 && error.code !== "INVALID_CONTRACT_RESPONSE",
    "g12 无任何本地缓存时必须抛出原始网络错误"
  );
}

// ---------------------------------------------------------------------------
// g13 离线 candidateListMax=offlineCandidateMax + 本地决策不伪造 detailId
// ---------------------------------------------------------------------------
async function runGroup13ClientOfflineCandidateCap() {
  const env = ensureMiniProgramEnv();
  const { releasePackServiceMini, miniContract } = env;
  env.mockEnv.clearStorage();
  releasePackServiceMini.__resetForTest();
  seedIndexCache(env, "course", COURSE_ITEMS);
  seedIndexCache(env, "classroom", [{ roomName: "B305", name: "B305", campus: "仙溪", semester: TERM }]);
  mockRequestFailDisconnected();

  const res = await releasePackServiceMini.searchSchoolContract("course", { q: "示例课程", term: TERM, releaseVersion: RELEASE, limit: 30 });
  assert.strictEqual(res.degraded, true, "g13 降级标识");
  assert.strictEqual(res.total, 10, "g13 课程模糊命中 10 条");
  assert.strictEqual(res.decision.kind, "candidate", "g13 多候选 → candidate");
  assert.strictEqual(
    res.decision.candidates.length,
    miniContract.DECISION.offlineCandidateMax,
    "g13 离线候选列表必须被 DECISION.offlineCandidateMax 截断（而非在线 candidateListMax）"
  );
  assert.strictEqual(
    res.decision.candidates.length,
    miniContract.clampDecisionLimit("offlineCandidateMax", 10),
    "g13 截断长度必须等于生成物 clampDecisionLimit 输出"
  );
  const directOpenCount = res.decision.candidates
    .filter((c) => c.actions.some((a) => a.name === "open_detail")).length;
  assert.strictEqual(directOpenCount, miniContract.DECISION.candidateOpenMax, "g13 离线直开预算同样受 candidateOpenMax 约束");

  // 缺 detailId：本地决策不伪造，按 reason code 兜底跳全校页
  const noId = await releasePackServiceMini.searchSchoolContract("classroom", { q: "B305", term: TERM, releaseVersion: RELEASE });
  assert.strictEqual(noId.decision.kind, "unique", "g13 B305 唯一命中");
  assert.strictEqual(noId.decision.detailId, "", "g13 缺 id 时不得伪造 detailId");
  assert.strictEqual(noId.decision.canOpen, false, "g13 缺 id 不可直开");
  assert.strictEqual(
    noId.decision.navigation.reasonCode,
    miniContract.NAVIGATION_REASON_CODES.detailIdMissing,
    "g13 缺 detailId 兜底 reason code = DETAIL_ID_MISSING"
  );
  assert.strictEqual(noId.decision.navigation.path, miniContract.NAVIGATION.schoolPath, "g13 缺 detailId 兜底跳全校页");
}

// ---------------------------------------------------------------------------
// g14 school.js 决策消费：唯一直开 / 多候选定位 / 缺 detailId 兜底 / 降级徽标
// ---------------------------------------------------------------------------
async function runGroup14SchoolPageDecisionConsumption() {
  const env = ensureMiniProgramEnv();
  const { releasePackServiceMini, miniContract } = env;
  env.mockEnv.clearStorage();
  releasePackServiceMini.__resetForTest();

  const page = env.mockEnv.createPageInstance();
  page._schoolRequestSeq = 0;
  page.setData({
    activeSnapshot: { term: TERM, releaseVersion: RELEASE },
    catalogVersion: RELEASE,
    semesters: [{ label: TERM, value: TERM }],
    selectedSemesterIndex: 0,
    recentSchedules: [{ type: "teacher", name: "陈芳", teacherName: "陈芳", releaseVersion: "rel-old", semester: TERM }],
  });
  let opened = null;
  let modal = null;
  page.openIndexedSchedule = function (type, item, displayName) {
    opened = { type, item, displayName };
  };
  global.wx.onModal = (opt) => { modal = opt; };

  // a) 唯一结果直开：统一端点 unique decision → openIndexedSchedule（schedule-view 链）
  let captured = null;
  global.wx.mockRequest = (options) => {
    captured = { url: options.url, data: options.data };
    setTimeout(() => options.success({
      statusCode: 200,
      data: {
        success: true,
        type: "teacher",
        contractVersion: miniContract.CONTRACT_VERSION,
        term: TERM,
        releaseVersion: RELEASE,
        query: "陈芳",
        total: 1,
        limit: miniContract.DECISION.candidateListMax,
        offset: 0,
        items: [TEACHER_ITEMS[0]],
        decision: {
          kind: "unique",
          total: 1,
          item: TEACHER_ITEMS[0],
          detailId: "t-chenfang",
          canOpen: true,
          navigation: {
            detailId: "t-chenfang", name: "陈芳", canOpen: true, reasonCode: "",
            path: miniContract.NAVIGATION.scheduleViewPath,
            url: `/pages/schedule-view/schedule-view?type=teacher&id=t-chenfang&releaseVersion=${RELEASE}`,
          },
          candidates: [],
          actions: [{ name: "open_detail", url: "/pages/schedule-view/schedule-view?type=teacher&id=t-chenfang", detailId: "t-chenfang" }],
        },
      },
    }), 1);
  };
  page.goRecentSchedule({ currentTarget: { dataset: { index: 0 } } });
  await sleep(80);
  assert.ok(captured && captured.url.includes("/api/fosu/release-pack/search"), "g14a 旧版重校验必须走统一搜索端点");
  assert.strictEqual(captured.data.limit, miniContract.DECISION.candidateListMax, "g14a 页面查询 limit 必须消费 DECISION.candidateListMax");
  assert.ok(opened, "g14a 唯一命中必须直开（openIndexedSchedule）");
  assert.strictEqual(opened.item.detailId, "t-chenfang", "g14a 直开 detailId 来自 decision");
  assert.strictEqual(opened.displayName, "陈芳", "g14a 直开展示名");
  assert.strictEqual(modal, null, "g14a 唯一命中不得弹兜底提示");

  // b) 多候选：按契约候选列表（candidates）归一化名定位同名项
  opened = null;
  modal = null;
  global.wx.mockRequest = (options) => {
    setTimeout(() => options.success({
      statusCode: 200,
      data: {
        success: true,
        type: "teacher",
        contractVersion: miniContract.CONTRACT_VERSION,
        term: TERM,
        releaseVersion: RELEASE,
        query: "陈芳",
        total: 2,
        limit: miniContract.DECISION.candidateListMax,
        offset: 0,
        items: [TEACHER_ITEMS[0], TEACHER_ITEMS[1]],
        decision: {
          kind: "candidate",
          total: 2,
          item: null,
          detailId: "",
          canOpen: false,
          navigation: null,
          candidates: [
            { type: "teacher", detailId: "t-chenfang", name: "陈芳", canOpen: true, reasonCode: "", navigation: null, item: TEACHER_ITEMS[0], actions: [] },
            { type: "teacher", detailId: "t-chenfanghua", name: "陈芳华", canOpen: true, reasonCode: "", navigation: null, item: TEACHER_ITEMS[1], actions: [] },
          ],
          actions: [],
        },
      },
    }), 1);
  };
  page.goRecentSchedule({ currentTarget: { dataset: { index: 0 } } });
  await sleep(80);
  assert.ok(opened, "g14b 多候选同名项必须直开");
  assert.strictEqual(opened.item.detailId, "t-chenfang", "g14b 按契约候选名定位「陈芳」而非本地多字段谓词");
  assert.strictEqual(modal, null, "g14b 命中候选不得弹兜底提示");

  // c) detailId 缺失：契约 reason code 兜底留全校页（不直开、弹提示）
  opened = null;
  modal = null;
  global.wx.mockRequest = (options) => {
    setTimeout(() => options.success({
      statusCode: 200,
      data: {
        success: true,
        type: "teacher",
        contractVersion: miniContract.CONTRACT_VERSION,
        term: TERM,
        releaseVersion: RELEASE,
        query: "周示例",
        total: 1,
        limit: miniContract.DECISION.candidateListMax,
        offset: 0,
        items: [TEACHER_ITEMS[3]],
        decision: {
          kind: "unique",
          total: 1,
          item: TEACHER_ITEMS[3],
          detailId: "",
          canOpen: false,
          navigation: {
            detailId: "", name: "周示例", canOpen: false,
            reasonCode: miniContract.NAVIGATION_REASON_CODES.detailIdMissing,
            path: miniContract.NAVIGATION.schoolPath,
            url: "/pages/school/school?type=teacher&q=%E5%91%A8%E7%A4%BA%E4%BE%8B",
          },
          candidates: [],
          actions: [{ name: "open_school_page", url: "/pages/school/school?type=teacher&q=%E5%91%A8%E7%A4%BA%E4%BE%8B" }],
        },
      },
    }), 1);
  };
  page.setData({
    recentSchedules: [{ type: "teacher", name: "周示例", teacherName: "周示例", releaseVersion: "rel-old", semester: TERM }],
  });
  page.goRecentSchedule({ currentTarget: { dataset: { index: 0 } } });
  await sleep(80);
  assert.strictEqual(opened, null, "g14c 缺 detailId 不得直开");
  assert.ok(modal, "g14c 缺 detailId 按 reason code 兜底留在全校页（弹提示）");

  // d) 降级徽标：服务端断网 + 本地缓存索引空命中（teacher+college 不信任空缓存链），
  //    页面必须照常渲染降级结果并给出可辨识缓存标识，不得进入错误态
  env.mockEnv.clearStorage();
  releasePackServiceMini.__resetForTest();
  seedIndexCache(env, "teacher", TEACHER_ITEMS);
  mockRequestFailDisconnected();
  const page2 = env.mockEnv.createPageInstance();
  page2._schoolRequestSeq = 0;
  page2.setData({
    activeSnapshot: { term: TERM, releaseVersion: RELEASE },
    catalogVersion: RELEASE,
    semesters: [{ label: TERM, value: TERM }],
    selectedSemesterIndex: 0,
  });
  let rendered = null;
  let caught = null;
  page2.executeSearch("teacher", { q: "陈芳", collegeCode: "07", term: TERM, releaseVersion: RELEASE }, (data) => {
    rendered = data;
  }, (error) => {
    caught = error;
  });
  await sleep(120);
  assert.ok(rendered, "g14d 降级响应必须照常渲染（全校页保持可用）");
  assert.strictEqual(rendered.degraded, true, "g14d degraded=true 透传页面");
  assert.strictEqual(rendered.source, "local_cache", "g14d source=local_cache 透传页面");
  assert.strictEqual(rendered.contractVersion, "local-fallback", "g14d 降级响应不得冒充在线契约版本");
  assert.strictEqual(caught, null, "g14d 有本地缓存兜底时不得进入 catchFn 错误态");
  assert.strictEqual(page2.data.loadingState, "none", "g14d 降级渲染后 loadingState=none");
  assert.ok(String(page2.data.restoreHint || "").includes("缓存"), "g14d 降级响应必须有可辨识缓存标识（restoreHint）");
}

// ---------------------------------------------------------------------------
// M3-T5 ⑤：classroomSearch 单源切换 + schedule-view URL 构建统一
// 纯 Node 静态 + 纯函数断言，不触碰 wx/网络/磁盘数据。
// ---------------------------------------------------------------------------
function runGroup15ClassroomSingleSourceAndUrlUnified() {
  const rootDir = path.join(__dirname, "..");

  // -- classroomSearch 单源：壳 ↔ 本侧生成物引用直通 + 导出形态跨端一致 --
  const serverShell = require("../server/src/services/ai/classroomSearch");
  const miniShell = require("../miniprogram/utils/classroomSearch");
  const serverGen = require("../server/src/shared/classroomSearch.generated");
  const miniGen = require("../miniprogram/shared/classroomSearch.generated");
  assert.strictEqual(serverShell, serverGen, "g15 server 壳必须原样 re-export 本侧生成物（同一引用）");
  assert.strictEqual(miniShell, miniGen, "g15 mini 壳必须原样 re-export 本侧生成物（同一引用）");
  const exportKeys = ["filterAndSortClassrooms", "getBuildingCode", "naturalRoomCompare", "normalizeRoomText", "parseClassroomQuery"];
  assert.deepStrictEqual(Object.keys(serverShell).sort(), exportKeys.slice().sort(), "g15 server 导出形态锁（五函数）");
  assert.deepStrictEqual(Object.keys(miniShell).sort(), exportKeys.slice().sort(), "g15 mini 导出形态锁（五函数）");
  exportKeys.forEach((key) => {
    assert.strictEqual(serverShell[key].toString(), miniShell[key].toString(), `g15 跨端函数源码一致: ${key}`);
  });

  // 正本 → 生成物：头部基准注释指向 shared/classroomSearch.source.js，正文逐字节等于正本
  const sourceText = fs.readFileSync(path.join(rootDir, "shared/classroomSearch.source.js"), "utf8");
  ["server/src/shared/classroomSearch.generated.js", "miniprogram/shared/classroomSearch.generated.js"].forEach((rel) => {
    const text = fs.readFileSync(path.join(rootDir, rel), "utf8");
    assert.ok(text.startsWith("// Generated from shared/classroomSearch.source.js."), `g15 生成物头部基准指向正本: ${rel}`);
    assert.ok(text.endsWith(sourceText), `g15 生成物正文 = 正本逐字节: ${rel}`);
  });
  // 壳静态断言：不再含 173 行实现，仅指向生成物并标明正本
  ["server/src/services/ai/classroomSearch.js", "miniprogram/utils/classroomSearch.js"].forEach((rel) => {
    const text = fs.readFileSync(path.join(rootDir, rel), "utf8");
    assert.ok(!/function parseClassroomQuery/.test(text), `g15 壳不再含独立实现: ${rel}`);
    assert.ok(text.includes("classroomSearch.generated"), `g15 壳指向本侧生成物: ${rel}`);
    assert.ok(text.includes("shared/classroomSearch.source.js"), `g15 壳头部标明正本: ${rel}`);
  });
  // 行为 battery：字面量期望锁语义（独立于实现位置）
  assert.deepStrictEqual(
    miniShell.parseClassroomQuery("C7楼"),
    { queryType: "building", buildingCode: "C7", roomNumber: "", normalizedQuery: "C7" },
    "g15 parseClassroomQuery building 语义"
  );
  assert.deepStrictEqual(
    serverShell.parseClassroomQuery("C7－305"),
    { queryType: "exact-room", buildingCode: "C7", roomNumber: "305", normalizedQuery: "C7-305" },
    "g15 parseClassroomQuery exact-room 语义"
  );
  const naturalSorted = miniShell.filterAndSortClassrooms(
    [{ roomName: "C7-10" }, { roomName: "C7-2" }, { roomName: "C7-101" }],
    miniShell.parseClassroomQuery("C7")
  ).map((item) => item.roomName);
  assert.deepStrictEqual(naturalSorted, ["C7-2", "C7-10", "C7-101"], "g15 自然序排序语义");

  // -- schedule-view URL 构建统一 --
  const miniContract = require("../miniprogram/shared/schoolSearchContract.generated");
  const scheduleNavigator = require("../miniprogram/services/scheduleNavigator");
  const scheduleNavigationService = require("../miniprogram/services/scheduleNavigationService");

  // 静态断言：scheduleNavigator 不再含独立 URL 构建实现（无硬编码路径、委托 service）；
  // scheduleNavigationService 为唯一实现且消费契约 NAVIGATION 常数
  const navigatorText = fs.readFileSync(path.join(rootDir, "miniprogram/services/scheduleNavigator.js"), "utf8");
  assert.ok(
    !navigatorText.includes("/pages/schedule-view/schedule-view"),
    "g15 scheduleNavigator 不得再硬编码 schedule-view 路径（独立实现已移除）"
  );
  assert.ok(
    /require\("\.\/scheduleNavigationService"\)/.test(navigatorText),
    "g15 scheduleNavigator.buildScheduleViewUrl 必须委托 scheduleNavigationService"
  );
  const serviceNavText = fs.readFileSync(path.join(rootDir, "miniprogram/services/scheduleNavigationService.js"), "utf8");
  assert.ok(
    !/scheduleNavigator\.buildScheduleViewUrl\s*\(/.test(serviceNavText),
    "g15 scheduleNavigationService 不得再向下委托 navigator（唯一实现在本文件）"
  );
  assert.ok(
    /shared\/schoolSearchContract\.generated/.test(serviceNavText),
    "g15 scheduleNavigationService 必须消费契约生成物"
  );
  assert.ok(
    /NAVIGATION\.scheduleViewPath/.test(serviceNavText),
    "g15 schedule-view URL 路径必须取自契约 NAVIGATION.scheduleViewPath"
  );

  // 双调用方输出一致 + 契约路径前缀 + 不携带 courses
  const urlCases = [
    { type: "teacher", id: "t-chenfang", name: "陈芳", term: TERM, releaseVersion: RELEASE },
    { type: "class", id: "c-24dy1", name: "24动医1班", term: TERM, releaseVersion: RELEASE },
    { type: "classroom", id: "r-b201", name: "B201", term: TERM, releaseVersion: RELEASE },
    { type: "course", id: "k-demo-01", name: "示例课程01", term: TERM, releaseVersion: RELEASE },
    { targetType: "room", targetName: "B305", scheduleId: "r-b305", semester: TERM, version: "v1" },
    { type: "class", id: "c-1", name: "聚合班", term: TERM, releaseVersion: RELEASE, displayType: "aggregate", isAggregated: true },
    { type: "course", name: "示例课程02", term: TERM, releaseVersion: RELEASE }, // 缺 id 回退 name
    {},
  ];
  urlCases.forEach((input, index) => {
    const viaNavigator = scheduleNavigator.buildScheduleViewUrl(input);
    const viaService = scheduleNavigationService.buildScheduleViewUrl(input);
    assert.strictEqual(viaNavigator, viaService, `g15 双调用方（navigator 壳 ≡ service 正本）输出一致 #${index}`);
    assert.ok(
      viaService.indexOf(`${miniContract.NAVIGATION.scheduleViewPath}?`) === 0 || viaService === miniContract.NAVIGATION.scheduleViewPath,
      `g15 URL 前缀必须等于契约 NAVIGATION.scheduleViewPath #${index}`
    );
    assert.ok(!/courses=/.test(viaService), `g15 URL 不得携带 courses #${index}`);
  });

  // week/weekday 透传回归锁（scheduleAssistantService 周次卡片既有字段集）
  const weekUrl = scheduleNavigator.buildScheduleViewUrl({
    type: "teacher", name: "陈芳", keyword: "陈芳", term: TERM, releaseVersion: RELEASE, week: 3, weekday: 2,
  });
  assert.ok(/week=3/.test(weekUrl) && /weekday=2/.test(weekUrl), "g15 week/weekday 必须透传进 URL（assistantService 形态）");
  assert.ok(/id=%E9%99%88%E8%8A%B3/.test(weekUrl), "g15 缺 id 回退 name（assistantService 形态）");

  // 兜底 reason code 语义不变且消费契约常数（DETAIL_ID_MISSING → 跳全校页）
  const missingId = scheduleNavigationService.resolveScheduleNavigation({
    type: "teacher", name: "周示例", term: TERM, releaseVersion: RELEASE,
  });
  assert.strictEqual(missingId.mode, "school", "g15 缺 detailId 兜底跳全校页");
  assert.strictEqual(missingId.reasonCode, miniContract.NAVIGATION_REASON_CODES.detailIdMissing, "g15 reasonCode 消费契约 NAVIGATION_REASON_CODES.detailIdMissing");
  assert.strictEqual(missingId.reasonCode, "DETAIL_ID_MISSING", "g15 DETAIL_ID_MISSING 字面值语义不变");
  assert.ok(missingId.url.indexOf(miniContract.NAVIGATION.schoolPath) === 0, "g15 兜底 URL 前缀=契约 schoolPath");
  const missingVersion = scheduleNavigationService.resolveScheduleNavigation({
    type: "teacher", id: "t-1", name: "陈芳", term: TERM,
  });
  assert.strictEqual(missingVersion.mode, "school", "g15 缺 releaseVersion 兜底跳全校页");
  assert.strictEqual(missingVersion.reasonCode, miniContract.NAVIGATION_REASON_CODES.releaseVersionMissing, "g15 RELEASE_VERSION_MISSING 消费契约常数");

  // 与服务端 buildItemNavigation URL 形态一致（同源契约常数；服务端参数为小程序侧子集）
  assert.strictEqual(contract.NAVIGATION.scheduleViewPath, miniContract.NAVIGATION.scheduleViewPath, "g15 双端契约 scheduleViewPath 同源同值");
  assert.strictEqual(contract.NAVIGATION.schoolPath, miniContract.NAVIGATION.schoolPath, "g15 双端契约 schoolPath 同源同值");
  assert.strictEqual(contract.NAVIGATION_REASON_CODES.detailIdMissing, miniContract.NAVIGATION_REASON_CODES.detailIdMissing, "g15 双端 reason code 同源同值");
  const serverNav = service.buildItemNavigation(
    "teacher",
    { id: "t-chenfang", teacherName: "陈芳" },
    { q: "陈芳", term: TERM, releaseVersion: RELEASE }
  );
  const miniUrl = scheduleNavigationService.buildScheduleViewUrl({
    type: "teacher", id: "t-chenfang", name: "陈芳", term: TERM, releaseVersion: RELEASE,
  });
  assert.ok(serverNav.url.indexOf(`${contract.NAVIGATION.scheduleViewPath}?`) === 0, "g15 服务端 URL 前缀=契约路径");
  const serverParams = new URLSearchParams(serverNav.url.split("?")[1]);
  const miniParams = new URLSearchParams(miniUrl.split("?")[1]);
  serverParams.forEach((value, key) => {
    assert.strictEqual(miniParams.get(key), value, `g15 服务端 URL 参数必须是小程序侧子集: ${key}=${value}`);
  });
}

// ---------------------------------------------------------------------------
// main：依次调用各断言组；后续里程碑续写时把新组追加到 GROUPS。
// ---------------------------------------------------------------------------
const GROUPS = [
  ["group1 four-types green/red", runGroup1FourTypesGreenRed],
  ["group2 filter predicates", runGroup2FilterPredicates],
  ["group3 teacher exact priority", runGroup3TeacherExactPriority],
  ["group4 decision shapes", runGroup4DecisionShapes],
  ["group5 decision truncation", runGroup5DecisionTruncation],
  ["group6 navigation fallback", runGroup6NavigationFallback],
  ["group7 contract shape", runGroup7ContractShape],
  ["group8 invalid type rejected", runGroup8InvalidTypeRejected],
  ["group9 http route behavior (M3-T3)", runGroup9HttpRouteBehavior],
  ["group10 agent-http parity (M3-T3)", runGroup10AgentHttpParity],
  ["group11 client online passthrough (M3-T4)", runGroup11ClientOnlinePassthrough],
  ["group12 client local fallback degraded (M3-T4)", runGroup12ClientLocalFallbackDegraded],
  ["group13 client offline candidate cap (M3-T4)", runGroup13ClientOfflineCandidateCap],
  ["group14 school page decision consumption (M3-T4)", runGroup14SchoolPageDecisionConsumption],
  ["group15 classroom single-source + url unified (M3-T5)", runGroup15ClassroomSingleSourceAndUrlUnified],
];

async function main() {
  let failures = 0;
  for (const [name, run] of GROUPS) {
    try {
      await run();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL ${name}`);
      console.error((error && error.stack) || error);
    }
  }
  if (failures > 0) {
    console.error(`test-search-contract-unified: FAIL (${failures}/${GROUPS.length} groups failed)`);
    process.exitCode = 1;
    return;
  }
  console.log("test-search-contract-unified: PASS");
}

main();

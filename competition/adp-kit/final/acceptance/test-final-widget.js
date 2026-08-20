"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const NATIVE = path.join(KIT, "widget", "native");
const UNIFIED = path.join(NATIVE, "campus-result-unified-v1");
const ADAPTERS = require(path.join(KIT, "r50.2", "widget", "variant-adapters.js"));
const { validateWidgetPayload } = require(path.join(UNIFIED, "payload-validator.js"));
const { auditWidget } = require(path.join(NATIVE, "audit-widget-contract.js"));

function verified(items, extra = {}) {
  return { success: true, items, evidence: { verified: true }, ...extra };
}

function room(index) {
  return { roomId: `r-${index}`, roomName: `A1-${String(index).padStart(3, "0")}`, capacity: 60 + index, type: "多媒体教室", campusName: "校区A", building: "A公共教学楼" };
}

test("FW1 space and ranking compact 20+ candidates into one hero and at most five visible choices", () => {
  const space = ADAPTERS.projectSpace(verified(Array.from({ length: 21 }, (_, index) => room(index + 1)), { resolvedEntity: { type: "campus", name: "校区A" }, query: { weekday: 3, periodStart: 5, periodEnd: 6 } }));
  assert.equal(space.ok, true);
  assert.match(space.envelope.summary, /21/);
  assert.ok(space.envelope.sections.flatMap((section) => section.rows).length <= 5);
  assert.match(space.envelope.sections.map((section) => section.note || "").join(" "), /还有 16 间/);

  const rankingItems = Array.from({ length: 20 }, (_, index) => ({ rank: index + 1, entity: { name: `教师${index + 1}`, type: "teacher" }, metrics: { loadCount: 50 - index }, data: { periodCount: 100 - index } }));
  const ranking = ADAPTERS.projectRanking(verified(rankingItems, { summary: { metric: "teacherLoad", windowLabel: "第1-4周" } }));
  assert.equal(ranking.ok, true);
  assert.ok(ranking.envelope.sections.flatMap((section) => section.rows).length <= 4);
  assert.match(ranking.envelope.summary, /第1名|负载最高/);
  assert.doesNotMatch(JSON.stringify(ranking.envelope), /"teacher"|"room"|"building"|"campus"/);
});

test("FW2 risk result has risk-specific title, Hero and human transition copy", () => {
  const raw = verified([], {
    query: { entityName: "某教师" }, window: { weekStart: 1, weekEnd: 1 }, resolvedEntity: { name: "某教师" },
    summary: { hasConflict: true, rushWarningCount: 1 },
    items: [{
      weekdayName: "周二", periodStart: 5, periodEnd: 6,
      first: { courseName: "高等数学", campusName: "校区A", roomName: "A1-101" },
      second: { courseName: "线性代数", campusName: "校区B", roomName: "B1-101" },
    }],
    rushWarnings: [{ weekdayName: "周三", gapMinutes: 20, from: { courseName: "数据结构", campusName: "校区A", startTime: "14:00", endTime: "15:40" }, to: { courseName: "程序设计", campusName: "校区B", startTime: "16:00", endTime: "17:40" } }],
  });
  const result = ADAPTERS.projectRisk(raw);
  assert.equal(result.ok, true);
  assert.match(result.envelope.title, /某教师.*第1周.*风险/);
  assert.match(result.envelope.summary, /1 项.*赶场|1 处.*赶场/);
  const copy = JSON.stringify(result.envelope);
  assert.match(copy, /数据结构/);
  assert.match(copy, /程序设计/);
  assert.match(copy, /20 分钟/);
  assert.match(copy, /周二 第5-6节/);
  assert.doesNotMatch(copy, /undefined/);
  assert.doesNotMatch(copy, /rushWarning|gapMinutes|\bfrom\b|\bto\b/);
  assert.doesNotMatch(copy, /\bvs\b/);
  assert.match(result.envelope.title, / · 教学风险$/);
});

test("FW3 collaboration and reschedule use recommendation and before-to-after information hierarchy", () => {
  const collaboration = ADAPTERS.projectCollaboration(verified([{
    planId: "p1", week: 1, weekday: 4, weekdayName: "周四", periodStart: 1, periodEnd: 4, periodText: "第1-4节",
    freePeriodCount: 4, entities: [{ name: "教师甲" }, { name: "教师乙" }, { name: "教师丙" }],
    rooms: [room(201), room(202), room(203), room(204), room(205), room(206)], roomCount: 6,
  }], { query: { weekday: 4, periodStart: 1, periodEnd: 4, minCapacity: 60 } }));
  assert.equal(collaboration.ok, true);
  const copy = JSON.stringify(collaboration.envelope);
  for (const expected of ["推荐方案", "教师甲", "首选空间", "容量满足需求"]) assert.match(copy, new RegExp(expected));
  assert.doesNotMatch(copy, /capacity-min|constraint|score|toolRank|sourceIndex/i);

  const reschedule = ADAPTERS.projectReschedule(verified([{
    sourceLesson: { courseName: "程序设计", weekdayName: "周一", periodText: "第1-2节", campusName: "校区A", roomName: "A1-101" },
    target: { weekdayName: "周三", periodText: "第5-6节", room: { campusName: "校区A", name: "A1-201" } },
  }], { summary: { feasible: true } }));
  assert.equal(reschedule.ok, true);
  assert.match(JSON.stringify(reschedule.envelope), /原安排/);
  assert.match(JSON.stringify(reschedule.envelope), /候选安排/);
});

test("FW4 empty and error remain compact, recoverable and protocol-free", () => {
  const empty = ADAPTERS.projectEmpty(verified([], { resolvedEntity: { name: "某教师" } }));
  const error = ADAPTERS.projectError({ success: false, error: { code: "INTERNAL_STACK_DO_NOT_SHOW", stack: "secret" } });
  assert.equal(empty.ok, true);
  assert.equal(error.ok, true);
  assert.equal(empty.envelope.sections.length, 0);
  assert.equal(error.envelope.sections.length, 0);
  assert.match(empty.envelope.title, /没有匹配结果/);
  assert.match(error.envelope.title, /暂时没有完成/);
  assert.doesNotMatch(JSON.stringify(error.envelope), /INTERNAL_STACK|secret|error code/i);
});

test("FW5 malformed payload fails closed and all valid actions remain exact sys.chat natural-language queries", () => {
  const malformed = {
    version: "1.0", variant: "risk", status: "success", title: "风险", subtitle: "", verified: true,
    summary: "存在提醒", context: "", sections: [{ title: "提醒", rows: [{ label: "一", value: "二", internal: true }] }],
    actions: [], displayMeta: {}, layoutMode: "result-card", weekBoardTitle: "", weekBoardSubtitle: "", days: [],
  };
  const validation = validateWidgetPayload(malformed);
  assert.equal(validation.ok, false);
  assert.ok(validation.textFallback.length > 0);
  assert.doesNotMatch(validation.textFallback, /internal|\{|\}/i);
});

test("FW6 real export Zod, outer schema, default and contract are audited with Tencent wrapper conventions", () => {
  const contract = JSON.parse(fs.readFileSync(path.join(UNIFIED, "contract.json"), "utf8"));
  const candidate = path.join(KIT, "final", "widget", "小序-校园智序结果卡.widget");
  const download = "C:\\Users\\Katelya\\Downloads\\小序-校园智序结果卡.widget";
  const widgetPath = fs.existsSync(candidate) ? candidate : download;
  const widget = JSON.parse(fs.readFileSync(widgetPath, "utf8"));
  const audit = auditWidget(widget, contract);
  assert.equal(audit.pass, true, JSON.stringify(audit, null, 2));
  assert.equal(audit.widgetId, "978b004b2f054e8bbd5438159c7329ff");
  assert.equal(audit.innerSchemaKeys.length, 15);
});

test("FW7 exported and repo Widget schemas agree: tieGroupCount is absent for zero and >=1 when present", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(UNIFIED, "schema.json"), "utf8"));
  const contract = JSON.parse(fs.readFileSync(path.join(UNIFIED, "contract.json"), "utf8"));
  assert.equal(contract.schema, "fosuclass-adp-widget-contract/v7");
  assert.equal(contract.widgetId, "978b004b2f054e8bbd5438159c7329ff");
  assert.equal(schema.properties.displayMeta.properties.tieGroupCount.minimum, 1);
  const zeroPayload = JSON.parse(fs.readFileSync(path.join(UNIFIED, "default.json"), "utf8"));
  zeroPayload.displayMeta.tieGroupCount = 0;
  assert.equal(validateWidgetPayload(zeroPayload).ok, false);
  delete zeroPayload.displayMeta.tieGroupCount;
  assert.equal(validateWidgetPayload(zeroPayload).ok, true);
});

test("FW8 ten Final UX payloads are renderable, compact, leak-free and sys.chat-only", () => {
  const dir = path.join(__dirname, "widget-payloads");
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(files, [
    "collaboration.json", "empty.json", "error.json", "overview.json", "ranking.json",
    "reschedule.json", "risk.json", "schedule-day.json", "schedule-week.json", "space.json",
  ]);
  const variants = new Set();
  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const validation = validateWidgetPayload(payload);
    assert.equal(validation.ok, true, `${file}: ${validation.errors}`);
    variants.add(payload.variant);
    for (const action of payload.actions) {
      assert.equal(action.type, "sys.chat", file);
      assert.deepEqual(Object.keys(action.payload), ["query"], file);
    }
    const publicText = [
      payload.title, payload.subtitle, payload.summary, payload.context,
      ...payload.sections.flatMap((section) => [section.title, section.note || "", ...section.rows.flatMap((row) => [row.label, row.value, row.badge || "", row.hint || ""])]),
      ...payload.actions.flatMap((action) => [action.label, action.payload.query]),
      ...payload.days.flatMap((day) => [day.label, ...day.blocks.flatMap((block) => [block.time, block.title, block.location, block.meta || ""])]),
    ].join(" ");
    assert.doesNotMatch(publicText, /capacity-min|constraint|toolRank|sourceIndex|queryId|dataHash|dataVersion|DecisionBundle|MissionState|R(?:47|50|51)|competition-demo-v3/i, file);
  }
  assert.equal(files.length, 10);
  assert.equal(variants.size, 9, "schedule week/day share one variant; remaining final variants are unique");
});

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
  for (const person of ["教师甲", "教师乙", "教师丙"]) {
    assert.equal((copy.match(new RegExp(person, "g")) || []).length, 1, `${person} must be presented exactly once`);
  }
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
  assert.equal(audit.widgetId, "601418106a374b2eb7de54c65a3de7e0");
  assert.equal(audit.innerSchemaKeys.length, 15);
});

test("FW7 exported and repo Widget schemas agree: tieGroupCount is absent for zero and >=1 when present", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(UNIFIED, "schema.json"), "utf8"));
  const contract = JSON.parse(fs.readFileSync(path.join(UNIFIED, "contract.json"), "utf8"));
  assert.equal(contract.schema, "fosuclass-adp-widget-contract/v8");
  assert.equal(contract.widgetId, "601418106a374b2eb7de54c65a3de7e0");
  assert.equal(contract.sourceSha256, "93bbc0b1619ee2bdfbbc7817ad15d3b0ad0a42054a345e35d7ccb290e40ef252");
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

test("FW9 deterministic projectors assign semantic section kinds", () => {
  const schedule = ADAPTERS.projectSchedule(verified([{
    courseName: "课程甲", weekday: 1, weekdayName: "周一", periodStart: 1, periodEnd: 2,
    periodText: "第1-2节", campusName: "校区A", roomName: "A1-101",
  }], { resolvedEntity: { name: "某教师" }, window: { weekStart: 1, weekEnd: 1 } }), "campus_schedule_query");
  assert.deepEqual(schedule.envelope.sections.map((section) => section.kind), ["timeline"]);

  const space = ADAPTERS.projectSpace(verified([room(1), room(2), room(3)], { resolvedEntity: { name: "校区A" } }));
  assert.deepEqual(space.envelope.sections.map((section) => section.kind), ["recommendation", "entity-list"]);

  const collaboration = ADAPTERS.projectCollaboration(verified([{
    weekdayName: "周四", periodStart: 1, periodEnd: 4, periodText: "第1-4节", freePeriodCount: 4,
    entities: [{ name: "教师甲" }, { name: "教师乙" }], rooms: [room(1), room(2), room(3), room(4), room(5)],
  }], { query: { minCapacity: 60 } }));
  assert.deepEqual(collaboration.envelope.sections.map((section) => section.kind), [
    "recommendation", "recommendation", "notice", "entity-list",
  ]);

  const risk = ADAPTERS.projectRisk(verified([], {
    resolvedEntity: { name: "某教师" }, window: { weekStart: 1, weekEnd: 1 },
    summary: { hasConflict: false, rushWarningCount: 1 },
    rushWarnings: [{ weekdayName: "周三", gapMinutes: 20, from: { courseName: "课程甲", campusName: "校区A", endTime: "15:40" }, to: { courseName: "课程乙", campusName: "校区B", startTime: "16:00" } }],
  }));
  assert.deepEqual(risk.envelope.sections.map((section) => section.kind), ["route", "notice"]);

  const ranking = ADAPTERS.projectRanking(verified([
    { rank: 1, entity: { name: "教师甲", type: "teacher" }, metrics: { loadCount: 8 } },
    { rank: 2, entity: { name: "教师乙", type: "teacher" }, metrics: { loadCount: 7 } },
  ], { summary: { metric: "teacherLoad", windowLabel: "第1-4周" } }));
  assert.deepEqual(ranking.envelope.sections.map((section) => section.kind), ["ranking"]);

  const reschedule = ADAPTERS.projectReschedule(verified([{
    sourceLesson: { courseName: "课程甲", weekdayName: "周一", periodText: "第1-2节", campusName: "校区A", roomName: "A1-101" },
    target: { weekdayName: "周三", periodText: "第5-6节", room: { campusName: "校区A", name: "A1-201" } },
    checks: { teacherConflict: { conflict: false }, capacity: { ok: true } },
  }], { summary: { feasible: true } }));
  assert.deepEqual(reschedule.envelope.sections.map((section) => section.kind), ["comparison", "comparison", "notice"]);

  const overview = ADAPTERS.projectOverview(verified([{
    weeks: [{ week: 1, perWeekday: [2, 3, 1, 2, 4] }],
    teachers: [{ rank: 1, name: "教师甲", lessonCount: 8, periodCount: 16 }],
    risks: { conflictCount: 1, rushCount: 2, continuousCount: 0 },
    summary: "教学运行总体平稳。",
  }], { window: { weekStart: 1, weekEnd: 4 } }));
  assert.deepEqual(overview.envelope.sections.map((section) => section.kind), ["metric", "ranking", "notice"]);

  const message = ADAPTERS.projectMessage(verified([{ name: "校历说明", note: "本学期共二十个教学周" }]));
  assert.deepEqual(message.envelope.sections.map((section) => section.kind), ["prose"]);
});

test("FW10 section.kind is optional for v7 payloads and rejects unknown module kinds", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(UNIFIED, "schema.json"), "utf8"));
  assert.deepEqual(schema.properties.sections.items.properties.kind.enum, [
    "metric", "timeline", "route", "recommendation", "ranking",
    "comparison", "entity-list", "notice", "prose",
  ]);
  assert.equal(schema.properties.sections.items.required.includes("kind"), false);

  const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, "widget-payloads", "schedule-day.json"), "utf8"));
  for (const section of legacy.sections) delete section.kind;
  assert.equal(validateWidgetPayload(legacy).ok, true, "v7 payload without section.kind must remain valid");

  const invalid = structuredClone(legacy);
  invalid.sections[0].kind = "model-selected-layout";
  assert.equal(validateWidgetPayload(invalid).ok, false);
});

test("FW11 Template keeps long verified titles on their own wrapping row and leads with the conclusion", () => {
  const template = fs.readFileSync(path.join(UNIFIED, "template.txt"), "utf8");
  assert.doesNotMatch(template, /ellipsis|textOverflow|whiteSpace|nowrap/i);
  assert.match(template, /<Title value=\{weekBoardTitle\} size="md" \/>/);
  assert.match(template, /<Title value=\{title\} size="md" \/>/);
  assert.match(template, /<Caption value="结论先行"/);
  assert.match(template, /label=\{status === 'success' \? '已核验'/);

  const payloadDir = path.join(__dirname, "widget-payloads");
  const risk = JSON.parse(fs.readFileSync(path.join(payloadDir, "risk.json"), "utf8"));
  const collaboration = JSON.parse(fs.readFileSync(path.join(payloadDir, "collaboration.json"), "utf8"));
  risk.title = "教师025（负载Top1）未来四周跨校区赶场风险";
  collaboration.title = "教师005 / 006 / 014 · 第1周周四上午共同空闲";
  assert.equal(validateWidgetPayload(risk).ok, true);
  assert.equal(validateWidgetPayload(collaboration).ok, true);
});

"use strict";
// R50.2B variant-adapters 门禁（2026-08-19）
// P1 13 个 Agent Tool 全部映射到 10 个 variant 之一，无遗漏；
// P2 fixtures → project() 输出合法 Envelope（schema 校验通过、无泄漏）；
// P3 确定性：同一 raw 两次投影字节一致，且与 golden snapshot 一致；
// P4 语义断言：周末标记 / 模拟未执行 / 并列位次 / verified empty / 可恢复错误。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const KIT = path.join(__dirname, "..", "..");
const WIDGET_DIR = path.join(KIT, "r50.2", "widget");
const FIXTURES_DIR = path.join(WIDGET_DIR, "fixtures");
const EXPECTED_DIR = path.join(FIXTURES_DIR, "expected");

const { project, MAP, resolveVariant } = require(path.join(WIDGET_DIR, "variant-adapters.js"));
const { isClean, validateEnvelope } = require(path.join(WIDGET_DIR, "envelope.js"));

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8"));
}

test("map: 13 Agent Tools 全部映射且无未知 variant", () => {
  const names = Object.keys(MAP);
  assert.equal(names.length, 13, `映射必须覆盖 13 个 Agent Tool（实际 ${names.length}）`);
  const allowed = new Set([
    "schedule", "space", "collaboration", "risk", "reschedule",
    "ranking", "overview", "empty", "error", "message",
  ]);
  for (const tool of names) {
    const variant = MAP[tool];
    assert.equal(allowed.has(variant), true, `${tool} → ${variant} 非法`);
    assert.equal(resolveVariant(tool), variant);
  }
});

const CASES = [
  ["schedule", "campus_schedule_query", "schedule"],
  ["space", "campus_classroom_search", "space"],
  ["collaboration", "campus_group_plan", "collaboration"],
  ["risk", "campus_risk_check", "risk"],
  ["reschedule", "campus_reschedule_feasibility", "reschedule"],
  ["ranking", "campus_teacher_load_query", "ranking"],
  ["overview", "campus_overview", "overview"],
  ["empty", "campus_schedule_query", "empty"],
  ["error", "campus_schedule_query", "error"],
  ["message", "campus_entity_search", "message"],
];

test("adapters: fixtures 投影为合法、无泄漏、确定性的 Envelope", () => {
  for (const [fixtureName, toolName, expectedVariant] of CASES) {
    const raw = loadFixture(fixtureName);
    const first = project(raw, toolName);
    assert.equal(first.ok, true, `${fixtureName}: ${JSON.stringify(first.errors)}`);
    assert.equal(first.envelope.variant, expectedVariant, `${fixtureName} 变体错误`);
    const validation = validateEnvelope(first.envelope);
    assert.equal(validation.ok, true, `${fixtureName} schema 校验失败: ${JSON.stringify(validation.errors)}`);
    assert.equal(isClean(first.envelope).ok, true, `${fixtureName} 泄漏内部字段`);
    const second = project(raw, toolName);
    assert.equal(
      JSON.stringify(first.envelope),
      JSON.stringify(second.envelope),
      `${fixtureName} 投影必须确定性`
    );
  }
});

test("adapters: golden snapshots 字节一致（fixtures/expected/*.json）", () => {
  for (const [fixtureName, toolName] of CASES) {
    const goldenPath = path.join(EXPECTED_DIR, `${fixtureName}.json`);
    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
    const projected = project(loadFixture(fixtureName), toolName).envelope;
    assert.deepStrictEqual(projected, golden, `${fixtureName} 与 golden snapshot 不一致`);
  }
});

test("schedule: 课程行含时间、教室、班级且无内部标识", () => {
  const { envelope } = project(loadFixture("schedule"), "campus_schedule_query");
  assert.equal(envelope.title, "教师003 · 第1周课表");
  const rows = envelope.sections[0].rows;
  assert.equal(rows.length, 5);
  assert.equal(rows[0].label, "周一 第5-6节");
  assert.equal(rows[0].value, "程序设计基础 · 校区A A2-301");
  assert.ok(rows[0].hint.includes("2025级A班"));
  assert.ok(!JSON.stringify(envelope).includes("les-101"));
});

test("space: 空教室行含容量与楼栋", () => {
  const { envelope } = project(loadFixture("space"), "campus_classroom_search");
  assert.equal(envelope.variant, "space");
  assert.equal(envelope.sections.flatMap((section) => section.rows).length, 3);
  assert.equal(envelope.sections[0].rows[0].label, "A1-101 · 120人");
  assert.equal(envelope.sections[0].title, "推荐教室");
});

test("collaboration: 推荐方案优先，参与者可读且周末候选元数据保留", () => {
  const { envelope } = project(loadFixture("collaboration"), "campus_group_plan");
  assert.equal(envelope.displayMeta.weekendMarked, true);
  assert.equal(envelope.sections[0].title, "推荐方案");
  assert.ok(envelope.sections.some((section) => section.title === "参与"));
  assert.ok(JSON.stringify(envelope.sections).includes("教师001 · 教师002"));
});

test("risk: 冲突与赶场分区块呈现", () => {
  const { envelope } = project(loadFixture("risk"), "campus_risk_check");
  const sectionTitles = envelope.sections.map((section) => section.title);
  assert.ok(sectionTitles.includes("时间冲突") && sectionTitles.includes("跨校区衔接"));
  assert.ok(envelope.summary.includes("1 处时间冲突"));
  assert.ok(envelope.summary.includes("1 处跨校区赶场"));
});

test("reschedule: 模拟结果明确标注未执行（simulated=true）", () => {
  const { envelope } = project(loadFixture("reschedule"), "campus_reschedule_feasibility");
  assert.equal(envelope.displayMeta.simulated, true);
  assert.ok(envelope.summary.includes("模拟"));
  assert.deepStrictEqual(envelope.sections.slice(0, 2).map((section) => section.title), ["原安排", "候选安排"]);
  assert.ok(envelope.sections.some((section) => (section.note || "").includes("模拟")));
  assert.ok(envelope.sections[1].rows[0].badge === "可行");
  assert.ok(envelope.sections[1].rows[0].hint.includes("教室待指定"));
});

test("ranking: 并列位次语义保留（badge=并列 + tieNote）", () => {
  const { envelope } = project(loadFixture("ranking"), "campus_teacher_load_query");
  assert.ok(envelope.summary.includes("第1名 教师001"));
  assert.equal(envelope.sections[0].rows[0].label, "第2名");
  assert.equal(envelope.sections[0].rows[0].badge, "并列");
  assert.equal(envelope.displayMeta.tieGroupCount, 1);
  assert.ok(envelope.displayMeta.tieNote.includes("第2名起并列"));
});

test("overview: 态势卡含周量/负载/风险区块", () => {
  const { envelope } = project(loadFixture("overview"), "campus_overview");
  assert.equal(envelope.title, "校园教学态势");
  const sectionTitles = envelope.sections.map((section) => section.title);
  assert.ok(sectionTitles.includes("教师负载 Top 3"));
  assert.ok(sectionTitles.includes("教学风险"));
});

test("empty: verified empty 为 first-class 变体", () => {
  const { envelope } = project(loadFixture("empty"), "campus_schedule_query");
  assert.equal(envelope.variant, "empty");
  assert.equal(envelope.status, "empty");
  assert.equal(envelope.verified, true);
});

test("error: 可恢复失败转用户语义，不携带内部错误码", () => {
  const { envelope } = project(loadFixture("error"), "campus_schedule_query");
  assert.equal(envelope.variant, "error");
  assert.equal(envelope.verified, false);
  assert.equal(envelope.displayMeta.recoverable, true);
  assert.ok(!JSON.stringify(envelope).includes("ENTITY_NOT_FOUND"));
  assert.ok(!JSON.stringify(envelope).includes("q-20260819-0009"));
});

test("message: 支撑工具作为最终答案时输出轻量结果列表", () => {
  const { envelope } = project(loadFixture("message"), "campus_entity_search");
  assert.equal(envelope.variant, "message");
  assert.equal(envelope.sections[0].rows.length, 3);
  assert.equal(envelope.sections[0].rows[0].label, "教师001");
});

test("adapters: 未映射工具名 fail closed", () => {
  const result = project(loadFixture("schedule"), "campus_bogus_tool");
  assert.equal(result.ok, false);
  assert.equal(result.envelope, null);
});

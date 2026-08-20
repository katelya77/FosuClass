"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const adpRoot = path.join(__dirname, "..", "..");
const datasetPath = path.join(adpRoot, "mock-data", "competition-demo-v3.json");
process.env.CAMPUS_DATA_PATH = datasetPath;

const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
const { callAgentTool, AGENT_TOOL_PATHS } = require(path.join(adpRoot, "mcp", "campus-tools-mcp", "src", "agent-tools.js"));

const teachers = dataset.teachers.slice(0, 2).map((teacher) => ({ type: "teacher", name: teacher.name }));
const lesson = dataset.lessons[0];

function labelsOfItems(envelope) {
  return new Set((envelope.items || []).map((item) => item.planName || item.roomName || item.name
    || (item.entity && item.entity.name)
    || `${item.weekdayName || ""} ${item.periodText || ""}`.trim()
    || `${item.target && item.target.weekdayName || ""} ${item.target && item.target.periodText || ""}`.trim()));
}

function assertPublicDecision(envelope) {
  assert.ok(envelope.decision, "live handler 必须附带 decision");
  assert.ok(["recommended", "needs_more_facts", "needs_user_choice", "no_feasible_candidate"].includes(envelope.decision.status));
  const serialized = JSON.stringify(envelope.decision);
  assert.doesNotMatch(serialized, /resultRef|queryId|dataHash|fingerprint|intrinsicConstraint|evaluation|sourceFactKey|toolName|campus_[a-z_]+/i);
  for (const action of envelope.decision.nextActions) {
    assert.deepStrictEqual(Object.keys(action).sort(), ["label", "payload", "type"]);
    assert.strictEqual(action.type, "sys.chat");
    assert.deepStrictEqual(Object.keys(action.payload), ["query"]);
  }
}

test("D1 简单课表查询仍直接返回事实，不进入 Decision 层", () => {
  const envelope = callAgentTool("campus_schedule_query", {
    entityType: "teacher", entityName: dataset.teachers[0].name, week: 1,
  });
  assert.strictEqual(envelope.success, true);
  assert.strictEqual(Object.hasOwn(envelope, "decision"), false);
});

test("D2 多个可行空间 + preferLarger 产生稳定首选且保留原 items", () => {
  const params = {
    campus: "校区A", week: 1, weekday: 3, periodStart: 5, periodEnd: 6, minCapacity: 1,
    decisionPreferences: { preferLarger: true },
  };
  const first = callAgentTool("campus_classroom_search", params);
  const second = callAgentTool("campus_classroom_search", params);
  assert.strictEqual(first.success, true);
  assert.ok(first.items.length > 1);
  assertPublicDecision(first);
  const maxCapacity = Math.max(...first.items.map((item) => item.capacity));
  const preferredRaw = first.items.find((item) => item.roomName === first.decision.preferred.label);
  assert.ok(preferredRaw);
  assert.strictEqual(preferredRaw.capacity, maxCapacity);
  assert.strictEqual(first.decision.preferred.label, second.decision.preferred.label);
  assert.deepStrictEqual(first.items, second.items);
});

test("D3 hard capacity 不满足者绝不推荐", () => {
  const envelope = callAgentTool("campus_classroom_search", {
    campus: "校区A", week: 1, weekday: 3, periodStart: 5, periodEnd: 6, minCapacity: 60,
  });
  assert.strictEqual(envelope.success, true);
  assertPublicDecision(envelope);
  const selected = envelope.items.find((item) => item.roomName === (envelope.decision.preferred && envelope.decision.preferred.label));
  assert.ok(selected);
  assert.ok(selected.capacity >= 60);
});

test("D4 无可行候选时 recommendation=null，且不发明备选", () => {
  const envelope = callAgentTool("campus_classroom_search", {
    campus: "校区A", week: 1, weekday: 3, periodStart: 5, periodEnd: 6, minCapacity: 100000,
  });
  assert.strictEqual(envelope.success, true);
  assert.deepStrictEqual(envelope.items, []);
  assertPublicDecision(envelope);
  assert.strictEqual(envelope.decision.status, "no_feasible_candidate");
  assert.strictEqual(envelope.decision.preferred, null);
  assert.deepStrictEqual(envelope.decision.alternatives, []);
});

test("D5 verified risk-aware 调课推荐只使用系统可行性核验理由", () => {
  const envelope = callAgentTool("campus_reschedule_feasibility", {
    sourceLessonId: lesson.id,
    target: { week: 1, weekday: 1, periodStart: 3, periodEnd: 4 },
  });
  assert.strictEqual(envelope.success, true);
  assert.strictEqual(envelope.summary.feasible, true);
  assertPublicDecision(envelope);
  assert.strictEqual(envelope.decision.status, "recommended");
  assert.ok(envelope.decision.reasons.some((reason) => reason.includes("feasible") && reason.includes("system-reschedule-feasible")));
});

test("D6 reschedule feasible:false 永不推荐", () => {
  const envelope = callAgentTool("campus_reschedule_feasibility", {
    sourceLessonId: lesson.id,
    target: { week: 1, weekday: 1, periodStart: 7, periodEnd: 8 },
  });
  assert.strictEqual(envelope.success, true);
  assert.strictEqual(envelope.summary.feasible, false);
  assertPublicDecision(envelope);
  assert.strictEqual(envelope.decision.status, "no_feasible_candidate");
  assert.strictEqual(envelope.decision.preferred, null);
});

test("D7 相同 verified handler 输入重复运行决策与 receipt 稳定", () => {
  const params = { entities: teachers, week: 1, minConsecutivePeriods: 1, decisionPreferences: { preferEarlier: true } };
  const first = callAgentTool("campus_group_plan", params);
  const second = callAgentTool("campus_group_plan", params);
  assert.strictEqual(first.success, true);
  assert.ok(first.items.length > 1);
  assertPublicDecision(first);
  assert.deepStrictEqual(first.decision, second.decision);
});

test("D8 L3 next action 只能是 confirmation-only sys.chat", () => {
  const envelope = callAgentTool("campus_group_plan", {
    entities: teachers, week: 1, minConsecutivePeriods: 1,
  }, { authorityLevel: "L3" });
  assert.strictEqual(envelope.success, true);
  assertPublicDecision(envelope);
  assert.strictEqual(envelope.decision.status, "needs_user_choice");
  assert.deepStrictEqual(envelope.decision.nextActions, [{
    type: "sys.chat",
    label: "确认后继续",
    payload: { query: "请先确认是否继续此项操作" },
  }]);
});

test("D9 existing result-card 正常投影推荐/理由/备选，actions 仅 sys.chat", () => {
  const envelope = callAgentTool("campus_group_plan", {
    entities: teachers, week: 1, minConsecutivePeriods: 1,
    decisionPreferences: { preferEarlier: true },
  });
  assertPublicDecision(envelope);
  const card = envelope.decision.resultCard;
  assert.strictEqual(card.layoutMode, "result-card");
  assert.strictEqual(card.title, "小序-校园智序结果卡");
  assert.ok(card.sections.some((section) => section.title === "推荐"));
  assert.ok(card.sections.some((section) => section.title === "理由"));
  assert.ok(card.sections.some((section) => section.title === "备选"));
  assert.ok(card.actions.length >= 1 && card.actions.length <= 3);
  for (const action of card.actions) {
    assert.strictEqual(action.type, "sys.chat");
    assert.deepStrictEqual(Object.keys(action.payload), ["query"]);
  }
  const rawLabels = labelsOfItems(envelope);
  assert.ok(rawLabels.has(envelope.decision.preferred.label));
  for (const alternative of envelope.decision.alternatives) assert.ok(rawLabels.has(alternative.label));
});

test("Runtime activation 不改变 13 public CampusTools / 14 bindings / Main=0 基线", () => {
  assert.strictEqual(AGENT_TOOL_PATHS.length, 13);
  assert.strictEqual(new Set(AGENT_TOOL_PATHS).size, 13);
});

test("OpenAPI 只扩展 6 个 existing operations 的 preference/decision contract，不新增工具", () => {
  const spec = JSON.parse(fs.readFileSync(
    path.join(adpRoot, "r49-ma", "tools", "openapi", "campus-agent-tools.adp-import.json"),
    "utf8",
  ));
  const operations = Object.values(spec.paths).map((pathItem) => pathItem.post);
  assert.strictEqual(operations.length, 13);
  const activated = new Set([
    "campus_classroom_search", "campus_teacher_load_query", "campus_common_free_time_query",
    "campus_room_utilization_query", "campus_reschedule_feasibility", "campus_group_plan",
  ]);
  for (const operation of operations) {
    const inputRef = operation.requestBody.content["application/json"].schema.$ref;
    const outputRef = operation.responses["200"].content["application/json"].schema.$ref;
    const input = spec.components.schemas[inputRef.split("/").pop()];
    const output = spec.components.schemas[outputRef.split("/").pop()];
    assert.strictEqual(Boolean(input.properties.decisionPreferences), activated.has(operation.operationId), operation.operationId);
    assert.strictEqual(Boolean(output.properties.decision), activated.has(operation.operationId), operation.operationId);
  }
  assert.deepStrictEqual(spec.components.schemas.PublicDecisionAction.properties.type.enum, ["sys.chat"]);
  const serialized = JSON.stringify(spec.components.schemas.RuntimeDecision);
  assert.doesNotMatch(serialized, /resultRef|queryId|dataHash|fingerprint|evaluation|toolName|agentName/i);
});

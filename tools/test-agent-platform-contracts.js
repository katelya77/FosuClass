const assert = require("assert");

const protocol = require("../packages/agent-protocol");
const uiSchema = require("../packages/ui-schema");

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error && error.stack || error}`);
    process.exitCode = 1;
  }
}

test("RunEvent keeps public fields and removes sensitive payload keys", () => {
  const event = protocol.createRunEvent({
    eventId: "evt_contract_1",
    runId: "run_contract_1",
    sequence: 1,
    type: "run.accepted",
    protocolVersion: "run.v1",
    configVersion: "cfg_contract_1",
    createdAt: "2026-07-30T08:00:00.000Z",
    publicPayload: {
      label: "已接收",
      status: "queued",
      nested: { count: 2, apiKey: "must-not-survive" },
      authorization: "Bearer must-not-survive",
    },
  });
  assert.deepStrictEqual(event, {
    eventId: "evt_contract_1",
    runId: "run_contract_1",
    sequence: 1,
    type: "run.accepted",
    protocolVersion: "run.v1",
    configVersion: "cfg_contract_1",
    createdAt: "2026-07-30T08:00:00.000Z",
    publicPayload: {
      label: "已接收",
      status: "queued",
      nested: { count: 2 },
    },
  });
});

test("RunEvent rejects unknown event types and invalid sequence", () => {
  assert.throws(
    () => protocol.createRunEvent({ runId: "run_1", sequence: 1, type: "thinking.fake" }),
    (error) => error && error.code === "RUN_EVENT_TYPE_UNSUPPORTED"
  );
  assert.throws(
    () => protocol.createRunEvent({ runId: "run_1", sequence: 0, type: "run.accepted" }),
    (error) => error && error.code === "RUN_EVENT_SEQUENCE_INVALID"
  );
});

test("RunEvent accepts every production lifecycle event", () => {
  [
    "understanding.fallback",
    "plan.created",
    "plan.replan",
    "planner.started",
    "planner.completed",
    "planner.failed",
    "provider.selected",
    "provider.shadow.started",
    "provider.shadow.completed",
    "provider.shadow.failed",
  ].forEach((type, index) => {
    assert(protocol.RUN_EVENT_TYPES.includes(type), `${type} must be a protocol event`);
    assert.strictEqual(protocol.createRunEvent({ runId: "run_catalog", sequence: index + 1, type }).type, type);
  });
});

test("PlatformTrace exposes package ownership without secrets", () => {
  const trace = protocol.createPlatformTrace({
    runId: "run_contract_1",
    configVersion: "cfg_contract_1",
    runtimePackage: "@xiaofu-agent/agent-runtime",
    pluginIds: ["fosu-campus"],
    stages: [{
      stage: "decision",
      owner: "@xiaofu-agent/agent-runtime",
      outcome: "success",
      durationMs: 12,
      details: { selectedSkill: "campus.schedule", token: "must-not-survive" },
    }],
  });
  assert.strictEqual(trace.runtimePackage, "@xiaofu-agent/agent-runtime");
  assert.deepStrictEqual(trace.pluginIds, ["fosu-campus"]);
  assert.deepStrictEqual(trace.stages[0], {
    stage: "decision",
    owner: "@xiaofu-agent/agent-runtime",
    outcome: "success",
    durationMs: 12,
    details: { selectedSkill: "campus.schedule" },
  });
});

test("UI Schema normalizes every stable block type", () => {
  const fixtures = [
    { type: "text", id: "text_1", text: "你好" },
    { type: "markdown", id: "markdown_1", markdown: "**你好**" },
    { type: "plan", id: "plan_1", steps: [{ id: "s1", label: "查询", status: "running" }] },
    { type: "tool_progress", id: "tool_1", toolId: "platform.echo", status: "running", label: "执行中" },
    { type: "list", id: "list_1", items: [{ id: "i1", title: "项目" }] },
    { type: "detail", id: "detail_1", fields: [{ label: "名称", value: "项目" }] },
    { type: "schedule", id: "schedule_1", entries: [{ id: "e1", title: "课程", start: "08:30" }] },
    { type: "clarification", id: "clarify_1", prompt: "你指哪个班？", options: [{ id: "o1", label: "一班" }] },
    { type: "confirmation", id: "confirm_1", prompt: "确认执行？", confirmLabel: "确认", cancelLabel: "取消" },
    { type: "action_receipt", id: "receipt_1", command: "setCurrentSchedule", status: "awaiting_receipt" },
    { type: "warning", id: "warning_1", message: "结果可能不完整", code: "PARTIAL" },
    { type: "error", id: "error_1", message: "请求失败", code: "FAILED", retryable: true },
  ];
  const blocks = uiSchema.normalizeUiBlocks(fixtures);
  assert.strictEqual(blocks.length, 12);
  assert.deepStrictEqual(blocks.map((item) => item.type), fixtures.map((item) => item.type));
  blocks.forEach((block) => assert.strictEqual(block.schemaVersion, "ui.v1"));
  assert.strictEqual(blocks[0].text, "你好");
  assert.strictEqual(blocks[2].steps[0].status, "running");
  assert.strictEqual(blocks[11].retryable, true);
});

test("UI Schema rejects arbitrary components and sensitive keys", () => {
  assert.throws(
    () => uiSchema.normalizeUiBlocks([{ type: "arbitrary_component", id: "bad" }]),
    (error) => error && error.code === "UI_BLOCK_TYPE_UNSUPPORTED"
  );
  const block = uiSchema.normalizeUiBlocks([{
    type: "detail",
    id: "detail_safe",
    fields: [{ label: "名称", value: "公开" }],
    apiKey: "must-not-survive",
  }])[0];
  assert.strictEqual(block.apiKey, undefined);
});

test("Legacy Agent result maps to deterministic generic blocks", () => {
  const blocks = uiSchema.blocksFromAgentResult({
    answer: "已找到两节课。",
    taskSteps: [{ key: "query", label: "已查询课表", status: "done" }],
    cards: [{
      id: "card_schedule",
      type: "schedule",
      title: "今日课表",
      items: [{ title: "高等数学", subtitle: "08:30", value: "A1-201" }],
    }],
  });
  assert.deepStrictEqual(blocks.map((item) => item.type), ["plan", "text", "schedule"]);
  assert.strictEqual(blocks[2].entries[0].title, "高等数学");
});

if (!process.exitCode) {
  console.log(`agent-platform-contracts: pass=${passed} fail=0`);
}

"use strict";
// R49-MA 自动测试 6：fixtures 一致性（对齐 09-MULTI-AGENT-E2E-MATRIX.md 与 agent-tools.json 契约）
const test = require("node:test");
const assert = require("node:assert");
const fixtures = require("./fixtures/multi-turn-cases.json");
const contract = require("../tools/schemas/agent-tools.json");

const validAgentTools = new Set(contract.tools.map((t) => t.name));
const KNOWLEDGE_ALLOW = new Set(["KnowledgeRetrievalAnswer"]);

test("fixture 三组齐全：hardCases=8 / coreCases=13 / r48Regression=7", () => {
  assert.ok(Array.isArray(fixtures.hardCases) && fixtures.hardCases.length === 8, `hardCases 应为 8，实际 ${fixtures.hardCases && fixtures.hardCases.length}`);
  assert.ok(Array.isArray(fixtures.coreCases) && fixtures.coreCases.length === 13, `coreCases 应为 13，实际 ${fixtures.coreCases && fixtures.coreCases.length}`);
  assert.ok(Array.isArray(fixtures.r48Regression) && fixtures.r48Regression.length === 7, `r48Regression 应为 7，实际 ${fixtures.r48Regression && fixtures.r48Regression.length}`);
});

test("hardCases 标识为 A~H 且唯一", () => {
  const ids = fixtures.hardCases.map((c) => c.id);
  assert.deepStrictEqual([...ids].sort(), ["A", "B", "C", "D", "E", "F", "G", "H"], "hardCases 必须 A~H");
});

test("所有 tools 引用必须合法（5 个 Agent Tool 或 KnowledgeRetrievalAnswer）", () => {
  for (const c of fixtures.hardCases) {
    for (const t of c.turns) {
      for (const tool of t.tools || []) {
        assert.ok(validAgentTools.has(tool) || KNOWLEDGE_ALLOW.has(tool), `case ${c.id} 引用未知工具 ${tool}`);
      }
    }
  }
});

test("self 模式轮次不得出现第二对象状态（A/D）；仅 E 允许 compare", () => {
  for (const c of fixtures.hardCases) {
    if (c.id === "E") continue;
    for (const t of c.turns) {
      const st = t.state || {};
      if (st.comparisonMode === "self") {
        assert.ok(!("second" in st), `case ${c.id} self 轮次不得携带 second 状态`);
        assert.ok(t.tools.includes("campus_risk_check"), `case ${c.id} self 轮次应调用 campus_risk_check`);
      }
    }
  }
  const e = fixtures.hardCases.find((c) => c.id === "E");
  assert.strictEqual(e.turns[0].state.comparisonMode, "compare");
  assert.ok(e.turns[0].tools.includes("campus_risk_check"), "E 必须调用 campus_risk_check");
});

test("B 轮（stale escape）必须 classroom 且不残留 second_entity", () => {
  const b = fixtures.hardCases.find((c) => c.id === "B");
  const last = b.turns[b.turns.length - 1];
  assert.strictEqual(last.route, "classroom");
  assert.ok(last.tools.includes("campus_classroom_search"));
  assert.strictEqual(last.state.staleContextEscaped, true);
});

test("C 轮下一天 = 09-04 → 09-05 确定性推进", () => {
  const c = fixtures.hardCases.find((c) => c.id === "C");
  assert.strictEqual(c.turns[0].state.activeTime, "2026-09-04");
  assert.strictEqual(c.turns[1].state.activeTime, "2026-09-05");
  assert.ok(c.turns[1].tools.includes("campus_day_plan"));
});

test("coreCases 覆盖澄清/chat/knowledge/self/compare 边界", () => {
  const c11 = fixtures.coreCases.find((c) => c.id === 11);
  assert.ok(c11.route.includes("clarify"), "case11 必须澄清");
  const c10 = fixtures.coreCases.find((c) => c.id === 10);
  assert.strictEqual(c10.route, "chat");
  const c12 = fixtures.coreCases.find((c) => c.id === 12);
  assert.ok(c12.route.includes("compare"));
  const c13 = fixtures.coreCases.find((c) => c.id === 13);
  assert.ok(c13.route.includes("self"));
});

test("agentToolNames 与契约 5 工具一致", () => {
  assert.deepStrictEqual([...fixtures.agentToolNames].sort(), [...validAgentTools].sort());
});

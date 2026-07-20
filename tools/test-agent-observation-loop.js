#!/usr/bin/env node
const assert = require("assert");
const { runObservationLoop } = require("../server/src/services/ai/planner/observationLoop");

async function run() {
  let replanCalled = false;
  const loop = await runObservationLoop({
    message: "找连续四节空教室",
    runtimeMode: "public",
    intent: { name: "search_continuous_empty_rooms", slots: { duration: 4 }, confidence: 0.8 },
    skill: {
      id: "find_continuous_empty_room",
      allowedTools: ["search_continuous_empty_rooms", "search_empty_rooms", "diagnose_data_status"],
      planBuilder: () => [{ toolName: "search_continuous_empty_rooms", args: { duration: 4 } }],
      resultVerifier: ({ toolCalls }) => {
        const last = toolCalls[toolCalls.length - 1];
        const empty = !last || Number(last.result && last.result.total || 0) === 0;
        return { ok: !empty, errors: empty ? [{ code: "EMPTY" }] : [], evidenceComplete: !empty };
      },
    },
    executePlan: async (steps, meta) => {
      const isReplan = meta && meta.isReplan;
      if (isReplan) replanCalled = true;
      return {
        toolCalls: steps.map((s) => ({
          name: s.toolName,
          status: "success",
          summary: isReplan ? "found rooms" : "EMPTY_RESULT",
          result: {
            success: true,
            total: isReplan ? 2 : 0,
            items: isReplan ? [{ room: "C7-101" }, { room: "C7-102" }] : [],
          },
        })),
        steps: steps.map((s, i) => ({
          id: `step-${i + 1}`,
          label: s.toolName,
          tool: s.toolName,
          status: "success",
          durationMs: 5,
        })),
      };
    },
  });

  assert.strictEqual(loop.replanUsed, true);
  assert.strictEqual(replanCalled, true);
  assert.ok(loop.execution.toolCalls.length >= 2);
  assert.ok(loop.observations.some((o) => Number(o.factCount) > 0));

  console.log("test-agent-observation-loop passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

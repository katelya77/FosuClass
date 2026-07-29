const assert = require("assert");

const protocol = require("../packages/agent-protocol");
const uiSchema = require("../packages/ui-schema");
const { createAgentRuntime } = require("../packages/agent-runtime");

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function tickingClock(start = Date.parse("2026-07-30T00:00:00.000Z"), tick = 5) {
  let current = start;
  return {
    now() {
      current += tick;
      return current;
    },
  };
}

async function main() {
  await test("Runtime owns the exact lifecycle and immutable handoffs", async () => {
    const order = [];
    const events = [];
    const traces = [];
    const callerContext = { nested: { value: 1 } };
    const runtime = createAgentRuntime({
      protocol,
      uiSchema,
      clock: tickingClock(),
      traceSink: (trace) => traces.push(trace),
    });
    const result = await runtime.executeTurn({
      request: { runId: "run_success", runtimeMode: "public", context: callerContext },
      configSnapshot: { configVersion: "cfg_1", pluginIds: ["fosu-campus"] },
      stages: {
        context: async ({ request }) => {
          order.push("context");
          assert.strictEqual(request.runId, "run_success");
          return { message: "hi", messageCount: 1 };
        },
        decision: async ({ context }) => {
          order.push("decision");
          assert(Object.isFrozen(context));
          return {
            goal: { name: "echo" },
            selectedSkillId: "platform.echo",
            decisionSource: "deterministic",
          };
        },
        skillTool: async ({ decision }) => {
          order.push("skill_tool");
          assert(Object.isFrozen(decision));
          return { toolCalls: [{ name: "platform.echo", status: "completed" }] };
        },
        verification: async ({ skillTool }) => {
          order.push("verification");
          assert(Object.isFrozen(skillTool));
          return { ok: true, errors: [] };
        },
        response: async ({ verification }) => {
          order.push("response");
          assert(Object.isFrozen(verification));
          return { answer: "ok", responseMode: "deterministic" };
        },
      },
      emit: (event) => events.push(event),
    });

    assert.deepStrictEqual(order, ["context", "decision", "skill_tool", "verification", "response"]);
    assert.deepStrictEqual(result.ui.blocks.map((block) => block.type), ["text"]);
    assert.strictEqual(result.ui.blocks[0].text, "ok");
    assert.strictEqual(result.platformTrace.runtimePackage, "@xiaofu-agent/agent-runtime");
    assert.deepStrictEqual(result.platformTrace.pluginIds, ["fosu-campus"]);
    assert.deepStrictEqual(
      result.platformTrace.stages.map((stage) => stage.stage),
      ["context", "decision", "skill_tool", "verification", "response", "ui", "total"],
    );
    assert(result.platformTrace.stages.every((stage) => stage.durationMs >= 0));
    assert.strictEqual(traces.length, 1);
    assert.strictEqual(events[0].type, "runtime.entered");
    assert.strictEqual(events.at(-1).type, "runtime.completed");
    assert.strictEqual(events.some((event) => event.type === "stage.failed"), false);
    assert.deepStrictEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
    assert(!JSON.stringify(events).includes("hi"));
    assert.strictEqual(Object.isFrozen(callerContext), false, "runtime must not freeze caller-owned input");
    assert.strictEqual(Object.isFrozen(callerContext.nested), false, "runtime must clone nested caller input");
  });

  await test("A stage failure is terminal and never emits false completion", async () => {
    const events = [];
    const runtime = createAgentRuntime({ protocol, uiSchema, clock: tickingClock() });
    await assert.rejects(() => runtime.executeTurn({
      request: { runId: "run_failure", runtimeMode: "trial" },
      configSnapshot: { configVersion: "cfg_failure" },
      stages: {
        context: async () => ({ messageCount: 1 }),
        decision: async () => {
          const error = new Error("provider unavailable");
          error.code = "PROVIDER_UNAVAILABLE";
          throw error;
        },
        skillTool: async () => ({ toolCalls: [] }),
        verification: async () => ({ ok: true }),
        response: async () => ({ answer: "must not run" }),
      },
      emit: (event) => events.push(event),
    }), (error) => {
      assert.strictEqual(error.code, "PROVIDER_UNAVAILABLE");
      assert(error.platformTrace);
      assert.strictEqual(error.platformTrace.stages[1].stage, "decision");
      assert.strictEqual(error.platformTrace.stages[1].outcome, "failed");
      return true;
    });
    assert(events.some((event) => event.type === "stage.failed" && event.publicPayload.stage === "decision"));
    assert.strictEqual(events.at(-1).type, "run.failed");
    assert.strictEqual(events.some((event) => event.type === "runtime.completed"), false);
  });

  await test("Pre-aborted Turn never starts a stage or reports completion", async () => {
    const events = [];
    const controller = new AbortController();
    controller.abort();
    const runtime = createAgentRuntime({ protocol, uiSchema, clock: tickingClock() });
    await assert.rejects(() => runtime.executeTurn({
      request: { runId: "run_aborted", runtimeMode: "dev" },
      configSnapshot: { configVersion: "cfg_abort" },
      stages: {
        context: async () => ({ messageCount: 0 }),
        decision: async () => ({}),
        skillTool: async () => ({}),
        verification: async () => ({ ok: true }),
        response: async () => ({ answer: "no" }),
      },
      emit: (event) => events.push(event),
      signal: controller.signal,
    }), (error) => error && error.code === "ABORTED");
    assert.deepStrictEqual(events.map((event) => event.type), ["runtime.entered", "run.cancelled"]);
  });

  await test("Abort between stages prevents every later side effect", async () => {
    const events = [];
    const order = [];
    const controller = new AbortController();
    const runtime = createAgentRuntime({ protocol, uiSchema, clock: tickingClock() });
    await assert.rejects(() => runtime.executeTurn({
      request: { runId: "run_mid_abort", runtimeMode: "dev" },
      configSnapshot: { configVersion: "cfg_abort" },
      stages: {
        context: async () => {
          order.push("context");
          controller.abort();
          return { messageCount: 1 };
        },
        decision: async () => (order.push("decision"), {}),
        skillTool: async () => (order.push("skill_tool"), {}),
        verification: async () => (order.push("verification"), { ok: true }),
        response: async () => (order.push("response"), { answer: "no" }),
      },
      emit: (event) => events.push(event),
      signal: controller.signal,
    }), (error) => error && error.code === "ABORTED");
    assert.deepStrictEqual(order, ["context"]);
    assert.strictEqual(events.at(-1).type, "run.cancelled");
    assert.strictEqual(events.some((event) => event.type === "runtime.completed"), false);
  });

  await test("UI Schema failures have an explicit failed stage", async () => {
    const events = [];
    const runtime = createAgentRuntime({ protocol, uiSchema, clock: tickingClock() });
    await assert.rejects(() => runtime.executeTurn({
      request: { runId: "run_ui_failure", runtimeMode: "public" },
      configSnapshot: { configVersion: "cfg_ui" },
      stages: {
        context: async () => ({ messageCount: 1 }),
        decision: async () => ({ goal: { name: "echo" } }),
        skillTool: async () => ({ toolCalls: [] }),
        verification: async () => ({ ok: true }),
        response: async () => ({ ui: { blocks: [{ type: "not_a_real_block" }] } }),
      },
      emit: (event) => events.push(event),
    }), (error) => {
      assert.strictEqual(error.code, "UI_BLOCK_TYPE_UNSUPPORTED");
      assert(error.platformTrace.stages.some((stage) => stage.stage === "ui" && stage.outcome === "failed"));
      return true;
    });
    assert(events.some((event) => event.type === "stage.failed" && event.publicPayload.stage === "ui"));
    assert.strictEqual(events.at(-1).type, "run.failed");
  });

  console.log(`agent-runtime-lifecycle: pass=${passed} fail=0`);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

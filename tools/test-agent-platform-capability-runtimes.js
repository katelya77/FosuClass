const assert = require("assert");

const { createSkillCatalog } = require("../packages/skill-runtime");
const { createToolRuntime } = require("../packages/tool-runtime");

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error && error.stack || error}`);
    process.exitCode = 1;
  }
}

function makeFactors(overrides = {}) {
  return Object.assign({
    manifestToolIds: ["platform.echo", "platform.detail"],
    skillToolIds: ["platform.echo", "platform.detail"],
    runtimeToolIds: ["platform.echo", "platform.detail"],
    environmentToolIds: ["platform.echo", "platform.detail"],
    safetyToolIds: ["platform.echo", "platform.detail"],
  }, overrides);
}

async function run() {
  await test("Skill catalog stores immutable declarative descriptors", () => {
    const catalog = createSkillCatalog({
      skills: [{
        id: "platform.echo",
        version: "1.0.0",
        description: "Echo a safe string",
        supportedGoals: ["echo"],
        allowedTools: ["platform.echo"],
        runtimeModes: ["public", "trial", "dev"],
        requiredSlots: ["text"],
        optionalSlots: [],
      }],
    });
    const skill = catalog.get("platform.echo");
    assert.strictEqual(skill.id, "platform.echo");
    assert.deepStrictEqual(catalog.findForGoal("echo").map((item) => item.id), ["platform.echo"]);
    assert.throws(() => skill.allowedTools.push("platform.detail"), TypeError);
    assert.strictEqual(catalog.get("Platform.Echo"), null);
  });

  await test("Skill catalog rejects duplicate and malformed identifiers", () => {
    const duplicate = { id: "platform.echo", version: "1", supportedGoals: [], allowedTools: [], runtimeModes: ["public"] };
    assert.throws(
      () => createSkillCatalog({ skills: [duplicate, duplicate] }),
      (error) => error && error.code === "SKILL_ID_DUPLICATE"
    );
    assert.throws(
      () => createSkillCatalog({ skills: [{ id: "Platform Echo", version: "1", allowedTools: [] }] }),
      (error) => error && error.code === "SKILL_ID_INVALID"
    );
  });

  let echoExecutions = 0;
  const toolRuntime = createToolRuntime({
    tools: [
      {
        id: "platform.echo",
        description: "Return a safe string",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["text"],
          properties: { text: { type: "string", minLength: 1, maxLength: 40 } },
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["success", "text"],
          properties: { success: { type: "boolean" }, text: { type: "string", maxLength: 40 } },
        },
        runtimeModes: ["public", "trial", "dev"],
        environments: ["production", "staging", "development"],
        safety: { autonomyLevel: 1, requiresConfirmation: false },
        execute: async ({ text }) => {
          echoExecutions += 1;
          return { success: true, text };
        },
      },
      {
        id: "platform.detail",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        outputSchema: { type: "object", required: ["success"], properties: { success: { type: "boolean" } } },
        execute: async () => ({ success: true }),
      },
      {
        id: "platform.bad-output",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        outputSchema: { type: "object", required: ["success"], properties: { success: { type: "boolean" } } },
        execute: async () => ({ success: "yes" }),
      },
    ],
  });

  await test("Five-factor intersection is exact and manifest ordered", () => {
    assert.deepStrictEqual(toolRuntime.resolveAllowedToolIds(makeFactors()), ["platform.echo", "platform.detail"]);
    for (const factor of ["manifestToolIds", "skillToolIds", "runtimeToolIds", "environmentToolIds", "safetyToolIds"]) {
      assert.deepStrictEqual(toolRuntime.resolveAllowedToolIds(makeFactors({ [factor]: [] })), [], factor);
    }
    assert.deepStrictEqual(toolRuntime.resolveAllowedToolIds(makeFactors({
      manifestToolIds: ["platform.detail", "platform.echo", "platform.detail"],
    })), ["platform.detail", "platform.echo"]);
  });

  await test("Tool Runtime rejects case changes and unauthorized IDs before execution", async () => {
    assert.throws(
      () => toolRuntime.assertExecutable("Platform.Echo", ["platform.echo"]),
      (error) => error && error.code === "TOOL_NOT_REGISTERED"
    );
    await assert.rejects(
      () => toolRuntime.execute("platform.echo", { text: "hello" }, {}, { allowedToolIds: [] }),
      (error) => error && error.code === "TOOL_NOT_ALLOWED"
    );
    assert.strictEqual(echoExecutions, 0);
  });

  await test("Tool input Schema rejects missing, extra, and oversized values", async () => {
    const allowedToolIds = ["platform.echo"];
    await assert.rejects(
      () => toolRuntime.execute("platform.echo", {}, {}, { allowedToolIds }),
      (error) => error && error.code === "TOOL_INPUT_SCHEMA_INVALID"
    );
    await assert.rejects(
      () => toolRuntime.execute("platform.echo", { text: "hello", arbitrary: true }, {}, { allowedToolIds }),
      (error) => error && error.code === "TOOL_INPUT_SCHEMA_INVALID"
    );
    await assert.rejects(
      () => toolRuntime.execute("platform.echo", { text: "x".repeat(41) }, {}, { allowedToolIds }),
      (error) => error && error.code === "TOOL_INPUT_SCHEMA_INVALID"
    );
    assert.strictEqual(echoExecutions, 0);
  });

  await test("Authorized Tool executes once and validates its output", async () => {
    const result = await toolRuntime.execute("platform.echo", { text: "hello" }, {}, { allowedToolIds: ["platform.echo"] });
    assert.deepStrictEqual(result, { success: true, text: "hello" });
    assert.strictEqual(echoExecutions, 1);
    await assert.rejects(
      () => toolRuntime.execute("platform.bad-output", {}, {}, { allowedToolIds: ["platform.bad-output"] }),
      (error) => error && error.code === "TOOL_OUTPUT_SCHEMA_INVALID"
    );
  });

  await test("Pre-aborted Tool never starts", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => toolRuntime.execute("platform.echo", { text: "hello" }, {}, {
        allowedToolIds: ["platform.echo"],
        signal: controller.signal,
      }),
      (error) => error && error.code === "ABORTED"
    );
    assert.strictEqual(echoExecutions, 1);
  });

  await test("Public descriptors never expose executable functions", () => {
    const descriptors = toolRuntime.listDescriptors();
    assert.strictEqual(descriptors.length, 3);
    descriptors.forEach((descriptor) => assert.strictEqual(descriptor.execute, undefined));
    assert.deepStrictEqual(descriptors[0].safety, { autonomyLevel: 1, requiresConfirmation: false });
  });

  if (!process.exitCode) console.log(`agent-platform-capability-runtimes: pass=${passed} fail=0`);
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

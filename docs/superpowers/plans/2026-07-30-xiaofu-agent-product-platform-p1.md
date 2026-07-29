# Xiaofu Agent Product Platform P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing FosuClass production Agent request path execute through real reusable packages, a Fosu campus plugin, and shared server/admin composition roots without creating a second kernel or state source.

**Architecture:** Keep the current CommonJS leaf services, but invert their ownership: `apps/agent-server` creates one platform instance, `packages/agent-runtime` owns the ordered lifecycle, `packages/skill-runtime` and `packages/tool-runtime` enforce declared capabilities, and `plugins/fosu-campus` supplies the Fosu-specific ports. Existing routes become compatibility adapters to that instance, and agent.v1 remains a presentation projection of the same result.

**Tech Stack:** Node.js 20+, CommonJS, Express 4, npm workspaces, existing JSON manifest, existing Node script test harness, Docker buildx-compatible Alpine image.

## Global Constraints

- `public` keeps zero external Provider attempts and the Release Pack remains the campus fact authority.
- Do not call the old whole `agentService.chat()` from the new Runtime; the legacy export must call the new composition.
- Do not duplicate Manifest, Skill, Tool, Run or Trace state.
- Generic packages must not contain `FosuClass`, `佛山大学`, `佛大`, campus route names, or Release Pack paths.
- Every package added in P1 must be imported by the integrated production composition or the final response presenter.
- Preserve agent.v1 and existing agent.v2 fields; additive `ui.blocks` and platform Trace fields are allowed in agent.v2.
- All code changes follow RED→GREEN→REFACTOR; each RED must fail for the intended missing behavior.
- Run the four AGENTS.md mandatory gates plus Phase 2/3 and the release gate before the P1 stage checkpoint.
- Do not deploy, upload a mini program, merge main, or write real credentials.

## File Structure

### Workspace contracts

- Create `packages/agent-protocol/package.json`
- Create `packages/agent-protocol/index.js`
- Create `packages/agent-protocol/src/runEvent.js`
- Create `packages/agent-protocol/src/platformTrace.js`
- Create `packages/ui-schema/package.json`
- Create `packages/ui-schema/index.js`
- Create `packages/ui-schema/src/blocks.js`
- Modify `package.json`
- Modify `package-lock.json` through `npm install --package-lock-only`

### Capability runtimes and plugin

- Create `packages/skill-runtime/package.json`
- Create `packages/skill-runtime/index.js`
- Create `packages/skill-runtime/src/skillCatalog.js`
- Create `packages/tool-runtime/package.json`
- Create `packages/tool-runtime/index.js`
- Create `packages/tool-runtime/src/toolRuntime.js`
- Create `plugins/fosu-campus/package.json`
- Create `plugins/fosu-campus/index.js`
- Create `plugins/fosu-campus/src/createFosuCampusPlugin.js`
- Create `plugins/fosu-campus/src/createFosuStages.js`

### Runtime and apps

- Create `packages/agent-runtime/package.json`
- Create `packages/agent-runtime/index.js`
- Create `packages/agent-runtime/src/agentRuntime.js`
- Create `packages/agent-runtime/src/stageTrace.js`
- Create `apps/agent-server/package.json`
- Create `apps/agent-server/index.js`
- Create `apps/agent-server/src/createAgentPlatform.js`
- Create `apps/agent-server/src/createRunHandlers.js`
- Create `apps/agent-admin/package.json`
- Create `apps/agent-admin/index.js`
- Create `apps/agent-admin/src/createPlatformAdminHandlers.js`
- Create `server/src/services/ai/platformComposition.js`
- Modify `server/src/services/ai/agentService.js`
- Modify `server/src/routes/ai.js`
- Modify `server/src/routes/admin.js`
- Modify `server/src/app.js`

### Integration and delivery tests

- Create `tools/test-agent-platform-contracts.js`
- Create `tools/test-agent-platform-capability-runtimes.js`
- Create `tools/test-fosu-campus-plugin.js`
- Create `tools/test-agent-runtime-lifecycle.js`
- Create `tools/test-agent-platform-production-wiring.js`
- Create `tools/test-agent-platform-http.js`
- Create `tools/test-agent-platform-admin.js`
- Modify `tools/run-agent-foundation-tests.js`
- Modify `tools/run-agent-release-gate.js`
- Modify `tools/test-server-ai-module-require.js`
- Modify `tools/test-server-docker-smoke.js`
- Modify `server/Dockerfile`
- Modify `.github/workflows/xiaofu-agent-ci.yml`

---

### Task 1: Executable protocol and UI-schema workspaces

**Files:**
- Create: `tools/test-agent-platform-contracts.js`
- Create: `packages/agent-protocol/package.json`
- Create: `packages/agent-protocol/index.js`
- Create: `packages/agent-protocol/src/runEvent.js`
- Create: `packages/agent-protocol/src/platformTrace.js`
- Create: `packages/ui-schema/package.json`
- Create: `packages/ui-schema/index.js`
- Create: `packages/ui-schema/src/blocks.js`
- Modify: `package.json`
- Modify mechanically: `package-lock.json`

**Interfaces:**
- Produces: `createRunEvent(input)`, `createPlatformTrace(input)`, `normalizeUiBlocks(input)`, `blocksFromAgentResult(result)`.
- Consumes later: Runtime events and final agent.v2 presentation.

- [x] **Step 1: Write the failing contract test**

The test must require the package entrypoints, create one event and all 12 block types, reject an unknown type, strip unknown/sensitive fields, and assert that a factual legacy result maps to at least one stable block.

```js
const assert = require("assert");
const protocol = require("../packages/agent-protocol");
const uiSchema = require("../packages/ui-schema");

const event = protocol.createRunEvent({
  runId: "run_test",
  sequence: 1,
  type: "run.accepted",
  configVersion: "cfg_1",
  publicPayload: { label: "已接收", secret: "must-not-survive" },
});
assert.strictEqual(event.sequence, 1);
assert.strictEqual(event.publicPayload.secret, undefined);
assert.throws(() => uiSchema.normalizeUiBlocks([{ type: "arbitrary_component" }]), /UI_BLOCK_TYPE_UNSUPPORTED/);
assert.deepStrictEqual(
  uiSchema.normalizeUiBlocks([{ type: "text", id: "b1", text: "你好" }])[0],
  { type: "text", id: "b1", schemaVersion: "ui.v1", text: "你好" }
);
```

- [x] **Step 2: Run RED**

Run: `node tools/test-agent-platform-contracts.js`

Expected: FAIL with `Cannot find module '../packages/agent-protocol'`.

- [x] **Step 3: Implement minimal real contracts**

`createRunEvent()` must validate IDs, positive integer sequence, allowlisted event type, ISO timestamp, protocol/config version, and recursively sanitize `publicPayload`. `normalizeUiBlocks()` must use an explicit handler per block type and never pass arbitrary fields through.

```js
const UI_BLOCK_TYPES = new Set([
  "text", "markdown", "plan", "tool_progress", "list", "detail", "schedule",
  "clarification", "confirmation", "action_receipt", "warning", "error",
]);

function normalizeUiBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((block, index) => {
    const type = String(block && block.type || "");
    if (!UI_BLOCK_TYPES.has(type)) throw codedError("UI_BLOCK_TYPE_UNSUPPORTED", type);
    return normalizeBlock(type, block, index);
  });
}
```

- [x] **Step 4: Add npm workspaces and refresh lockfile**

Set root workspaces to `packages/*`, `plugins/*`, and `apps/*`. Run `npm install --package-lock-only --ignore-scripts`; inspect that only workspace metadata and expected lock entries changed.

- [x] **Step 5: Run GREEN and package hygiene**

Run:

```text
node tools/test-agent-platform-contracts.js
npm run test:agent-foundation
```

Expected: new test PASS; foundation exit 0.

- [ ] **Step 6: Commit**

```text
git add package.json package-lock.json packages/agent-protocol packages/ui-schema tools/test-agent-platform-contracts.js
git commit -m "feat(agent): add executable platform contracts"
```

### Task 2: Skill and Tool runtimes with exact five-factor intersection

**Files:**
- Create: `tools/test-agent-platform-capability-runtimes.js`
- Create: `packages/skill-runtime/package.json`
- Create: `packages/skill-runtime/index.js`
- Create: `packages/skill-runtime/src/skillCatalog.js`
- Create: `packages/tool-runtime/package.json`
- Create: `packages/tool-runtime/index.js`
- Create: `packages/tool-runtime/src/toolRuntime.js`

**Interfaces:**
- Produces: `createSkillCatalog({ skills })`, `createToolRuntime({ tools, validateInput, validateOutput })`.
- `toolRuntime.resolveAllowedToolIds({ manifestToolIds, skillToolIds, runtimeToolIds, environmentToolIds, safetyToolIds })` returns an ordered exact intersection.
- `toolRuntime.execute(toolId, args, context)` rejects unregistered/disallowed IDs before invoking the implementation.

- [ ] **Step 1: Write failing behavior tests**

Use a real in-process read-only implementation that increments only when authorization succeeds. Assert exact match, Schema rejection, and each factor independently removing the tool.

```js
const runtime = createToolRuntime({
  tools: [{ id: "platform.echo", inputSchema: { required: ["text"] }, execute: ({ text }) => ({ success: true, text }) }],
});
const allowed = runtime.resolveAllowedToolIds({
  manifestToolIds: ["platform.echo"],
  skillToolIds: ["platform.echo"],
  runtimeToolIds: ["platform.echo"],
  environmentToolIds: ["platform.echo"],
  safetyToolIds: ["platform.echo"],
});
assert.deepStrictEqual(allowed, ["platform.echo"]);
assert.throws(() => runtime.assertExecutable("Platform.Echo", allowed), /TOOL_NOT_REGISTERED/);
```

- [ ] **Step 2: Run RED**

Run: `node tools/test-agent-platform-capability-runtimes.js`

Expected: FAIL because `skill-runtime` and `tool-runtime` do not exist.

- [ ] **Step 3: Implement catalogs and validation**

Skill descriptors are immutable copies. Tool descriptors hold executable functions supplied by code at composition time; no serialized function may be accepted. Schema validation supports required fields, primitive types, enums, additionalProperties false and maximum string/array limits needed by the current Manifest.

- [ ] **Step 4: Run GREEN and mutation cases**

Run: `node tools/test-agent-platform-capability-runtimes.js`

Expected: all exact-match, missing-factor, malformed-args and output-redaction cases PASS.

- [ ] **Step 5: Commit**

```text
git add packages/skill-runtime packages/tool-runtime tools/test-agent-platform-capability-runtimes.js
git commit -m "feat(agent): add constrained skill and tool runtimes"
```

### Task 3: Fosu campus plugin owns campus capability adapters

**Files:**
- Create: `tools/test-fosu-campus-plugin.js`
- Create: `plugins/fosu-campus/package.json`
- Create: `plugins/fosu-campus/index.js`
- Create: `plugins/fosu-campus/src/createFosuCampusPlugin.js`

**Interfaces:**
- Consumes injected `capabilityManifestService`, `skillRegistry`, `toolRegistry`, `responseComposer`, `releaseService`.
- Produces `{ id, version, manifestVersion, skills, tools, releaseContext, mapResultToBlocks }`.
- Tool implementations call the existing authoritative Tool registry; descriptors come from the single existing Manifest.

- [ ] **Step 1: Write a failing plugin integration test**

Require the real server Manifest/registries, construct the plugin, assert every Skill/Tool ID is unique, then execute the real read-only `explain_personal_import` Tool through `packages/tool-runtime`. Verify no copy of `agent-capability-manifest.json` is created under the plugin.

- [ ] **Step 2: Run RED**

Run: `node tools/test-fosu-campus-plugin.js`

Expected: FAIL with missing plugin module.

- [ ] **Step 3: Implement the plugin factory**

```js
function createFosuCampusPlugin(deps) {
  const manifest = deps.capabilityManifestService.getManifest();
  const skills = deps.skillRegistry.listSkills().map(toSkillDescriptor);
  const tools = deps.toolRegistry.listToolNames().map((id) => ({
    id,
    metadata: deps.capabilityManifestService.getTool(id),
    execute: (args, context) => deps.toolRegistry.executeToolAsync(id, args, context),
  }));
  return Object.freeze({
    id: "fosu-campus",
    version: String(manifest.version),
    skills,
    tools,
    getReleaseContext: () => safeReleaseContext(deps.releaseService),
    mapResultToBlocks: deps.mapResultToBlocks,
  });
}
```

The plugin must not cache a second mutable Manifest. It reads the authoritative service once per immutable composition/config snapshot.

- [ ] **Step 4: Run GREEN plus existing Manifest/Tool gates**

Run:

```text
node tools/test-fosu-campus-plugin.js
node tools/test-agent-capability-manifest.js
node tools/test-agent-tool-plan-manifest.js
```

- [ ] **Step 5: Commit**

```text
git add plugins/fosu-campus tools/test-fosu-campus-plugin.js
git commit -m "feat(agent): inject campus capabilities as a plugin"
```

### Task 4: Generic Agent Runtime owns lifecycle and stage Trace

**Files:**
- Create: `tools/test-agent-runtime-lifecycle.js`
- Create: `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/index.js`
- Create: `packages/agent-runtime/src/agentRuntime.js`
- Create: `packages/agent-runtime/src/stageTrace.js`

**Interfaces:**
- Produces: `createAgentRuntime({ protocol, uiSchema, clock, traceSink })`.
- `runtime.executeTurn({ request, configSnapshot, stages, emit, signal })` owns `context → decision → skill_tool → verification → response → ui` order.
- Each stage callback consumes the previous immutable stage output; callbacks cannot skip directly to final result.

- [ ] **Step 1: Write failing lifecycle tests**

Create concrete stage callbacks that append their name, return literal outputs and emit one event. Assert exact order, stage durations, error terminal behavior, abort behavior and final UI blocks.

```js
const order = [];
const result = await runtime.executeTurn({
  request: { runId: "run_1", runtimeMode: "public" },
  configSnapshot: { configVersion: "cfg_1" },
  stages: {
    context: async () => (order.push("context"), { message: "hi" }),
    decision: async () => (order.push("decision"), { goal: { name: "echo" }, selectedSkillId: "platform.echo" }),
    skillTool: async () => (order.push("skill_tool"), { toolCalls: [] }),
    verification: async () => (order.push("verification"), { ok: true }),
    response: async () => (order.push("response"), { answer: "ok" }),
  },
  emit: (event) => events.push(event),
});
assert.deepStrictEqual(order, ["context", "decision", "skill_tool", "verification", "response"]);
assert.strictEqual(result.platformTrace.stages[0].stage, "context");
```

- [ ] **Step 2: Run RED**

Run: `node tools/test-agent-runtime-lifecycle.js`

Expected: FAIL with missing runtime module.

- [ ] **Step 3: Implement the lifecycle**

The implementation must emit `runtime.entered`, real stage started/completed/failed events and `runtime.completed`; it uses `packages/agent-protocol` for events and `packages/ui-schema` for final blocks. Trace details contain IDs/counts only.

- [ ] **Step 4: Run GREEN and abort/error cases**

Run: `node tools/test-agent-runtime-lifecycle.js`

Expected: success, stage failure and pre-aborted cases all PASS without emitting a false completed event.

- [ ] **Step 5: Commit**

```text
git add packages/agent-runtime tools/test-agent-runtime-lifecycle.js
git commit -m "feat(agent): add traced generic runtime lifecycle"
```

### Task 5: Shared server composition and real Fosu stage wiring

**Files:**
- Create: `tools/test-agent-platform-production-wiring.js`
- Create: `apps/agent-server/package.json`
- Create: `apps/agent-server/index.js`
- Create: `apps/agent-server/src/createAgentPlatform.js`
- Create: `plugins/fosu-campus/src/createFosuStages.js`
- Create: `server/src/services/ai/platformComposition.js`
- Modify: `server/src/services/ai/agentService.js`
- Modify: `server/src/services/ai/agentKernel.js`
- Modify: `server/src/services/ai/runtime/plannerCoordinator.js`
- Modify: `server/src/services/ai/runtime/verificationCoordinator.js`

**Interfaces:**
- `createAgentPlatform({ runtime, plugin, runRepository, legacyPorts })` returns one runtime-bound service.
- `platform.executeTurn(input)` invokes separate Fosu `context`, `decision`, `skillTool`, `verification`, and `response` ports through generic Runtime.
- `createFosuStages(dependencies)` owns the Fosu-specific phase callbacks while importing no app/router state.
- `agentService.chat(input)` becomes a compatibility export that calls the singleton platform; it is not passed back as a callback.

- [ ] **Step 1: Write the failing production-wiring test**

Run a real public factual request through `agentService.chat()` using existing fixtures. Assert:

- response success and agent.v1 fields remain;
- `platformTrace.runtimePackage === "@xiaofu-agent/agent-runtime"`;
- stages include decision, skill_tool, verification, response in order;
- `pluginIds` contains `fosu-campus`;
- factual Evidence remains complete;
- external Provider use is false.

Also inspect `agentService.__getPlatformForTests()` only if a production lifecycle owner exposes the same read-only diagnostics; do not add a test-only cleanup method to production.

- [ ] **Step 2: Run RED**

Run: `node tools/test-agent-platform-production-wiring.js`

Expected: FAIL because the response lacks platform Trace and the app composition does not exist.

- [ ] **Step 3: Extract stage ports without changing leaf behavior**

Move current `chat()` sections into named Fosu stage functions that retain existing coordinator calls. The generic Runtime invokes them. Do not wrap the old whole chat as one stage. Early safety exits remain `guard_rejected` results inside the Runtime boundary.

Required shape:

```js
const platform = createAgentPlatform({
  runtime: createAgentRuntime({ protocol: platformProtocol, uiSchema }),
  plugin: createFosuCampusPlugin(fosuDependencies),
  stages: {
    context: fosuStages.assembleContext,
    decision: fosuStages.decide,
    skillTool: fosuStages.executeSkillTool,
    verification: fosuStages.verify,
    response: fosuStages.compose,
  },
});
```

- [ ] **Step 4: Make AgentKernel consume generic Skill/Tool runtimes**

Inject the plugin-created catalogs into AgentKernel. Remove default direct registry checks when injected; all paths use exact Tool IDs and the five-factor intersection before execution. Existing capability router may propose candidates but cannot bypass the Tool Runtime.

- [ ] **Step 5: Run GREEN and regressions**

Run:

```text
node tools/test-agent-platform-production-wiring.js
npm run test:agent-regression
npm run test:agent-final-convergence
```

- [ ] **Step 6: Commit**

```text
git add apps/agent-server packages/agent-runtime server/src/services/ai plugins/fosu-campus tools/test-agent-platform-production-wiring.js
git commit -m "refactor(agent): route Fosu turns through platform runtime"
```

### Task 6: Run API and legacy transports use one app service

**Files:**
- Create: `tools/test-agent-platform-http.js`
- Create: `apps/agent-server/src/createRunHandlers.js`
- Modify: `server/src/routes/ai.js`
- Modify: `server/src/app.js`

**Interfaces:**
- Produces HTTP handlers `createRun`, `getRun`, `cancelRun`, `chatCompat`, `aguiCompat` bound to one platform instance.
- P1 adapts the existing Run Repository as the single source; durable replacement is P6, but no route may own its own execution closure.

- [ ] **Step 1: Write failing HTTP integration test**

Start the real Express app on an ephemeral port, POST `/api/ai/agent/runs`, poll to terminal, then call `/agent/chat`. Assert both results contain the same platform runtime marker and the Run timeline contains real runtime/stage events. Assert `idempotencyKey` reaches the app service diagnostics even though durable dedupe lands in P6.

- [ ] **Step 2: Run RED**

Run: `node tools/test-agent-platform-http.js`

Expected: FAIL because routes directly use `agentRunEventService` and `setImmediate(agentService.chat)`.

- [ ] **Step 3: Implement app-bound handlers**

Move Run execution closure and terminal event selection into `createRunHandlers()`. Route files perform Express validation/auth only, then delegate. `chatCompat` calls `platform.executeTurn()` directly for synchronous compatibility; `aguiCompat` converts the same emitted events and never runs a second engine.

- [ ] **Step 4: Run GREEN plus existing transport tests**

Run:

```text
node tools/test-agent-platform-http.js
npm run test:agent-run-events
npm run test:xiaofu-runs-transport
node tools/test-agui-adapter.js
```

- [ ] **Step 5: Commit**

```text
git add apps/agent-server/src/createRunHandlers.js server/src/routes/ai.js server/src/app.js tools/test-agent-platform-http.js
git commit -m "refactor(agent): unify online transports on Run service"
```

### Task 7: Agent Admin app exposes real topology and execution evidence

**Files:**
- Create: `tools/test-agent-platform-admin.js`
- Create: `apps/agent-admin/package.json`
- Create: `apps/agent-admin/index.js`
- Create: `apps/agent-admin/src/createPlatformAdminHandlers.js`
- Modify: `server/src/routes/admin.js`

**Interfaces:**
- Produces `getTopology(req,res)` and `getRecentRuns(req,res)` using the same platform diagnostics/trace repository.
- Response includes active runtime package, plugin IDs/versions, configVersion, execution policy capability and package ownership; no key material or prompt text.

- [ ] **Step 1: Write failing authenticated admin test**

Use the existing admin HTTP harness and credentials fixture to GET `/api/admin/agent-platform/topology`. Assert the runtime/plugin/version fields match the production platform instance and that JSON serialization contains no `apiKey`, `token`, `authorization`, prompt or hidden reasoning fields.

- [ ] **Step 2: Run RED**

Run: `node tools/test-agent-platform-admin.js`

Expected: FAIL with 404.

- [ ] **Step 3: Implement and mount handlers**

Use existing admin middleware and audit conventions. The app reads, but never recreates, the platform singleton. P4 will add mutation and UI workflows; P1 endpoint is a real runtime truth surface, not a static feature matrix.

- [ ] **Step 4: Run GREEN plus admin security tests**

Run:

```text
node tools/test-agent-platform-admin.js
npm run test:admin-api-contract
node tools/test-admin-error-sanitizer.js
```

- [ ] **Step 5: Commit**

```text
git add apps/agent-admin server/src/routes/admin.js tools/test-agent-platform-admin.js
git commit -m "feat(agent): expose platform runtime truth in admin"
```

### Task 8: Production packaging, Docker loading and CI coverage

**Files:**
- Modify: `server/Dockerfile`
- Modify: `tools/test-server-docker-smoke.js`
- Modify: `tools/test-server-ai-module-require.js`
- Modify: `.github/workflows/xiaofu-agent-ci.yml`
- Modify: `tools/run-agent-foundation-tests.js`
- Modify: `tools/run-agent-release-gate.js`

**Interfaces:**
- Integrated image preserves repository layout under `/app/server`, `/app/packages`, `/app/plugins`, `/app/apps` and starts from `/app/server`.
- Docker smoke asserts runtime topology endpoint and one public Run, not only legacy chat.

- [ ] **Step 1: Extend gates first**

Add P1 tests to foundation/release runners and expand CI path filters to `apps/**`, `packages/**`, `plugins/**`, `specs/xiaofu-agent-product-platform/**`, and `docs/superpowers/plans/**`.

- [ ] **Step 2: Run RED for container/module packaging**

Run:

```text
node tools/test-server-ai-module-require.js
node tools/test-server-docker-smoke.js
```

Expected locally: module test fails until package copy/load is correct; Docker test either fails for missing workspace files when daemon exists or records the existing explicit non-CI daemon skip.

- [ ] **Step 3: Update Dockerfile and smoke assertions**

Build from repository root, install server production dependencies, copy only required workspace source/package files, set `WORKDIR /app/server`, and preserve existing data/config paths. Do not copy node_modules, secrets, output, staging or local artifacts.

- [ ] **Step 4: Run targeted GREEN**

Run:

```text
node tools/test-server-ai-module-require.js
node tools/test-agent-platform-contracts.js
node tools/test-agent-platform-capability-runtimes.js
node tools/test-fosu-campus-plugin.js
node tools/test-agent-runtime-lifecycle.js
node tools/test-agent-platform-production-wiring.js
node tools/test-agent-platform-http.js
node tools/test-agent-platform-admin.js
node tools/test-server-docker-smoke.js
```

- [ ] **Step 5: Commit**

```text
git add server/Dockerfile .github/workflows/xiaofu-agent-ci.yml tools package.json package-lock.json
git commit -m "build(agent): package integrated platform runtime"
```

### Task 9: P1 full verification and stage checkpoint

**Files:**
- Modify: `specs/xiaofu-agent-product-platform/tasks.md`
- Create: `docs/xiaofu-agent/product-platform-p1-evidence.md`

**Interfaces:**
- Evidence maps R1/R4/R10/R11 to test output and the exact production import chain.

- [ ] **Step 1: Run all mandatory gates freshly**

Run:

```text
npm run test:agent-foundation
npm run test:agent-regression
npm run test:ai-competition
npm run test:agent-final-convergence
npm run test:agent-phase2
npm run test:agent-phase3
npm run test:agent-release-gate
```

Expected: exit 0 for every command. Docker daemon skip remains “container unverified,” never “passed.”

- [ ] **Step 2: Verify architecture and secret boundaries**

Run generic-package forbidden-term scan, `git diff --check`, `npm ci` lockfile verification and existing no-secret tests. Confirm every P1 workspace is reached from `server/src/app.js` or final presenter with a runtime test—not only by grep.

- [ ] **Step 3: Write evidence document and mark P1 tasks**

Record commit IDs, commands, pass/fail counts, Trace example with safe IDs, Docker status, rollback sequence and remaining P2 gaps. Do not claim strict_model_first or durable RunEvent yet.

- [ ] **Step 4: Commit P1 checkpoint**

```text
git add specs/xiaofu-agent-product-platform/tasks.md docs/xiaofu-agent/product-platform-p1-evidence.md
git commit -m "docs(agent): record P1 production wiring evidence"
```

## P1 Completion Audit

- Every created package contains exercised behavior, not only interfaces or re-exports.
- A real HTTP Run Trace proves `apps/agent-server → packages/agent-runtime → Decision → packages/skill-runtime/packages/tool-runtime → Verification → RunEvent → packages/ui-schema`.
- `plugins/fosu-campus` supplies real existing campus Tool implementations from the authoritative Manifest.
- Legacy chat/agui do not execute another kernel.
- Existing agent.v1 and public zero-provider gates remain green.
- Integrated Docker image includes and requires the workspace code; unavailable local Docker remains explicitly unverified.
- P2 limitations are honest: strict Decision merge, Deadline and persisted metrics are not claimed in P1.

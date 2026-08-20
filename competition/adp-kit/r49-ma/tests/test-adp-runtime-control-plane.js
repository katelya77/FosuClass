"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..", "ops", "runtime-control-plane");
const desired = require(path.join(ROOT, "lib", "desired-state.js"));
const { redactDeep, containsCredential } = require(path.join(ROOT, "lib", "redact.js"));
const { diffState } = require(path.join(ROOT, "lib", "drift.js"));
const { applySafePlan } = require(path.join(ROOT, "lib", "apply.js"));
const { planCloudBaseDeploy, waitForRemoteHash } = require(path.join(ROOT, "lib", "cloudbase-deploy.js"));

test("CP1 desired state freezes 4 Agents / 13 CampusTools / 14 bindings / Main=0", () => {
  const state = desired.loadDesiredState();
  const canonicalBindings = require(path.join(__dirname, "..", "..", "r50.1", "agent-tool-bindings.json"));
  const canonicalTools = require(path.join(__dirname, "..", "tools", "schemas", "agent-tools.json"));
  assert.strictEqual(state.agents.length, 4);
  assert.strictEqual(state.campusTools.length, 13);
  assert.strictEqual(state.bindings.length, 14);
  assert.deepStrictEqual(state.agents.find((x) => x.key === "main").campusTools, []);
  assert.strictEqual(state.app.publishAllowed, false);
  assert.strictEqual(state.widget.name, "小序-校园智序结果卡");
  assert.strictEqual(state.multimodal.mainOfficialVisionToolRequired, true);
  assert.ok(state.agents.filter((x) => x.key !== "main").every((x) => !x.officialVisionToolRequired));
  assert.deepStrictEqual(new Set(state.campusTools), new Set(canonicalTools.tools.map((x) => x.name)));
  for (const [agent, tools] of Object.entries(canonicalBindings.agents)) assert.deepStrictEqual(state.agents.find((x) => x.key === agent).campusTools, tools);
});

test("CP2 desired prompt hashes and current KB document list are derived from Repo", () => {
  const state = desired.loadDesiredState();
  assert.ok(state.agents.every((x) => /^[a-f0-9]{64}$/.test(x.promptHash)));
  assert.strictEqual(state.knowledge.documents.length, 12);
  assert.ok(state.knowledge.documents.every((x) => x.startsWith("competition/adp-kit/knowledge/current/")));
});

test("CP3 snapshot redaction removes credentials without printing values", () => {
  const authorizationFixture = ["Bearer", ["redaction", "fixture", "value"].join("-")].join(" ");
  const raw = {
    Authorization: authorizationFixture,
    nested: { SecretKey: "secret-value", ordinary: "safe" },
    url: "https://private.example/image.png?token=secret-value",
  };
  const clean = redactDeep(raw);
  assert.strictEqual(clean.Authorization, "[REDACTED]");
  assert.strictEqual(clean.nested.SecretKey, "[REDACTED]");
  assert.strictEqual(clean.nested.ordinary, "safe");
  assert.ok(!JSON.stringify(clean).includes("secret-value"));
  assert.strictEqual(containsCredential(JSON.stringify(clean)), false);
});

test("CP4 drift is classified into safe/manual/blocked and publish is always blocked", () => {
  const state = desired.loadDesiredState();
  const snapshot = desired.makeSyntheticMatchingSnapshot(state);
  snapshot.agents.find((x) => x.key === "schedule").promptHash = "0".repeat(64);
  snapshot.agents.find((x) => x.key === "main").officialVisionToolBound = false;
  snapshot.releaseRequested = true;
  const result = diffState(state, snapshot);
  assert.ok(result.SAFE_AUTOMATABLE.some((x) => x.code === "AGENT_PROMPT_DRIFT"));
  assert.ok(result.MANUAL_CONSOLE_REQUIRED.some((x) => x.code === "MAIN_VISION_TOOL_NOT_BOUND"));
  assert.ok(result.BLOCKED_UNKNOWN.some((x) => x.code === "PUBLISH_FORBIDDEN"));
});

test("CP5 apply defaults to dry-run and performs no mutation", async () => {
  let writes = 0;
  const client = { modifyAgent: async () => { writes += 1; } };
  const result = await applySafePlan({
    plan: [{ action: "ModifyAgent", target: "schedule", updateMask: ["Instructions"], patch: { Instructions: "x" } }],
    client,
    safe: false,
    confirm: false,
  });
  assert.strictEqual(result.mode, "dry-run");
  assert.strictEqual(writes, 0);
});

test("CP6 safe apply requires allowlisted UpdateMask and writes rollback snapshot first", async () => {
  const events = [];
  const rollback = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "adp-rollback-")), "before.json");
  const client = {
    snapshot: async () => ({ agents: [] }),
    modifyAgent: async (request) => events.push(request),
  };
  await assert.rejects(
    applySafePlan({ plan: [{ action: "ModifyAgent", target: "schedule", patch: { Instructions: "x" } }], client, safe: true, confirm: true, rollbackPath: rollback }),
    /UpdateMask/,
  );
  const result = await applySafePlan({
    plan: [{ action: "ModifyAgent", target: "schedule", updateMask: ["Instructions"], patch: { Instructions: "x" } }],
    client, safe: true, confirm: true, rollbackPath: rollback,
  });
  assert.strictEqual(result.applied, 1);
  assert.strictEqual(events.length, 1);
  assert.deepStrictEqual(events[0].UpdateMask, { Paths: ["Instructions"] });
  assert.ok(fs.existsSync(rollback));
  await assert.rejects(
    applySafePlan({ plan: [{ action: "CreateRelease", target: "app", updateMask: ["Name"], patch: {} }], client, safe: true, confirm: true, rollbackPath: rollback }),
    /forbidden/i,
  );
});

test("CP7 CloudBase deploy planner only allows changed campusflowAdpTools", () => {
  assert.throws(() => planCloudBaseDeploy({ target: "anotherFunction", localHash: "a", remoteHash: "b" }), /allowlist/i);
  assert.deepStrictEqual(planCloudBaseDeploy({ target: "campusflowAdpTools", localHash: "a", remoteHash: "a" }), { action: "NO_CHANGE", target: "campusflowAdpTools" });
  assert.deepStrictEqual(planCloudBaseDeploy({ target: "campusflowAdpTools", localHash: "a", remoteHash: "b" }).action, "DEPLOY_CHANGED_CODE");
});

test("CP8 CloudBase post-deploy hash tolerates bounded platform propagation only", () => {
  const observed = ["old", "old", "new"];
  const result = waitForRemoteHash({
    target: "campusflowAdpTools",
    envId: "local-test",
    expectedHash: "new",
    attempts: 4,
    fetcher: () => observed.shift(),
    wait: () => {},
  });
  assert.deepStrictEqual(result, { matched: true, attempts: 3, hash: "new" });
});

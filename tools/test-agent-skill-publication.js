#!/usr/bin/env node
// P4a：Skill 参考发布适配器 + 内核端到端（tasks.md P4a「最小 Skill 参考 Adapter」）。
//   - 声明式校验：未知技能/越权 Tool/越权 Goal/非法字段/空发布一律拒绝；
//   - 可执行行为（planBuilder）只来自插件静态代码，payload 无法注入 JS；
//   - 发布 v2 → 新快照绑定新目录（禁用技能消失）；在途旧快照仍可执行旧版本；
//   - rollback → 新快照回到旧目录；Decision 层按绑定目录解析（覆盖目录缺技能时
//     确定性决策报 DECISION_SKILL_NOT_FOUND，不静默改用静态全量集）。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createConfigKernel, createConfigKernelFileRepository } = require("../packages/agent-runtime");
const { createSkillCatalog, createSkillPublicationAdapter } = require("../packages/skill-runtime");
const { createDecisionService } = require("../server/src/services/ai/decision/decisionService");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-publication-"));
}

const STATIC_SKILLS = [
  {
    id: "teaching_week",
    version: "3",
    description: "查询当前教学周",
    supportedGoals: ["get_teaching_week"],
    allowedTools: ["getTeachingWeek"],
    runtimeModes: ["public", "trial", "dev"],
    planBuilder: () => [{ tool: "getTeachingWeek" }],
  },
  {
    id: "campus_map",
    version: "1",
    description: "校园地点查询",
    supportedGoals: ["find_place"],
    allowedTools: ["searchPlaces"],
    runtimeModes: ["public", "trial", "dev"],
  },
];

function testAdapterValidation() {
  const adapter = createSkillPublicationAdapter({ staticSkills: STATIC_SKILLS });
  const base = adapter.seedPayload();

  assert.strictEqual(adapter.validate(base).ok, true, "seed payload must validate");

  const cases = [
    ["unknown skill id", (p) => { p.skills.push({ id: "made_up_skill" }); }],
    ["tool outside static set", (p) => { p.skills[0].allowedTools = ["getTeachingWeek", "dropTables"]; }],
    ["goal outside static set", (p) => { p.skills[0].supportedGoals = ["get_teaching_week", "hack_everything"]; }],
    ["non-whitelisted field", (p) => { p.skills[0].evil = true; }],
    ["empty publication", (p) => { p.skills = []; }],
    ["non-boolean enabled", (p) => { p.skills[0].enabled = "yes"; }],
    ["runtimeMode outside whitelist", (p) => { p.skills[0].runtimeModes = ["prod"]; }],
    ["duplicate id", (p) => { p.skills.push(Object.assign({}, p.skills[0])); }],
  ];
  cases.forEach(([name, mutate]) => {
    const payload = JSON.parse(JSON.stringify(base));
    mutate(payload);
    const report = adapter.validate(payload);
    assert.strictEqual(report.ok, false, `${name} must be rejected`);
    assert.ok(report.errors.length > 0, `${name} must report errors`);
  });
  console.log("✓ declarative validation rejects unknown/unauthorized/non-declarative publications");
}

function testExecutableMerge() {
  const adapter = createSkillPublicationAdapter({ staticSkills: STATIC_SKILLS });
  const payload = JSON.parse(JSON.stringify(adapter.seedPayload()));
  payload.skills[1].enabled = false;
  const normalized = adapter.validate(payload).normalized;
  const report = adapter.test(normalized);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.results.skillCount, 1);
  assert.strictEqual(report.results.withPlanBuilder, 1, "planBuilder must come from static plugin code");
  const runtimeSkills = adapter.resolveRuntime({ payload: normalized });
  assert.strictEqual(runtimeSkills.length, 1);
  assert.strictEqual(runtimeSkills[0].id, "teaching_week");
  assert.strictEqual(typeof runtimeSkills[0].planBuilder, "function");
  assert.strictEqual(runtimeSkills[0].enabled, undefined, "enabled is a publication flag, not a runtime field");
  console.log("✓ executable behavior merges from static code only; disabled skills are filtered");
}

function testKernelEndToEnd() {
  const adapter = createSkillPublicationAdapter({ staticSkills: STATIC_SKILLS });
  const kernel = createConfigKernel({
    repository: createConfigKernelFileRepository({ root: tmpRoot() }),
    domainAdapters: { skill: adapter },
    environments: ["trial"],
  });

  // 种子：v1 全量
  const seedPayload = adapter.seedPayload();
  const { sha256Digest } = require("../packages/agent-runtime");
  kernel.seedEnvironment("trial", [{
    domain: "skill",
    artifactId: "campus",
    payload: seedPayload,
    sourceDigest: sha256Digest(seedPayload),
  }]);
  const snapshotV1 = kernel.getCurrentSnapshot("trial");
  assert.strictEqual(snapshotV1.artifacts["skill:campus"].version, 1);
  assert.strictEqual(snapshotV1.artifacts["skill:campus"].summary.skillCount, 2);

  // 发布 v2：禁用 campus_map
  const draftPayload = JSON.parse(JSON.stringify(seedPayload));
  draftPayload.skills[1].enabled = false;
  const draftInput = { domain: "skill", artifactId: "campus", environment: "trial", payload: draftPayload, actor: "admin1" };
  kernel.saveDraft(draftInput);
  assert.strictEqual(kernel.validateDraft(draftInput).ok, true);
  assert.strictEqual(kernel.testDraft(draftInput).ok, true);
  const published = kernel.publishDraft(draftInput);
  assert.strictEqual(published.version, 2);
  const snapshotV2 = kernel.getCurrentSnapshot("trial");
  assert.notStrictEqual(snapshotV2.configVersion, snapshotV1.configVersion);
  assert.strictEqual(snapshotV2.artifacts["skill:campus"].summary.skillCount, 1);

  // 新 Run 绑定：v2 目录不再提供 campus_map；在途 Run 持有的 v1 快照仍可解析
  const catalogV2 = createSkillCatalog({
    skills: adapter.resolveRuntime(kernel.getArtifactVersion({
      domain: "skill", artifactId: "campus", environment: "trial", version: 2,
    })),
  });
  assert.strictEqual(catalogV2.get("campus_map"), null);
  assert.ok(catalogV2.get("teaching_week"));
  const catalogV1InFlight = createSkillCatalog({
    skills: adapter.resolveRuntime(kernel.getArtifactVersion({
      domain: "skill", artifactId: "campus", environment: "trial", version: 1,
    })),
  });
  assert.ok(catalogV1InFlight.get("campus_map"), "in-flight runs keep the old published skill set");

  // rollback：新快照回到 v1 目录
  kernel.rollback({ domain: "skill", artifactId: "campus", environment: "trial", toVersion: 1, actor: "ops" });
  const snapshotV3 = kernel.getCurrentSnapshot("trial");
  assert.strictEqual(snapshotV3.artifacts["skill:campus"].version, 1);
  assert.notStrictEqual(snapshotV3.configVersion, snapshotV1.configVersion, "rollback produces a new snapshot");
  assert.strictEqual(snapshotV3.artifacts["skill:campus"].summary.skillCount, 2);
  console.log("✓ publish → new-run binding → in-flight stability → rollback closed loop");
}

async function testDecisionUsesBoundCatalog() {
  const staticCatalog = createSkillCatalog({ skills: STATIC_SKILLS });
  const decisionService = createDecisionService({
    providerRuntime: { generateStructured: async () => { throw new Error("must not be called in deterministic mode"); } },
    skillCatalog: staticCatalog,
    deterministicResolve: (message) => ({ name: message === "place" ? "find_place" : "get_teaching_week", slots: {} }),
  });

  // 静态目录（默认注入）可解析两个目标
  // 覆盖目录缺少 campus_map：同一意图在绑定目录下报 DECISION_SKILL_NOT_FOUND，
  // 不静默回落静态全量集（发布语义必须等于执行语义）。
  const boundCatalog = createSkillCatalog({ skills: [STATIC_SKILLS[0]] });
  return decisionService.decide({
    message: "place",
    context: {},
    runtimeMode: "public",
    skillCatalog: boundCatalog,
  }).then(() => {
    throw new Error("decide must fail when the bound catalog lacks the resolved skill");
  }, (error) => {
    assert.strictEqual(error.code, "DECISION_SKILL_NOT_FOUND");
    console.log("✓ decision resolves against the snapshot-bound catalog, never a hidden superset");
  });
}

// P4a 审查跟进（M2/M6）：发布物 runtimeModes 不得超出静态技能自身集合
// （授权不扩大）；静态空集 = 全模式，此时允许三元组内任意子集且语义不收窄。
function testRuntimeModesBoundedByStaticSkill() {
  const restricted = {
    id: "trial_only_skill",
    supportedGoals: ["trial_goal"],
    allowedTools: [],
    runtimeModes: ["trial"],
  };
  const allModes = {
    id: "all_modes_skill",
    supportedGoals: ["all_goal"],
    allowedTools: [],
    runtimeModes: [],
  };
  const adapter = createSkillPublicationAdapter({ staticSkills: [restricted, allModes] });
  const base = adapter.seedPayload();

  const widen = JSON.parse(JSON.stringify(base));
  widen.skills[0].runtimeModes = ["public", "trial"];
  const widenReport = adapter.validate(widen);
  assert.strictEqual(widenReport.ok, false, "publishing must not add modes beyond the static skill set");
  assert.ok(widenReport.errors.some((line) => line.includes("outside the plugin static set")));

  const narrow = JSON.parse(JSON.stringify(base));
  narrow.skills[0].runtimeModes = ["trial"];
  assert.strictEqual(adapter.validate(narrow).ok, true, "narrowing within the static set is allowed");

  // 静态空集（= 全模式语义）：允许三元组任意子集；种子投影必须保留空集不收窄。
  assert.deepStrictEqual(base.skills[1].runtimeModes, [], "seed projection preserves the all-modes empty set");
  const subset = JSON.parse(JSON.stringify(base));
  subset.skills[1].runtimeModes = ["dev"];
  const subsetReport = adapter.validate(subset);
  assert.strictEqual(subsetReport.ok, true, "static empty set means all modes; any triple subset is allowed");
  assert.deepStrictEqual(subsetReport.normalized.skills[1].runtimeModes, ["dev"]);
  const omittedReport = adapter.validate(JSON.parse(JSON.stringify(base)));
  assert.strictEqual(omittedReport.ok, true);
  assert.deepStrictEqual(omittedReport.normalized.skills[1].runtimeModes, [], "omitted runtimeModes inherit the static empty set (all modes)");
  console.log("✓ runtimeModes bounded by the static skill set; empty static set keeps all-modes semantics");
}

// P4a 审查跟进（Important #1）：模型路径 validate 回调必须按绑定目录校验。
// 两个目录含相同技能但 goal→skill 映射顺序不同：绑定目录映射 skill_beta，
// 静态目录映射 skill_alpha。契约选择 skill_beta，按绑定目录合法；若 validate
// 漏用静态目录（修复前），getSkillForIntent 映射拒绝 → 合法契约被错误拒绝。
async function testModelPathValidateUsesBoundCatalog() {
  const skillAlpha = {
    id: "skill_alpha",
    supportedGoals: ["get_teaching_week"],
    allowedTools: [],
    runtimeModes: ["public", "trial", "dev"],
  };
  const skillBeta = {
    id: "skill_beta",
    supportedGoals: ["get_teaching_week"],
    allowedTools: [],
    runtimeModes: ["public", "trial", "dev"],
  };
  const staticCatalog = createSkillCatalog({ skills: [skillAlpha, skillBeta] });
  const boundCatalog = createSkillCatalog({ skills: [skillBeta, skillAlpha] });
  assert.strictEqual(staticCatalog.getSkillForIntent("get_teaching_week").id, "skill_alpha");
  assert.strictEqual(boundCatalog.getSkillForIntent("get_teaching_week").id, "skill_beta");
  const contract = {
    schemaVersion: "decision.v2",
    goal: { name: "get_teaching_week", confidence: 0.9, requiresClarification: false },
    entities: [],
    constraints: {},
    skillCandidates: [{ skillId: "skill_beta", confidence: 0.9 }],
    plan: { steps: [{ id: "s1", skillId: "skill_beta", purpose: "run beta" }] },
    responseMode: "deterministic",
  };
  const providerRuntime = {
    async generateStructured(input) {
      const validated = input.validate(contract);
      return {
        contract: validated,
        provider: "primary",
        intendedProvider: "primary",
        actualFirstProvider: "primary",
        fallbackPath: ["primary:success"],
      };
    },
  };
  const decisionService = createDecisionService({
    providerRuntime,
    skillCatalog: staticCatalog,
    deterministicResolve: () => ({ name: "get_teaching_week", confidence: 1, slots: {} }),
  });
  const result = await decisionService.decide({
    message: "现在第几教学周？",
    runtimeMode: "trial",
    executionPolicy: "strict_model_first",
    providerRuntimeConfig: { AI_AGENT_ENABLED: "true", AI_PROVIDER: "primary" },
    context: {},
    skillCatalog: boundCatalog,
    contextView: {
      contextId: "ctx_bound_validate",
      currentTurn: { message: "现在第几教学周？", runtimeMode: "trial" },
      workingState: {},
      recentMessages: [],
      rollingSummary: "",
      memories: [],
      episodes: [],
    },
  });
  assert.strictEqual(result.selectedSkillId, "skill_beta", "model-path validate must honor the snapshot-bound catalog");
  console.log("✓ model-path validate callback resolves against the bound catalog (Important #1)");
}

async function run() {
  testAdapterValidation();
  testRuntimeModesBoundedByStaticSkill();
  testExecutableMerge();
  testKernelEndToEnd();
  await testDecisionUsesBoundCatalog();
  await testModelPathValidateUsesBoundCatalog();
  console.log("\ntest-agent-skill-publication: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

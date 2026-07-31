#!/usr/bin/env node
// P4b：统一 domain adapter conformance suite（tasks.md P4b 验收项；P4c/P4d 扩展至六域）。
// 同一份契约对六个发布域各跑一遍（Skill 参考适配器 + Provider/Tool/Memory/MCP/RAG）：
//   1. 域协议方法集完整（domain/validate/test/composeSnapshotEntry/resolveRuntime/seedPayload）；
//   2. 种子 ≡ 静态默认：seed validate+test 通过，resolveRuntime(seed) 等价静态默认语义；
//   3. 非声明式/越权发布物一律拒绝（含各域专项非法载荷）；
//   4. 内核闭环：seed → publish → 新快照绑定 → 在途旧版本仍可解析 → rollback 恢复；
//   5. resolveRuntime 对非法版本文档 fail closed（coded 错误，不静默兜底）。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createConfigKernel,
  createConfigKernelFileRepository,
  createMemoryPolicyPublicationAdapter,
  sha256Digest,
} = require("../packages/agent-runtime");
const { createSkillPublicationAdapter } = require("../packages/skill-runtime");
const { createProviderPublicationAdapter } = require("../packages/provider-runtime");
const { createToolPublicationAdapter } = require("../packages/tool-runtime");
const { createMcpPublicationAdapter } = require("../packages/mcp-runtime");
const { createRagPublicationAdapter } = require("../packages/rag-runtime");

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `domain-conformance-${label}-`));
}

const STATIC_SKILLS = [
  {
    id: "teaching_week",
    version: "3",
    description: "查询当前教学周",
    supportedGoals: ["get_teaching_week"],
    allowedTools: ["get_teaching_week"],
    runtimeModes: ["public", "trial", "dev"],
    planBuilder: () => [{ tool: "get_teaching_week" }],
  },
  {
    id: "campus_map",
    version: "1",
    description: "校园地点查询",
    supportedGoals: ["find_place"],
    allowedTools: ["search_campus_place"],
    runtimeModes: [],
  },
];
const STATIC_TOOLS = [
  { id: "get_teaching_week", runtimeModes: [] },
  { id: "search_campus_place", runtimeModes: ["public", "trial"] },
];

const DOMAINS = [
  {
    domain: "skill",
    createAdapter: () => createSkillPublicationAdapter({ staticSkills: STATIC_SKILLS }),
    validChange(seed) {
      const payload = JSON.parse(JSON.stringify(seed));
      payload.skills[1].enabled = false;
      return payload;
    },
    invalidPayloads(seed) {
      return [
        ["unknown skill id", (() => { const p = JSON.parse(JSON.stringify(seed)); p.skills.push({ id: "made_up" }); return p; })()],
        ["non-declarative entry field", (() => { const p = JSON.parse(JSON.stringify(seed)); p.skills[0].evil = true; return p; })()],
      ];
    },
    assertSeedRuntime(runtime) {
      assert.strictEqual(runtime.length, 2, "seed runtime = full static skill set");
      assert.strictEqual(typeof runtime[0].planBuilder, "function", "executable behavior merges from static code");
    },
    assertChangedRuntime(runtime) {
      assert.strictEqual(runtime.length, 1, "disabled skill filtered from runtime");
      assert.strictEqual(runtime[0].id, "teaching_week");
    },
  },
  {
    domain: "provider",
    createAdapter: () => createProviderPublicationAdapter({ knownProviderIds: ["deepseek", "mock"] }),
    validChange(seed) {
      return Object.assign(JSON.parse(JSON.stringify(seed)), {
        providerChain: ["deepseek", "mock"],
        timeoutMs: 8000,
      });
    },
    invalidPayloads(seed) {
      return [
        ["unknown provider id", Object.assign(JSON.parse(JSON.stringify(seed)), { providerChain: ["not_a_provider"] })],
        ["secret material", Object.assign(JSON.parse(JSON.stringify(seed)), { stageProviders: { decision: "deepseek", apiKey: "x" } })],
        ["deterministic policy not publishable", Object.assign(JSON.parse(JSON.stringify(seed)), { executionPolicy: "deterministic" })],
      ];
    },
    assertSeedRuntime(runtime) {
      assert.deepStrictEqual(runtime, {}, "empty overlay = inherit existing env/store resolution");
    },
    assertChangedRuntime(runtime) {
      assert.deepStrictEqual(runtime.providerChain, ["deepseek", "mock"]);
      assert.strictEqual(runtime.timeoutMs, 8000);
    },
  },
  {
    domain: "tool",
    createAdapter: () => createToolPublicationAdapter({ staticTools: STATIC_TOOLS }),
    validChange(seed) {
      const payload = JSON.parse(JSON.stringify(seed));
      payload.tools.push({ id: "search_campus_place", enabled: false });
      return payload;
    },
    invalidPayloads(seed) {
      return [
        ["unknown tool id", { tools: [{ id: "drop_tables" }] }],
        ["mode widening beyond static set", { tools: [{ id: "search_campus_place", runtimeModes: ["public", "dev"] }] }],
        ["non-declarative entry field", { tools: [{ id: "search_campus_place", execute: "evil" }] }],
      ];
    },
    assertSeedRuntime(runtime) {
      assert.deepStrictEqual(runtime.disabled, [], "seed disables nothing");
      assert.deepStrictEqual(runtime.modeOverrides, {}, "seed overrides nothing");
    },
    assertChangedRuntime(runtime) {
      assert.deepStrictEqual(runtime.disabled, ["search_campus_place"]);
    },
  },
  {
    domain: "memory",
    createAdapter: () => createMemoryPolicyPublicationAdapter({ knownTtlKeys: ["session_fact", "preference"] }),
    validChange(seed) {
      return Object.assign(JSON.parse(JSON.stringify(seed)), {
        minConfidence: 0.9,
        ttlOverridesMs: { session_fact: 7200000 },
      });
    },
    invalidPayloads(seed) {
      return [
        ["unknown ttl key", { ttlOverridesMs: { not_a_key: 7200000 } }],
        ["unbounded ttl", { ttlOverridesMs: { session_fact: 1000 } }],
        ["content carrier field", { memoryContent: "user secret" }],
      ];
    },
    assertSeedRuntime(runtime) {
      assert.deepStrictEqual(runtime, {}, "empty policy = static memory defaults");
    },
    assertChangedRuntime(runtime) {
      assert.strictEqual(runtime.minConfidence, 0.9);
      assert.deepStrictEqual(runtime.ttlOverridesMs, { session_fact: 7200000 });
    },
  },
  {
    domain: "mcp",
    createAdapter: () => createMcpPublicationAdapter({ knownCommands: ["node"], allowInsecureHttp: true }),
    validChange(seed) {
      return {
        servers: [{
          id: "kb-remote",
          transport: "http",
          url: "https://mcp.example.com/mcp",
          authEnvVar: "MCP_KB_TOKEN",
          allowedTools: ["kb_search"],
        }],
      };
    },
    invalidPayloads(seed) {
      return [
        ["untrusted stdio command", { servers: [{ id: "s1", transport: "stdio", command: "bash", allowedTools: ["a"] }] }],
        ["secret smuggled in registry", { servers: [{ id: "s1", transport: "http", url: "https://mcp.example.com", allowedTools: ["a"], apiKey: "sk-x" }] }],
        ["writeTools outside allowedTools", { servers: [{ id: "s1", transport: "http", url: "https://mcp.example.com", allowedTools: ["a"], writeTools: ["b"] }] }],
      ];
    },
    assertSeedRuntime(runtime) {
      assert.deepStrictEqual(runtime, { servers: [] }, "seed registry = no MCP servers");
    },
    assertChangedRuntime(runtime) {
      assert.strictEqual(runtime.servers.length, 1);
      assert.strictEqual(runtime.servers[0].id, "kb-remote");
      assert.strictEqual(runtime.servers[0].authEnvVar, "MCP_KB_TOKEN", "auth kept as reference name");
    },
  },
  {
    domain: "rag",
    createAdapter: () => createRagPublicationAdapter(),
    validChange(seed) {
      const payload = JSON.parse(JSON.stringify(seed));
      payload.documents.push({
        docId: "run-recovery",
        title: "Run recovery",
        kind: "note",
        text: "A run can be resumed from its last acknowledged cursor. Final results are recoverable after a reconnect.",
      });
      payload.retrieval = Object.assign({}, payload.retrieval, { topK: 3 });
      return payload;
    },
    invalidPayloads(seed) {
      return [
        ["structured campus fact kind", (() => {
          const p = JSON.parse(JSON.stringify(seed));
          p.documents.push({ docId: "week-facts", title: "Week facts", kind: "teaching_week", text: "current week is 12" });
          return p;
        })()],
        ["credential-shaped text", (() => {
          const p = JSON.parse(JSON.stringify(seed));
          p.documents.push({ docId: "leaked", title: "Leaked", text: "example api_key: abcd1234efgh5678" });
          return p;
        })()],
        ["non-public uri", (() => {
          const p = JSON.parse(JSON.stringify(seed));
          p.documents.push({ docId: "internal", title: "Internal", uri: "https://127.0.0.1/notes" });
          return p;
        })()],
        ["non-declarative field", Object.assign(JSON.parse(JSON.stringify(seed)), { execute: "evil" })],
      ];
    },
    assertSeedRuntime(runtime) {
      assert.strictEqual(runtime.kbId, "platform-example", "seed = builtin read-only example KB");
      assert.strictEqual(runtime.documents.length, 1);
      assert.strictEqual(runtime.encoder.encoderType, "deterministic-local-v3", "runtime carries the encoder manifest");
    },
    assertChangedRuntime(runtime) {
      assert.strictEqual(runtime.documents.length, 2);
      assert.strictEqual(runtime.retrieval.topK, 3);
    },
  },
];

function runDomainAdapterConformance(spec) {
  const adapter = spec.createAdapter();
  const label = `[${spec.domain}]`;

  // 1. 域协议方法集
  assert.strictEqual(adapter.domain, spec.domain, `${label} domain name`);
  ["validate", "test", "composeSnapshotEntry", "resolveRuntime", "seedPayload"].forEach((method) => {
    assert.strictEqual(typeof adapter[method], "function", `${label} must expose ${method}()`);
  });

  // 2. 种子 ≡ 静态默认
  const seed = adapter.seedPayload();
  const seedValidation = adapter.validate(seed);
  assert.strictEqual(seedValidation.ok, true, `${label} seed must validate: ${seedValidation.errors}`);
  assert.strictEqual(adapter.test(seedValidation.normalized).ok, true, `${label} seed must pass pre-publish test`);
  spec.assertSeedRuntime(adapter.resolveRuntime({ payload: seed }));
  const seedSnapshotEntry = adapter.composeSnapshotEntry({ payload: seed });
  assert.ok(seedSnapshotEntry && typeof seedSnapshotEntry === "object", `${label} composeSnapshotEntry returns summary`);

  // 3. 非声明式/越权拒绝
  assert.strictEqual(adapter.validate(null).ok, false, `${label} rejects non-object payload`);
  assert.strictEqual(adapter.validate([1, 2]).ok, false, `${label} rejects array payload`);
  spec.invalidPayloads(seed).forEach(([name, payload]) => {
    const report = adapter.validate(payload);
    assert.strictEqual(report.ok, false, `${label} must reject: ${name}`);
    assert.ok(report.errors.length > 0, `${label} must report errors for: ${name}`);
  });

  // 4. resolveRuntime 对非法版本文档 fail closed
  assert.throws(
    () => adapter.resolveRuntime(null),
    (error) => error && typeof error.code === "string" && error.code.length > 0,
    `${label} resolveRuntime must throw a coded error on missing version doc`
  );

  // 5. 内核闭环：seed → publish → 在途稳定 → rollback
  const kernel = createConfigKernel({
    repository: createConfigKernelFileRepository({ root: tmpRoot(spec.domain) }),
    domainAdapters: { [spec.domain]: adapter },
    environments: ["trial"],
  });
  kernel.seedEnvironment("trial", [{
    domain: spec.domain,
    artifactId: "artifact",
    payload: seed,
    sourceDigest: sha256Digest(seed),
  }]);
  const snapshotV1 = kernel.getCurrentSnapshot("trial");
  assert.strictEqual(snapshotV1.artifacts[`${spec.domain}:artifact`].version, 1, `${label} seed pins v1`);

  const changePayload = spec.validChange(seed);
  const draftInput = {
    domain: spec.domain,
    artifactId: "artifact",
    environment: "trial",
    payload: changePayload,
    actor: "conformance",
  };
  kernel.saveDraft(draftInput);
  assert.strictEqual(kernel.validateDraft(draftInput).ok, true, `${label} change draft validates`);
  assert.strictEqual(kernel.testDraft(draftInput).ok, true, `${label} change draft passes pre-publish test`);
  const published = kernel.publishDraft(draftInput);
  assert.strictEqual(published.version, 2, `${label} publish bumps version`);
  const snapshotV2 = kernel.getCurrentSnapshot("trial");
  assert.notStrictEqual(snapshotV2.configVersion, snapshotV1.configVersion, `${label} publish produces a new snapshot`);

  // 新快照绑定新版本；在途旧快照仍可解析旧版本（发布不影响在途 Run）
  spec.assertChangedRuntime(adapter.resolveRuntime(kernel.getArtifactVersion({
    domain: spec.domain, artifactId: "artifact", environment: "trial", version: 2,
  })));
  spec.assertSeedRuntime(adapter.resolveRuntime(kernel.getArtifactVersion({
    domain: spec.domain, artifactId: "artifact", environment: "trial", version: 1,
  })));

  kernel.rollback({ domain: spec.domain, artifactId: "artifact", environment: "trial", toVersion: 1, actor: "conformance" });
  const snapshotV3 = kernel.getCurrentSnapshot("trial");
  assert.strictEqual(snapshotV3.artifacts[`${spec.domain}:artifact`].version, 1, `${label} rollback re-pins v1`);
  assert.notStrictEqual(snapshotV3.configVersion, snapshotV1.configVersion, `${label} rollback produces a new snapshot`);
  console.log(`✓ ${label} contract: methods / seed-default / rejection / kernel roundtrip / in-flight stability / rollback`);
}

DOMAINS.forEach(runDomainAdapterConformance);
console.log(`\ntest-domain-adapter-conformance: PASS (${DOMAINS.length} domains)`);

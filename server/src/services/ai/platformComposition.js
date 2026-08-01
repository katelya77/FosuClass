const { createAgentRuntime, createContextAssembler, createConfigKernel, createConfigKernelFileRepository, createConfigKernelPgRepository, createMemoryPolicyPublicationAdapter, createEngineRegistry, engineTraceMetadata, sha256Digest } = require("../../../../packages/agent-runtime");
const { EXECUTION_POLICIES, createMetricsStore, createProviderPublicationAdapter, overlayToRuntimeConfig, resolveExecutionPolicy } = require("../../../../packages/provider-runtime");
const platformProtocol = require("../../../../packages/agent-protocol");
const uiSchema = require("../../../../packages/ui-schema");
const { createSkillCatalog, createSkillPublicationAdapter } = require("../../../../packages/skill-runtime");
const { createToolRuntime, createToolPublicationAdapter } = require("../../../../packages/tool-runtime");
const { createMcpPublicationAdapter, createMcpRuntime } = require("../../../../packages/mcp-runtime");
const { createRagPublicationAdapter } = require("../../../../packages/rag-runtime");
const { createRagIndexService } = require("./ragIndexService");
const { createAgentPlatform, createRunHandlers } = require("../../../../apps/agent-server");
const { createFosuEngine } = require("./engine/fosuEngine");
const { createFosuCampusPlugin, createFosuStages } = require("../../../../plugins/fosu-campus");
const path = require("path");

const capabilityManifestService = require("./capabilityManifestService");
const skillRegistry = require("./skillRegistry");
const toolRegistry = require("./toolRegistry");
const toolSchemaRegistry = require("./generated/toolSchemas.generated");
const responseComposer = require("./responseComposer");
const releaseService = require("../releaseService");
const agentProtocol = require("./agentProtocol");
const { AgentKernel } = require("./agentKernel");
const { createFosuTurnPorts } = require("./runtime/fosuTurnPorts");
const { createDecisionService } = require("./decision/decisionService");
const providerRuntimeComposition = require("./providerRuntimeComposition");
const providerConfigService = require("./providerConfigService");
const providerReadinessService = require("./providerReadinessService");
const runtimeModeService = require("./runtimeModeService");
const safetyGuard = require("./safetyGuard");
const memoryPolicy = require("./memory/memoryPolicy");
const { resolveRepositoryBackend } = require("./persistence/repositoryBackend");

const recentPlatformTraces = [];
let runHandlers = null;

const plugin = createFosuCampusPlugin({
  capabilityManifestService,
  skillRegistry,
  toolRegistry,
  toolSchemaRegistry,
  responseComposer,
  releaseService,
  mapResultToBlocks: uiSchema.blocksFromAgentResult,
});
const platformSkillCatalog = createSkillCatalog({ skills: plugin.skills });
const platformToolRuntime = createToolRuntime({ tools: plugin.tools });

// P4a：统一配置发布内核。P5a WS2 起 Repository 后端由
// FOSU_AGENT_REPOSITORY_BACKEND 选择：file（integrated 默认）| postgres
// （standalone）。种子只初始化空环境或升级 seed-origin 版本，admin 发布的
// 内容不会被覆盖。root 遵守全仓 FOSU_DATA_DIR 约定（测试/容器可重定向数据目录）。
const configKernelRoot = process.env.FOSU_AGENT_CONFIG_KERNEL_PATH
  || path.join(path.resolve(process.env.FOSU_DATA_DIR || path.join(__dirname, "../../../data")), "ai", "config-kernel");

function logConfigKernelEvent(entry) {
  try {
    // 延迟加载，避免与日志模块的循环依赖；仅安全事件字段，不含配置内容。
    const { safeLog } = require("../../utils/safeLogger");
    safeLog("config-kernel", entry);
  } catch (_) {
    // 可观测性不得影响配置加载。
  }
}
const skillPublicationAdapter = createSkillPublicationAdapter({ staticSkills: plugin.skills });
// P4b：Provider/Tool/Memory 三域接入同一发布内核。发布物均为纯声明式
// overlay（禁 JS、禁密钥、只能收窄静态能力），种子 ≡ 静态默认（空 overlay）。
const providerPublicationAdapter = createProviderPublicationAdapter({
  knownProviderIds: providerRuntimeComposition.PROVIDER_IDS.concat(["mock"]),
});
const toolPublicationAdapter = createToolPublicationAdapter({
  staticTools: platformToolRuntime.listDescriptors(),
});
const memoryPolicyAdapter = createMemoryPolicyPublicationAdapter({
  knownTtlKeys: Object.keys(memoryPolicy.DEFAULT_TTL_MS),
});
// P4c：MCP 域接入同一发布内核。注册表为纯声明式（鉴权只按环境变量名
// 引用）；stdio 受信命令名集来自部署方环境变量 AGENT_MCP_TRUSTED_COMMANDS
// （JSON：名→绝对路径），默认空集 = stdio 服务器永远不可激活（fail closed）。
function parseTrustedCommands(raw) {
  try {
    const parsed = JSON.parse(String(raw || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .map(([name, value]) => [String(name || "").slice(0, 64), String(value || "")])
      .filter(([name, value]) => name && path.isAbsolute(value)));
  } catch (_) {
    return {};
  }
}
const mcpTrustedCommands = Object.freeze(parseTrustedCommands(process.env.AGENT_MCP_TRUSTED_COMMANDS));
const mcpPublicationAdapter = createMcpPublicationAdapter({
  knownCommands: Object.keys(mcpTrustedCommands),
  allowInsecureHttp: String(process.env.AGENT_MCP_ALLOW_INSECURE_HTTP || "").toLowerCase() === "true",
});
// P4d：RAG 域接入同一发布内核（第 6 域）。发布物是自包含版本化 KB 定义；
// 索引是派生物（确定性可重建），由 ragIndexService 异步构建/持久化/恢复。
const ragPublicationAdapter = createRagPublicationAdapter();
const platformMcpRuntime = createMcpRuntime({
  trustedCommands: mcpTrustedCommands,
  allowInsecureHttp: String(process.env.AGENT_MCP_ALLOW_INSECURE_HTTP || "").toLowerCase() === "true",
  logger: logConfigKernelEvent,
});
const domainAdapters = Object.freeze({
  skill: skillPublicationAdapter,
  provider: providerPublicationAdapter,
  tool: toolPublicationAdapter,
  memory: memoryPolicyAdapter,
  mcp: mcpPublicationAdapter,
  rag: ragPublicationAdapter,
});
// P5a WS2：Repository 后端选择（FOSU_AGENT_REPOSITORY_BACKEND，唯一解析点在
// persistence/repositoryBackend）。postgres 模式经 pgPersistenceService 建 PG
// 适配器；池用门面惰性解析——构造同步、不触网、未配置 PG 也不在 require 期
// 抛错，配置/连接失败统一延迟到 initPlatform() 的 AGENT_PLATFORM_INIT_FAILED。
const repositoryBackend = resolveRepositoryBackend();
function createConfigKernelRepository() {
  if (repositoryBackend === "postgres") {
    const pgPersistenceService = require("./persistence/pgPersistenceService");
    const lazyPool = {
      query: (text, params) => pgPersistenceService.getPool().query(text, params),
      connect: () => pgPersistenceService.getPool().connect(),
    };
    return createConfigKernelPgRepository({ pool: lazyPool });
  }
  return createConfigKernelFileRepository({ root: configKernelRoot });
}
const configKernel = createConfigKernel({
  repository: createConfigKernelRepository(),
  domainAdapters,
  environments: ["public", "trial", "dev"],
  logger: logConfigKernelEvent,
});
const domainSeedEntries = Object.keys(domainAdapters).map((domain) => {
  const payload = domainAdapters[domain].seedPayload();
  return Object.freeze({
    domain,
    artifactId: plugin.id,
    payload,
    sourceDigest: sha256Digest(payload),
  });
});

// P5a WS2：init 模式。require 期只做同步构造（池 lazy 不触网）；迁移与种子
// 统一收敛到 memoized initPlatform()：
//   - postgres：先 runMigrations()（并发安全、checksum fail closed）再全环境种子；
//   - file：仅全环境种子（行为与 P5a 前 require 期种子一致，幂等）。
// init 失败（迁移/连接/种子存储故障）→ memoized promise 以 coded
// AGENT_PLATFORM_INIT_FAILED 拒绝（粘性失败，causeCode 保留底层 code）；
// config-plane 路由与 run 创建链 await platformReady()/initPlatform() 获取该语义。
let initPromise = null;
function initPlatform() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        if (repositoryBackend === "postgres") {
          await require("./persistence/pgPersistenceService").runMigrations();
        }
        for (const environment of configKernel.environments) {
          await configKernel.seedEnvironment(environment, domainSeedEntries);
        }
        return Object.freeze({ backend: repositoryBackend, environments: configKernel.environments.slice() });
      } catch (error) {
        const causeCode = String(error && error.code || "UNKNOWN");
        const wrapped = new Error(`agent platform init failed (${repositoryBackend} backend): ${causeCode}`);
        wrapped.code = "AGENT_PLATFORM_INIT_FAILED";
        wrapped.causeCode = causeCode;
        throw wrapped;
      }
    })();
  }
  return initPromise;
}

function platformReady() {
  return initPlatform();
}

// 按快照绑定的技能目录：发布/回滚只影响新 Run；在途 Run 的快照不可变。
// 解析结果按 (environment, version) 记忆化，目录接口与静态目录一致。
// P5a：内核方法 async 化后本解析器同为 async（缓存命中也返回 Promise）。
const boundCatalogCache = new Map();
async function resolveSkillCatalogForSnapshot(configSnapshot) {
  const artifacts = configSnapshot && configSnapshot.artifacts || null;
  const entry = artifacts && artifacts[`skill:${plugin.id}`];
  const environment = configSnapshot && configSnapshot.environment;
  if (!entry || !environment) return platformSkillCatalog;
  const cacheKey = `${environment}:${entry.version}`;
  if (!boundCatalogCache.has(cacheKey)) {
    let versionDoc = null;
    try {
      versionDoc = await configKernel.getArtifactVersion({
        domain: "skill",
        artifactId: plugin.id,
        environment,
        version: entry.version,
      });
    } catch (error) {
      // 快照明确钉住的版本文档不可读（含 digest 篡改）：这是配置完整性故障，
      // 不得静默回落静态全量目录（已禁用技能复活 = 授权漂移）。fail closed
      // 抛 coded 错误、记录安全日志，且失败结果不缓存（存储修复后无需重启）。
      logConfigKernelEvent({
        event: "skill-catalog-unreadable",
        environment,
        version: String(entry.version || ""),
        code: String(error && error.code || "UNKNOWN"),
      });
      const failure = new Error(`Published skill catalog version is unreadable: ${String(entry.version || "")}`);
      failure.code = "DECISION_SKILL_CATALOG_UNREADABLE";
      throw failure;
    }
    boundCatalogCache.set(cacheKey, createSkillCatalog({ skills: skillPublicationAdapter.resolveRuntime(versionDoc) }));
    if (boundCatalogCache.size > 24) {
      const oldest = boundCatalogCache.keys().next().value;
      boundCatalogCache.delete(oldest);
    }
  }
  return boundCatalogCache.get(cacheKey);
}

// P4b：Provider/Tool/Memory 按快照解析，与 Skill 目录同一不变量：发布/回滚
// 只影响新 Run；在途 Run 快照不可变；按 (environment, version) 记忆化；快照
// 钉住的版本不可读 = 配置完整性故障，fail closed（失败结果不缓存）。
const boundDomainRuntimeCache = { provider: new Map(), tool: new Map(), memory: new Map(), mcp: new Map(), rag: new Map() };
const DOMAIN_UNREADABLE_CODES = Object.freeze({
  provider: "PROVIDER_CONFIG_UNREADABLE",
  tool: "TOOL_CONFIG_UNREADABLE",
  memory: "MEMORY_POLICY_UNREADABLE",
  mcp: "MCP_REGISTRY_UNREADABLE",
  rag: "RAG_CONFIG_UNREADABLE",
});
// 空 overlay 的解析结果 = 静态默认（等价 P4b 前行为），预先解析一次复用。
const defaultDomainRuntime = Object.freeze(Object.fromEntries(Object.keys(domainAdapters).map((domain) => [
  domain,
  domainAdapters[domain].resolveRuntime({ payload: domainAdapters[domain].seedPayload() }),
])));
async function resolveDomainRuntimeForSnapshot(domain, configSnapshot) {
  const artifacts = configSnapshot && configSnapshot.artifacts || null;
  const entry = artifacts && artifacts[`${domain}:${plugin.id}`];
  const environment = configSnapshot && configSnapshot.environment;
  if (!entry || !environment) return defaultDomainRuntime[domain];
  const cache = boundDomainRuntimeCache[domain];
  const cacheKey = `${environment}:${entry.version}`;
  if (!cache.has(cacheKey)) {
    let versionDoc = null;
    try {
      versionDoc = await configKernel.getArtifactVersion({
        domain,
        artifactId: plugin.id,
        environment,
        version: entry.version,
      });
    } catch (error) {
      logConfigKernelEvent({
        event: `${domain}-config-unreadable`,
        environment,
        version: String(entry.version || ""),
        code: String(error && error.code || "UNKNOWN"),
      });
      const failure = new Error(`Published ${domain} config version is unreadable: ${String(entry.version || "")}`);
      failure.code = DOMAIN_UNREADABLE_CODES[domain];
      throw failure;
    }
    cache.set(cacheKey, domainAdapters[domain].resolveRuntime(versionDoc));
    if (cache.size > 24) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }
  return cache.get(cacheKey);
}
function resolveProviderOverlayForSnapshot(configSnapshot) {
  return resolveDomainRuntimeForSnapshot("provider", configSnapshot);
}
function resolveToolOverlayForSnapshot(configSnapshot) {
  return resolveDomainRuntimeForSnapshot("tool", configSnapshot);
}
function resolveMemoryPolicyForSnapshot(configSnapshot) {
  return resolveDomainRuntimeForSnapshot("memory", configSnapshot);
}
function resolveMcpRegistryForSnapshot(configSnapshot) {
  return resolveDomainRuntimeForSnapshot("mcp", configSnapshot);
}

// P4d：RAG 索引服务。队列/索引落在内核 root 下（`rag-indexes/` 与
// `rag-index-queue.json`）；reclaim 时经 resolveArtifact 从内核重取发布物，
// 队列不复制文档内容（内核是唯一内容源）。
const ragIndexService = createRagIndexService({
  root: configKernelRoot,
  logger: logConfigKernelEvent,
  async resolveArtifact({ environment, artifactId, version }) {
    const versionDoc = await configKernel.getArtifactVersion({ domain: "rag", artifactId, environment, version });
    return ragPublicationAdapter.resolveRuntime(versionDoc);
  },
});

// RAG 快照解析 = 通用域解析 + 索引同步钩子：新快照钉住的版本若未构建，
// 以稳定 jobId 入队异步构建（幂等，不阻塞在线 Run）；查询在索引就绪前
// 按 lkg 语义降级或如实返回不可用，绝不返回草稿内容。
async function resolveRagArtifactForSnapshot(configSnapshot) {
  const artifact = await resolveDomainRuntimeForSnapshot("rag", configSnapshot);
  const entry = configSnapshot && configSnapshot.artifacts && configSnapshot.artifacts[`rag:${plugin.id}`];
  const environment = configSnapshot && configSnapshot.environment;
  if (entry && environment && artifact && artifact.kbId) {
    try {
      await ragIndexService.requestBuild({
        environment,
        artifactId: plugin.id,
        kbId: artifact.kbId,
        version: entry.version,
      });
    } catch (error) {
      // 入队失败不阻断解析（查询路径会如实降级），但必须留安全信号。
      logConfigKernelEvent({
        event: "rag-index-enqueue-failed",
        environment,
        version: String(entry.version || ""),
        code: String(error && error.code || "UNKNOWN"),
      });
    }
  }
  return artifact;
}

// 生产查询路径（P4d 契约测试与 P4e 控制面/工具接线共用）：快照钉住版本 →
// 索引服务 → 四模式查询链。无快照钉住时如实降级（不发明内容）。
async function queryRagForSnapshot(configSnapshot, input = {}) {
  const artifact = await resolveRagArtifactForSnapshot(configSnapshot);
  const entry = configSnapshot && configSnapshot.artifacts && configSnapshot.artifacts[`rag:${plugin.id}`];
  const environment = configSnapshot && configSnapshot.environment;
  if (!entry || !environment || !artifact || !artifact.kbId) {
    return Object.freeze({ hits: Object.freeze([]), reason: "rag_not_configured", kbId: artifact && artifact.kbId || "" });
  }
  return ragIndexService.query({
    environment,
    kbId: artifact.kbId,
    version: entry.version,
    query: input.query,
    mode: input.mode,
    topK: input.topK,
  });
}

function resolveSnapshotEnvironment(request) {
  // 优先请求作用域模式（bindRuntimeDecision 的授权感知决策，经 platformInput
  // 传入）；缺失时才回落全局 configuredMode。AGENTS.md：不得仅用全局
  // configuredMode 串环境——trial/dev 服务器上被降级为 public 的请求必须绑定
  // public 环境快照。
  const requested = request && request.runtimeMode;
  return capabilityManifestService.normalizeRuntimeMode(requested || runtimeModeService.resolveConfiguredMode());
}

const platformKernel = new AgentKernel({
  skillRegistry: platformSkillCatalog,
  toolRuntime: platformToolRuntime,
  capabilityManifestService,
  intentResolver: toolRegistry.resolveIntent,
});
const platformDecisionService = createDecisionService({
  providerRuntime: providerRuntimeComposition.getProviderRuntime(),
  skillCatalog: platformSkillCatalog,
  deterministicResolve(message, context) {
    return require("./runtime/understandingCoordinator").resolveRuleBackedIntent(message, context).intent;
  },
});
const platformContextAssembler = createContextAssembler({
  redact: safetyGuard.redactSensitiveText,
});
const ports = createFosuTurnPorts({
  agentKernel: platformKernel,
  skillCatalog: platformSkillCatalog,
  decisionService: platformDecisionService,
  contextAssembler: platformContextAssembler,
  resolveSkillCatalog: resolveSkillCatalogForSnapshot,
  resolveProviderOverlay: resolveProviderOverlayForSnapshot,
  resolveToolOverlay: resolveToolOverlayForSnapshot,
  resolveMemoryPolicy: resolveMemoryPolicyForSnapshot,
  overlayToRuntimeConfig,
});
const stages = createFosuStages({ plugin, ports });
// 平台级共享 Metrics Store：Runtime 六阶段与 Run Handler 首事件延迟（firstEvent
// 桶）聚合到同一处，经 getDiagnostics 暴露（P2R R3.7，低基数标签词表见
// provider-runtime metrics）。
const platformMetrics = createMetricsStore({ sampleLimit: 2000 });
const runtime = createAgentRuntime({
  protocol: platformProtocol,
  uiSchema,
  stageMetrics: platformMetrics,
  traceSink(trace) {
    recentPlatformTraces.push(trace);
    if (recentPlatformTraces.length > 200) recentPlatformTraces.splice(0, recentPlatformTraces.length - 200);
  },
});
// P7a：现有生产 Runtime 经 AgentEngineAdapter 成为默认 Engine。生产链：
// Run API → createAgentPlatform → engineRegistry.resolve → fosu engine
// → runtime.executeTurn（薄委托，不改行为、不复制状态）。public 与
// trial/dev 默认均 fosu-runtime；experimental 引擎只允许经显式
// feature flag 在 dev 注册（当前无实验引擎注册，P7b/P7c deferred）。
const engineRegistry = createEngineRegistry({ featureFlags: { allowExperimentalEngines: false } });
engineRegistry.register(createFosuEngine({ runtime }), { makeDefault: true });
const platform = createAgentPlatform({
  runtime,
  engineRegistry,
  engineTraceMetadata,
  plugin,
  stages,
  createRunId: agentProtocol.createRunId,
  // P4a：createRun 原子绑定内核当前不可变快照（单次读取，Runtime 深冻结）。
  // 内核从未初始化/存储不可读且无 LKG 时回退 manifest 版本号，保持平台可用。
  // P5a：init 失败（coded AGENT_PLATFORM_INIT_FAILED）不回退——沿 run 创建链
  // 上抛（init 失败语义与 config-plane 路由一致）；仅快照读取失败才降级。
  async resolveConfigSnapshot({ request } = {}) {
    const environment = resolveSnapshotEnvironment(request);
    await initPlatform();
    let snapshot = null;
    try {
      snapshot = await configKernel.getCurrentSnapshot(environment);
    } catch (error) {
      // 快照读取失败（含 CONFIG_KERNEL_SNAPSHOT_UNREADABLE）降级为 manifest
      // 兜底保持平台可用，但必须留下安全信号，不得静默掩盖配置存储故障。
      logConfigKernelEvent({
        event: "config-snapshot-fallback",
        environment,
        code: String(error && error.code || "UNKNOWN"),
      });
      snapshot = null;
    }
    if (!snapshot) {
      return {
        configVersion: `manifest:${plugin.manifestVersion}`,
        environment,
        manifestVersion: plugin.manifestVersion,
      };
    }
    return {
      configVersion: snapshot.configVersion,
      environment,
      artifacts: snapshot.artifacts,
      manifestVersion: plugin.manifestVersion,
    };
  },
});

function getPlatform() {
  return platform;
}

async function getDiagnostics() {
  // 后台显示必须等于真实执行：configVersion 来自发布内核当前快照，
  // 不再由插件 manifest 版本号单独冒充。init/读取失败降级为 manifest
  // 兜底（与 getCurrentSnapshot 读取失败同级语义），不击落诊断端点。
  const kernelEnvironment = capabilityManifestService.normalizeRuntimeMode(runtimeModeService.resolveConfiguredMode());
  let kernelDiagnostics = null;
  try {
    await initPlatform();
    kernelDiagnostics = await configKernel.diagnostics(kernelEnvironment);
  } catch (_) {
    kernelDiagnostics = null;
  }
  return Object.assign({}, platform.diagnostics(), {
    configVersion: kernelDiagnostics && kernelDiagnostics.configVersion
      || `manifest:${plugin.manifestVersion}`,
    configKernel: kernelDiagnostics,
    manifestVersion: plugin.manifestVersion,
    skillCount: plugin.skills.length,
    toolCount: plugin.tools.length,
    recentTraceCount: recentPlatformTraces.length,
    providerRuntime: providerRuntimeComposition.getProviderRuntimeDiagnostics(),
    // 首事件延迟独立桶（含 environment 标签；success/all-runs 双序列同六阶段口径）。
    firstEventLatency: platformMetrics.summary("firstEvent"),
  });
}

function listRecentPlatformTraces() {
  return recentPlatformTraces.slice().reverse();
}

async function listDurableRunTraces() {
  getRunHandlers();
  return require("./agentTraceRecorder").listRecent();
}

function percentile(values, ratio) {
  const ordered = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!ordered.length) return null;
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1));
  return ordered[index];
}

async function getOperationsSnapshot(requestedEnvironment = "public") {
  const environment = capabilityManifestService.normalizeRuntimeMode(requestedEnvironment);
  await initPlatform();
  getRunHandlers();
  const snapshot = await configKernel.getCurrentSnapshot(environment);
  const traces = await require("./agentTraceRecorder").listRecent();
  const runRecords = await require("./agentRunEventService").listRunRecords();
  const cutoff = Date.now() - 15 * 60 * 1000;
  const recent = traces.filter((trace) => {
    const at = Date.parse(trace && trace.recordedAt || "");
    return (trace.environment || trace.runtimeMode) === environment && Number.isFinite(at) && at >= cutoff;
  });
  const completed = recent.filter((trace) => trace.status === "completed" && !trace.errorCode);
  const failed = recent.filter((trace) => trace.status === "failed" || Boolean(trace.errorCode));
  const lastSuccess = completed[0] || null;
  const lastFailure = failed[0] || null;
  const durations = recent.map((trace) => trace.totalDurationMs);
  const runtimeConfig = providerConfigService.getRuntimeConfigForEnvironment(environment) || {};
  const configuredProvider = providerReadinessService.evaluateEnvironment(environment);
  const providerFlags = providerReadinessService.publicProviderFlags(environment, runtimeConfig);
  const chainItem = (configuredProvider.chainStatus || [])
    .find((item) => item && item.name === configuredProvider.provider) || {};

  let rag = { backend: ragIndexService.backend, status: "not_configured", lkgVersion: null, pendingJobs: 0 };
  let queueStatus = { backend: repositoryBackend === "postgres" ? "postgres" : "embedded", status: "available", pending: 0 };
  try {
    const ragEntry = snapshot && snapshot.artifacts && snapshot.artifacts[`rag:${plugin.id}`];
    if (ragEntry) {
      const doc = await configKernel.getArtifactVersion({
        domain: "rag",
        artifactId: plugin.id,
        environment,
        version: ragEntry.version,
      });
      const artifact = ragPublicationAdapter.resolveRuntime(doc);
      if (artifact && artifact.kbId) {
        const status = await ragIndexService.getIndexStatus({ environment, kbId: artifact.kbId });
        rag = {
          backend: ragIndexService.backend,
          status: status.lkgVersion ? "available" : "not_built",
          lkgVersion: status.lkgVersion || null,
          pendingJobs: status.jobs.filter((job) => job.status === "pending" || job.status === "building").length,
        };
      }
    }
    const jobs = await ragIndexService.listJobs();
    queueStatus.pending = jobs.filter((job) => job.status === "pending" || job.status === "building").length;
  } catch (error) {
    rag = Object.assign({}, rag, { status: "unavailable", reasonCode: String(error && error.code || "RAG_STATUS_UNAVAILABLE") });
    queueStatus = Object.assign({}, queueStatus, { status: "unavailable", reasonCode: String(error && error.code || "QUEUE_STATUS_UNAVAILABLE") });
  }

  const toolOverlay = await resolveToolOverlayForSnapshot(snapshot);
  const disabledTools = new Set(toolOverlay && Array.isArray(toolOverlay.disabled) ? toolOverlay.disabled.map(String) : []);
  const manifest = capabilityManifestService.getManifest();
  const capabilities = Object.values(manifest.skills || {}).map((skill) => ({
    id: skill.id,
    name: skill.description || skill.id,
    tools: (skill.allowedTools || []).slice(),
    dataSource: skill.providerPolicy === "never" ? "deterministic-tool" : "tool-and-provider",
    publicAvailable: (skill.runtimeModes || []).includes("public"),
    enhancedAvailable: (skill.runtimeModes || []).some((mode) => mode === "trial" || mode === "dev"),
    providerRequired: skill.providerPolicy === "required",
    available: (skill.allowedTools || []).some((toolId) => !disabledTools.has(toolId)),
  }));
  const providerExpected = environment !== "public" && configuredProvider.provider !== "mock";
  const overallStatus = providerExpected && !providerFlags.providerReachable
    ? "degraded"
    : (rag.status === "unavailable" || queueStatus.status === "unavailable" ? "degraded" : "healthy");

  return Object.freeze({
    overallStatus,
    environment,
    deploymentSha: String(process.env.DEPLOY_SHA || process.env.GITHUB_SHA || process.env.COMMIT_SHA || "unknown").slice(0, 40),
    configVersion: snapshot && snapshot.configVersion || `manifest:${plugin.manifestVersion}`,
    provider: {
      name: configuredProvider.provider,
      configured: providerFlags.providerConfigured,
      configuredAvailable: providerFlags.configuredAvailable,
      verified: providerFlags.verified,
      reachable: providerFlags.providerReachable,
      lastProbeAt: providerFlags.lastProbeAt,
      lastSuccessAt: providerFlags.lastSuccessAt,
      lastFailureAt: providerFlags.lastFailureAt,
      circuitState: providerFlags.circuitState,
      reasonCode: providerFlags.reasonCode,
      health: String(chainItem.health || "unknown"),
    },
    metrics15m: {
      successRate: recent.length ? Number((completed.length / recent.length * 100).toFixed(1)) : null,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      sampleCount: recent.length,
    },
    runningRuns: runRecords.filter((run) => !["completed", "failed", "cancelled"].includes(run.status)).length,
    lastSuccessAt: lastSuccess && lastSuccess.recordedAt || "",
    lastFailureAt: lastFailure && lastFailure.recordedAt || "",
    lastFailure: lastFailure ? {
      runId: lastFailure.runId,
      requestId: lastFailure.requestId,
      failureLayer: lastFailure.failureLayer,
      errorCode: lastFailure.errorCode,
    } : null,
    stores: {
      memory: { backend: repositoryBackend, status: "available", lastWriteSuccessAt: null, lastWriteFailureAt: null },
      rag,
      queue: queueStatus,
      postgresql: { status: repositoryBackend === "postgres" ? "available" : "not_configured" },
      redis: { status: "not_configured" },
    },
    tools: { available: plugin.tools.filter((tool) => !disabledTools.has(tool.id)).length, total: plugin.tools.length },
    capabilities,
    checkedAt: new Date().toISOString(),
  });
}

async function runOperationsSmokeTest(requestedEnvironment = "public") {
  const environment = capabilityManifestService.normalizeRuntimeMode(requestedEnvironment);
  const envVersion = environment === "dev" ? "develop" : (environment === "trial" ? "trial" : "release");
  const checks = [];
  async function check(id, verificationType, task) {
    const startedAt = Date.now();
    try {
      const outcome = await task();
      const passed = outcome && outcome.passed === true;
      checks.push({
        id,
        status: outcome && outcome.status === "skipped" ? "skipped" : (passed ? "passed" : (outcome && outcome.status || "failed")),
        verificationType,
        durationMs: Date.now() - startedAt,
        reasonCode: String(outcome && outcome.reasonCode || (passed ? "OK" : "CHECK_FAILED")).slice(0, 80),
        details: outcome && outcome.details || null,
      });
    } catch (error) {
      checks.push({
        id,
        status: "failed",
        verificationType,
        durationMs: Date.now() - startedAt,
        reasonCode: String(error && error.code || "CHECK_FAILED").slice(0, 80),
      });
    }
  }

  await initPlatform();
  getRunHandlers();
  const agentService = require("./agentService");
  let publicToolPayload = null;
  await check("public_tool", "real-deterministic-tool", async () => {
    publicToolPayload = await agentService.chat({
      message: "当前教学周",
      requestId: `ops-public-${Date.now()}`,
      context: { envVersion: "release", runtimeMode: "public", memoryMode: "local_only", currentPage: "admin-operations-smoke" },
      runtimeMode: "public",
    });
    const external = Boolean(publicToolPayload && publicToolPayload.safety && publicToolPayload.safety.externalProviderUsed);
    const calls = publicToolPayload && publicToolPayload.toolCalls || [];
    return {
      passed: publicToolPayload && publicToolPayload.success !== false && !external && calls.length > 0,
      reasonCode: external ? "PUBLIC_PROVIDER_INVARIANT_BROKEN" : (calls.length ? "OK" : "PUBLIC_TOOL_NOT_EXECUTED"),
      details: { externalProviderUsed: external, toolCount: calls.length },
    };
  });
  await check("tool_call", "real-deterministic-tool", async () => {
    const calls = publicToolPayload && publicToolPayload.toolCalls || [];
    const successful = calls.filter((call) => call && call.success !== false && call.status !== "failed");
    return {
      passed: successful.length > 0,
      reasonCode: successful.length ? "OK" : "TOOL_FAILED",
      details: { tools: successful.map((call) => String(call.name || call.tool || "").slice(0, 80)) },
    };
  });
  await check("trial_provider", environment === "public" ? "not-applicable" : "real-provider-probe", async () => {
    if (environment === "public") return { passed: true, status: "skipped", reasonCode: "PUBLIC_PROVIDER_FORBIDDEN" };
    const payload = await agentService.chat({
      message: "请简要说明你当前可以完成哪些校园任务。",
      requestId: `ops-provider-${Date.now()}`,
      context: { envVersion, runtimeMode: environment, memoryMode: "local_only", currentPage: "admin-operations-smoke" },
      runtimeMode: environment,
      serverSession: { adminProviderVerification: true },
    });
    const safety = payload && payload.safety || {};
    const external = safety.externalProviderUsed === true;
    return {
      passed: external,
      reasonCode: external ? "OK" : String(safety.fallbackReason || "PROVIDER_UNVERIFIED"),
      details: { provider: String(safety.resolvedProvider || safety.provider || "mock"), externalProviderUsed: external },
    };
  });
  await check("run_create_poll", "real-durable-run-store", async () => {
    const repository = require("./agentRunEventService");
    const requestId = `ops-run-${Date.now()}`;
    const created = repository.createRun({ runtimeMode: environment, requestId, idempotencyKey: requestId });
    repository.appendEvent(created.runId, { type: "run.completed", runtimeMode: environment, status: "completed" });
    repository.setResult(created.runId, { success: true, requestId, runtimeMode: environment }, "completed");
    const view = repository.getRunView(created.runId, { pollToken: created.pollToken });
    return {
      passed: view && view.status === "completed" && Array.isArray(view.events) && view.events.length >= 2,
      reasonCode: view && view.status === "completed" ? "OK" : "RUN_POLL_FAILED",
      details: { runId: created.runId, status: view && view.status },
    };
  });
  await check("memory_rollback", "real-store-write-read-delete", async () => {
    const memoryService = require("./conversation/conversationMemoryService").defaultMemoryService;
    const repository = memoryService.repository;
    const nonce = `${process.pid}-${Date.now()}`;
    const principalKey = require("./conversation/conversationPrincipalService").hmacPrincipalKey(["operations-smoke", nonce]);
    const conversationId = `ops-smoke-${nonce}`;
    try {
      await repository.update(principalKey, conversationId, {
        runtimeMode: environment,
        title: "operations smoke",
        memoryPolicy: { mode: "session_state" },
      }, { createIfMissing: true, runtimeMode: environment, memoryMode: "session_state" });
      const restored = await repository.get(principalKey, conversationId);
      return { passed: Boolean(restored), reasonCode: restored ? "OK" : "MEMORY_STORE_UNAVAILABLE" };
    } finally {
      await repository.delete(principalKey, conversationId);
    }
  });
  await check("rag_query", "real-published-index-query", async () => {
    const snapshot = await configKernel.getCurrentSnapshot(environment);
    await resolveRagArtifactForSnapshot(snapshot);
    const idle = await ragIndexService.waitForIdle(5000);
    if (!idle) return { passed: false, reasonCode: "RAG_INDEX_BUILD_TIMEOUT" };
    const result = await queryRagForSnapshot(snapshot, { query: "校园办事入口", topK: 1 });
    const available = Boolean(result.indexSource || result.servedVersion || Array.isArray(result.hits));
    return {
      passed: available,
      reasonCode: String(result.reason || (available ? "OK" : "RAG_UNAVAILABLE")).toUpperCase(),
      details: { hitCount: Array.isArray(result.hits) ? result.hits.length : 0, source: result.indexSource || "" },
    };
  });
  return Object.freeze({
    environment,
    ok: checks.every((item) => item.status === "passed" || item.status === "skipped"),
    checks,
    checkedAt: new Date().toISOString(),
  });
}

function getExecutionPolicyTruth() {
  const activeMode = runtimeModeService.resolveConfiguredMode();
  let runtimeConfig = {};
  try {
    const status = providerConfigService.getStatus();
    const environment = activeMode === "public" ? "public" : (status.activeEnvironment || activeMode);
    runtimeConfig = providerConfigService.getRuntimeConfigForEnvironment(environment) || {};
  } catch (error) {
    runtimeConfig = {};
  }
  const configuredPolicy = runtimeConfig.AI_EXECUTION_POLICY || process.env.AI_EXECUTION_POLICY || "";
  return Object.freeze({
    activeMode,
    configuredPolicy: String(configuredPolicy || "").slice(0, 40),
    effectiveDefault: resolveExecutionPolicy({
      runtimeMode: activeMode,
      configuredPolicy,
      trusted: true,
    }),
    supported: Object.freeze([
      EXECUTION_POLICIES.DETERMINISTIC,
      EXECUTION_POLICIES.STRICT_MODEL_FIRST,
      EXECUTION_POLICIES.ADAPTIVE,
    ]),
    strictModelFirstReady: true,
    adaptiveReady: true,
    publicProviderForbidden: true,
  });
}

function getRunHandlers() {
  if (runHandlers) return runHandlers;
  // Lazy imports keep the Agent Runtime independent from the integrated
  // Express shell while still binding every transport to this exact platform
  // singleton and the existing Run Repository fact source.
  const agentRunEventService = require("./agentRunEventService");
  const aguiAdapter = require("./aguiAdapter");
  const agentService = require("./agentService");
  const { safeLog } = require("../../utils/safeLogger");
  // P5a WS3：Run/Event/Trace 持久化绑定（组合根唯一接线点，runHandlers 记忆化
  // 保证只执行一次）。后端选择复用 WS2 的 repositoryBackend，不引入第二套开关：
  //   - file（一体化默认）→ journalRunStore：持久卷 append-only journal +
  //     原子 snapshot，构造即同步重放恢复 accepted/running（design.md §8.2）；
  //   - postgres（standalone）→ pgRunStore：迁移由 initPlatform 的
  //     getMigrationList 目录自动发现涵盖（0006）；水合在写队列头部异步完成，
  //     就绪/失败语义沿用 initPlatform 的 AGENT_PLATFORM_INIT_FAILED 链。
  // bindDefaultStore 后，模块级 12 函数、fosuTurnPorts 的 isCancelled 与下方
  // runRepository 注入落到同一实例（12 函数 surface 逐字不变）。
  if (repositoryBackend === "postgres") {
    const pgPersistenceService = require("./persistence/pgPersistenceService");
    const { createPgRunStore } = require("./persistence/pgRunStore");
    const lazyPool = {
      query: (text, params) => pgPersistenceService.getPool().query(text, params),
      connect: () => pgPersistenceService.getPool().connect(),
    };
    const runStore = createPgRunStore({ pool: lazyPool, beforeStart: () => initPlatform() });
    agentRunEventService.bindDefaultStore(runStore);
    require("./agentTraceRecorder").bindDefaultStore(runStore);
  } else {
    const { createJournalRunStore } = require("./persistence/journalRunStore");
    const runStore = createJournalRunStore();
    agentRunEventService.bindDefaultStore(runStore);
    require("./agentTraceRecorder").bindDefaultStore(runStore);
  }
  runHandlers = createRunHandlers({
    platform,
    runRepository: agentRunEventService,
    protocol: agentProtocol,
    agui: aguiAdapter,
    buildFailureResponse: agentService.buildServiceFailureResponse,
    log: safeLog,
    runRepositoryId: "agentRunEventService",
    metrics: platformMetrics,
    resolvePrincipal(req) {
      const session = req && req.fosuSession || null;
      return {
        repositoryPrincipal: session,
        runtimePrincipal: session ? {
          openidHash: session.openidHash || "",
          sessionIdHash: session.sessionIdHash || "",
          appid: session.appid || "",
        } : null,
      };
    },
    resolvePollCredential(req) {
      return String(req && req.body && req.body.pollToken
        || req && req.query && req.query.pollToken
        || req && req.headers && req.headers["x-fosu-run-poll-token"]
        || "");
    },
  });
  return runHandlers;
}

module.exports = {
  getConfigKernel() {
    return configKernel;
  },
  getDiagnostics,
  // P5a WS2：init 门。config-plane 路由中间件与 run 创建链（resolveConfigSnapshot
  // 内部）await 它；postgres 迁移/连接失败 → coded AGENT_PLATFORM_INIT_FAILED 拒绝。
  initPlatform,
  platformReady,
  // 组合根解析器：fosuTurnPorts 经选项注入使用；P4b 其他域复用同一模式。
  // 同时供契约测试直接驱动（请求作用域环境绑定、目录 fail-closed）。
  resolveSnapshotEnvironment,
  resolveSkillCatalogForSnapshot,
  resolveProviderOverlayForSnapshot,
  resolveToolOverlayForSnapshot,
  resolveMemoryPolicyForSnapshot,
  resolveMcpRegistryForSnapshot,
  resolveRagArtifactForSnapshot,
  queryRagForSnapshot,
  getRagIndexService() {
    return ragIndexService;
  },
  getMcpRuntime() {
    return platformMcpRuntime;
  },
  getExecutionPolicyTruth,
  getPlatform,
  getRunHandlers,
  listRecentPlatformTraces,
  listDurableRunTraces,
  getOperationsSnapshot,
  runOperationsSmokeTest,
};

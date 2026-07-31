const { createAgentRuntime, createContextAssembler, createConfigKernel, createConfigKernelFileRepository, createMemoryPolicyPublicationAdapter, sha256Digest } = require("../../../../packages/agent-runtime");
const { EXECUTION_POLICIES, createMetricsStore, createProviderPublicationAdapter, overlayToRuntimeConfig, resolveExecutionPolicy } = require("../../../../packages/provider-runtime");
const platformProtocol = require("../../../../packages/agent-protocol");
const uiSchema = require("../../../../packages/ui-schema");
const { createSkillCatalog, createSkillPublicationAdapter } = require("../../../../packages/skill-runtime");
const { createToolRuntime, createToolPublicationAdapter } = require("../../../../packages/tool-runtime");
const { createMcpPublicationAdapter, createMcpRuntime } = require("../../../../packages/mcp-runtime");
const { createRagPublicationAdapter } = require("../../../../packages/rag-runtime");
const { createRagIndexService } = require("./ragIndexService");
const { createAgentPlatform, createRunHandlers } = require("../../../../apps/agent-server");
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
const runtimeModeService = require("./runtimeModeService");
const safetyGuard = require("./safetyGuard");
const memoryPolicy = require("./memory/memoryPolicy");

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

// P4a：统一配置发布内核。文件 Repository 为 integrated 模式默认适配器（P5a
// 将增加 PostgreSQL 适配器）；Skill 域参考适配器证明通用发布协议。种子只
// 初始化空环境或升级 seed-origin 版本，admin 发布的内容不会被覆盖。
// root 遵守全仓 FOSU_DATA_DIR 约定（测试/容器可重定向数据目录）。
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
const configKernel = createConfigKernel({
  repository: createConfigKernelFileRepository({ root: configKernelRoot }),
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
["public", "trial", "dev"].forEach((environment) => {
  configKernel.seedEnvironment(environment, domainSeedEntries);
});

// 按快照绑定的技能目录：发布/回滚只影响新 Run；在途 Run 的快照不可变。
// 解析结果按 (environment, version) 记忆化，目录接口与静态目录一致。
const boundCatalogCache = new Map();
function resolveSkillCatalogForSnapshot(configSnapshot) {
  const artifacts = configSnapshot && configSnapshot.artifacts || null;
  const entry = artifacts && artifacts[`skill:${plugin.id}`];
  const environment = configSnapshot && configSnapshot.environment;
  if (!entry || !environment) return platformSkillCatalog;
  const cacheKey = `${environment}:${entry.version}`;
  if (!boundCatalogCache.has(cacheKey)) {
    let versionDoc = null;
    try {
      versionDoc = configKernel.getArtifactVersion({
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
function resolveDomainRuntimeForSnapshot(domain, configSnapshot) {
  const artifacts = configSnapshot && configSnapshot.artifacts || null;
  const entry = artifacts && artifacts[`${domain}:${plugin.id}`];
  const environment = configSnapshot && configSnapshot.environment;
  if (!entry || !environment) return defaultDomainRuntime[domain];
  const cache = boundDomainRuntimeCache[domain];
  const cacheKey = `${environment}:${entry.version}`;
  if (!cache.has(cacheKey)) {
    let versionDoc = null;
    try {
      versionDoc = configKernel.getArtifactVersion({
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
  resolveArtifact({ environment, artifactId, version }) {
    const versionDoc = configKernel.getArtifactVersion({ domain: "rag", artifactId, environment, version });
    return ragPublicationAdapter.resolveRuntime(versionDoc);
  },
});

// RAG 快照解析 = 通用域解析 + 索引同步钩子：新快照钉住的版本若未构建，
// 以稳定 jobId 入队异步构建（幂等，不阻塞在线 Run）；查询在索引就绪前
// 按 lkg 语义降级或如实返回不可用，绝不返回草稿内容。
function resolveRagArtifactForSnapshot(configSnapshot) {
  const artifact = resolveDomainRuntimeForSnapshot("rag", configSnapshot);
  const entry = configSnapshot && configSnapshot.artifacts && configSnapshot.artifacts[`rag:${plugin.id}`];
  const environment = configSnapshot && configSnapshot.environment;
  if (entry && environment && artifact && artifact.kbId) {
    try {
      ragIndexService.requestBuild({
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
  const artifact = resolveRagArtifactForSnapshot(configSnapshot);
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
const platform = createAgentPlatform({
  runtime,
  plugin,
  stages,
  createRunId: agentProtocol.createRunId,
  // P4a：createRun 原子绑定内核当前不可变快照（单次读取，Runtime 深冻结）。
  // 内核从未初始化/存储不可读且无 LKG 时回退 manifest 版本号，保持平台可用。
  resolveConfigSnapshot({ request } = {}) {
    const environment = resolveSnapshotEnvironment(request);
    let snapshot = null;
    try {
      snapshot = configKernel.getCurrentSnapshot(environment);
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

function getDiagnostics() {
  // 后台显示必须等于真实执行：configVersion 来自发布内核当前快照，
  // 不再由插件 manifest 版本号单独冒充。
  const kernelEnvironment = capabilityManifestService.normalizeRuntimeMode(runtimeModeService.resolveConfiguredMode());
  let kernelDiagnostics = null;
  try {
    kernelDiagnostics = configKernel.diagnostics(kernelEnvironment);
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
};

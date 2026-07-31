const { createAgentRuntime, createContextAssembler, createConfigKernel, createConfigKernelFileRepository, sha256Digest } = require("../../../../packages/agent-runtime");
const { EXECUTION_POLICIES, createMetricsStore, resolveExecutionPolicy } = require("../../../../packages/provider-runtime");
const platformProtocol = require("../../../../packages/agent-protocol");
const uiSchema = require("../../../../packages/ui-schema");
const { createSkillCatalog, createSkillPublicationAdapter } = require("../../../../packages/skill-runtime");
const { createToolRuntime } = require("../../../../packages/tool-runtime");
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
const configKernelRoot = process.env.FOSU_AGENT_CONFIG_KERNEL_PATH
  || path.join(__dirname, "../../../data/ai/config-kernel");
const skillPublicationAdapter = createSkillPublicationAdapter({ staticSkills: plugin.skills });
const configKernel = createConfigKernel({
  repository: createConfigKernelFileRepository({ root: configKernelRoot }),
  domainAdapters: { skill: skillPublicationAdapter },
  environments: ["public", "trial", "dev"],
  logger(entry) {
    try {
      // 延迟加载，避免与日志模块的循环依赖；仅安全事件字段，不含配置内容。
      const { safeLog } = require("../../utils/safeLogger");
      safeLog("config-kernel", entry);
    } catch (_) {
      // 可观测性不得影响配置加载。
    }
  },
});
const skillSeedPayload = skillPublicationAdapter.seedPayload();
const skillSeedDigest = sha256Digest(skillSeedPayload);
["public", "trial", "dev"].forEach((environment) => {
  configKernel.seedEnvironment(environment, [{
    domain: "skill",
    artifactId: plugin.id,
    payload: skillSeedPayload,
    sourceDigest: skillSeedDigest,
  }]);
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
    let catalog = platformSkillCatalog;
    try {
      const versionDoc = configKernel.getArtifactVersion({
        domain: "skill",
        artifactId: plugin.id,
        environment,
        version: entry.version,
      });
      catalog = createSkillCatalog({ skills: skillPublicationAdapter.resolveRuntime(versionDoc) });
    } catch (_) {
      // 已发布版本不可读时 fail closed 到静态目录（与种子一致的全量集），
      // 不伪造版本内容；内核自身已对 LKG 之外的情况抛错。
      catalog = platformSkillCatalog;
    }
    boundCatalogCache.set(cacheKey, catalog);
    if (boundCatalogCache.size > 24) {
      const oldest = boundCatalogCache.keys().next().value;
      boundCatalogCache.delete(oldest);
    }
  }
  return boundCatalogCache.get(cacheKey);
}

function resolveSnapshotEnvironment(request) {
  const requested = request && (request.runtimeMode || request.assistantEnvironment);
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
    } catch (_) {
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
  getExecutionPolicyTruth,
  getPlatform,
  getRunHandlers,
  listRecentPlatformTraces,
};

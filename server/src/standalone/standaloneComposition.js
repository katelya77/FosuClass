/**
 * P5b WS-A：standalone 组合根（无 Fosu 顶层耦合）。
 *
 * 与 server/src/services/ai/platformComposition.js 的分界线：
 * - 不 require plugins/fosu-campus、capabilityManifestService、providerChainService、
 *   releaseService、agentService 或任何 Fosu 路由/Release Pack/CloudBase 模块；
 *   本文件只组合 packages/* 通用运行时、apps/agent-server 与 server 侧通用
 *   持久化/队列模块（ragIndexService、taskQueue、persistence）。
 * - fosu-campus 是可选插件接缝：默认零插件；AGENT_PLATFORM_ENABLE_FOSU=1 只登记
 *   「请求启用」状态，本阶段不实现校园数据供给（装配点留痕，应用层对该集成
 *   一律返回明确 501）。
 *
 * 存储/传输：
 * - FOSU_AGENT_REPOSITORY_BACKEND=postgres（standalone 基线）→ PG config kernel
 *   repository + PG run store + PG RAG 索引存储；init 先跑版本化迁移再种子。
 * - AGENT_REDIS_URL 配置时 → Redis Streams 任务队列（server 角色只入队不消费，
 *   经 enqueue-only 门面注入 ragIndexService；消费在 worker 角色）。未配置时
 *   退化为 data 目录文件队列 + 进程内即时消费（单实例语义，与 integrated 同型，
 *   不留无法消费的队列任务）。
 *
 * Provider：本阶段 standalone 五阶段全确定性，任何模式下外部 Provider 调用恒 0。
 * AGENT_PLATFORM_PROVIDERS（JSON：[{id, apiKeyEnv, baseUrl?}]）只是部署方声明的
 * 凭据引用登记，readiness 据其所引环境变量是否非空如实报告配置级就绪——不作
 * 连通性伪装，也绝无 Mock 冒充。
 */

const crypto = require("crypto");
const path = require("path");

const {
  createAgentRuntime,
  createConfigKernel,
  createConfigKernelFileRepository,
  createConfigKernelPgRepository,
  createMemoryPolicyPublicationAdapter,
  sha256Digest,
} = require("../../../packages/agent-runtime");
const { createProviderPublicationAdapter } = require("../../../packages/provider-runtime");
const platformProtocol = require("../../../packages/agent-protocol");
const uiSchema = require("../../../packages/ui-schema");
const { createSkillCatalog, createSkillPublicationAdapter } = require("../../../packages/skill-runtime");
const { createToolRuntime, createToolPublicationAdapter } = require("../../../packages/tool-runtime");
const { createMcpPublicationAdapter, createMcpRuntime } = require("../../../packages/mcp-runtime");
const { createRagPublicationAdapter } = require("../../../packages/rag-runtime");
const { createAgentPlatform, createRunHandlers } = require("../../../apps/agent-server");

const { createStandalonePlugin, createStandaloneStages, normalizeRuntimeMode } = require("./standalonePlugin");
const { errorClassOf } = require("./standaloneLogger");
const { createRagIndexService } = require("../services/ai/ragIndexService");
const { createRedisStreamsTaskQueue } = require("../services/ai/taskQueue/redisStreamsTaskQueue");
const { BACKEND_ENV, resolveRepositoryBackend } = require("../services/ai/persistence/repositoryBackend");
const pgPersistenceService = require("../services/ai/persistence/pgPersistenceService");
const { createPgRunStore } = require("../services/ai/persistence/pgRunStore");
const { createMemoryRunStore } = require("../services/ai/persistence/memoryRunStore");
const { createRunEventService, statusFromResult } = require("../services/ai/agentRunEventService");
const aguiAdapter = require("../services/ai/aguiAdapter");

const CONFIG_PLANE_SCOPES = Object.freeze(["agent-config:read", "agent-config:write", "agent-config:audit:read"]);
const ENVIRONMENTS = Object.freeze(["public", "trial", "dev"]);
const BOUND_CACHE_LIMIT = 24;

function codedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function safeString(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function parseJsonEnv(raw) {
  try {
    const parsed = JSON.parse(String(raw || ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

/** server 角色的入队门面：只暴露簿记/入队方法，claim/reclaim 恒为空——
 * standalone server 进程绝不消费异步任务（worker 角色职责）。 */
function createEnqueueOnlyQueue(queue) {
  return Object.freeze({
    kind: `${queue.kind}-enqueue-only`,
    enqueue: (input) => queue.enqueue(input),
    get: (jobId) => queue.get(jobId),
    list: () => queue.list(),
    requeue: (jobId, input) => queue.requeue(jobId, input),
    remove: (jobId) => queue.remove(jobId),
    deadLetter: (jobId, input) => queue.deadLetter(jobId, input),
    listDead: () => queue.listDead(),
    claim: async () => null,
    reclaimPending: async () => Object.freeze([]),
    ack: async () => {
      throw codedError("STANDALONE_SERVER_CANNOT_CONSUME");
    },
    retry: async () => {
      throw codedError("STANDALONE_SERVER_CANNOT_CONSUME");
    },
    close: async () => {},
  });
}

function createStandaloneComposition(options = {}) {
  const env = options.env || process.env;
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const repositoryBackend = resolveRepositoryBackend(env[BACKEND_ENV]);
  const dataRoot = safeString(env.AGENT_PLATFORM_DATA_DIR, 400)
    || path.join(path.resolve(env.FOSU_DATA_DIR || path.join(__dirname, "../../data")), "standalone");

  // fosu-campus 可选插件接缝（决策 4）：默认零插件；本阶段不装配、不供给校园
  // 数据，只留状态登记与明确 501 语义（装配点 = 本对象 + 应用层集成路由）。
  const fosuCampusSeam = Object.freeze({
    pluginId: "fosu-campus",
    requested: safeString(env.AGENT_PLATFORM_ENABLE_FOSU, 8) === "1",
    assembled: false,
    reasonCode: safeString(env.AGENT_PLATFORM_ENABLE_FOSU, 8) === "1"
      ? "FOSU_CAMPUS_ASSEMBLY_NOT_IMPLEMENTED"
      : "FOSU_CAMPUS_NOT_ENABLED",
  });

  // ---- Provider 凭据引用登记（配置级，无执行链）----
  const providerDeclarations = (Array.isArray(parseJsonEnv(env.AGENT_PLATFORM_PROVIDERS))
    ? parseJsonEnv(env.AGENT_PLATFORM_PROVIDERS)
    : [])
    .map((entry) => ({
      id: safeString(entry && entry.id, 64),
      apiKeyEnv: safeString(entry && entry.apiKeyEnv, 80),
    }))
    .filter((entry) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.id) && /^[A-Z][A-Z0-9_]*$/.test(entry.apiKeyEnv));

  function providerReadiness() {
    // 只检查所引环境变量是否非空；值本身永远不进日志/响应。
    const configured = providerDeclarations
      .filter((entry) => safeString(env[entry.apiKeyEnv], 2).length > 0)
      .map((entry) => entry.id);
    return Object.freeze({
      ready: configured.length > 0,
      reason: configured.length > 0 ? "PROVIDER_CONFIGURED" : "PROVIDER_NOT_CONFIGURED",
      source: "env-declared",
      probed: false,
      declaredCount: providerDeclarations.length,
      configuredProviderIds: Object.freeze(configured),
    });
  }

  // ---- 平台静态业务面（通用插件 + 目录/工具运行时）----
  // queryKb 晚绑定：plugin 构造先于 RAG 查询链，工具执行时再解析。
  let queryKbImpl = async () => ({ hits: [], reason: "kb_not_configured", kbId: "" });
  const plugin = createStandalonePlugin({ queryKb: (input) => queryKbImpl(input) });
  const platformSkillCatalog = createSkillCatalog({ skills: plugin.skills });
  const platformToolRuntime = createToolRuntime({ tools: plugin.tools });

  // ---- 六域发布适配器（种子 ≡ 静态默认 / 内置示例）----
  const mcpTrustedCommands = Object.freeze((() => {
    const parsed = parseJsonEnv(env.AGENT_MCP_TRUSTED_COMMANDS) || {};
    return Object.fromEntries(Object.entries(parsed)
      .map(([name, value]) => [safeString(name, 64), String(value || "")])
      .filter(([name, value]) => name && path.isAbsolute(value)));
  })());
  const domainAdapters = Object.freeze({
    skill: createSkillPublicationAdapter({ staticSkills: plugin.skills }),
    provider: createProviderPublicationAdapter({
      // 已知集合 = 部署方 env 声明 ∪ 通用 OpenAI/Anthropic 兼容端点位（适配器
      // 要求非空；发布 overlay 只表达意图，凭据真相由 readiness 如实报告）。
      knownProviderIds: Array.from(new Set(
        providerDeclarations.map((entry) => entry.id).concat(["custom-openai", "custom-anthropic"])
      )),
    }),
    tool: createToolPublicationAdapter({ staticTools: platformToolRuntime.listDescriptors() }),
    memory: createMemoryPolicyPublicationAdapter({ knownTtlKeys: [] }),
    mcp: createMcpPublicationAdapter({
      knownCommands: Object.keys(mcpTrustedCommands),
      allowInsecureHttp: safeString(env.AGENT_MCP_ALLOW_INSECURE_HTTP, 8).toLowerCase() === "true",
    }),
    rag: createRagPublicationAdapter(),
  });
  const platformMcpRuntime = createMcpRuntime({
    trustedCommands: mcpTrustedCommands,
    allowInsecureHttp: safeString(env.AGENT_MCP_ALLOW_INSECURE_HTTP, 8).toLowerCase() === "true",
    logger,
  });

  // ---- Config Kernel（PG 池门面惰性解析：构造同步、不触网）----
  const lazyPool = {
    query: (text, params) => pgPersistenceService.getPool().query(text, params),
    connect: () => pgPersistenceService.getPool().connect(),
  };
  const configKernel = createConfigKernel({
    repository: repositoryBackend === "postgres"
      ? createConfigKernelPgRepository({ pool: lazyPool })
      : createConfigKernelFileRepository({ root: path.join(dataRoot, "config-kernel") }),
    domainAdapters,
    environments: ENVIRONMENTS.slice(),
    logger,
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
  const seedKbId = safeString(domainAdapters.rag.seedPayload().kbId, 64);

  // init 门（与 integrated 同语义）：postgres 先迁移后种子；失败 → memoized
  // coded AGENT_PLATFORM_INIT_FAILED 拒绝（causeCode 保留底层 code）。
  let initPromise = null;
  function initPlatform() {
    if (!initPromise) {
      initPromise = (async () => {
        try {
          if (repositoryBackend === "postgres") {
            await pgPersistenceService.runMigrations();
          }
          for (const environment of configKernel.environments) {
            await configKernel.seedEnvironment(environment, domainSeedEntries);
          }
          return Object.freeze({ backend: repositoryBackend, environments: configKernel.environments.slice() });
        } catch (error) {
          const causeCode = errorClassOf(error);
          const wrapped = new Error(`agent platform init failed (${repositoryBackend} backend): ${causeCode}`);
          wrapped.code = "AGENT_PLATFORM_INIT_FAILED";
          wrapped.causeCode = causeCode;
          throw wrapped;
        }
      })();
    }
    return initPromise;
  }

  // ---- 任务队列（Redis Streams；server 角色只入队）----
  const queueStream = safeString(env.AGENT_REDIS_STREAM, 120) || "agent-platform-tasks";
  const queue = safeString(env.AGENT_REDIS_URL, 400)
    ? createRedisStreamsTaskQueue({
      url: safeString(env.AGENT_REDIS_URL, 400),
      stream: queueStream,
      group: safeString(env.AGENT_REDIS_STREAM_GROUP, 60) || "workers",
      consumer: `server-${process.pid}`,
      pool: repositoryBackend === "postgres" ? lazyPool : null,
      mirrorNamespace: queueStream,
    })
    : null;

  // ---- RAG 索引服务（查询链 + 入队钩子；server 不消费）----
  async function resolveRagArtifact({ environment, artifactId, version }) {
    const versionDoc = await configKernel.getArtifactVersion({ domain: "rag", artifactId, environment, version });
    return domainAdapters.rag.resolveRuntime(versionDoc);
  }
  const ragIndexService = createRagIndexService(Object.assign({
    root: dataRoot,
    backend: repositoryBackend,
    logger,
    resolveArtifact: resolveRagArtifact,
  }, queue ? { queue: createEnqueueOnlyQueue(queue) } : {}));

  // ---- 快照绑定解析器（发布/回滚只影响新 Run；版本不可读 fail closed）----
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
        logger({
          event: "skill-catalog-unreadable",
          environment,
          version: safeString(entry.version, 20),
          code: errorClassOf(error),
        });
        const failure = new Error(`Published skill catalog version is unreadable: ${safeString(entry.version, 20)}`);
        failure.code = "DECISION_SKILL_CATALOG_UNREADABLE";
        throw failure;
      }
      boundCatalogCache.set(cacheKey, createSkillCatalog({ skills: domainAdapters.skill.resolveRuntime(versionDoc) }));
      if (boundCatalogCache.size > BOUND_CACHE_LIMIT) {
        boundCatalogCache.delete(boundCatalogCache.keys().next().value);
      }
    }
    return boundCatalogCache.get(cacheKey);
  }

  // RAG 快照解析 + 索引异步构建钩子（幂等入队，不阻塞在线 Run）。
  async function resolveRagArtifactForSnapshot(configSnapshot) {
    const entry = configSnapshot && configSnapshot.artifacts && configSnapshot.artifacts[`rag:${plugin.id}`];
    const environment = configSnapshot && configSnapshot.environment;
    if (!entry || !environment) {
      return domainAdapters.rag.resolveRuntime({ payload: domainAdapters.rag.seedPayload() });
    }
    let artifact = null;
    try {
      const versionDoc = await configKernel.getArtifactVersion({
        domain: "rag",
        artifactId: plugin.id,
        environment,
        version: entry.version,
      });
      artifact = domainAdapters.rag.resolveRuntime(versionDoc);
    } catch (error) {
      logger({
        event: "rag-config-unreadable",
        environment,
        version: safeString(entry.version, 20),
        code: errorClassOf(error),
      });
      const failure = new Error(`Published rag config version is unreadable: ${safeString(entry.version, 20)}`);
      failure.code = "RAG_CONFIG_UNREADABLE";
      throw failure;
    }
    if (artifact && artifact.kbId) {
      try {
        await ragIndexService.requestBuild({
          environment,
          artifactId: plugin.id,
          kbId: artifact.kbId,
          version: entry.version,
        });
      } catch (error) {
        logger({ event: "rag-index-enqueue-failed", environment, code: errorClassOf(error) });
      }
    }
    return artifact;
  }

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

  // platform.kb 工具的查询端口：如实降级（索引未就绪/未配置 → 空命中 + 原因码），
  // 绝不编造内容；未识别故障留安全信号后同样如实降级。
  queryKbImpl = async ({ query, configSnapshot }) => {
    try {
      const result = await queryRagForSnapshot(configSnapshot, { query, topK: 5 });
      return {
        hits: Array.isArray(result.hits) ? result.hits : [],
        reason: result.hits && result.hits.length ? "" : "no_hits",
        kbId: result.kbId || "",
        servedVersion: result.servedVersion || null,
        indexSource: result.indexSource || "",
      };
    } catch (error) {
      const code = errorClassOf(error);
      logger({ event: "kb-query-degraded", code });
      return { hits: [], reason: code === "UNKNOWN" ? "kb_query_failed" : code.toLowerCase(), kbId: "" };
    }
  };

  // ---- Runtime / Platform / Run Handlers ----
  const recentPlatformTraces = [];
  const runtime = createAgentRuntime({
    protocol: platformProtocol,
    uiSchema,
    traceSink(trace) {
      recentPlatformTraces.push(trace);
      if (recentPlatformTraces.length > 200) recentPlatformTraces.splice(0, recentPlatformTraces.length - 200);
    },
  });
  const stages = createStandaloneStages({
    plugin,
    toolRuntime: platformToolRuntime,
    resolveSkillCatalog: resolveSkillCatalogForSnapshot,
    logger,
  });
  const platform = createAgentPlatform({
    runtime,
    plugin,
    stages,
    createRunId: () => `run_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
    async resolveConfigSnapshot({ request } = {}) {
      const environment = normalizeRuntimeMode(
        request && request.runtimeMode || env.AGENT_PLATFORM_RUNTIME_MODE
      );
      await initPlatform();
      let snapshot = null;
      try {
        snapshot = await configKernel.getCurrentSnapshot(environment);
      } catch (error) {
        logger({ event: "config-snapshot-fallback", environment, code: errorClassOf(error) });
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

  const runStore = repositoryBackend === "postgres"
    ? createPgRunStore({ pool: lazyPool, beforeStart: () => initPlatform() })
    : createMemoryRunStore();
  const runRepository = Object.assign(createRunEventService({ store: runStore }), { statusFromResult });

  function buildFailureResponse(input = {}, error = {}) {
    const code = errorClassOf(error);
    return {
      success: false,
      status: "failed",
      code,
      answer: "请求处理失败，请稍后重试。",
      runtimeMode: normalizeRuntimeMode(input.runtimeMode),
      provider: "",
      externalProviderUsed: false,
      fallback: false,
      fallbackReason: "",
      errors: [{ code, message: "请求处理失败，请稍后重试。" }],
      requestId: safeString(input.requestId, 96),
      conversationId: safeString(input.conversationId, 96),
    };
  }

  const runHandlers = createRunHandlers({
    platform,
    runRepository,
    protocol: { createRequestId: () => `req_${crypto.randomBytes(8).toString("hex")}` },
    agui: aguiAdapter,
    buildFailureResponse,
    log: (event, fields) => logger(Object.assign({ event }, fields || {})),
    runRepositoryId: `standalone-${runStore.kind}`,
    resolvePrincipal: () => ({ repositoryPrincipal: null, runtimePrincipal: null }),
  });

  // ---- Config-plane Bearer 鉴权（无 Cookie 会话 → 无 CSRF 面；令牌只经环境注入）----
  const authTokens = [];
  if (safeString(env.AGENT_PLATFORM_ADMIN_TOKEN, 256)) {
    authTokens.push(Object.freeze({
      name: "admin",
      token: safeString(env.AGENT_PLATFORM_ADMIN_TOKEN, 256),
      scopes: CONFIG_PLANE_SCOPES.slice(),
    }));
  }
  const declaredTokens = parseJsonEnv(env.AGENT_PLATFORM_SERVICE_TOKENS);
  (Array.isArray(declaredTokens) ? declaredTokens : []).forEach((entry) => {
    const name = safeString(entry && entry.name, 64);
    const token = safeString(entry && entry.token, 256);
    const scopes = (Array.isArray(entry && entry.scopes) ? entry.scopes : [])
      .map((scope) => safeString(scope, 60))
      .filter((scope) => CONFIG_PLANE_SCOPES.includes(scope));
    if (name && token) authTokens.push(Object.freeze({ name, token, scopes }));
  });

  function authenticate(req) {
    if (!authTokens.length) return { ok: false, code: "AGENT_AUTH_NOT_CONFIGURED", status: 503 };
    const header = safeString(req && req.headers && req.headers.authorization, 400);
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return { ok: false, code: "AGENT_AUTH_REQUIRED", status: 401 };
    const presented = match[1].trim();
    const found = authTokens.find((entry) => timingSafeEqualText(entry.token, presented));
    if (!found) return { ok: false, code: "AGENT_AUTH_INVALID", status: 401 };
    return { ok: true, actor: found.name, scopes: found.scopes.slice() };
  }

  // ---- Readiness 九项细分（逐项 ok/not_ready/unknown + 原因码）----
  function ok(detail) {
    return Object.freeze(Object.assign({ status: "ok", reason: "OK" }, detail || {}));
  }
  function notReady(reason, detail) {
    return Object.freeze(Object.assign({ status: "not_ready", reason: safeString(reason, 80) || "NOT_READY" }, detail || {}));
  }
  function unknown(reason, detail) {
    return Object.freeze(Object.assign({ status: "unknown", reason: safeString(reason, 80) || "UNKNOWN" }, detail || {}));
  }

  async function checkPostgres() {
    if (repositoryBackend !== "postgres") return notReady("PG_BACKEND_NOT_SELECTED", { backend: repositoryBackend });
    try {
      await lazyPool.query("SELECT 1", []);
      return ok();
    } catch (error) {
      return notReady(errorClassOf(error), { blocking: true });
    }
  }

  async function checkRedis() {
    if (!queue) return unknown("REDIS_NOT_CONFIGURED");
    try {
      await queue.listDead();
      return ok({ stream: queueStream });
    } catch (error) {
      return notReady(errorClassOf(error));
    }
  }

  async function checkMigration() {
    if (repositoryBackend !== "postgres") return notReady("PG_BACKEND_NOT_SELECTED", { backend: repositoryBackend });
    try {
      const status = await pgPersistenceService.getMigrationStatus();
      return status.pending.length
        ? notReady("MIGRATION_PENDING", { schemaVersion: status.schemaVersion, pendingCount: status.pending.length })
        : ok({ schemaVersion: status.schemaVersion });
    } catch (error) {
      return notReady(errorClassOf(error));
    }
  }

  async function checkArtifactRepository() {
    try {
      await configKernel.diagnostics(defaultEnvironment());
      return ok({ backend: repositoryBackend });
    } catch (error) {
      return notReady(errorClassOf(error));
    }
  }

  async function snapshotOrNull() {
    try {
      return await configKernel.getCurrentSnapshot(defaultEnvironment());
    } catch (_) {
      return null;
    }
  }

  async function checkConfigSnapshot() {
    try {
      const snapshot = await configKernel.getCurrentSnapshot(defaultEnvironment());
      return snapshot ? ok({ environment: snapshot.environment }) : notReady("CONFIG_SNAPSHOT_MISSING");
    } catch (error) {
      return notReady(errorClassOf(error));
    }
  }

  async function checkPublishedConfigVersion() {
    const snapshot = await snapshotOrNull();
    const configVersion = snapshot && safeString(snapshot.configVersion, 128);
    if (configVersion && configVersion.indexOf("manifest:") !== 0) {
      return ok({ configVersion });
    }
    return notReady("CONFIG_VERSION_NOT_PUBLISHED");
  }

  async function checkWorkerQueue() {
    if (!queue) return unknown("QUEUE_NOT_CONFIGURED");
    try {
      const jobs = await queue.list();
      const pending = jobs.filter((job) => job.status === "pending" || job.status === "building").length;
      return ok({ stream: queueStream, depth: jobs.length, inFlight: pending });
    } catch (error) {
      return notReady(errorClassOf(error));
    }
  }

  async function checkRagBackend() {
    try {
      const status = await ragIndexService.getIndexStatus({ environment: defaultEnvironment(), kbId: seedKbId });
      return ok({ backend: ragIndexService.backend, lkgVersion: status.lkgVersion });
    } catch (error) {
      return notReady(errorClassOf(error), { backend: ragIndexService.backend });
    }
  }

  function checkProvider() {
    const readiness = providerReadiness();
    return Object.freeze({
      status: readiness.ready ? "ok" : "not_ready",
      reason: readiness.reason,
      source: readiness.source,
      probed: false,
      declaredCount: readiness.declaredCount,
      configuredProviderIds: readiness.configuredProviderIds,
      blocking: false,
    });
  }

  function defaultEnvironment() {
    return normalizeRuntimeMode(env.AGENT_PLATFORM_RUNTIME_MODE);
  }

  async function readinessItems() {
    const provider = checkProvider();
    const items = {
      postgres: await checkPostgres(),
      redis: await checkRedis(),
      migration: await checkMigration(),
      artifactRepository: await checkArtifactRepository(),
      configSnapshot: await checkConfigSnapshot(),
      workerQueue: await checkWorkerQueue(),
      ragBackend: await checkRagBackend(),
      provider,
      publishedConfigVersion: await checkPublishedConfigVersion(),
    };
    return Object.freeze(items);
  }

  // ---- Startup 状态（首次迁移 + 索引恢复完成）----
  const startupState = { started: false, failed: "", startedAt: "" };
  let startPromise = null;
  function start() {
    if (!startPromise) {
      startPromise = (async () => {
        try {
          const init = await initPlatform();
          // 索引恢复（启动 reclaim + done 任务清扫）经一次状态读取强制完成；
          // server 角色的 reclaim 门面恒为空，恢复性消费仍只在 worker。
          await ragIndexService.getIndexStatus({ environment: defaultEnvironment(), kbId: seedKbId });
          startupState.started = true;
          startupState.startedAt = new Date().toISOString();
          return init;
        } catch (error) {
          startupState.failed = errorClassOf(error);
          throw error;
        }
      })();
    }
    return startPromise;
  }

  async function getDiagnostics() {
    let kernelDiagnostics = null;
    try {
      await initPlatform();
      kernelDiagnostics = await configKernel.diagnostics(defaultEnvironment());
    } catch (_) {
      kernelDiagnostics = null;
    }
    return Object.assign({}, platform.diagnostics(), {
      configVersion: kernelDiagnostics && kernelDiagnostics.configVersion
        || `manifest:${plugin.manifestVersion}`,
      configKernel: kernelDiagnostics,
      repositoryBackend,
      queueKind: queue ? queue.kind : "file",
      fosuCampus: fosuCampusSeam,
      provider: providerReadiness(),
      recentTraceCount: recentPlatformTraces.length,
    });
  }

  return Object.freeze({
    plugin,
    domainAdapters,
    configKernel,
    initPlatform,
    platformReady: initPlatform,
    start,
    startupState,
    platform,
    runHandlers,
    runRepository,
    ragIndexService,
    queryRagForSnapshot,
    resolveSkillCatalogForSnapshot,
    readinessItems,
    providerReadiness,
    getDiagnostics,
    listRecentPlatformTraces: () => recentPlatformTraces.slice().reverse(),
    getMcpRuntime: () => platformMcpRuntime,
    repositoryBackend,
    queueStream,
    hasQueue: Boolean(queue),
    getQueue: () => queue,
    fosuCampus: fosuCampusSeam,
    auth: Object.freeze({
      authenticate,
      configured: authTokens.length > 0,
      scopes: CONFIG_PLANE_SCOPES,
    }),
    defaultEnvironment,
    seedKbId,
    async close() {
      if (queue) await queue.close();
    },
  });
}

module.exports = Object.freeze({
  CONFIG_PLANE_SCOPES,
  createStandaloneComposition,
});

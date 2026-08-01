/**
 * P5a WS6：postgres 消费链的 schema/init 就绪门与 lazy pool 工厂。
 *
 * 背景：migration 只经 platformComposition.initPlatform()（WS2，memoized）统一
 * 执行；但会话/记忆/durable/知识幂等审计的消费链可能在首个 Run 创建之前就被
 * 触达（如 GET /api/ai/agent/conversations、admin KB 端点）。直接查询缺表会
 * 以 42P01 失败。本模块提供两级设施：
 *
 *   - ensureAgentPersistenceReady()：惰性 require platformComposition 并返回
 *     initPlatform()（memoized、并发安全；失败为 coded AGENT_PLATFORM_INIT_FAILED
 *     且粘性）。在适配器层（不经 agent-runtime query 包装）await 它可保留
 *     原始 code。仅在 FOSU_AGENT_REPOSITORY_BACKEND=postgres 时有意义；
 *     file 模式调用方不得触达本模块（facade 不会创建 PG 路径）。
 *   - createLazyPool({ gated })：WS2 同款 lazy pool 门面——构造同步、不触网、
 *     未配置 PG 也不在 require 期抛错；getPool() 的 PG_CONFIG_REQUIRED 延迟到
 *     首次真实查询。gated=true 时每次 query/connect 先 await 就绪门——
 *     经 agent-runtime query() 调用时，就绪失败会被 re-code 为
 *     PG_QUERY_FAILED（message 保留 init 失败原因，fail closed）；
 *     需要保留 AGENT_PLATFORM_INIT_FAILED 原始 code 的适配器应自行在
 *     入口 await ensureAgentPersistenceReady()（见 pgMemoryDocumentStoreAdapter /
 *     durable/sharedTaskStore）。
 */

const { resolveRepositoryBackend } = require("./repositoryBackend");

function ensureAgentPersistenceReady() {
  // 惰性 require：本模块被 conversation/kb/durable facade 引用，platformComposition
  // 又（经 fosuTurnPorts → memoryCoordinator → userMemory → userPreferenceService）
  // 传递引用这些 facade——顶层 require 会成环；请求期调用时 platformComposition
  // 已完整加载，initPlatform memoized promise 直接复用。
  return require("../platformComposition").initPlatform();
}

function createLazyPool(options = {}) {
  const gated = options.gated === true;
  const pgPersistenceService = require("./pgPersistenceService");
  if (!gated) {
    return {
      query: (text, params) => pgPersistenceService.getPool().query(text, params),
      connect: () => pgPersistenceService.getPool().connect(),
    };
  }
  return {
    query: (text, params) => ensureAgentPersistenceReady()
      .then(() => pgPersistenceService.getPool().query(text, params)),
    connect: () => ensureAgentPersistenceReady()
      .then(() => pgPersistenceService.getPool().connect()),
  };
}

/** 仅 postgres 模式返回就绪门 Promise；file 模式返回 null（调用方走同步直路）。 */
function readinessGate(options = {}) {
  if (resolveRepositoryBackend(options.repositoryBackend) !== "postgres") return null;
  return ensureAgentPersistenceReady();
}

module.exports = {
  createLazyPool,
  ensureAgentPersistenceReady,
  readinessGate,
};

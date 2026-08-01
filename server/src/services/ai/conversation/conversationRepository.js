/**
 * ConversationRepository facade — P5a WS4a 起按后端 env 双实现。
 *
 * FOSU_AGENT_REPOSITORY_BACKEND=file（默认）→ FileConversationRepository（同步方法）；
 * =postgres → PgConversationRepository（异步方法，经 pgPersistenceService.getPool()）。
 * 两种实现同一接口同一错误码；postgres 模式下消费方必须 await
 * （现有同步消费链的适配属后续集成 WS，文件模式行为零变化）。
 */
const { FileConversationRepository } = require("./fileConversationRepository");
const { resolveRepositoryBackend } = require("../persistence/repositoryBackend");

let defaultRepository = null;

function createConversationRepository(options = {}) {
  if (resolveRepositoryBackend(options.repositoryBackend) === "postgres") {
    // lazy require：file 模式不加载 pg 依赖链。
    // P5a WS6：gated lazy pool（WS2 同款）——构造同步、不触网、未配置 PG
    // 也不在 require 期抛错（PG_CONFIG_REQUIRED 延迟到首次查询）；每次
    // query/connect 先过 initPlatform 就绪门（migration 0003 的
    // agent_conversations 表由迁移链保证）。显式 options.pool 仍然优先
    // （测试注入真实池）。
    const { createLazyPool } = require("../persistence/pgReadiness");
    const { PgConversationRepository } = require("./pgConversationRepository");
    return new PgConversationRepository(Object.assign({ pool: createLazyPool({ gated: true }) }, options));
  }
  return new FileConversationRepository(options);
}

function getConversationRepository(options = {}) {
  if (options.repository) return options.repository;
  if (!defaultRepository || options.forceNew) {
    defaultRepository = createConversationRepository(options);
  }
  return defaultRepository;
}

function resetConversationRepositoryForTests() {
  defaultRepository = null;
}

module.exports = {
  createConversationRepository,
  getConversationRepository,
  resetConversationRepositoryForTests,
};

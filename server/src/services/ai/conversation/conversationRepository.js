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
    const { getPool } = require("../persistence/pgPersistenceService");
    const { PgConversationRepository } = require("./pgConversationRepository");
    return new PgConversationRepository(Object.assign({ pool: getPool() }, options));
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

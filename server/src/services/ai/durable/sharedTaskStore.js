/**
 * P5a WS6：durable 任务存储的消费侧共享实例（按后端选择）。
 *
 * WS4a 交付了 createDurableTaskStore 工厂与 PG adapter，但
 * resume.js / waitForEvent.js 的既有默认参数固定 file 单例。本模块提供
 * 进程级共享实例：
 *   - file（默认）→ 逐字返回 taskStore.defaultDurableTaskStore（既有同步
 *     消费链零变化）；
 *   - postgres → createDurableTaskStore({ store: gated pg adapter })：
 *     lazy pool 构造不触网、未配置 PG 不在首次调用前抛错；adapter 的
 *     load/save 入口先 await ensureAgentPersistenceReady()（migration
 *     0003 的 agent_durable_tasks 表由 initPlatform 链保证；失败以 coded
 *     AGENT_PLATFORM_INIT_FAILED 拒绝，不经 agent-runtime query 包装，
 *     code 原样保留）。DurableTaskStore 已内建 thenable 透传，resume /
 *     waitForEvent 的消费方按 maybe-async 处理。
 */

const {
  createDurableTaskStore,
  defaultDurableTaskStore,
  SCHEMA_VERSION,
} = require("./taskStore");
const { resolveRepositoryBackend } = require("../persistence/repositoryBackend");
const { createLazyPool, ensureAgentPersistenceReady } = require("../persistence/pgReadiness");

let sharedStore = null;

function createSharedDurableTaskStore(options = {}) {
  if (resolveRepositoryBackend(options.repositoryBackend) !== "postgres") {
    return defaultDurableTaskStore;
  }
  // lazy require：file 模式不加载 pg 依赖链。
  const { createPgDurableTaskStoreAdapter } = require("./pgDurableTaskStoreAdapter");
  const inner = createPgDurableTaskStoreAdapter({
    pool: options.pool || createLazyPool(),
    schemaVersion: SCHEMA_VERSION,
  });
  const gatedAdapter = {
    kind: inner.kind,
    async load() {
      await ensureAgentPersistenceReady();
      return inner.load();
    },
    async save(collection) {
      await ensureAgentPersistenceReady();
      return inner.save(collection);
    },
  };
  return createDurableTaskStore({ store: gatedAdapter });
}

function getSharedDurableTaskStore(options = {}) {
  if (!sharedStore || options.forceNew) {
    sharedStore = createSharedDurableTaskStore(options);
  }
  return sharedStore;
}

function resetSharedDurableTaskStoreForTests() {
  sharedStore = null;
}

module.exports = {
  createSharedDurableTaskStore,
  getSharedDurableTaskStore,
  resetSharedDurableTaskStoreForTests,
};

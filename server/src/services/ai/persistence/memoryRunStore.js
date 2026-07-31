/**
 * P5a WS3：Run/Event/Trace store 契约与默认内存实现。
 *
 * store 契约（三个后端共享：memory / journal / pg；hooks 由
 * agentRunEventService 与 agentTraceRecorder 在每次内存投影变更后调用）：
 *   - kind: "memory" | "journal" | "pg"
 *   - retentionMs / terminalRetentionMs：durable 后端的保留窗口（数据保留策略）；
 *     memory 为 undefined → 服务层回落 180s 内存语义（行为逐字不变）；
 *   - onRunCreated(doc)：新 Run 落存（doc 为完整 run 文档快照）；
 *   - onEvent(runId, event, doc)：事件追加 + run.status 推进（pg 后端同一事务）；
 *   - onRunUpdated(doc)：setResult / cancel 等非事件字段推进；
 *   - onRunsPruned(runIds)：过期 / 容量淘汰传播；
 *   - onTrace(trace)：已脱敏 trace（sanitize 链在写入前完成，store 不再加工）；
 *   - onTracesCleared()：测试钩子清空传播；
 *   - hydrate()：启动重放 → { runs: [doc], traces: [trace] }；
 *     memory/journal 同步返回，pg 返回 Promise（服务层按 thenable 区分）；
 *   - listEventsAfter(runId, afterSequence)：cursor 续读支撑（P6a）；
 *   - resetForTests() / closeForTests()：测试钩子。
 *
 * 内存实现是「无持久化」语义：全部 hook 为 no-op，hydrate 返回空集——
 * 进程重启即丢（与 P5a 前的 agentRunEventService 行为逐字一致）。
 */

function createMemoryRunStore() {
  return Object.freeze({
    kind: "memory",
    retentionMs: undefined,
    terminalRetentionMs: undefined,
    onRunCreated() {},
    onEvent() {},
    onRunUpdated() {},
    onRunsPruned() {},
    onTrace() {},
    onTracesCleared() {},
    hydrate() {
      return { runs: [], traces: [] };
    },
    listEventsAfter() {
      return [];
    },
    resetForTests() {},
    closeForTests() {},
  });
}

module.exports = Object.freeze({
  createMemoryRunStore,
});

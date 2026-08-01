/**
 * P5a WS3：Run/Event/Trace 持久化的数据保留策略（单一权威定义点）。
 *
 * 语义（design.md §8.1：terminal result 与事件的 TTL 不得短于客户端断线恢复窗口）：
 *   - RECOVERY_WINDOW_FLOOR_MS：客户端断线恢复窗口基线，与
 *     agentRunEventService 的内存 TTL（AI_AGENT_RUN_TTL_MS，默认 180s）同口径。
 *     持久化后该 TTL 从「内存清理语义」重定义为「数据保留策略」的下限；
 *   - DEFAULT_RUN_RETENTION_MS：durable store（journal / postgres）默认保留窗口
 *     30 分钟（AI_AGENT_RUN_RETENTION_MS 可配），永远 ≥ 恢复窗口基线。
 *     P6a 的 cursor 重放依赖本窗口：窗口内的 Run/Event 在进程重启后仍可
 *     按 afterSequence 续读；
 *   - trace 保留与 Run 分开：沿用 capability manifest 的管理面口径
 *     （maxTraceEntries / traceRetentionMs），与内存实现一致。
 *
 * 显式构造参数（测试注入短窗口）优先于 env/默认；env/默认路径永远套用下限。
 */

const RECOVERY_WINDOW_FLOOR_MS = Math.max(
  30_000,
  Number(process.env.AI_AGENT_RUN_TTL_MS || 180_000) || 180_000
);
const DEFAULT_RUN_RETENTION_MS = Math.max(
  RECOVERY_WINDOW_FLOOR_MS,
  Number(process.env.AI_AGENT_RUN_RETENTION_MS || 30 * 60_000) || 30 * 60_000
);

// 显式参数可信（测试需要短窗口）；缺省时回落 env/默认（带恢复窗口下限）。
function resolveRunRetentionMs(explicit) {
  const value = Number(explicit);
  if (Number.isFinite(value) && value >= 1) return Math.floor(value);
  return DEFAULT_RUN_RETENTION_MS;
}

function resolveTraceRetentionMs(explicit, manifestRetentionMs) {
  const value = Number(explicit);
  if (Number.isFinite(value) && value >= 1) return Math.floor(value);
  const fromManifest = Number(manifestRetentionMs);
  if (Number.isFinite(fromManifest) && fromManifest >= 1000) return Math.floor(fromManifest);
  return 7 * 24 * 60 * 60 * 1000;
}

function resolveTraceMaxEntries(explicit, manifestMaxEntries) {
  const value = Number(explicit);
  if (Number.isFinite(value) && value >= 1) return Math.floor(value);
  const fromManifest = Number(manifestMaxEntries);
  if (Number.isFinite(fromManifest) && fromManifest >= 1) return Math.floor(fromManifest);
  return 500;
}

module.exports = Object.freeze({
  DEFAULT_RUN_RETENTION_MS,
  RECOVERY_WINDOW_FLOOR_MS,
  resolveRunRetentionMs,
  resolveTraceMaxEntries,
  resolveTraceRetentionMs,
});

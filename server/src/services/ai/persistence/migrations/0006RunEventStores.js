/**
 * P5a WS3：Run / RunEvent / RunTrace 三表的建表 migration（design.md §8.1/§8.3）。
 *
 * 版本纪律（expand-contract，与 packages/agent-runtime AGENT_CORE_MIGRATIONS 同规）：
 *   - 本文件固定 version 6；0005 预留给 RAG 索引 workstream（并行任务），不得占用；
 *   - 已应用版本的 statements 永远不得回改（runner 以 sha256 校验，fail closed）；
 *   - 本 migration 只新增表/索引，不触碰既有对象。
 *
 * 表结构（与 brief §4 逐字对齐；唯一键与约束照简报）：
 *   - agent_runs：run_id 主键 + (principal_key, idempotency_key) 唯一键；
 *     idempotency_key 缺省存 NULL（PG 唯一键对 NULL 互不相同，未提供幂等键的
 *     Run 不会误碰撞）。doc jsonb 为附加列——水合事实源，携带 pollTokenHash /
 *     expiresAtMs / runtimeMode 等恢复必需字段（沿用 0003 agent_conversations /
 *     agent_durable_tasks 的 key 列 + doc jsonb 屋型）；
 *   - agent_run_events：(run_id, sequence) 唯一键 + event_id 主键（确定性
 *     `${run_id}#${sequence}`，幂等重放 ON CONFLICT DO NOTHING）；
 *     run_id 外键 ON DELETE CASCADE（保留窗口淘汰 Run 时事件随之物理删除）；
 *   - agent_run_traces：trace_id 主键；run_id 无外键（chat 链路的 trace 可能
 *     先于/不经过 Run 存在）；脱敏后的完整 trace 存 safe_details。
 */

const RUN_EVENT_STORE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 6,
    name: "run_event_stores",
    statements: Object.freeze([
      [
        "CREATE TABLE IF NOT EXISTS agent_runs (",
        "  run_id text PRIMARY KEY,",
        "  principal_key text,",
        "  idempotency_key text,",
        "  status text NOT NULL,",
        "  execution_policy text,",
        "  config_version text,",
        "  engine_id text,",
        "  deadline_at timestamptz,",
        "  final_result jsonb,",
        "  doc jsonb NOT NULL,",
        "  created_at timestamptz NOT NULL DEFAULT now(),",
        "  updated_at timestamptz NOT NULL DEFAULT now(),",
        "  CONSTRAINT agent_runs_principal_idempotency_key UNIQUE (principal_key, idempotency_key)",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS agent_run_events (",
        "  event_id text PRIMARY KEY,",
        "  run_id text NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,",
        "  sequence bigint NOT NULL,",
        "  type text NOT NULL,",
        "  protocol_version text,",
        "  public_payload jsonb NOT NULL,",
        "  created_at timestamptz NOT NULL DEFAULT now(),",
        "  CONSTRAINT agent_run_events_run_sequence_key UNIQUE (run_id, sequence)",
        ")",
      ].join("\n"),
      [
        "CREATE TABLE IF NOT EXISTS agent_run_traces (",
        "  trace_id text PRIMARY KEY,",
        "  run_id text,",
        "  stage text,",
        "  duration_ms bigint,",
        "  outcome text,",
        "  provider_id text,",
        "  fallback boolean NOT NULL DEFAULT false,",
        "  safe_details jsonb NOT NULL,",
        "  created_at timestamptz NOT NULL DEFAULT now()",
        ")",
      ].join("\n"),
      "CREATE INDEX IF NOT EXISTS agent_run_traces_run_id_idx ON agent_run_traces (run_id)",
      "CREATE INDEX IF NOT EXISTS agent_run_traces_created_at_idx ON agent_run_traces (created_at)",
    ]),
  }),
]);

module.exports = Object.freeze({
  RUN_EVENT_STORE_MIGRATIONS,
});

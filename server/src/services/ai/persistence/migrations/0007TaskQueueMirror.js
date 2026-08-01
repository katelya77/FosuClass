/**
 * P5a 审查修复（I-1）：任务队列 PG 镜像的独立表（standalone 模式）。
 *
 * 背景：WS5 曾把 Redis 队列镜像写进 0003 的 agent_durable_tasks（task_id
 * `tq:<namespace>:<jobId>`），与 durable 任务存储一表两主——durable 的
 * 整集合重写（save 的差集 DELETE / clearAll）会抹掉队列镜像行（跨重启
 * 幂等锚），队列镜像行也会被 durable load() 读成幽灵任务。独立评审
 * 确认为 Important，本 migration 将队列镜像分表：
 *
 *   - agent_task_queue_mirror：仅由 taskQueue/redisStreamsTaskQueue 读写
 *     （task_id 同为 `tq:<namespace>:<jobId>` 形式）；durable 任务存储
 *     不再与其共享表，互不抹除；
 *   - doc 为 jsonb（驱动自动解析回对象，与 0003 同屋型；镜像簿记无字节
 *     保留需求，非业务文档；权威语义见队列头注）；
 *   - P5a 尚未发布到任何环境，无存量行需要搬移（expand-only 新增表）。
 *
 * 版本纪律（expand-contract，与既有 migration 同规）：
 *   - 本文件固定 version 7；已应用版本的 statements 永远不得回改
 *     （runner 以 sha256 校验，fail closed）；
 *   - 本 migration 只新增表，不触碰既有对象。
 */

const TASK_QUEUE_MIRROR_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 7,
    name: "task_queue_mirror",
    statements: Object.freeze([
      [
        "CREATE TABLE IF NOT EXISTS agent_task_queue_mirror (",
        "  task_id text PRIMARY KEY,",
        "  status text NOT NULL,",
        "  doc jsonb NOT NULL,",
        "  updated_at timestamptz NOT NULL DEFAULT now()",
        ")",
      ].join("\n"),
    ]),
  }),
]);

module.exports = Object.freeze({
  TASK_QUEUE_MIRROR_MIGRATIONS,
});

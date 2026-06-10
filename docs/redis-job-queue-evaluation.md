# Redis / BullMQ 任务队列评估

## 结论

当前单实例 FosuClass 发布链路暂不引入 Redis 或 BullMQ。

现阶段最直接的 504 风险，来自 Release Pack 构建等 CPU 密集任务与 Web API 共用同一个 Node.js 事件循环。把发布重任务移到子进程即可解决这个故障模式，同时不需要改变 Release Pack 的文件存储模型，也不需要额外维护一个外部服务。

## 当前方案

- 任务状态继续以文件形式保存在 `server/storage/jobs`。
- 发布重任务共用 `release-heavy` 锁分组，避免并发构建互相覆盖。
- API 进程创建排队任务，并 fork `server/src/workers/releaseWorker.js`。
- Worker 将进度、日志、结果和错误写回持久化任务文件。
- 静态 Release Pack JSON 继续采用文件存储，由 CDN/OpenResty 提供访问。

## 后续 Redis 适用场景

Redis 适合在以下情况引入：

- 多进程或多主机任务队列。
- 分布式锁。
- 任务进度广播。
- 全局限流。
- 重试元数据和延迟任务调度。

当项目扩展到多个 Worker、多个 VPS 实例，或需要比当前文件队列更完整的持久重试、退避和延迟调度时，BullMQ 才有明显收益。

## Redis 不适合解决的问题

Redis 不应保存完整的全校 Release Pack。Release Pack 是大体积、静态、适合 CDN 缓存的 JSON 数据，现有目录布局已经能高效服务小程序。

Redis 本身也不能解决同步 gzip/Brotli 压缩导致的 CPU 占用。无论底层队列是文件、Redis 还是 BullMQ，压缩都应移出 API 进程，并以受控并发执行。

## 未来适配边界

如果服务规模超过单 Worker，可以增加 `JobStore` / `JobQueue` 适配层：当前文件实现作为默认方案，Redis/BullMQ 作为可选生产适配器。

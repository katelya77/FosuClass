# 学期迁移

学期迁移是一次性、幂等且可恢复的启动流程。

当 `term-registry.json` 不存在时，服务启动会尝试从当前生产状态迁移：

1. 读取 `releases/active.json`。
2. 读取 active release manifest。
3. 优先使用 manifest 中的 `term`、`semester`、`termConfig`、`releaseVersion` 和发布时间。
4. 如果 active release 是 `2025-2026-2`，且 manifest 缺少 `termConfig`，使用明确标注的旧版兼容回退。
5. 在安全条件满足时，将旧版 `catalog.json`、`majors-index.json` 和 `sync-meta.json` 复制到 `terms/2025-2026-2/`。
6. 写入 `term-registry-migration-report.json`。

迁移不会删除旧文件。重复启动不会覆盖已存在的 registry。如果迁移失败，服务会继续以单学期兼容模式运行，并记录结构化 warning。

迁移过程中不会为未来学期猜测开学日期。

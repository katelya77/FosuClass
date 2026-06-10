# 存储保留策略

## 默认保留规则

- Active Release：始终保留。
- Last-known-good Release：至少保留到最近一个可用的上一版本。
- Release 保留数量：`FOSU_RELEASE_RETENTION_COUNT=3`。
- Release 保留天数：`FOSU_RELEASE_RETENTION_DAYS=30`。
- 成功任务：`FOSU_JOB_SUCCESS_RETENTION_DAYS=14`。
- 失败任务：`FOSU_JOB_FAILED_RETENTION_DAYS=30`。
- Staging 上传文件：`FOSU_STAGING_FILE_RETENTION_DAYS=14`。
- 已归档元数据：`FOSU_ARCHIVE_METADATA_RETENTION_DAYS=90`。
- 临时文件和分片：`FOSU_TEMP_RETENTION_HOURS=24`。
- 日志：`FOSU_LOG_RETENTION_DAYS=30`，并在约 `FOSU_LOG_ROTATE_SIZE_MB=10` 时轮转。

## 安全规则

- 清理前支持 dry-run 预览。
- Active Release 永远不会被维护任务删除。
- 被 pin 的 Release 不能被维护任务删除。
- 正在运行的任务文件会被跳过。
- 公开的 Release Pack 目录，只有在对应正式 Release 不再保留时才会被清理。
- 重要元数据会在文件清理前先汇总留档。
- 同一时间只允许一个维护任务运行。

## 管理后台操作

- 刷新轻量状态：读取缓存的运行时和磁盘状态。
- 运行存储扫描：计算目录大小，并写入缓存摘要。
- 预览安全清理：只报告候选文件和预计释放空间，不执行删除。
- 执行安全清理：只删除不受 active、last-known-good、pin 或运行中任务保护的候选项。

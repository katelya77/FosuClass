# 存储保留策略

## 默认保留规则

- Active Release：始终保留。
- Last-known-good Release：至少保留到最近一个可用的上一版本。
- Release 保留数量：`FOSU_RELEASE_RETENTION_COUNT=3`。
- Release 保留天数：`FOSU_RELEASE_RETENTION_DAYS=30`。
- 成功任务：`FOSU_JOB_SUCCESS_RETENTION_DAYS=14`。
- 失败任务：`FOSU_JOB_FAILED_RETENTION_DAYS=30`。
- Staging 上传文件：`FOSU_STAGING_FILE_RETENTION_DAYS=14`。
- 重复 / no-change 观测：`FOSU_DUPLICATE_UPLOAD_RETENTION_DAYS=7`。
- 失败上传：`FOSU_FAILED_UPLOAD_RETENTION_DAYS=7`。
- 未完成上传：`FOSU_INCOMPLETE_UPLOAD_RETENTION_HOURS=24`。
- superseded 原始大文件与非 Active、非各学期最新 Published 的历史上传记录：`FOSU_SUPERSEDED_UPLOAD_FILE_RETENTION_DAYS=30`。
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
- canonicalHash 相同只表示“数据内容一致”，不会让所有历史上传记录都成为 Active；只有 runtime pointer 对应的准确 Release 来源记录受 Active 保护。
- no-change 同步按 `term + canonicalHash + source` 合并为单个观测记录，保留累计次数和最近 20 个 Publisher runId，避免每日同步无限增长。
- 删除上传物理目录后会用精确 uploadId 压缩统一上传索引，已删除记录不会被历史索引重新带回。

## 管理后台操作

- 刷新轻量状态：读取缓存的运行时和磁盘状态。
- 运行存储扫描：计算目录大小，并写入缓存摘要。
- 预览安全清理：只报告候选文件和预计释放空间，不执行删除。
- 执行安全清理：仅 `admin:full` 可用，必须提交精确确认文本 `DELETE_UNUSED_SCHEDULE_DATA`；只删除不受 active、last-known-good、pin、每学期最新 Published 或运行中任务保护的候选项，并同步压缩上传记录索引。

## CloudBase Hosting

- 新版本镜像并完成远端校验、pointer 切换后，Publisher 自动执行远端保留清理。
- `FOSU_CLOUDBASE_KEEP_LATEST=3` 控制最近版本保留数；active、pointer 中的 last-known-good 和显式 keep 列表始终受保护。
- 日常 no-change 同步不会扫描或删除 CloudBase 文件，避免增加常规同步延迟。
- 可用 `npm run cloudbase:release:prune` 只查看 dry-run 计划；实际删除仍需要工具内的精确确认门禁。

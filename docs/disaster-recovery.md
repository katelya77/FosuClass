# 灾备与故障恢复

## 发布任务失败

1. 打开任务详情。
2. 查看已脱敏的错误摘要。
3. 执行状态核对。
4. 只有在 Staging 安全检查仍通过时，才重试发布。

## 后台 Worker 挂起

1. 检查当前运行中的 `release-heavy` 任务。
2. 如果任务已经过期，等待 stale-job recovery 将其标记为失败。
3. 不要手动再启动第二个 release-heavy 任务。

## OpenResty 目录不可写

1. 修复目录所有者或挂载权限。
2. 重新执行静态同步。
3. 验证 `manifest.json`、`index/class/all.json` 和 `empty-room/index.json`。

## 磁盘进入严重状态

1. 运行存储扫描。
2. 预览安全清理。
3. 执行安全清理。
4. 等磁盘退出 critical 状态后，再重试 release-heavy 任务。

## 当前正式 Release 损坏

1. 从 Release 历史回滚到 last-known-good。
2. 执行 OpenResty 静态同步。
3. 验证静态 URL。
4. 重新核对 Staging / upload 状态。

## Staging 状态不一致

点击“重新核对状态”。核对流程会比较 active Release canonical hash、最新 Staging canonical hash、upload ID、Relay ID 和 release version。该操作是幂等的，可以安全重复执行。

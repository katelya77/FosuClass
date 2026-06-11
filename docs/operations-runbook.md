# FosuClass 运维手册

## 长期生产流程

1. 在本地校园网环境执行一次全新的数据采集。
2. 通过 CLI 分片上传或 Relay 上传 Staging 数据。
3. 在管理后台同步中心检查 canonical hash。
4. 发布当前 Staging 包。
5. 由 Release Worker 构建 Release Pack。
6. 将 active Release 同步到 OpenResty 静态目录。
7. 验证 `manifest.json`、`index/class/all.json` 和 `empty-room/index.json` 的静态 URL。
8. 确认小程序正在使用 active Release version。
9. 日常运行通常不需要手动清理。
10. 发现异常状态时，先执行状态核对，再通过 Release 历史回滚，不要直接改文件。

## 日常检查

- 管理后台同步中心能看到 active release、active canonical hash 和 staging hash。
- Staging 上传列表不会对已经发布并激活的数据继续显示发布操作。
- OpenResty 卡片分别展示 enabled、configured、writable、version 和 URL 状态。
- Runtime 和存储卡片显示磁盘未进入 critical 状态。
- 最近的 release-heavy 任务为成功，或失败但带有明确错误摘要。

## 常见故障

- 发布任务失败：查看任务日志，运行状态核对；只有在 Staging 安全检查仍通过时才重试发布。
- API 重启：`/api/admin/sync/status` 会执行轻量核对，并应能从文件中恢复上传状态。
- Worker 卡住：`release-heavy` 锁会阻止重复执行；过期任务由 stale job recovery 标记为失败。
- OpenResty 目录不可写：修复目录 owner 或挂载权限，然后重新执行静态同步。
- 磁盘空间不足：运行存储扫描，预览安全清理，再执行安全清理。
- Active Release 损坏：通过 Release 历史回滚到 last-known-good。
- Staging 状态不一致：点击“重新核对状态”，系统会比较 active manifest 和 upload canonical hash。
- CDN 或 Cloudflare 504：先验证源站静态 URL，再对受影响路径清理或绕过 CDN 缓存。
- 日志已脱敏：排查时使用后台审计日志和任务日志；secret、cookie、token 和本地路径都必须被脱敏。

## VPS 命令

```bash
cd /home/ubuntu/FosuClass
npm --prefix server install
NODE_ENV=production npm --prefix server start
```

部署完成后，在管理后台同步中心依次执行：

- `重新核对状态`
- `运行存储扫描`
- `验证静态 URL`
- 当 OpenResty 显示版本不一致时，执行 `同步当前 Release`

## 回滚

使用管理后台的 Release 历史模块回滚。不要手动删除 active Release 目录。回滚后要重新执行静态同步和 URL 验证，确保 OpenResty 与小程序指向同一个 Release。

## Production runtime data

`server/storage/term-registry.json` is persistent production runtime data, not a source-controlled default. Code deployment must not assume it will overwrite production registry state.

Operational rules:

- Deploy scripts deploy code only.
- Do not delete the whole `server/storage` directory during deploy.
- Do not clear `server/storage/snapshots/current.json` or `.gz`.
- Do not overwrite XLS or user-local schedule data.
- Do not use `git reset` or source checkout commands to force-remove production runtime files.
- Term registry fixes must run through an explicit admin migration/repair Job, such as `管理后台 -> 学期管理 -> 修复并重建当前学期 Release`.

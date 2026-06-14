# CloudBase Hybrid Architecture

## 目标架构

FosuClass 采用“Oracle 控制面 + CloudBase 国内数据面 + 可替换 AI Provider”的渐进式架构：

- Oracle 继续负责本地校园网同步结果接收、XLS 导入、用户贡献、反馈、管理后台、Release Pack 构建审核发布，以及现有 Express API。
- CloudBase 静态网站托管作为公开 Release Pack 的国内主读取源，只分发已经验证过的不可变 JSON 文件。
- Oracle OpenResty `/static/releases` 和 `/static/runtime/active.json` 作为第二读取源。
- 课表查询不通过云函数实时转发，不把全校课表逐条写入 CloudBase 数据库，也不让模型成为课表事实来源。

## 小程序读取顺序

小程序端的读取顺序固定为：

1. 页面内存和本地 storage。
2. last-known-good。
3. CloudBase Hosting 静态源。
4. Oracle OpenResty 静态 Release Pack。
5. Oracle 兼容 API。
6. 所有网络源失败后继续展示 last-known-good，不清空页面。

运行时指针优先读取：

- CloudBase: `${CLOUDBASE_HOSTING_BASE_URL}/runtime/active.json?bucket=...`
- Oracle: `https://class.katelya.eu.org/static/runtime/active.json?bucket=...`

版本化文件保持不可变 URL，例如：

```text
releases/{releaseVersion}/manifest.json
releases/{releaseVersion}/index/class.json
releases/{releaseVersion}/details/class/{id}.json
```

这些文件不追加随机时间戳，避免破坏 CDN 缓存和版本隔离。

## 配置边界

CloudBase 环境 ID `cloud1-d3g17rpe7566d3d5c` 不是密钥，可以进入代码，但集中放在 `miniprogram/config/cloudbase.js`。Hosting 域名不能猜测，必须由 CloudBase 控制台或 CLI 查到后填入：

```bash
npm install -g @cloudbase/cli
tcb login
npm run cloudbase:hosting:detail
```

本次 CLI 查询到的当前 Hosting 域名为：

```text
https://cloud1-d3g17rpe7566d3d5c-1442900641.tcloudbaseapp.com
```

如果后续环境迁移或没有 CLI 登录态，`CLOUDBASE_HOSTING_BASE_URL` 可以保持空字符串，小程序会自动跳过 CloudBase 静态源并继续使用 Oracle 静态源。

## 静态源故障隔离

`miniprogram/services/staticOriginService.js` 对每个 origin 独立维护：

- 失败次数。
- circuit breaker。
- 最近命中的源。
- in-flight singleflight，避免同一个 manifest、index、detail 并发重复下载。

建议超时策略：

- runtime pointer: 约 2.2 秒，同源不重试。
- manifest: 约 4.5 秒，同源不重试。
- index/detail/empty-room: 约 7.5 秒，最多同源重试 1 次。

CloudBase 源失败后快速切 Oracle；Oracle 再失败时保留本地 last-known-good。

## Runtime pointer 与完整 manifest 边界

`runtime/active.json` 只是一份 pointer，客户端按 term 写入独立缓存 `FOSU_RUNTIME_POINTER`。它只能用于 activeTerm、releaseVersion、cacheEpoch、forceRefreshToken 和 termConfig 候选信息，状态标记为 `manifestStatus: "pointer-only"`。

客户端不得把 pointer 写入 manifest cache，也不得写入 last-known-good。只有成功下载 `releases/{releaseVersion}/manifest.json`，并校验 term、releaseVersion、cacheEpoch，再预热必要 class index/shard 后，才允许写入 manifest cache、last-known-good 和 active release。真实 manifest 获取或 warmup 失败时，旧 last-known-good 保持不变。

## CloudBase/Oracle freshness 保护

首屏仍优先 CloudBase，不等待 Oracle。冷启动后后台低优先级执行 freshness check：每次冷启动最多一次，且距离上次检查至少 6 小时，Oracle runtime pointer 请求 2 秒超时。

比较规则：

- Oracle 与 CloudBase releaseVersion/cacheEpoch/forceRefreshToken 一致：`healthy`。
- Oracle 更新：记录 `cloudbase-stale`，当前会话优先切到 Oracle 新版本，不删除 CloudBase 缓存。
- Oracle 不可用：记录 `oracle-unavailable`，不影响 CloudBase 首屏。
- CloudBase 不可用：继续现有 Oracle fallback。

设置页高级诊断会显示 `cloudbaseReleaseVersion`、`oracleReleaseVersion`、`freshnessStatus`、`checkedAt`、实际命中的 `staticOrigin`、`staticOriginLabel`、去 query 后的 `staticOriginUrl`、pointer source 和最近请求耗时。

## AI 路由边界

事实型请求仍走 Oracle `/api/ai/agent/chat`，继续使用现有 `toolRegistry`、`cards`、`actions`、`evidence` 和安全结构。包括：

- 今日课程、下一节课。
- 教师、班级、教室、课程查询。
- 空教室、教学周、数据诊断。
- XLS 导入、共同空闲时间。

生成式请求才进入 CloudBase 混元：

- 项目问答。
- 使用帮助。
- 普通自然聊天。
- 对已经确定的工具结果做非事实性解释。

回退顺序是：

```text
CloudBase Hunyuan -> Oracle DeepSeek/Coze -> 内置项目知识摘要 -> mock
```

CloudBase、Oracle 或模型任一方故障，都不得影响核心课表读取。

## 官方参考

- CloudBase 小程序 AI 接入: <https://docs.cloudbase.net/ai/model/miniprogram-access>
- CloudBase AI 体验计划: <https://docs.cloudbase.net/ai/ai-inspire-plan>
- CloudBase 静态托管 CLI: <https://docs.cloudbase.net/cli-v1/hosting>

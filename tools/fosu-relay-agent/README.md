# FosuClass 接力采集 Agent

`relay agent` 用于让一台已连接校园网或 VPN 的本地机器代替管理员执行采集任务。它只上传候选 Staging JSON 和任务进度，不会把 Cookie、密码、CAS ticket、本地教务会话或浏览器缓存发到 VPS。

## 运行命令

```powershell
npm run sync:relay-agent -- --server=https://class.katelya.eu.org --token=RELAY_TOKEN --term=2025-2026-2
```

`RELAY_TOKEN` 只能执行以下动作：

- 读取一个待执行的 relay task。
- 上报 heartbeat、版本、网络诊断、登录状态、阶段、进度、失败目标和上传进度。
- 上传候选 Staging JSON。
- 接收管理员取消任务的指令。

`RELAY_TOKEN` 不能执行以下动作：

- 访问 `/api/admin/*`。
- 发布、激活或回滚 release。
- 读取管理员配置。
- 读取或传输本地校园网 Cookie、密码、CAS ticket、JSESSIONID。

## 任务类型

管理后台主语义是 `sync:publish`。旧任务名仍可作为兼容别名解析到同一个 `syncPlan`，不要让 relay 形成另一套数据契约或 Release 格式：

- `sync:publish`
- `sync:publish:full`
- `sync:daily`（兼容）
- `sync:new-term`

同一台机器同一时间只应运行一个重任务。管理员取消任务后，Agent 会在下一个阶段边界或 heartbeat 检查点停止。

## 日志与脱敏

日志必须脱敏。不要打印包含身份信息、Cookie、JSESSIONID、CAS ticket、密码、API token、relay token 或原始 HTML 的内容。

## 缓存与上传记录

采集结果上传到 VPS 后只进入 Staging 区。服务端统一维护 `server/storage/upload-record-index.json`，管理后台分页、`term` 过滤和 `status` 过滤都从这个索引读取，避免打开列表时重新扫描每个上传目录。后续发布仍走统一 Oracle publish pipeline、OpenResty 同步和 CloudBase 镜像；安全校验会阻止教师目录异常降级。

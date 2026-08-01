# 助手运行中心使用说明

入口沿用现有后台路由，用户可见名称为“助手运行中心”；内部 `agent-platform` API 和配置内核名称不变。

## 运行概览

管理员应先选择 `public`、`trial` 或 `dev`，然后确认：

- 当前部署 SHA 和该环境的 configVersion；
- 总体状态、最近成功/失败、15 分钟成功率、P50/P95 和运行中 Run；
- Provider 的 configured、configuredAvailable、verified、reachable、lastProbeAt、lastSuccessAt 和 circuit state；
- Memory、RAG、Tool、Queue、PostgreSQL、Redis 的真实状态。

“暂无样本”表示没有足够的持久化事件，不能解释为 0ms 或 100% 成功。`providerVerified=false` 时，即使凭据存在，也不能写“已验证”。

## 一键诊断

Smoke Test 的每一项显示验证类型、通过状态、耗时、reasonCode 和时间：

- public 本地 Tool：真实确定性调用；
- trial/dev Provider Decision：真实 Probe，只有凭据与能力授权允许时执行；
- Tool：真实调用；
- Run create/poll：真实创建并轮询；
- Memory：写入临时值、读回、删除回滚，不保留测试内容；
- RAG：等待已发布索引就绪后进行真实查询。

public 的 Provider 测试应显示“跳过/public 禁止外部调用”，不是失败，也不能用 mock 冒充 Probe。RAG 无候选可作为查询链路完成，但 reasonCode 必须保留 `NO_CANDIDATE`。

## Run 监控

列表来自 durable Run/Event/Trace Store，可按环境、状态、Provider、Tool、errorCode 和时间筛选。默认字段包括 runId、requestId、environment、configVersion、intent、Skill/Tool、Provider、externalProviderUsed、fallback、状态、总耗时、失败层和错误码。

列表不默认展示完整用户原文、OpenID、个人课表或私人记忆。点击一条 Run 后显示真实时间轴；失败阶段突出，并依据 reasonCode 给处理建议。服务重启后历史 Run 仍应存在。

## 记忆运行状态与能力管理

记忆区只显示后端、可用性、写入/失败、冲突、无效候选拒绝、迁移、scope 计数和 TTL 清理等聚合事实，不浏览私人内容。

能力区用业务名称关联 Skill、Tool、数据源、public/trial/dev 可用范围、是否需要 Provider 和最近结果。管理员不需要先理解六域 JSON 才能判断一项校园能力是否可用。

## 高级配置

六域配置、原始 JSON、draft、validate、test、publish、history、rollback 和 audit 全部保留在折叠的“高级配置”。发布和回滚仍需管理员确认、CSRF、权限和审计；历史版本不可变，不可用覆盖旧 JSON 的方式“回滚”。

## 常见处置

- readiness 可达但 Run 失败：按 requestId 查询 Run，先看 Session、environment/configVersion，再看 failureLayer。
- configured=true、verified=false：执行对应环境的真实 Provider Probe；不要先改成 reachable。
- Run create 有记录但客户端报网络错：确认客户端已包含 HTTP 202 修复，并检查 poll token/header 是否被反代丢弃。
- Memory unavailable：本机记忆仍可浏览；检查持久化后端、密钥和最近写入错误，不要把 cloud_sync 显示为成功。
- 没有 Run：先检查小程序诊断中的 API host、Session、Run create requestId，再核对 Cloudflare/OpenResty 日志。

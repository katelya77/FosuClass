# 小佛助手可靠性与产品收敛设计

## 目标与边界

本次收敛不建立第二套在线 Agent，也不恢复客户端生成式回答。服务端 Agent Kernel 仍是在线决策核心，Release Pack、个人课表摘要和确定性 Tool 仍是校园事实源。`public` 外部 Provider 调用恒为零；`trial/dev` 只有在 Session 与 capability authorization 同时允许时才可调用 Provider。

## 运行链路

```text
小程序环境唯一来源
  -> 可信请求层注入 X-Fosu-Env-Version + requestId
  -> Route 认证/授权并生成 runtime context
  -> Run create (202 + 幂等键)
  -> durable Run/Event/Trace Store
  -> Planner -> Tool/Provider -> Verify -> Response
  -> poll 按 runId/requestId 返回唯一终态
```

环境字段只是输入信号。正式版、缺失或伪造的字段都不能绕过服务端 Session 和能力授权；服务端裁决后的 environment/configVersion 必须同时出现在 readiness、Run 和 Trace 中。

## 失败语义

错误按层分类：

- 微信网络：`NETWORK_OFFLINE`、`WECHAT_NETWORK_FAILED`；只有平台提供确定证据时才使用 `DNS_FAILED`、`TLS_FAILED`、`WECHAT_DOMAIN_NOT_ALLOWED`。
- 连接/HTTP：`CONNECT_TIMEOUT`、`REQUEST_TIMEOUT`、`HTTP_4XX`、`HTTP_5XX`。
- Session/运行模式：`SESSION_REQUIRED`、`SESSION_INVALID`、`RUNTIME_NOT_AUTHORIZED`。
- Run：`RUN_CREATE_FAILED`、`RUN_POLL_FAILED`、`RUN_EXPIRED`、`RUN_EXECUTOR_LOST`。
- Provider：`PROVIDER_NOT_CONFIGURED`、`PROVIDER_UNVERIFIED`、`PROVIDER_TIMEOUT`、`PROVIDER_UNAUTHORIZED`、`PROVIDER_RATE_LIMITED`。
- 数据层：`TOOL_FAILED`、`MEMORY_STORE_UNAVAILABLE`。

同一个用户问题只有一个最终状态和一张最终错误卡；requestId/runId 贯穿小程序与后台。错误不能被全部吞成“服务器不可用”。

## 本机降级

Local Tool Fallback 与旧 direct-chat 完全分离：

- 仅执行本机已经有事实数据的确定性能力：个人今天/本周课表、已缓存索引的受限查询、当前教学周、页面导航、地图入口和本机记忆。
- 结果标记为“本机结果”，没有服务端 runId，也不伪造 RunEvent。
- 复杂组合任务或缺少缓存时明确提示“此任务需要联网”。
- 网络恢复后保留原问题的一键重试入口。
- 只有检测到可执行本地事实源时显示“本地可用”；否则显示“离线 · 仅可查看已缓存页面”。

## 记忆边界

所有 personal interpreter、extractor、Provider structured candidate、preference service、restore 和迁移数据最终都经过同一语义验证器。

- 疑问句、疑问代词、空值、语气词和明显低置信度候选不得直接进入长期 User Memory。
- 低置信度候选只进入 Working Memory，或等待用户确认。
- 长期记录保存 provenance、source、confidence、scope、reasonCode、时间和 supersede 关系。
- 纠正语句创建新 revision 并 supersede 旧值，不原地抹除历史。
- 明显无效的旧 preferredName 自动失效并写审计；不确定的正常值不迁移。

## 助手运行中心

首页只回答运行事实：部署 SHA、environment、configVersion、Provider 四种状态、真实 Probe 时间、15 分钟成功率和 P50/P95、运行中 Run、Memory/RAG/Tool/Queue/PostgreSQL/Redis。

一键诊断调用真实后端路径：public 确定性 Tool、trial/dev Provider Probe、Run create/poll、Memory 写读删回滚和已发布 RAG 查询。选择 mock 时只允许标记为“仅结构测试”。无样本显示“暂无样本”，不显示伪造的 0ms。

Run 列表来自持久化 Store，默认只显示脱敏摘要与运行元数据。原始 JSON、六域配置、发布、历史和回滚保留在“高级配置”，继续服从不可变版本与审计语义。

## 兼容和回滚

- `agent.v1` 保持兼容；新增诊断和事实字段以可选方式消费。
- 不改变 Release Pack 的 last-known-good、缓存或版本校验。
- 代码回滚：回退本分支提交并重新运行 release gate。
- 配置回滚：使用助手运行中心高级配置中的历史版本回滚，不删除版本。
- 部署回滚：恢复部署前镜像/SHA，并核对 public、trial、dev 的 configVersion 指针。

# FosuClass 开发约束

本文件适用于仓库内所有自动化开发 Agent（包括 Codex、Grok Build）及其子任务。若局部目录没有更严格的说明，以下规则不可绕过。

## 项目与事实源

- FosuClass 是面向佛山大学的课表微信小程序；“小佛助手”是其校园任务型 Agent。
- Release Pack、全校课表索引、个人课表的受控本机摘要，以及现有确定性工具，是课表、教师、教室、空教室、教学周等事实的唯一来源。
- 生成式模型不能成为课表事实源，也不能改写、补全或覆盖确定性工具给出的事实。
- `public` 是正式版，必须保持生成式模型/外部 Provider 调用次数为零。`trial` 与 `dev` 可以在能力清单许可下使用表达层，但与正式版共享同一套 Intent、Skill、Tool、协议和安全边界。
- 兼容配置名 `competition` 只能映射为规范运行模式，不能继续扩展成独立业务语义。
- 不得破坏 Release Pack 的版本校验、静态源回退、缓存和 last-known-good；网络或新数据加载失败时必须保留上一份可用数据。

## Agent 改动规则

- 在线语义请求的唯一决策核心是服务端 Agent Kernel。小程序端 `xiaofuAgentRouter` 仅用于离线降级和兼容，不得重新发展成平行的在线 Agent。
- 能力权威源是 `server/config/agent-capability-manifest.json`。小程序兼容映射由 `tools/generate-agent-capability-compat.js` 生成；不要手工维护第二份 Intent/Skill/Tool 清单。
- 保持 `agent.v1` 向后兼容；新增字段进入 `agent.v2`，不得泄露隐藏推理、系统提示、内部 URL、Provider 配置或密钥。
- 正式版事实任务必须先执行确定性工具，并返回可核查 Evidence。体验/开发版的 Provider 失败时必须保留确定性结果。
- 不得用 LangChain、LangGraph、向量数据库或远程可写 MCP 替换当前轻量业务内核，除非后续需求明确授权且完成专项评审。

## 隐私、安全与后台写入

- 学号、密码、Cookie、Authorization、API Key、Token、登录票据、原始个人文件、XLS 原文和文件 base64 不得进入模型、Trace、普通日志、文档或测试快照。
- Provider 只可接收脱敏消息、最小上下文和经过裁剪的工具结果；不得接收管理员 Token、完整个人课表、系统提示或内部部署信息。
- 不得绕过后台写入权限、管理员确认、审计、幂等控制、备份和回滚机制。
- 知识库的 `publish`、`rollback`、批量删除、修改 public 范围以及 Tool/Intent 绑定属于高风险操作。未来即使通过 MCP 暴露，也必须有人工确认、细粒度 scope、审计、幂等键和回滚能力。
- 联网检索结果只能生成候选草稿；禁止搜索结果直接写入并发布。
- 不得为了通过测试删除安全检查、扩大 Provider 权限或把 mock 结果描述为生产验证。

## 必跑验证

修改 Agent、协议、运行模式、Provider、工具、Skill、知识库控制边界或小程序 Assistant 路由时，至少运行：

```text
npm run test:agent-foundation
npm run test:agent-regression
npm run test:ai-competition
```

涉及会话记忆、知识库控制面或 MCP 时，额外运行：

```text
npm run test:agent-phase2
```

或按模块：

```text
npm run test:conversation-memory
npm run test:kb-control-plane
npm run test:kb-mcp
npm run test:xiaofu-agent-ui
```

同时运行与修改模块直接相关的既有测试。若既有命令存在已确认的基线失败，必须保留失败证据并在交付报告中区分“改动引入”与“改动前已存在”；不得跳过、静默吞掉或削弱检查。需要真实 Provider 的验证必须单独说明环境和凭据条件，不能用 mock 代替。

## 会话记忆与 MCP 边界（Phase 2）

- 服务端不得信任客户端 `conversationId` 作为用户身份；Principal 仅由已验证 Session 派生。
- 无有效 Session 不得假装云端同步成功；默认 `local_only`。
- `cloud_sync` 必须用户显式开启。
- 知识库 MCP（`tools/fosu-kb-mcp`）只走受保护后台 API，不直读写知识 JSON；不得注册 publish/rollback Tool。

## 变更与发布纪律

- 只修改当前任务范围内的文件；保留用户已有的未提交改动。
- 不得直接部署生产环境。
- 未经用户明确要求，不得创建提交、推送、合并、修改远程分支或创建发布。
- 禁止把 API Key、真实凭据或私有部署信息写入代码、日志、文档、测试和 Git 历史。
- 交付前应报告实际运行的命令、通过数量、失败原因、未验证项和回滚路径。

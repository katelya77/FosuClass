# AI 校园管家合规说明

## 境内部署要求

参赛演示版本建议部署在境内服务器或校内可控网络环境。演示版不依赖境外 API，不把课表、个人摘要、聊天内容或日志发送到境外服务。

## 国产 AI Provider 配置

后端通过环境变量选择 Provider：

- `AI_PROVIDER=mock`：默认规则模式，不调用外部模型。
- `AI_PROVIDER=deepseek`：兼容 OpenAI Chat Completions 风格，需配置境内可用的 `AI_BASE_URL` 和 `AI_API_KEY`。
- `AI_PROVIDER=coze`：保留接口，需配置 `COZE_API_BASE_URL`、`COZE_API_KEY`、`COZE_BOT_ID`，未完成对接时自动 fallback mock。

## 不调用境外 API

比赛演示时保持 `AI_AGENT_ENABLED=false` 或使用境内部署的国产 Provider。任何模型服务地址都必须通过环境变量配置，不得写入仓库。

## 数据最小化

AI 请求上下文只允许包含：

- 学期、Release Version、当前页面、客户端时间、时区。
- 当前课表最小摘要：课程名、教师、教室、星期、节次、教学周、校区。

禁止包含学号、姓名、密码、Cookie、JSESSIONID、ticket、Authorization、token、原始 XLS 内容或文件 base64。

## 敏感信息脱敏

后端 `safetyGuard` 提供：

- `redactSensitiveText(text)`
- `hasSensitiveCredential(text)`
- `sanitizeAgentContext(context)`
- `sanitizeToolResult(result)`
- `buildSafeLogPayload(payload)`

聊天中出现密码、学号、Cookie、Authorization、token、base64 等内容时，系统会拒绝处理凭证，并引导用户前往 XLS 导入页面。

## 不保存密码

AI 助手不保存密码，不要求用户输入密码。个人课表推荐通过 XLS 导入，账号同步仍在原个人同步页面完成，不经过 AI Provider。

## 日志策略

AI 路由只记录脱敏后的 message preview、长度、工具名、状态、Provider 和 Release Version，不记录完整聊天原文、文件内容、密码、token 或 Cookie。

## 模型不可用降级

Provider 未配置、超时或返回非 JSON 时，`agentService` 自动 fallback 到 `mockProvider`。mock 模式仍能演示空教室、今日课程、导入指引、数据诊断和全校索引查询卡片。

## 评审测试方式建议

评审现场建议使用测试课表或脱敏 Release Pack。测试问题包括：

- “现在有空教室吗？”
- “今天还有课吗？”
- “帮我查老师课表”
- “找连续 2 节空教室”
- “怎么导入个人课表？”
- “为什么数据加载失败？”

请不要在演示中输入真实学号、密码、Cookie、token 或身份证号。

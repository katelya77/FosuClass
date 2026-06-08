# AI 校园管家合规说明

## 部署与数据链路边界

AI 校园管家按三种模式说明合规边界：

- 本地/评审机 mock 演示模式：不调用外部模型，适合比赛现场和离线安全演示。
- 国产模型脱敏调用模式：DeepSeek/Coze 只接收脱敏后的消息、工具结果和最小上下文。
- 境内部署生产模式：未来迁移到境内云、校内服务器或微信云托管并备案，是否满足数据不出境以服务器 region、模型服务 region 和实际数据链路为准。

Oracle ARM 或海外 VPS 只能作为开发/运维服务器，不应在比赛材料中表述为境内合规部署。

## 国产 AI Provider 配置

后端通过环境变量选择 Provider：

- `AI_PROVIDER=mock`：默认规则模式，不调用外部模型。
- `AI_PROVIDER=deepseek`：兼容 OpenAI Chat Completions 风格，需配置境内可用的 `AI_BASE_URL` 和 `AI_API_KEY`。
- `AI_PROVIDER=coze`：保留接口，需配置 `COZE_API_BASE_URL`、`COZE_API_KEY`、`COZE_BOT_ID`，未完成对接时自动 fallback mock。

DeepSeek 默认使用 `deepseek-v4-flash`，用于小程序快速响应；复杂说明书、离线分析或后台验证可切换 `deepseek-v4-pro`。

## 不调用境外 API

比赛演示时建议保持 `AI_AGENT_ENABLED=false`，或使用合规的国产 Provider 脱敏调用模式。任何模型服务地址和密钥都必须通过环境变量或未跟踪的 `server/.env` 配置，不得写入仓库。

## 数据最小化

AI 请求上下文只允许包含：

- 学期、Release Version、当前页面、客户端时间、时区。
- 当前课表最小摘要：课程名、教师、教室、星期、节次、教学周、校区。

禁止包含学号、姓名、密码、Cookie、JSESSIONID、ticket、Authorization、token、原始 XLS 内容或文件 base64。

个人课表摘要默认关闭。小程序端只有在用户打开“允许分析本机课表摘要”后才发送最小课程字段；后端仍受 `AI_ALLOW_PERSONAL_CONTEXT` gate 保护，未开启时会把个人课表摘要替换为 `personal-redacted`。

## 敏感信息脱敏

后端 `safetyGuard` 提供：

- `redactSensitiveText(text)`
- `hasSensitiveCredential(text)`
- `sanitizeAgentContext(context)`
- `sanitizeToolResult(result)`
- `buildSafeLogPayload(payload)`

聊天中出现密码、学号、Cookie、Authorization、token、base64 等内容时，系统会拒绝处理凭证，并引导用户前往 XLS 导入页面。

## XLS-only 个人课表

AI 助手不保存密码，不要求用户输入密码。个人课表只支持 XLS 导入；学号密码同步、滑块验证和登录抓取接口已下线，旧接口返回 `410 XLS_ONLY` 并引导用户前往 XLS 导入页面。XLS 原始文件内容和 base64 不进入 AI Provider。

## 日志策略

AI 路由只记录脱敏后的 message preview、长度、工具名、状态、Provider 和 Release Version，不记录完整聊天原文、文件内容、密码、token 或 Cookie。

## 密钥管理

- 不提交 key。
- 不在日志打印 key。
- 不在 README、docs、测试脚本、Dockerfile、docker-compose.yml、package.json 或 GitHub Actions workflow 中写入 key。
- 通过环境变量或未跟踪的 `server/.env` 本地文件注入。
- 发现泄露立即轮换。

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

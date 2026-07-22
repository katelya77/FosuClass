# AI 模型服务配置说明

## 三种运行模式

- 本地/评审机 mock 演示模式：`AI_AGENT_ENABLED=false` 或 `AI_PROVIDER=mock`，不调用外部模型。
- 国产模型脱敏调用模式：`AI_PROVIDER=deepseek` 或 `AI_PROVIDER=coze`，只发送脱敏后的消息、工具结果和最小上下文。
- 境内部署生产模式：未来迁移到境内云、校内服务器或微信云托管并备案；是否满足数据不出境以服务器 region、模型服务 region 和实际链路为准。

Oracle ARM 可作为开发/运维服务器，但不等同于境内合规部署。

CloudBase 混元接入已经加入小程序端生成式路由，但它不是课程事实来源。`project_qa`、`conversational_help` 和普通自然对话优先尝试 CloudBase `hy3-preview`；今日课程、下一节课、教师课表、教室课表、空教室、教学周、XLS 导入、数据诊断等确定性问题仍走 Oracle `/api/ai/agent/chat` 和现有工具链。

## 环境变量

```bash
AI_AGENT_ENABLED=false
AI_PROVIDER=mock
AI_MODEL=deepseek-v4-flash
AI_REASONING_MODEL=deepseek-v4-pro
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=
AI_TIMEOUT_MS=15000
AI_MAX_TOKENS=1200
AI_TEMPERATURE=0.1
AI_THINKING_ENABLED=false
AI_REASONING_EFFORT=medium
AI_PROVIDER_JSON_REPAIR=true
DEEPSEEK_STRICT_JSON_MODE=false
AI_MAX_CONTEXT_COURSES=80
AI_LOG_PROMPTS=false
AI_ALLOW_PERSONAL_CONTEXT=false
AI_PROVIDER_CHAIN=deepseek,coze,mock
COZE_ENABLED=false
COZE_EXPIRES_AT=
COZE_PROVIDER_ROLE=temporary
COZE_API_BASE_URL=https://api.coze.cn
COZE_API_KEY=
COZE_API_MODE=bot
COZE_BOT_ID=
COZE_AGENT_ID=
COZE_CHAT_ENDPOINT=/v3/chat
COZE_WORKLOAD_ENDPOINT=
COZE_PROJECT_ID=
COZE_TIMEOUT_MS=15000
COZE_POLL_ENABLED=true
COZE_POLL_INTERVAL_MS=1000
COZE_POLL_MAX_ATTEMPTS=12
```

> Coze 仅接受官方 API Token。不要填写学校账户密码或浏览器 Cookie。
> Coze `user_id` 不是配置项，由服务端按已验证 Principal、运行模式和部署环境生成伪匿名 HMAC ID，不使用全员共用固定值，也不发送 OpenID 明文。
> 扣子编程部署项目使用 `COZE_API_MODE=workload`、部署页给出的 `COZE_WORKLOAD_ENDPOINT` 和 `COZE_PROJECT_ID`；同一 `COZE_API_KEY` 作为可轮换 Bearer Token。后台保存时加密且不回显明文。
> 详见 `docs/xiaofu-agent/coze-temporary-provider.md`。

## CloudBase Hunyuan

小程序端配置集中在 `miniprogram/config/cloudbase.js`：

```js
ENV_ID = "cloud1-d3g17rpe7566d3d5c"
CLOUDBASE_AI_ENABLED = true
CLOUDBASE_AI_MODEL = "hy3-preview"
CLOUDBASE_AI_PROMO_EXPIRES_AT = "2026-12-14T23:59:59+08:00"
AI_GENERATIVE_PUBLIC_ENABLED = false
AI_COMPETITION_MODE = true
AI_TOOL_ONLY_MODE = false
AI_MAX_HISTORY_MESSAGES = 6
AI_MAX_USER_MESSAGE_LENGTH = 1200
AI_MAX_DAILY_GENERATIVE_REQUESTS = 20
```

调用链为：

```text
CloudBase Hunyuan -> Oracle DeepSeek/Coze -> 内置项目知识摘要 -> mock
```

到期保护：

- 到期前 30 天、7 天，管理后台显示提醒。
- 到期后小程序不再盲目请求 `hy3-preview`。
- 只切换生成式 Provider，不影响课表静态读取和工具查询。

公开发布开关：

- 开发版、体验版、比赛演示：可开启 `AI_COMPETITION_MODE=true`。
- 正式公开版且主体资质未确认：保持 `AI_GENERATIVE_PUBLIC_ENABLED=false`，必要时开启 `AI_TOOL_ONLY_MODE=true`。
- 关闭混元只需设置 `CLOUDBASE_AI_ENABLED=false`，Oracle DeepSeek/Coze 和 mock 仍保留。

CloudBase 官方小程序 AI 接入要求基础库版本不低于 `3.15.1`，并使用 `wx.cloud.extend.AI.createModel("cloudbase")` 后在 `streamText` 的 `data.model` 中传入具体模型名。不要把 `hy3-preview` 写进 `createModel(...)`。

DeepSeek key 读取优先级：

1. `AI_API_KEY`
2. `DEEPSEEK_API_KEY`
3. `FOSUCLASS_DEEPSEEK_API_KEY`

## DeepSeek

`AI_PROVIDER=deepseek` 使用 Chat Completions 兼容接口。默认模型是 `deepseek-v4-flash`，面向小程序快速响应；复杂说明书或离线分析可用 `deepseek-v4-pro` 并开启 `AI_THINKING_ENABLED=true`。

`AI_PROVIDER_POLICY=auto` 时，确定性的课表查询、今日课程、空教室单结果、导入指引和数据诊断默认走本地工具和规则模板，避免模型改写事实。`project_qa` / `conversational_help` 这类项目知识问答、自然聊天、使用引导和复杂解释会调用 DeepSeek/Coze；如果 Provider 超时或不可用，会降级到内置项目知识摘要。

课程事实只能来自 `toolResults`，Provider 不允许凭空补课表、教室占用或个人安排。

`project_qa` / `conversational_help` 默认使用普通 text 模式，更适合项目说明、使用引导和话术解释，避免部分模型在 `response_format=json_object` 下返回 `provider_bad_request`。后端会把 text 结果包装成 `generic` 卡片；课程事实仍只来自工具结果，不允许模型补写。

工具卡片生成仍使用 JSON 模式，请求包含：

- `stream=false`
- `response_format={"type":"json_object"}`
- `max_tokens`
- `temperature`

JSON 模式的 system prompt 必须明确包含 `json` 字样，并包含一个短 JSON 示例，例如 `{"answer":"...","cards":[],"suggestions":[]}`。Provider 返回非 JSON 时会尝试修复 JSON 或提取 JSON code block，仍失败则抛出 `INVALID_PROVIDER_JSON`，由 `agentService` fallback 到 mock。

如果确实需要项目问答也强制 JSON，可设置：

```bash
DEEPSEEK_STRICT_JSON_MODE=true
```

不建议默认开启。`AI_THINKING_ENABLED=true` 只会在模型名包含 `pro` 时发送 thinking / reasoning 参数；flash 模型默认不带这些参数。

## Coze

`AI_PROVIDER=coze` 是可选适配器。后台只要求 PAT/API Token 与已发布 Bot ID；缺少任一项时抛出 `NOT_CONFIGURED`，主流程继续回退其他 Provider 或确定性回答。专用“测试连接”会区分 Token 无效、Bot 不存在、Bot 未发布、无权限、限流和超时，且只返回 Token 配置状态与 Bot ID 掩码。不同 Coze API 响应结构会尝试从 `answer/content/messages/data.messages/data.output` 中提取答案，必要时按 `chat_id` 轮询。

当前不提供仅凭 PAT 的 Bot 选择器：官方 Bot 列表接口还需要 Workspace/Space ID。后台保留 Bot ID 实时连接校验与获取引导，不伪造可用列表。

## 后台在线管理

后台管理台新增“AI 模型”面板，可在线设置 Provider、模型、超时、tokens、思考模式、个人课表摘要开关和 Coze 参数。面板只读写 `server/.env` 和当前进程环境变量，不参与小程序每次聊天请求，因此不会因后台多 provider 配置拖慢聊天调用。

密钥输入框留空时保留原密钥；页面和接口只显示“是否已配置”，不会回显 key。

后台验证会返回 `deterministicToolTest`、`projectQaProviderTest` 和 `forceProviderTest`，并展示 `desiredProvider`、`resolvedProvider`、`externalProviderUsed`、`providerPolicy`、`providerDecisionReason`，用于解释“为什么保存了 DeepSeek key，但简单课表查询仍显示本地规则”。

## 本机一键配置

```powershell
powershell -ExecutionPolicy Bypass -File tools/configure-ai-provider-local.ps1
```

脚本会复制或创建 `server/.env`，写入 DeepSeek 快速模式配置，从环境变量读取 key；如果环境变量不存在，会用安全输入提示，不在终端回显。

## 验证与回退

```bash
npm run verify:ai-provider
npm run test:deepseek-provider-config
npm run test:coze-provider-config
npm run test:ai-competition
```

回退 mock：

```bash
AI_AGENT_ENABLED=false
AI_PROVIDER=mock
```

## 密钥管理

- 不提交 key。
- 不在日志打印 key。
- 不把 key 写入 README、docs、测试脚本、Dockerfile、docker-compose.yml、package.json 或 GitHub Actions workflow。
- 只通过环境变量或未跟踪的 `server/.env` 本地文件注入。
- 发现泄露立即轮换。

## 故障降级

| 故障 | 降级结果 |
| --- | --- |
| `AI_AGENT_ENABLED=false` | 使用 mock provider |
| provider 未配置 | fallback mock |
| Provider 超时 | fallback mock |
| Provider 返回非 JSON | fallback mock |
| Coze 响应无法解析 | fallback mock |

# AI Provider 配置说明

## 三种运行模式

- 本地/评审机 mock 演示模式：`AI_AGENT_ENABLED=false` 或 `AI_PROVIDER=mock`，不调用外部模型。
- 国产模型脱敏调用模式：`AI_PROVIDER=deepseek` 或 `AI_PROVIDER=coze`，只发送脱敏后的消息、工具结果和最小上下文。
- 境内部署生产模式：未来迁移到境内云、校内服务器或微信云托管并备案；是否满足数据不出境以服务器 region、模型服务 region 和实际链路为准。

Oracle ARM 可作为开发/运维服务器，但不等同于境内合规部署。

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
AI_MAX_CONTEXT_COURSES=80
AI_LOG_PROMPTS=false
AI_ALLOW_PERSONAL_CONTEXT=false
COZE_API_BASE_URL=https://api.coze.cn
COZE_API_KEY=
COZE_BOT_ID=
COZE_USER_ID=fosuclass-user
COZE_CHAT_ENDPOINT=/v3/chat
COZE_POLL_ENABLED=true
COZE_POLL_INTERVAL_MS=1000
COZE_POLL_MAX_ATTEMPTS=8
```

DeepSeek key 读取优先级：

1. `AI_API_KEY`
2. `DEEPSEEK_API_KEY`
3. `FOSUCLASS_DEEPSEEK_API_KEY`

## DeepSeek

`AI_PROVIDER=deepseek` 使用 Chat Completions 兼容接口。默认模型是 `deepseek-v4-flash`，面向小程序快速响应；复杂说明书或离线分析可用 `deepseek-v4-pro` 并开启 `AI_THINKING_ENABLED=true`。

请求默认包含：

- `stream=false`
- `response_format={"type":"json_object"}`
- `max_tokens`
- `temperature`

Provider 返回非 JSON 时会尝试修复 JSON 或提取 JSON code block，仍失败则抛出 `INVALID_PROVIDER_JSON`，由 `agentService` fallback 到 mock。

## Coze

`AI_PROVIDER=coze` 是可选适配器。缺少 `COZE_API_KEY` 或 `COZE_BOT_ID` 时抛出 `NOT_CONFIGURED`，主流程 fallback mock。不同 Coze API 响应结构会尝试从 `answer/content/messages/data.messages/data.output` 中提取答案，必要时按 `chat_id` 轮询。

## 后台在线管理

后台管理台新增“AI 模型”面板，可在线设置 Provider、模型、超时、tokens、思考模式、个人课表摘要开关和 Coze 参数。面板只读写 `server/.env` 和当前进程环境变量，不参与小程序每次聊天请求，因此不会因后台多 provider 配置拖慢聊天调用。

密钥输入框留空时保留原密钥；页面和接口只显示“是否已配置”，不会回显 key。

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

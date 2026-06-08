# AI Provider 配置说明

## 环境变量

```bash
AI_AGENT_ENABLED=false
AI_PROVIDER=mock
AI_MODEL=deepseek-v4-flash
AI_REASONING_MODEL=deepseek-v4-pro
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=
AI_TIMEOUT_MS=15000
AI_MAX_CONTEXT_COURSES=80
AI_LOG_PROMPTS=false
AI_ALLOW_PERSONAL_CONTEXT=false
COZE_API_BASE_URL=
COZE_API_KEY=
COZE_BOT_ID=
```

## mock

`AI_PROVIDER=mock` 是默认模式，不调用外部模型。它基于规则和工具结果生成回答与卡片，适合比赛现场无 key、网络不稳定或只做安全演示时使用。

## deepseek

`AI_PROVIDER=deepseek` 使用 OpenAI Chat Completions 兼容接口。必须配置：

- `AI_AGENT_ENABLED=true`
- `AI_PROVIDER=deepseek`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`

注意：参赛演示版本应使用境内可访问、合规的 Provider 地址。不得把 API Key 写进仓库。

## coze

`AI_PROVIDER=coze` 保留对接接口。当前适配器在未配置或未完成部署接入时会返回明确错误，并由 `agentService` 自动 fallback 到 mock。

## 安全注意事项

- Provider 只接收脱敏后的消息、上下文和工具结果。
- AI 不作为课程事实来源；事实必须来自 Release Pack、空教室索引、本地缓存或确定性算法。
- `AI_LOG_PROMPTS` 默认关闭，不记录完整 prompt。
- 模型超时、未配置或返回非 JSON 时自动 fallback mock。

## 故障降级

常见故障与处理：

| 故障 | 降级结果 |
| --- | --- |
| `AI_AGENT_ENABLED=false` | 使用 mock provider |
| `AI_API_KEY` 为空 | fallback mock |
| Provider 超时 | fallback mock |
| Provider 返回非 JSON | fallback mock |
| Coze 未完成接入 | fallback mock |

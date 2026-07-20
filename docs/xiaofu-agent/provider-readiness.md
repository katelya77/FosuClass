# Provider / Agent Readiness

## 客户端

`GET /api/ai/agent/readiness` 返回裁剪字段：

- network / server
- runtimeMode
- enhancedMode: disabled | ready | degraded
- authorization
- providerConfigured / providerReachable
- memoryAvailable
- runEventsSupported
- reasonCode
- checkedAt

禁止返回：API Key、Key 后四位、Base URL、OpenID、白名单、内部堆栈。

## 管理员

- `GET /api/admin/ai-provider/readiness-matrix`
- `POST /api/admin/ai-provider/diagnose-enhanced`

诊断步骤：读配置 → 读 process.env → 读活动 Profile → 检查授权 → 最小测试请求 → 返回 Provider/延迟/原因。

## reasonCode 示例

- `SERVER_RUNTIME_PUBLIC`
- `AGENT_DISABLED`
- `PROVIDER_MOCK`
- `PROVIDER_KEY_MISSING`
- `PROVIDER_MODEL_MISSING`
- `TRIAL_ENV_NOT_ALLOWED`
- `ENHANCED_SESSION_NOT_AUTHORIZED`
- `PROVIDER_UNAUTHORIZED` / `FORBIDDEN` / `RATE_LIMITED` / `TIMEOUT` / `EXPIRED`
- `PROVIDER_HEALTHY`

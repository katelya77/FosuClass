# GitHub Actions 环境契约

本文档描述 `.github/workflows/deploy-vps.yml` 在部署 VPS 时读取的 GitHub Secrets 和 Repository Variables。不要把 Secret 值写入仓库、Variables、日志或文档。

## 必需 Secrets

| 名称 | 默认值 | 作用 | 缺失时行为 |
| --- | --- | --- | --- |
| `VPS_HOST` | 无 | SSH/SCP 目标主机 | 部署前置检查失败，只输出变量名 |
| `VPS_USER` | 无 | SSH/SCP 登录用户 | 部署前置检查失败，只输出变量名 |
| `VPS_SSH_KEY` | 无 | SSH 私钥 | 部署前置检查失败，只输出变量名 |
| `VPS_APP_DIR` | 无 | 远端应用目录 | 部署前置检查失败，只输出变量名 |
| `ADMIN_PASSWORD` | 无 | Web 后台登录密码，也用于派生默认 `ADMIN_API_TOKEN` | 部署前置检查失败，只输出变量名 |

## 条件必需 Secrets

| 名称 | 默认值 | 作用 | 缺失时行为 |
| --- | --- | --- | --- |
| `WECHAT_APPID` | 空 | 微信 session bootstrap 的 AppID | `FOSU_SECURITY_MODE` 非 `observe` 时部署前置检查失败 |
| `WECHAT_APPSECRET` | 空 | 微信 session bootstrap 的 AppSecret | `FOSU_SECURITY_MODE` 非 `observe` 时部署前置检查失败 |
| `FOSU_SESSION_SECRET_CURRENT` | 空 | 动态 API session token 当前签名密钥 | `FOSU_SECURITY_MODE` 非 `observe` 时部署前置检查失败 |
| `FOSU_STATIC_TICKET_SECRET_CURRENT` | 空 | 静态资源 ticket 当前签名密钥 | `FOSU_SECURITY_MODE=ticket` 或 `ticket-enforce` 时部署前置检查失败 |

## 可选 Secrets

| 名称 | 默认值 | 作用 | 缺失时行为 |
| --- | --- | --- | --- |
| `ADMIN_API_TOKEN` | 由 `ADMIN_PASSWORD` 派生 | 本地同步工具和后台写接口 token | 允许为空，部署给出 warning，服务端自动派生 |
| `ADMIN_TOKEN` | 空 | 后台静态 Bearer token 或登录凭据 | 允许为空，后台登录依赖 `ADMIN_PASSWORD` |
| `FOSU_SESSION_SECRET_PREVIOUS` | 空 | session token 密钥轮换旧 key | 允许为空，状态页显示未配置 previous key |
| `FOSU_SESSION_SECRET_KID` | `current` | session token key id | 允许为空，服务端使用 `current` |
| `FOSU_CSRF_SECRET` | 由后台凭据派生 | 后台 Cookie session/CSRF 签名 | 允许为空，服务端从后台凭据派生 |
| `FOSU_STATIC_TICKET_SECRET_PREVIOUS` | 空 | 静态 ticket 密钥轮换旧 key | 允许为空，状态页显示未配置 previous key |
| `FOSU_STATIC_TICKET_SECRET_KID` | `current` | 静态 ticket key id | 允许为空，服务端使用 `current` |
| `AI_API_KEY` | 空 | DeepSeek/OpenAI 兼容 provider key | 允许为空，AI 状态显示 key 未配置，调用外部 provider 时 fallback |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek provider 专用 key，优先级低于 `AI_API_KEY` | 允许为空，AI 状态显示 DeepSeek key 未配置 |
| `COZE_API_KEY` | 空 | Coze provider key | 允许为空，AI 状态显示 Coze key 未配置 |

## Deprecated

| 名称 | 替代项 | 作用 | 当前部署行为 |
| --- | --- | --- | --- |
| `FOSU_STATIC_TICKET_SECRET` | `FOSU_STATIC_TICKET_SECRET_CURRENT` | 旧版静态 ticket 兼容密钥名 | GitHub Actions 不再写入生产 `.env`；代码仍保留运行时兼容读取 |

## Repository Variables

| 名称 | 默认值 | 作用 | 缺失时行为 |
| --- | --- | --- | --- |
| `FOSU_SECURITY_MODE` | `observe` | 动态 API session 安全模式 | 使用 observe，不要求微信凭据和 session secret |
| `FOSU_DYNAMIC_API_SESSION_REQUIRED` | `false` | 是否强制动态 API session | 使用 false |
| `FOSU_SESSION_TTL_SECONDS` | `7200` | session token TTL | 使用默认值 |
| `FOSU_STATIC_ACCESS_MODE` | `public` | 静态资源访问模式 | 使用 public |
| `FOSU_OPENRESTY_STATIC_SECURITY_MODE` | `public` | OpenResty 静态安全模式 | 使用 public |
| `FOSU_STATIC_TICKET_TTL_SECONDS` | `600` | 静态 ticket TTL | 使用默认值 |
| `AI_AGENT_ENABLED` | `false` | 是否启用外部 AI provider | 使用本地规则/mock，不调用外部模型 |
| `AI_PROVIDER` | `mock` | provider 名称：`mock`、`deepseek`、`coze` | 使用 mock |
| `AI_PROVIDER_POLICY` | `auto` | 外部 provider 调用策略 | 使用 auto |
| `AI_MODEL` | `deepseek-v4-flash` | 默认模型 | 使用默认值 |
| `AI_REASONING_MODEL` | `deepseek-v4-pro` | 推理模型 | 使用默认值 |
| `AI_BASE_URL` | `https://api.deepseek.com` | DeepSeek/OpenAI 兼容接口地址 | 使用默认值 |
| `AI_TIMEOUT_MS` | `15000` | provider 请求超时 | 使用默认值 |
| `AI_MAX_TOKENS` | `1200` | provider 最大输出 token | 使用默认值 |
| `AI_TEMPERATURE` | `0.1` | provider temperature | 使用默认值 |
| `AI_THINKING_ENABLED` | `false` | 是否对 reasoning model 发送 thinking/reasoning 参数 | 使用默认值 |
| `AI_REASONING_EFFORT` | `medium` | reasoning effort | 使用默认值 |
| `AI_PROVIDER_JSON_REPAIR` | `true` | provider 文本 JSON 修复 | 使用默认值 |
| `DEEPSEEK_STRICT_JSON_MODE` | `false` | DeepSeek 严格 JSON mode | 使用默认值 |
| `AI_ALLOW_PERSONAL_CONTEXT` | `false` | 后端是否允许使用脱敏个人课表摘要 | 使用默认值，不使用个人摘要 |
| `COZE_API_BASE_URL` | `https://api.coze.cn` | Coze API 地址 | 使用默认值 |
| `COZE_BOT_ID` | 空 | Coze bot id | Coze 状态显示未配置，调用时 fallback |
| `COZE_USER_ID` | `fosuclass-user` | Coze user id | 使用默认值 |
| `COZE_CHAT_ENDPOINT` | `/v3/chat` | Coze chat endpoint | 使用默认值 |

## 固定部署默认值

这些值由 workflow 固定写入远端 `.env`，不是 GitHub Secret 或 Variable：`NODE_ENV=production`、`PORT=3000`、`HOST_BIND_IP=127.0.0.1`、`HOST_API_PORT=18318`、`PUBLIC_API_ORIGIN=https://class.katelya.eu.org`、`FOSU_API_BASE_URL=https://class.katelya.eu.org`、`FOSU_STATIC_RELEASE_BASE_URL=/static/releases`、OpenResty 静态同步路径、release worker、维护任务和磁盘水位参数。

## 缺失值诊断

部署前置检查只对必需和条件必需 Secret 失败，并且只打印缺失变量名。可选 Secret 缺失不会阻断部署；远端 `node scripts/verify-ai-provider.js --mode=status` 会输出 provider、policy、model、baseUrl 以及 key 是否配置的布尔状态，不输出任何 Secret 值。

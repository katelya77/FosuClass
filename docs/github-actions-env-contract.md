# GitHub Actions 环境契约

本文档描述 `.github/workflows/deploy-vps.yml` 在部署 VPS 时读取的 GitHub Secrets 和仓库变量。不要把 Secret 值写入仓库、变量、日志或文档。

## 必需 Secrets

| 名称 | 默认值 | 作用 | 缺失时行为 |
| --- | --- | --- | --- |
| `VPS_HOST` | 无 | SSH/SCP 目标主机 | 部署前置检查失败，只输出变量名 |
| `VPS_USER` | 无 | SSH/SCP 登录用户 | 部署前置检查失败，只输出变量名 |
| `VPS_SSH_KEY` | 无 | SSH 私钥 | 部署前置检查失败，只输出变量名 |
| `VPS_APP_DIR` | 无 | 远端应用目录 | 部署前置检查失败，只输出变量名 |
| `ADMIN_API_TOKEN` | none | Required production publisher sync token shared by local Publisher and VPS admin API | Deploy preflight fails and only prints the secret name |
| `ADMIN_PASSWORD` | 无 | Web 后台登录密码；旧版派生 `ADMIN_API_TOKEN` 仅保留运行时兼容，不用于生产部署门禁 | 部署前置检查失败，只输出变量名 |

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
| `ADMIN_TOKEN` | 空 | 后台静态 Bearer token 或登录凭据 | 允许为空，后台登录依赖 `ADMIN_PASSWORD` |
| `FOSU_SESSION_SECRET_PREVIOUS` | 空 | session token 密钥轮换旧 key | 允许为空，状态页显示未配置 previous key |
| `FOSU_SESSION_SECRET_KID` | `current` | session token key id | 允许为空，服务端使用 `current` |
| `FOSU_CSRF_SECRET` | 由后台凭据派生 | 后台 Cookie session/CSRF 签名 | 允许为空，服务端从后台凭据派生 |
| `FOSU_STATIC_TICKET_SECRET_PREVIOUS` | 空 | 静态 ticket 密钥轮换旧 key | 允许为空，状态页显示未配置 previous key |
| `FOSU_STATIC_TICKET_SECRET_KID` | `current` | 静态 ticket key id | 允许为空，服务端使用 `current` |
| `AI_API_KEY` | 空 | DeepSeek/OpenAI 兼容 provider key | 允许为空，AI 状态显示 key 未配置，调用外部 provider 时 fallback |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek provider 专用 key，优先级低于 `AI_API_KEY` | 允许为空，AI 状态显示 DeepSeek key 未配置 |
| `CLOUDBASE_OPENAI_API_KEY` | 空 | CloudBase OpenAI-compatible provider key | 允许为空，AI 状态显示 CloudBase OpenAI key 未配置 |
| `COZE_API_KEY` | 空 | Coze provider key | 允许为空，AI 状态显示 Coze key 未配置 |
| `FOSU_IMPORT_CLOUDBASE_RELAY_TOKEN` | 空 | 学号导入 CloudBase relay 的可选 Bearer token | 允许为空；仅当 relay 服务要求 token 时配置 |

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
| `FOSU_IMPORT_ENABLE` | `true` | 是否启用本人授权学号导入预览 API | 使用 true |
| `FOSU_IMPORT_CHANNEL` | `auto` | 导入通道策略：`auto`、`cloudbase`、`oracle` | 生产使用 auto，优先 CloudBase |
| `FOSU_CLOUDBASE_IMPORT_ENABLE` | `true` | 是否启用 CloudBase relay 导入通道 | 生产使用 true |
| `FOSU_CLOUDBASE_IMPORT_URL` | 空 | CloudBase relay HTTPS 地址 | 生产必须配置 relay URL |
| `FOSU_IMPORT_CHANNEL_TIMEOUT_MS` | `25000` | 单个导入通道请求超时 | 使用默认值 |
| `FOSU_IMPORT_ORACLE_FALLBACK` | `true` | CloudBase 可重试故障时是否回落 Oracle 通道 | 生产开启 Oracle fallback |
| `AI_AGENT_ENABLED` | `false` | 是否启用外部 AI provider | 使用本地规则/mock，不调用外部模型 |
| `AI_PROVIDER` | `mock` | provider 名称：`mock`、`deepseek`、`coze`、`cloudbase-openai` | 使用 mock |
| `AI_PROVIDER_POLICY` | `auto` | 外部 provider 调用策略 | 使用 auto |
| `AI_PROVIDER_CHAIN` | 空 | Provider 回退链，如 `deepseek,coze,mock`；public 强制 mock | 使用代码默认链 |
| `AI_RUNTIME_MODE` | `public` | 运行模式：`public` / `trial` / `dev`（兼容 `competition`） | 使用 public，正式版 fail-closed |
| `AI_PROVIDER_ACTIVE_ENV` | `public` | 后台默认查看/编辑的环境：`public`、`trial`、`dev` | 使用 public |
| `COZE_ENABLED` | `false` | 是否启用临时 Coze Provider | 默认关闭 |
| `COZE_EXPIRES_AT` | 空 | Coze 临时到期时间（ISO）；到期自动跳过 | 允许为空 |
| `COZE_BOT_ID` | 空 | Coze Bot/Agent ID | 允许为空 |
| `COZE_PROVIDER_ROLE` | `temporary` | Coze 角色标记，默认 temporary | 使用 temporary |
| `AI_COMPETITION_ALLOW_TRIAL_ENV` | `true` | 微信体验版/开发版/devtools 是否允许进入增强模式 | 使用 true；release 仍强制 public |
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
| `CLOUDBASE_OPENAI_ENABLED` | `false` | CloudBase OpenAI-compatible provider enabled flag | 使用默认值 |
| `CLOUDBASE_OPENAI_BASE_URL` | `https://cloud1-d3g17rpe7566d3d5c.api.tcloudbasegateway.com/v1/ai/cloudbase` | CloudBase OpenAI-compatible base URL | 使用默认值 |
| `CLOUDBASE_OPENAI_TEXT_MODEL` | `hy3-preview` | CloudBase text model | 使用默认值 |
| `CLOUDBASE_OPENAI_TIMEOUT_MS` | `15000` | CloudBase provider timeout | 使用默认值 |
| `CLOUDBASE_OPENAI_MAX_TOKENS` | `1200` | CloudBase provider max output tokens | 使用默认值 |
| `COZE_API_BASE_URL` | `https://api.coze.cn` | Coze API 地址 | 使用默认值 |
| `COZE_BOT_ID` | 空 | Coze bot id | Coze 状态显示未配置，调用时 fallback |
| `COZE_USER_ID` | `fosuclass-user` | Coze user id | 使用默认值 |
| `COZE_CHAT_ENDPOINT` | `/v3/chat` | Coze chat endpoint | 使用默认值 |

## 固定部署默认值

这些值由 workflow 固定写入远端 `.env`，不是 GitHub Secret 或仓库变量：`NODE_ENV=production`、`PORT=3000`、`HOST_BIND_IP=127.0.0.1`、`HOST_API_PORT=18318`、`PUBLIC_API_ORIGIN=https://class.katelya.eu.org`、`FOSU_API_BASE_URL=https://class.katelya.eu.org`、`FOSU_STATIC_RELEASE_BASE_URL=/static/releases`、OpenResty 静态同步路径、release worker、维护任务和磁盘水位参数。

## 缺失值诊断

部署前置检查只对必需和条件必需 Secret 失败，并且只打印缺失变量名。可选 Secret 缺失不会阻断部署；远端 `node scripts/verify-ai-provider.js --mode=status` 会输出 provider、policy、model、baseUrl 以及 key 是否配置的布尔状态，不输出任何 Secret 值。

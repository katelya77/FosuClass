# 小佛助手外部运行配置清单

这些项目位于微信公众平台、Cloudflare、DNS、1Panel/OpenResty、GitHub 或 Provider 控制台，仓库代码不能替用户修改。每项必须留下截图、时间或 Probe 记录；“已填写”不等于“已验证”。

## 微信公众平台

- request 合法域名：`https://class.katelya.eu.org`。
- downloadFile 合法域名：`https://class.katelya.eu.org`（Release Pack/静态索引）。
- 域名必须使用 HTTPS、不能带路径、不能使用 IP、不能依赖跳转。
- 建议配置 DNS 预解析和预连接主机 `class.katelya.eu.org`。
- 分别用体验版 iOS 5G/Wi-Fi 执行 health、readiness、Session、Run create/poll、Memory；DevTools 的“不校验合法域名”不能作为通过证据。

## DNS

2026-08-02 观测到 Cloudflare 代理地址：A `104.21.76.75`、`172.67.191.25`；AAAA `2606:4700:3033::ac43:bf19`、`2606:4700:3034::6815:4c4`。这是观测值，不应写死进配置。

- 确认没有另一个同名 A/AAAA/CNAME 指向旧源站。
- Cloudflare 开启代理时 AAAA 是边缘地址，不能仅因本地没有 IPv6 就删除；用 iOS 5G 实测 IPv6/Happy Eyeballs 路径。
- 修改后从国内移动网络、Wi-Fi 和权威 DNS 分别解析，记录 TTL 和结果。

## TLS 与 Cloudflare

2026-08-02 观测到 TLS 1.3，证书主题 `CN=katelya.eu.org`，签发者 Google Trust Services WE1，有效期为 2026-06-09 至 2026-09-07。仍需持续监控自动续期和完整证书链。

- Cloudflare SSL/TLS 模式使用 Full (strict)，源站证书名称和有效期匹配。
- 不开启会让 API 循环跳转的 Always Use HTTPS/Origin 规则组合。
- `/api/*` 绕过缓存，尤其是 Session、readiness、Run create/poll 和 Memory。
- WAF/限流允许合法的 POST `/api/ai/agent/runs`、GET poll 和正常 JSON body；按 requestId 核对拦截日志。
- 不把浏览器 CORS 当作 `wx.request` 的唯一依据。

## 1Panel / OpenResty

- 公网 `https://class.katelya.eu.org/api/` 反代到宿主机 `http://127.0.0.1:18318/api/`；容器内服务端口为 3000。
- 保留 Host、真实客户端地址和 request ID；不要丢弃 `X-Fosu-Env-Version`、`X-Fosu-Session`、`X-Fosu-Run-Poll-Token`、`Authorization`、`Cookie`、Content-Type 和幂等键。
- POST body 大小与超时应容纳 Run create；poll/read timeout 至少覆盖服务端约定，不由 OpenResty提前返回 499/504。
- 路径重写必须保持 `/api/ai/agent/*`，禁止意外改成静态站点或缓存响应。
- 从源站执行 `curl http://127.0.0.1:18318/api/health`，再从公网执行同一路径；用相同 requestId 对齐 OpenResty、Cloudflare 与 Express 日志。

## GitHub Actions Variables / Secrets

不得在 PR、日志或诊断报告中输出值。部署前检查名称存在、轮换状态和环境绑定。

核心 Secrets：`VPS_HOST`、`VPS_USER`、`VPS_SSH_KEY`、`VPS_APP_DIR`、`ADMIN_API_TOKEN`、`ADMIN_PASSWORD`、`ADMIN_TOKEN`、`FOSU_AI_CONFIG_ENCRYPTION_KEY`、`FOSU_AGENT_MEMORY_SECRET`、`FOSU_AGENT_REMINDER_SECRET`、`WECHAT_APPID`、`WECHAT_APPSECRET`、`FOSU_SESSION_SECRET_CURRENT`、`FOSU_CSRF_SECRET`。按启用能力再配置 `AI_API_KEY`/`DEEPSEEK_API_KEY`、`CLOUDBASE_OPENAI_API_KEY` 或 `COZE_API_KEY`，以及静态票据、导入中继和提醒相关密钥。

核心 Variables：`AI_AGENT_ENABLED`、`AI_PROVIDER`、`AI_PROVIDER_POLICY`、`AI_RUNTIME_MODE`、`AI_PROVIDER_ACTIVE_ENV`、`AI_COMPETITION_ALLOW_TRIAL_ENV`、模型/URL/超时参数、`FOSU_SECURITY_MODE`、`FOSU_DYNAMIC_API_SESSION_REQUIRED`。部署产物必须记录 SHA 和 public/trial/dev 的实际 configVersion，不能只记录变量文本。

## Provider 真实验证

- 在“助手运行中心”选择 trial/dev 后执行真实 Probe；public 必须跳过且外部调用为 0。
- Probe 记录 provider、environment、configVersion、HTTP 类别、耗时、lastProbeAt、lastSuccessAt 和 circuit state，不记录 API Key 或完整响应正文。
- 401 对应凭据/权限，429 对应限流，timeout 对应上游时延；不得统一写服务器断网。
- 只有最新真实 Probe 成功才能把 verified/reachable 显示为真；配置存在只代表 configured。

## 发布后 15 分钟观察

记录部署 SHA/configVersion，每分钟或持续观察 health、readiness、Run create/poll、Memory、Release Pack、5xx/429/timeout 和队列状态。若持续错误或环境/configVersion 错位，立即恢复部署前 SHA，并通过不可变配置历史回滚对应环境指针。

# 小佛助手真机可靠性根因报告

日期：2026-08-02

基线：`4f06c697f71f5ffb38a4ce7eed4ca8227d803bde`

修复分支：`codex/xiaofu-agent-reliability-and-product-convergence`

## 结论

真机“所有消息都提示服务器不可用”不是单一的 DNS 或 VPS 宕机。代码审计和基线复现确认了四个会叠加的主故障：

1. readiness 显式携带 `envVersion=trial`，Run create 没有统一携带环境信号，导致 readiness 可显示 trial，而实际 Run 在请求组装阶段回落到 public。
2. 小程序请求封装只把 HTTP 200 当成功；服务端创建 Run 按协议返回 HTTP 202，客户端因此把已创建的 Run 当作网络失败并重试。
3. readiness 把“Provider 已配置”推导成“Provider 可达/健康”，即使没有真实 Probe 也会显示绿色状态。
4. 网络错误没有进入已有的确定性本地工具路径，页面却仍显示“本地可用”，形成状态与行为相反的产品承诺。

记忆中的 `preferredName=什么` 是另一条独立的数据正确性故障：候选来源很多，但最终持久化边界没有统一语义校验，疑问句或 Provider 结构化候选可以污染长期记忆。

## 证据链

### 线上入口当前可达

2026-08-02 从开发机实测：

- `https://class.katelya.eu.org/api/health` 返回 HTTP 200；
- DNS 返回 Cloudflare A 和 AAAA 记录；
- TLS 协商为 TLS 1.3，证书主题 `CN=katelya.eu.org`，证书在观测时有效；
- 用户使用普通浏览器能直接打开 trial readiness JSON。

因此，Codex 内置 Chrome 出现的 `ERR_BLOCKED_BY_CLIENT` 是该插件/内置浏览上下文的客户端拦截，不能作为 VPS、DNS、TLS 或微信合法域名故障证据。后续验收以普通浏览器、命令行接口、微信 DevTools 和真实 iPhone 为准。

### 线上 readiness 仍存在事实矛盾

用户在 2026-08-02 提供的已部署响应同时包含：

- `runtimeMode=trial`
- `providerConfigured=true`
- `providerVerified=false`
- `providerReachable=true`
- `reasonCode=PROVIDER_HEALTHY`
- `memoryAvailable=false`

未发生成功 Probe 时不能证明 Provider 当前可达。旧响应只能证明 trial readiness 路由可达和配置存在，不能证明 Run、Provider 或 Memory 可用。

### 环境错位

基线调用关系为：

```text
readiness client --envVersion--> readiness route --trial snapshot
run client --------(missing)----> run route --------public/default
                                          |
                                          +--> request assembler 再次解析环境
```

路由层即使曾解析出 trial，平台输入没有完整保留环境上下文时，后续组装仍可能重新解析成 public。基线 Smoke Test 已复现“readiness=trial、Run=public”。

### HTTP 202 被误判

`POST /api/ai/agent/runs` 的正常响应是 202 Accepted，表示 Run 已进入执行流程。基线 `miniprogram/utils/request.js` 只接受 200，因此走入失败映射、Toast 和重试；重试又可能创建重复请求。修复后所有 2xx 都按协议成功，Run create 默认以 `requestId` 作为幂等键。

### 错误被过度归类

基线把大量 `wx.request:fail`、HTTP、Session、Run poll、Provider、Tool 和 Memory 错误收敛为 `SERVER_UNREACHABLE`。这既误导用户，也让后台无法定位。微信只返回通用 `request:fail` 时，不能猜测为 DNS 或 TLS；修复后显示“微信网络层请求失败”并保留脱敏 `errMsg`。

## 修复

- `getMiniProgramEnvVersion()` 成为小程序环境的唯一来源。
- 可信 API 请求层自动注入 `X-Fosu-Env-Version`；不向第三方绝对 URL 泄漏该头。
- readiness、Run create/poll、兼容 chat、Memory、Session、Reminder、Voice 和 CloudBase gateway 共用同一来源。
- 服务端把已授权的 runtime context 贯穿 Route、Platform、Planner、Kernel、Run Trace；环境信号不替代 Session 或 capability authorization。
- readiness 的 configured、configuredAvailable、verified、reachable、lastProbeAt、lastSuccessAt 和 circuit state 独立表达。
- 新增体验/开发版连接诊断，逐层记录 requestId/runId、耗时、HTTP 状态、failureLayer 和解决建议。
- 网络失败只允许进入确定性 Local Tool Fallback；本机结果不伪装成服务端 Run。
- `MemoryController.commit` 和最终 User Memory 写入边界统一经过 `memorySemanticValidator`，并对明显无效旧数据做幂等失效迁移和审计。
- Run 监控改读持久化 Run/Event/Trace Store，进程重启后仍可查询。

## 未经验证的外部环节

仓库测试不能证明以下项目已经通过：微信公众平台合法域名配置、Cloudflare 控制台规则、1Panel/OpenResty 当前生效配置、iOS 5G/IPv6 路径、真实 Provider 凭据、体验版上传及真机执行。它们必须按《真机诊断与验收》和《外部运行配置清单》逐项验证，未验证前不得写“真机通过”或“Provider 健康”。

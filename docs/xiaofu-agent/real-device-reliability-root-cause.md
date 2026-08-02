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

### 合并后生产验证发现的回复阶段预算竞争

PR #44 合并并部署到 `main@b3949ab23b7a78d39c20da0cf14a0eda68228ad6` 后，生产 HTTP Run 进一步暴露了一个独立故障。`public` 的“你好”能够完成，但 `trial` 的同一输入稳定出现：

```text
provider.started (understanding)
→ understanding.fallback
→ provider.started (response)
→ STAGE_TIMEOUT
→ run.failed
```

根因是 Agent Runtime 为简单回复阶段分配 800ms 外层预算，`providerOrchestrator` 又把完整预算交给 Provider，且没有为确定性 fallback 保留完成时间。父阶段定时器先创建；当两个计时器同时到期时，父阶段先把请求标记为 `ABORTED/STAGE_TIMEOUT`，已有的 Provider timeout fallback 尚未来得及返回，整个 Run 就进入失败终态。

热修复为响应 Provider 分配严格小于外层回复阶段的 lease，并预留有上限的完成时间。它不改变 `strict_model_first`，不放宽 Session/capability authorization，也不吞掉配置、鉴权或用户取消错误；只让 timeout/network/429/5xx 等既有 fallback-eligible 失败有时间返回真实的确定性结果。

该响应阶段热修复部署为 `main@5819e949a63744ad8602e953bcf62d1c3fd2cc15` 后，trial “你好”不再到达 response，而是在更早的 Decision Provider 阶段出现同构的父/子预算竞争：`provider.started → stage.failed → run.failed`。这证明问题不是某个 composer catch，而是 Decision 与 Response 两个 Provider 子阶段没有共同遵守“子链必须早于父阶段结束”的不变量。最终修复把 attempt-count 与 lease 计算下沉到既有 `provider-runtime/deadline`，由两个阶段共同使用。

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
- 回复 Provider 的执行预算小于外层 response stage，Provider timeout 先进入统一分类器，确定性 fallback 可以在外层硬截止前完成。
- Decision 与 Response 共用 Provider stage lease；主/备用链共享父阶段可用窗口并保留收尾时间。

## 未经验证的外部环节

仓库测试不能证明以下项目已经通过：微信公众平台合法域名配置、Cloudflare 控制台规则、1Panel/OpenResty 当前生效配置、iOS 5G/IPv6 路径、真实 Provider 凭据、体验版上传及真机执行。它们必须按《真机诊断与验收》和《外部运行配置清单》逐项验证，未验证前不得写“真机通过”或“Provider 健康”。

## 2026-08-02 增强理解与后台实时性复查

本轮从 `origin/main@9d093596846b734c6185cebfb06e2ba646ccbad9` 重新复现了用户截图中的三个独立问题：

1. `goalParser` 已能把“帮我查看一下二五级动物科学三班的课表”识别为班级课表目标，但 `classAliasResolver` 只接受阿拉伯数字，实体原样进入索引后查无结果。修复把中文数字转换限定在班级实体的“开头年级”和“末尾班号”，再由真实班级索引唯一匹配；不会全局改写专业名，多个候选仍必须澄清。
2. trial Decision 默认把 Coze workload 当作严格 JSON Provider，同时旧 Decision 外层预算只有 3.5 秒并在主备之间均分。普通 Coze 工作流并不保证 DecisionContract；本机真实结构化 Probe 在 12 秒边界超时。修复后 workload 默认只进入 Response，Decision 选择已配置且支持严格结构化输出的 Provider，并获得 6.5 秒有界阶段预算；总 Run 截止仍不超过 15 秒，public 外部调用仍为 0。
3. 新 `packages/provider-runtime` 发出了真实 Provider 事件，但 readiness 与“查询服务”仍读取旧 `providerChainService` 的进程内数组，因此真实调用发生后后台仍可能显示“未验证”且日志为空。修复增加单向脱敏观察桥，Provider 成功/失败会更新状态投影；调用日志从 durable Run/Event Store 查询，非 Run Probe 才使用内存补充。

真实 Probe 还确认了一个仓库代码无法代替外部配置修复的事实：当前开发机 trial 配置中的 DeepSeek 结构化调用返回 HTTP 401（映射为 `PROVIDER_UNAUTHORIZED`），而 Coze workload 结构化调用在 12 秒内未完成。二者都不能记为“Provider 已验证”。部署前必须更新有效凭据或配置一个真实返回严格 DecisionContract 的 Provider，然后重新 Probe；不得用 mock 或 `configured=true` 冒充通过。

助手运行中心的“返回后台”故障来自嵌入 iframe 内把自身导航到 `/admin/dashboard`，该页面的 frame policy 正确拒绝了嵌入，最终显示“拒绝连接”。页内链接现已移除；首屏只加载概览和近期 Run，高级配置惰性加载，运行事实按页面可见性自动刷新。

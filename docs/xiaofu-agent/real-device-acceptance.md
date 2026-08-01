# 小佛助手真机诊断与验收

## 验收原则

自动化、DevTools 和浏览器不能替代真实 iPhone。没有在设备上实际执行的项目必须标为“未验证”，不得用 readiness 200 或 mock Provider 宣称真机通过。

## 体验版准备

1. 记录待测 Git SHA、体验版版本号、构建时间和 public/trial/dev configVersion。
2. 运行 `npm run test:agent-release-gate`、secret scan、`git diff --check`、Docker smoke 和备份门禁。
3. 在微信公众平台确认 request/downloadFile 合法域名。
4. 上传体验版，不提交正式审核。
5. 确认小程序右上角菜单能打开“连接诊断”；正式版必须看不到敏感诊断入口。

## 连接诊断

在 iOS 5G 和 Wi-Fi 各运行一次完整诊断，并复制脱敏报告。逐项确认：

| 步骤 | 通过标准 |
| --- | --- |
| 网络类型 | 展示微信报告的网络类型，不自行推测 DNS/TLS |
| API 主机 | 仅展示 `class.katelya.eu.org` 等脱敏主机信息 |
| `/api/health` | HTTP 2xx、elapsedMs 和 requestId 可见 |
| readiness | runtimeMode、configVersion 与当前体验环境一致 |
| Session | 获取成功且有效；失败明确区分 required/invalid |
| Run create | HTTP 202 被视为成功，并产生唯一 runId |
| Run poll | 到达唯一终态，requestId/runId 可在后台查到 |
| Memory snapshot | local_only 不要求云端；cloud_sync 必须真实读到服务端状态 |
| Provider | configured/verified/reachable/Probe/成功时间/熔断状态分开 |
| 最近失败 | failureLayer、reasonCode、状态、耗时、ID 和处理建议齐全 |

若微信只提供 `request:fail ...`，报告应写“微信网络层请求失败”并保留脱敏 errMsg，不能直接断言 DNS、TLS 或服务器宕机。

## 场景矩阵

以下每项在 iOS 5G 与 Wi-Fi 至少各覆盖一次关键主路径：

- public：问候、能力说明、课表、教学周；确认外部 Provider 调用为 0。
- trial：教师本周课表 → “周三呢” → “换成第16周” → “只看下午” → 打开完整课表。
- 班级：`25动物医学6班`、`25动医6`、`25动医六班`；歧义时只给候选。
- 组合：空教室 + 天气、明日课表 + 附近空教室；Tool 事实不能被模型改写。
- RAG：学校制度/办事入口展示来源、更新时间和可打开卡片；无来源明确说明。
- Memory：local_only、session_state、cloud_sync 各验证一次；“你能记住什么”“我叫什么”不产生 preferredName；纠正称呼建立新 revision。
- 生命周期：前后台切换、杀进程重开恢复 active Run、poll 中断恢复、断网后恢复。
- 离线：个人今日/本周课表和已有缓存查询显示“本机结果”；复杂任务说明需要联网；同一问题不出现重复错误卡或重复终态。
- Provider 故障：timeout/401/429 分别显示真实层级；能由 Tool 完成的任务继续给结构化事实。

## 管理后台交叉核对

每次真机 Run 用 requestId/runId 在“助手运行中心”查询，核对 environment、configVersion、Provider、externalProviderUsed、Tool、duration、failureLayer 和 errorCode。重启服务后该 Run 仍应可查。

`configured`、`verified`、`reachable`、`lastSuccessAt` 必须来自不同事实；未真实 Probe 不得显示“健康”。

## 生产前门禁

体验版验收完成后仍不自动部署生产。生产需要人工批准，并满足：完整 release gate、密钥扫描、Docker smoke、备份、SHA/configVersion 记录。部署后连续观察不少于 15 分钟，检查 health、readiness、Run create/poll、Memory 和 Release Pack；持续异常立即按部署前 SHA 与配置历史回滚。

## 本轮可确认与不可确认

可由仓库自动化确认：协议传播、安全边界、202 处理、错误分类、本机降级、记忆语义、持久化 Run 查询、后台契约及场景模拟/本地集成。

必须人工确认：iOS 5G、iOS Wi-Fi、微信合法域名、体验版构建上传、真实 Session、真实 Provider Probe、Cloudflare/1Panel 当前配置以及生产观察窗口。

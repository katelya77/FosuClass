# CAS 兼容候选与生产边界

本候选基于 PR #89 的 `6fe02a552e7511bc27a2f4751db302ebb7a8e001`。修改仅涉及 Collector 的 CAS 请求策略、浏览器适配器及本地回归。Windows `tools/fosu-sync-client/login.js`、共享 UA/选择器、个人 Agent、认证历史、Session、LF checksum、ZIP 归一化和 heartbeat-only 门禁均沿用。

## 已知阻断与证据

用户提供的 WYZ 验收证明：安装和心跳门禁已通过，Collector 与个人 Agent active，`execute=0`、timer disabled；mobile-wechat 的账号框、密码框、JS 登录按钮可识别。尚未输入凭据、提交密码或建立 Session。

最新无凭据公开页审计将三次被阻断请求归并为同一端点：

| 属性 | 实际审计值 |
| --- | --- |
| 来源 | school-auth |
| 方法/类型 | POST / XHR |
| 脱敏路径 | `/authserver/common/getLanguageTypes.htl` |
| 路径指纹 | `1a216ae3c97d` |
| 次数 | 3 |
| 当前结果 | blocked |
| 页面 | formReady=true、jsSubmit=true、无已观察到的 challenge |
| 凭据/认证历史 | credentialsRead=false、passwordSubmissions=0、authHistoryChanged=false |

这确认了一个重复端点，尚未确认必要性或权限。路径名称不能证明它仅提供语言列表。PR #89 已跟踪源码未包含该端点、调用它的官方 CAS JS 或对应脱敏响应 fixture。生产 `REVIEWED_PUBLIC_POSTS=[]` 继续保留，端点仍为 `unknown-official-post` / `BACKGROUND_POST_UNREVIEWED`，公开页 `REVIEW_REQUIRED`，凭据阶段停止。无需仅为补充这条路径重新安装。

一次补齐以下最小证据后再确定真实规则；不要回传原 HAR、Cookie、账号、密码、execution、CSRF、ticket 或隐藏字段值：

1. 官方公开调用脚本的 pathname、文件 hash，以及经过检查不含敏感值的调用和响应使用片段；说明三次调用的触发点及重试行为。
2. 请求 Content-Type、是否无 body、公开固定参数的名称与安全固定值。若参数含账户或安全令牌，只报告敏感字段存在，不能归为 public-bootstrap。
3. 无凭据公开页面的响应状态、Content-Type、脱敏 schema/类型，以及响应影响哪些页面行为。可以使用合法已有本机证据；当前被阻断请求本身没有成功响应证据。
4. 官方脚本对请求失败的处理：若是可选功能，需要证明阻断后认证入口仍有可用的明确降级；若是必须初始化，需要明确成功条件。不得为了获取这些证据先把整个 authserver 域的 POST 放行。

最终分类和生产新增规则需要独立审阅。运行时参数、环境变量或 PAM 输入不能添加 URL/allowlist。

## 现有 6fe 安装上的一次公开调用证据审计

2026-10-11 用户回传的首次用途审计是 `SCHOOL_PUBLIC_AUDIT_FAILED`、`endpointAudit=[]`、`sourceEvidence=[]`，没有提供用途或响应成功证据。`backgroundPostsBlocked`、认证历史和 Session 的变化均为 null，不能解读为已确认未变化。这个结果继续阻断生产规则审查。

已逐项核对 Git 中原始 6fe 模块：`schoolSession.createAdapter` 存在，调用参数与原 API 一致。旧 PAM 脚本遗漏了现有 `fosu-collector.sh` 和 systemd 已设置的 `PLAYWRIGHT_BROWSERS_PATH`，直接启动 Node 会改用用户默认浏览器目录；原始 launch 异常又被统一收敛为无阶段的通用错误。这是已确认的脚本缺陷，真实主机此次失败是否由它单独造成仍待修正版结果确认。修正版使用同一既有浏览器目录，不安装、更换或下载浏览器；失败仅输出固定阶段、固定原因和安全状态，禁止原异常、stack、URL 或动态路径值。

回归直接从固定 Git 6fe 提取原始 schoolSession / browser adapter / request policy 等模块。真实原生 Chromium 的离线公开页审计仍观察到三次目标请求并全部阻断，且无凭据读取、认证提交或历史变化。模拟原版模块的浏览器启动失败会返回 `stage=browser-start`、`reason=BROWSER_RUNTIME_UNAVAILABLE`。测试需要完整 Git 历史；缺失固定版本应失败，不能退回 mock API。

打开 [PAM-PUBLIC-AUDIT.sh](PAM-PUBLIC-AUDIT.sh)，将整个文件一次性粘贴到 WYZ 的 PAM SSH Web 终端。它是完整 bash + inline Node，直接复用已安装 `6fe02a55` 的 Playwright、schoolSession 和 Fetch 守卫，不依赖新模块或重装。先锁定 current 的真实 release 路径；与登录共享会话锁；只新建不携带现有 Session 的 mobile-wechat 公开页面上下文。不会输入账号/密码、调用预算 Upsert、清除认证历史、放行未知 POST 或切换服务/timer。

若使用本机已保存的 `/root/fosu-collector-audit/PAM-PUBLIC-AUDIT.sh`，先用本候选中修正后的整份脚本替换该审计文件，然后执行 `bash /root/fosu-collector-audit/PAM-PUBLIC-AUDIT.sh`。这只更新审计脚本；Collector 安装保持 6fe。正式提交后的脚本下载命令必须固定该提交并校验 SHA256，不能运行旧副本或移动分支 URL。

它仅为已观察到的 `/authserver/common/getLanguageTypes.htl` 记录 Content-Type、body 是否为空/是否完整捕获、参数**名称**和敏感字段存在性、公开 initiator 脚本 path/行号/已知函数名或函数指纹。读取 JS 使用 Debugger.getScriptSource，只读取此次页面已经加载的公开脚本，不额外 GET 或释放 POST。审计最多 45 秒，单个 CDP 读操作最多 2–3 秒，关闭最多 5 秒；脚本扫描最多 96 个、每份最多 2 MB、保留最多 8 个有目标调用的脚本。

完整调用控制流只保存到 root-only `public-cas-audit-*/*.sanitized.js`：固定协议/公开语言与登录 UI 词保留；其余字符串、数字、regex、注释和未经审阅的 identifier/property key 均去除或稳定映射为 `v1`、`v2`。原始 JS/响应/参数值不输出、不保存。已出现账号、密码、captcha 等参数仍明确输出其名称及 `sensitiveParameterPresent`，不会因脱敏隐藏安全条件。

JSON 的 `sourceEvidence` 直接提供围绕目标调用的 `sanitizedCallExcerpts`，整个审计合计最多约 6 KB，可一次回传审阅；同时提供本机完整脱敏文件、原公开源码 SHA256、目标所在原行号及一次现场审阅的三个明确字段。片段不足时可在 PAM 以 `less -N <localSanitizedSource>` 现场检查，源码保持原行数，不需再次联网审计。只需回传最终 JSON；若能现场判断，附带这三个结果：

```json
{
  "successCallbackLanguageComponent": "公开语言组件名称或UNCONFIRMED",
  "failureCallbackDisablesLogin": "YES或NO或UNCONFIRMED",
  "requestDataFixedOrAccountDerived": "EMPTY或FIXED_PUBLIC或ACCOUNT_DERIVED或UNCONFIRMED"
}
```

`knownUsageSignals`/邻近词布尔值只辅助定位；`purposeConfirmed=false` 明确要求根据真实控制流审核，不能据词邻近或 endpoint 名猜定 optional/required。没有成功响应时仍不能建立 required 响应规则。这一轮补用途证据，不重复此前已通过的安装、UA、ZIP 或心跳验收。工具仅生成本机脱敏审计文件，不读取/保存真实凭据。

## 源码审查结论

Windows 登录链路导航官方 CAS 页后直接由浏览器加载资源，没有 Collector 的 CDP POST 守卫。因此 Windows 能显示页面不能证明三个后台 POST 均必要、安全或可以无条件复制；只复用其已验证 UA/DOM 候选集。Windows 路径未被修改。

原策略对已审阅初始化仅检查固定 JSON 参数，允许次数没有上限，也没有等待必要请求的成功响应。于是必要接口返回错误、重定向或未完成时可能仍宣告网络兼容。候选将请求授权与完成证据分开，并在读凭据前完成门禁。

| 类型 | 候选处理 |
| --- | --- |
| 用途未确认的官方 POST | 一律阻断，REVIEW_REQUIRED；同域不能升级权限 |
| 已审阅的 optional 公开初始化 | 固定参数匹配时仍阻断，计为 noncritical；参数/请求类型变化仍 REVIEW_REQUIRED |
| 已审阅的 required 公开初始化 | 仅精确路径、XHR/Fetch、固定 JSON 序列化、无 query、无敏感参数；预留小额请求预算后放行 |
| 必要初始化响应 | HTTP 200 + JSON Content-Type 之后，还须符合审阅规则固定的公开应用成功字段、精确根字段和非空数组 item schema；200 应用错误也拒绝；body 上限 1–16 KB、读取最多 3 秒；错误/重定向/缺失/未完成均 REVIEW_REQUIRED，准备等待上限 10 秒 |
| CAS 认证 POST | 既有固定 `/authserver/login`、官方 service、单次持久预算预留；重复 service 或第二次 POST 拒绝；不读取 body |
| 已确认的安全验证端点/可见 challenge | 阻断并要求人工处理；不得作为公开初始化放行 |
| 账户验证码预检查 | 仅获批登录中的既有显式 GET；公开页浏览器自动预检查不得提前运行 |

每条代码审阅规则必须包含 origin、精确 path、purpose、criticality、resourceTypes、固定 payload（仅 public-bootstrap）、maxRequests 和脱敏证据 SHA256；required 还必须提供公开响应成功 schema，不能默认任何 JSON 都成功。摘要 hash 只是关联审阅证据，不能自动证明权限。规则启动时校验并冻结，每个隔离页面上下文独立记初始化预算和完成状态；旧 Session 检查后新建 CAS 页不会复用已耗尽初始化预算。认证单次预算仍由既有持久生命周期管理。目前仅支持小型固定 JSON，不接受通配符、query、动态参数、敏感字段、任意 resource type 或超过 3 次的单路径预算。审计确认实际协议不符时应审阅该协议，而非宽化现有规则。未加入任何真实规则。

新增安全摘要字段为 `requestPurpose`、`criticality`、`reviewRequired`、`publicPostsReleased`、`requiredInitializationResponses` 和 `requiredInitializationComplete`；不输出 URL/query/body/参数名/响应正文。`formReady` 只证明 DOM 选择可用。只有 `loginReady=true` 且 `requiredInitializationComplete=true` 才进入下一层，不能等同 Session 已建立。

## 本地回归与真实验收边界

```powershell
node tools/test-collector-cas-post-policy.js
node tools/test-collector-cas-mobile.js
node tools/test-collector-login-browser-fixture.js
node tools/test-collector-auth-evidence.js
node tools/test-collector-cas-public-audit.js
```

POST 策略测试包含精确范围、重复预算竞争、可选请求、必要响应错误/重定向/等待/缺失、HTTP 200 应用错误、公开 schema、旧 Session 检查→新 CAS 上下文、安全验证、浏览器预检查、未知真实审计路径的三次阻断，以及认证 body 不被读取。公开响应补充 localhost HTTP fixture，原生 Chromium 真正暂停 Response、调用 Fetch.getResponseBody 并核对 schema；其余响应为本地合成，未拦截外连只会命中关闭的本地代理，学校请求数为零。这些只证明代码边界，不能替代学校登录或 Oracle 验收。

2026-10-11 正式源码 review 补齐了固定 payload 参数名的格式、64 字符长度和最多 8 字段约束；原有 70 项保留，新增 3 项不合法固定参数规则拒绝测试。最终本地执行结果为策略 73 项＋原生 Chromium 33 场景、mobile 27 场景、基础 browser 4 场景、auth-evidence 10 项全部通过；public-audit 为实际计数的 52 项断言＋2 次原生 Chromium 审计通过，其中第二次加载原 Git 6fe API。`test-school-session-lifecycle.js` 和 `test-collector-sample-request-budget.js` 同样通过。日志位于本工作区 `.local/closure-validation/20261011-final/`，未作为真实学校验收。

review 确认初始化预算在任何异步 CDP 放行之前预留，并且预算/必要响应/完成集合属于单个 browser context；认证提交锁及持久预算继续覆盖所有 context。应用响应必须满足固定 schema，错误、超时、缺失和重定向停止凭据阶段。公开审计取消不调用登录或生命周期写入；交互登录取消、challenge 和浏览器关闭继续经既有停止及冷却门禁处理。严格 TLS、唯一认证 POST、现有 UA/心跳配置均保留。此次未发现需要新增真实初始化权限的证据。

用户单独批准且补齐用途证据后，在已审核候选上先运行现有 `fosu-collector diagnose-login --login-profile=mobile --approve-school-access`；若 REVIEW_REQUIRED，停止并保留原安装。兼容性通过后，单独批准一次 `fosu-collector login --login-profile=mobile --approve-school-access`，在 PAM 隐藏输入真实凭据。认证历史 blocked 时只有人工确认旧失败处理后才加既有 `--acknowledge-auth-failure`；它不清除冷却或日预算。无 Session 不执行任何 Sample。分层端到端结果及完整 PAM 命令以同目录验收手册为准。

## 部署与独立回滚

本候选尚未安装到 WYZ，不触碰学校和生产网络，不启动采集、timer 或发布。没有真实用途规则前，生产 CAS 允许规则仍不可最终确定；Oracle Sample 候选可以独立推进。

未来经批准安装时，复用已通过的 LF checksum、ZIP 归一化、受控安装和 heartbeat-only 门禁。安装前锁定候选 hash；备份/`previous-install.txt` 必须明确指向当前已验收 `6fe02a552e7511bc27a2f4751db302ebb7a8e001`，不能误用历史 `6eea0ec...` 回滚模板。

回滚仅恢复 Collector 候选代码及确实发生变化的 unit。使用既有 `deploy/wyz/rollback-schedule-collector.sh`，先停止 Collector 并核实 previous-install 指向 6fe02a55；脚本不启动服务。完成后以既有 `check-heartbeat-service.py` 检查 heartbeat-only 语义再恢复 Collector。保留 Session、`school-auth-state.json`、checkpoint、个人 Agent 与正式 active；失败则保持 Collector 停止。没有执行回滚或安装。

# CAS 兼容候选与生产边界

2026-10-11 后续真实状态：WYZ已安装215f7e54，安装和公开CAS验收PASS。最新阻断是账号填写后的页面GET预检查与独立程序GET冲突，密码提交/预留均0。本轮增量收敛预检查、增加手动protected-file登录和本地适配冷却分类；完整约束/操作见 [受保护文件登录](PROTECTED-FILE-LOGIN.md)。下方语言接口审查作为已完成历史证据保留，不再次审计UA、语言用途或一小时心跳。

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

2026-10-11 用户补齐 WYZ 公开用途审计、一次无凭据空 POST 响应结构和此前保存的脱敏调用片段。本轮 Agent 没有访问学校。实际请求无 query，bodyEmpty/bodyCaptureComplete=true，bodyFormat=empty，无参数及敏感参数；不是 JSON `{}`。

| 官方公开脚本 | 调用点 | 原源码 SHA256 |
| --- | --- | --- |
| `/authserver/fosuThemeCaptcha/static/custom/js/login-language.js` | `setLanguage`，46 行，两次 | `80e8b6d5e52cf763d9379a937f8640885b6aa5d3548e3a873eac0913ef1c96a6` |
| `/authserver/fosuThemeCaptcha/static/mobile/js/login.js` | 296 行，一次 | `01b5f480764100909b90463124c1c8bd65dac3cda4d81ebf85ca2c0dee6da1a8` |

真实控制流显示：custom 函数在 `language` 元素不存在时直接返回；其 AJAX success 只向 `#language` 添加选项并选择语言。mobile success 只清空/填充语言列表、按 locale 设置 languageName 文本。两处 `data:{}`、`async:false`，片段内没有 error 回调、禁用登录动作或认证提交。邻近 mobile 脚本含安全逻辑，不据邻近词扩大权限。用户真实阻断三次之后账号/密码/JS 提交入口仍可识别；既有 `schoolCasPage.scan` 的 usable 检查要求可见、非 disabled、非 readOnly，formReady不只是找到DOM元素。这支持把该**语言选择 UI 初始化**归为 optional，并保留网络阻断；不证明密码已正确、认证已成功或 Session 已建立。

用户空 POST 探针得到 HTTP 200、application/json、272 字节、无重定向，根字段 `languageTypeList` 为长度2数组；首 item 的 wid/languageKey/languageName 为字符串，isChoose 为整数，isDefault/isDelete 为 null，另一个整数字段名已脱敏。没有独立公开 success 字段，且证据只覆盖首 item。因此它不是可用于 required 放行的完整成功契约，不能将任意 200/JSON 当作初始化成功，也不猜测脱敏字段名。

最后的生产规则只对 **exact HTTPS origin + exact wire pathname、POST、XHR、无 query/fragment、完整空 body、无 Authorization** 匹配请求归类为 `OPTIONAL_INITIALIZATION_BLOCKED`；每个公开 browser context 最多三次，三次均由 Fetch.failRequest 在发送前阻断，publicPostsReleased=0。空正文只接受明确空字符串，或 postData 缺失且没有 hasPostData/opaque entries；Content-Type 仅可缺失或空表单的标准 form-urlencoded/UTF-8 类型，不改写请求、不伪造 JSON。第四次或任何参数、请求类型、方法、路径、header 类型变化均 REVIEW_REQUIRED，凭据阶段请求仍 fatal。匿名公开页面 Cookie 不读取；此规则不释放带 Cookie 的请求。

分类依据是上述调用控制流与实际降级行为，规则 evidenceSha256 关联 custom 源码，同时保留 mobile hash 于本审查记录。运行时参数、环境变量或 PAM 输入不能添加 URL/allowlist；生产没有可释放的 public POST 规则。实际 WYZ 仍安装6fe，尚未得到新候选的 CAS_PUBLIC_READY。只需后续批准的一次升级及公开门禁，再单独批准一次登录。

## 现有 6fe 安装上的一次公开调用证据审计

首次用途审计曾返回 `SCHOOL_PUBLIC_AUDIT_FAILED`，空 evidence 和 null 状态不能视为成功。修正版审计随后由用户在同一6fe安装上执行成功：status=PUBLIC_BOOTSTRAP_EVIDENCE，formReady=true，credentialsRead/passwordSubmissions= false/0，authHistoryChanged/sessionMetadataChanged=false。该执行阻断已解除，不需要再跑公开审计或端点探针。

已逐项核对 Git 中原始6fe模块：API一致。旧 PAM 脚本遗漏既有 PLAYWRIGHT_BROWSERS_PATH，直接 Node 可能改用默认目录；异常又被收敛为通用错误。修正版复用既有浏览器目录，不安装、更换或下载浏览器。当前真实审计成功证明修正版可用；不倒推首次异常的唯一原因。失败仅输出固定阶段、固定原因和安全状态，禁止原异常、stack、URL 或动态路径值。

回归直接从固定 Git 6fe 提取原始 schoolSession / browser adapter / request policy 等模块。真实原生 Chromium 的离线公开页审计仍观察到三次目标请求并全部阻断，且无凭据读取、认证提交或历史变化。模拟原版模块的浏览器启动失败会返回 `stage=browser-start`、`reason=BROWSER_RUNTIME_UNAVAILABLE`。测试需要完整 Git 历史；缺失固定版本应失败，不能退回 mock API。

保留 [PAM-PUBLIC-AUDIT.sh](PAM-PUBLIC-AUDIT.sh) 及离线回归，以下说明用于已有审计记录的复核，本轮不再要求执行。脚本复用已安装6fe的 Playwright、schoolSession 和 Fetch 守卫；与登录共享会话锁，只新建不携带现有 Session 的 mobile-wechat 上下文，不读取凭据或修改认证预算、服务/timer。

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
| 已审阅的 optional 公开初始化 | 空正文或已审阅固定 JSON 匹配时仍阻断；同步计入 per-context 预算，超预算/参数/类型变化仍 REVIEW_REQUIRED |
| 已审阅的 required 公开初始化 | 仅精确路径、XHR/Fetch、显式空正文或固定 JSON、无 query、无敏感参数；小额预算及完整已审阅响应成功契约缺一不可；当前生产无此规则 |
| 必要初始化响应 | HTTP 200 + JSON Content-Type 之后，还须符合审阅规则固定的公开应用成功字段、精确根字段和非空数组 item schema；200 应用错误也拒绝；body 上限 1–16 KB、读取最多 3 秒；错误/重定向/缺失/未完成均 REVIEW_REQUIRED，准备等待上限 10 秒 |
| CAS 认证 POST | 既有固定 `/authserver/login`、官方 service、单次持久预算预留；重复 service 或第二次 POST 拒绝；不读取 body |
| 已确认的安全验证端点/可见 challenge | 阻断并要求人工处理；不得作为公开初始化放行 |
| 账户验证码预检查 | 获批登录绑定同一账号/context，页面XHR优先；没有XHR才一次备用GET，晚到第一次XHR复用同次已验证官方响应；严格单次预算，公开页无绑定仍拒绝 |

每条代码审阅规则包含 origin、path、purpose、criticality、resourceTypes、maxRequests 和证据 SHA256。bodyFormat=empty 时禁止 payload；既有 fixed-json 默认兼容且保留严格序列化匹配。required 必须提供固定公开应用成功 schema。规则启动校验并深冻结；每个隔离页面上下文独立记预算/完成状态，认证持久预算不改变。空正文与 opaque body 区分，不接受通配符、query、动态参数、敏感字段、任意 resource type 或超过3次的单路径预算。

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

此前73项（原70+固定参数校验3项）及33场景完整保留，包括显式空审批列表下原始未知路径三次阻断。新增语言规则检查覆盖空/缺失/opaque 正文、JSON `{}`拒绝、空query/fragment/路径别名、header/类型/方法变化、三次与第四次预算、环境变量无效、credential-phase body 不读取，以及不完整语言响应不能作为 required 成功。新增原生场景覆盖同步/并发第四次、非空body/新路径/query、一次合成认证及原子保存、旧Session检查→新context预算隔离、challenge/取消/浏览器关闭。日志、准确断言数与最新提交的 CI 见本次交付 receipt；这些仍是离线回归，不是学校登录验收。

review 补齐 optional 分支原先未计次数的问题：现在在任何异步 CDP block/release 前同步预留匹配次数。optional 请求始终阻断，无响应释放/成功判定；required 的响应失败、未知schema、超时、缺失和重定向仍停止。认证提交锁、持久预算、挑战/取消、严格TLS、唯一认证POST、原子Session保存及现有UA/心跳配置均保留。此次只改变有证据支持的阻断分类，不新增真实初始化放行权限。

用户单独批准且补齐用途证据后，在已审核候选上先运行现有 `fosu-collector diagnose-login --login-profile=mobile --approve-school-access`；若 REVIEW_REQUIRED，停止并保留原安装。兼容性通过后，单独批准一次 `fosu-collector login --login-profile=mobile --approve-school-access`，在 PAM 隐藏输入真实凭据。认证历史 blocked 时只有人工确认旧失败处理后才加既有 `--acknowledge-auth-failure`；它不清除冷却或日预算。无 Session 不执行任何 Sample。分层端到端结果及完整 PAM 命令以同目录验收手册为准。

## 部署与独立回滚

本候选尚未安装到 WYZ；真实用途证据已审查，后续仍需一次已批准候选升级、公开门禁和单独批准的真实登录验收。没有 Session 不执行 Sample。Oracle PR #90 的c74候选、ARM64镜像和部署边界保持独立，本轮没有修改其源码或生产环境。

未来经批准安装时，复用已通过的 LF checksum、ZIP 归一化、受控安装和 heartbeat-only 门禁。安装前锁定候选 hash；备份/`previous-install.txt` 必须明确指向当前已验收 `6fe02a552e7511bc27a2f4751db302ebb7a8e001`，不能误用历史 `6eea0ec...` 回滚模板。

回滚仅恢复 Collector 候选代码及确实发生变化的 unit。使用既有 `deploy/wyz/rollback-schedule-collector.sh`，先停止 Collector 并核实 previous-install 指向 6fe02a55；脚本不启动服务。完成后以既有 `check-heartbeat-service.py` 检查 heartbeat-only 语义再恢复 Collector。保留 Session、`school-auth-state.json`、checkpoint、个人 Agent 与正式 active；失败则保持 Collector 停止。没有执行回滚或安装。

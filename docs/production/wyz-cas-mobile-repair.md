# WYZ CAS 移动端故障修复记录

日期：2026-10-10。范围：PR #88 Stage A 的登录适配；不部署、不访问学校、不采集、不改正式指针、timer、个人 Agent 或付费资源。

## 已知事实与定位限度

用户 PAM 确认已安装 `df4ed1e985630002f614d37db246a76dcaad65a8`，Collector active、NRestarts=0、个人 Agent active、timer disabled；单次 mobile 登录返回 `SCHOOL_LOGIN_FORM_CHANGED`，尚无 Session。既有 Oracle Direct 一小时心跳 PASS 继续保留。

该提交中此错误码的直接触发点均位于密码填写和点击提交之前。但旧版在进入 adapter.login 前就增加预算，且没有请求阶段记录。因此可确认本地统计缺陷，不能倒推实际学校认证请求数量、退还历史预算或断言真实故障就是某个 DOM 变体。

| 旧路径可能触发点 | 新诊断阶段 / 错误 | 本轮证据 |
| --- | --- | --- |
| 导航后未处于预期 CAS 登录页 | cas-navigation / SCHOOL_LOGIN_FORM_CHANGED | 固定来源及完整 Service 断言；真实页面待批准诊断 |
| 写死 username/password/login_submit ID | account-field、password-field、submit-button / 各自 CHANGED | 原生 Chromium 合成 name-only 表单：修复前复现旧错误，修复后 PASS |
| 异步加载、合法账号密码标签尚未就绪 | cas-load、account-tab、form-selection | 异步插入、隐藏表单标签切换 PASS |
| form.action / 提交方法不符合预期 | form-action、form-method / TLS_OR_ORIGIN_REJECTED 或 SUBMIT_CHANGED | 不可信 Service 阻断；标准 form、button、input 及同路径 JS 场景 PASS |
| 预检查 HTTP 失败、非 JSON 或 isNeed 不是 boolean | precheck-response / PRECHECK_FAILED、PRECHECK_CHANGED | 支持既有客户端已用的 boolean/string isNeed、needCaptcha、boolean 本文；未知响应停止 |
| 来源策略拒绝关键脚本、样式，随后表单缺失 | resource-policy / RESOURCE_REJECTED | 拒绝合成外域脚本并独立报告；没有增加可信域名 |
| 普通“账号或密码”“验证码”“风险”提示 | page-credential-error、challenge-before-password | 去掉宽泛单词判定；可见核验控件、明确要求或官方预检查 true 仍停止 |
| CAS 已提交、结果拒绝或未完成 | authentication-request/released/response/result | 单次放行、有界等待；重复 POST、307 回放与不可信跳转阻断 |
| 登录落地页看似成功但受保护页面无效 | protected-session-check | 再次访问受保护教务页、候选 Session 新 context 校验后才原子保存 |

真实故障原因仍需获批的 WYZ 脱敏公开页诊断确认。没有原始 HTML、截图、学校接口响应或 HAR 证据；不能把本地 fixture 当作学校验收。

## 适配与安全边界

Windows 与 WYZ 共用 schoolLoginProfile、schoolCasPage 选择器集合。`mobile` 明确映射 `mobile-wechat`，与 Windows 默认微信 iOS UA 一致；`mobile-safari` 为显式 Safari UA。两者 viewport/screen=390×844、isMobile/hasTouch=true、scale=3、严格 TLS。Chromium 模拟不等于原生 iOS 浏览器验证。Windows 自定义 UA 优先级、可见浏览器人工入口和同步链路保留，导航回退保留完整 CAS Service。

WYZ 先完成资源加载及有界稳定检查，再请求隐藏凭据。候选必须唯一、可见且属于密码表单/已知登录容器；允许一次明确账号密码标签点击，不生成表单或调用猜测的 JS 函数。JS 支持证据仅来自本地 fixture：点击页面自身按钮，同一个已审核 `/authserver/login` POST 路径，随后受保护页确认；学校实际 JS 流程仍待核实。

CDP 逐跳审查 Request/Response，来源白名单仍只有 authserver.fosu.edu.cn 和 100.fosu.edu.cn。未批准第三方资源不加载；关键脚本/样式拒绝独立报告。密码阶段阻止 GET 导航或非审核 POST，认证 POST 同步占用一次性槽，禁止并发二次提交。官方 checkNeedCaptcha.htl 仍原路径、严格 TLS、maxRedirects=0；没有伪造或省略预检查。未知结构、挑战、错误密码、TLS、网络错误均非零停止，不重试密码。

诊断只含固定阶段、计数、布尔值、HTTP 状态及错误码，不含学号、密码、Cookie、Ticket、完整 URL 查询、隐藏字段、CSRF、网页正文/截图。`diagnose-login` 不填字段、不读旧 Session、不做需要账号的预检查、不保存 Session、不写认证保护记录；页面自动尝试 POST 也会被拒绝。

## 认证预算与崩溃恢复

school-auth-state.json 原有 attempts/windowStart/cooldownUntil/blocked 保留，root-only 读取。损坏状态停止，不能默认空记录。新增字段区分 local_preflight、authentication_rejected、submission_outcome_unknown，以及 reserved_unknown、released、response_received。

只有 CDP 捕获即将放行的审核认证 POST 后才持久化预算预留，写入 mode 600、fsync、原子 rename、目录 fsync，再允许浏览器继续。崩溃发生在预留与放行间仍消耗预算；released 表示浏览器放行命令完成，不能证明学校收到了请求；response_received 是认证响应证据。旧计数标记 LEGACY_UNVERIFIED，绝不按错误码自动扣回。

未提交时的本地识别失败不新增预算，但仍保留 30 分钟冷却和结构/安全/TLS blocked 保护。人工确认仅解除继续尝试的 blocked 门禁，不绕过冷却或 24 小时两次预算。既有成功 Session 可以显式复用；新会话在验证完成前不会覆盖旧会话。

## 验证与真实访问门禁

本机：原始红色 name-only Chromium 回归已复现；移动浏览器覆盖标准及 JS 按钮、异步页、标签、预检查和来源拦截；既有浏览器 4 场景、认证证据 9 组、CLI 24 组和 Session 生命周期通过。要求命令 test:wyz-four-source（23组）、test:collector-personal-regression（51组）、test:security-full、test:architecture-guards、release:preflight 均通过。最终移动场景数量及 Linux 权限/安装、Agent、Gitleaks 以修复 PR 的最终提交 CI 链接为准，不以本机 Windows 结果替代。

安装包及独立修复 PR 延续 #88→#87 的祖先关系，不合并。源码包由 git archive 固定提交生成、SHA256 校验；包内 PAM-HANDOFF 提供本次精确提交、源包哈希、升级与 df4ed1e9 回滚步骤。

以下命令分开批准，不能串成自动重试流程：

1. 新候选安装后离线检查：`fosu-collector auth-state`。无学校或 Oracle 请求；只反馈预算、冷却和 blocked 状态。旧 df4ed1e9 尚不支持此子命令。
2. **单独批准公开 CAS 页诊断后**：`fosu-collector diagnose-login --login-profile=mobile --approve-school-access`。无需账号密码；检查资源/表单阶段。失败停止，只回传白名单状态。
3. **诊断完成并单独批准一次真实登录后**：`fosu-collector login --login-profile=mobile --approve-school-access`。若原记录 blocked，人工处理且冷却/日限允许后加 `--acknowledge-auth-failure`。先更换聊天中已披露密码，新凭据仅在 PAM 隐藏输入，不能回传聊天。

登录成功要求 SESSION_SAVED、sessionChanged=true、passwordPersisted=false 及 protected-session-valid；这不批准采集、Staging、全量、timer 或发布。失败立即停止，不切换桌面反复尝试。

回滚只恢复 df4ed1e9 的代码/服务文件和已备份 drop-in，保留当前 Session、认证预算/冷却记录和采集产物；不复制旧保护记录覆盖新记录。既有一小时网络验收无需重做。首次真实诊断和登录均是本轮停止点。

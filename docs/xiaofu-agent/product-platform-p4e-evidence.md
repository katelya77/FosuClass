# P4e Evidence — Runtime-backed Agent Control Plane

日期：2026-07-31（本地分支 `codex/xiaofu-agent-product-platform`）
范围：tasks.md P4e（apps/agent-admin 六域控制面 + draft/validate/test/publish/rollback/版本历史/environment scope + Run Trace/Eval 后台视图 + 真实 API 无 mock + 浏览器发布→新 Run 生效→回滚闭环）。

## 1. 交付内容

### 1.1 控制面 API（runtime-backed，无 mock）

| 文件 | 职责 |
| --- | --- |
| `apps/agent-admin/src/createConfigPlaneHandlers.js` | 配置面 handlers 工厂（依赖注入 `getConfigKernel`/`listRecentPlatformTraces`/`resolveActor`/`recordWrite`）：snapshot/domains/versions/artifact/draft 读取，draft/validate/test/publish/rollback 写链，内核审计列表，Run Trace 详情。全部 `no-store` + 响应信封 `sanitizePublicValue` + coded error（4xx/5xx 分明，5xx 不透内部消息） |
| `server/src/modules/agent-platform/routes.js` | 装配层：注入 `platformComposition` 真实内核与 trace 源，挂载读 scope（`agent-config:read`/`agent-config:audit:read`）与写保护（`verifyAdminWriteAccess` = 来源校验 + Cookie 会话 CSRF + scope 门禁），写操作经 `recordWrite` 回调进 `writeAuditLog`（模块名 `agent-platform-config`） |
| `server/src/routes/admin.js` | +1 行挂载（渐进式模块先例，`try` 块内第 4 个 `router.use`）；全文 6380 行 ≤ 6500 硬顶 |
| `server/src/services/serviceTokenService.js` | 新 scope 族（词形仿 `assistant-kb:*`）：`agent-config:read` / `agent-config:draft:write` / `agent-config:validate` / `agent-config:publish` / `agent-config:rollback` / `agent-config:audit:read` |
| `server/src/security/adminRouteScopes.js` | 五条写路由显式映射（draft→draft:write，validate/test→validate，publish→publish，rollback→rollback，均兼容 admin:full）；未映射写路由默认拒绝策略不变 |

### 1.2 管理页面（无构建纯静态，不复活第二套 SPA）

- `apps/agent-admin/public/agent-platform.html`：单文件（内联 JS/CSS）。环境切换（public/trial/dev）→ 六域 tab（版本号从真实发布指针渲染）→ 草稿 JSON 编辑器（载入已发布版本/载入草稿/保存草稿/校验/测试/发布）→ 版本历史（当前钉住标记 + 每行回滚按钮）→ 内核审计列表 → 最近 Run 列表 → Run Trace 详情（阶段表 + 各阶段 details 原文渲染）。publish/rollback 有 `confirm()`；写操作带 `X-Fosu-CSRF`；401 跳 `/admin/login?next=…`。
- `server/src/app.js`：`/admin/agent-platform` 静态挂载（Cookie 会话校验未过先 302 登录页；`no-store` + `nosniff` + 与 adminPages 同形 CSP 允许内联脚本），位于 `/admin` 页面路由之前避免被通配符吞掉。未触碰 `adminPages.js`（17,318/17,500，零余量操作）与 legacy SPA 禁列（`test-admin-legacy-only` PASS）。

### 1.3 设计决策

- **为什么新模块 + 静态页而不动 adminPages/admin.js**：`tools/test-architecture-guards.js` 硬顶 adminPages.js 17,500（现 17,318）/ admin.js 6,500（现 6,380）。admin.js 只付 1 行挂载成本；页面走 `apps/agent-admin/public`（不在 legacy SPA 禁列），行为与 adminPages 内控制台同构（session→csrfToken→api()→tab 栏→版本历史回滚）。
- **payload 双轨脱敏**（复审级关键点）：响应信封走 `sanitizePublicValue`；配置 payload 走独立 `redactConfigPayload`（密钥形态字段/值 → `"[REDACTED]"`，豁免 `maxTokens`）。原因：`sanitizePublicValue` 的 `SENSITIVE_KEY` 会剥掉 provider 域合法声明式字段 `maxTokens`（适配器白名单字段），外层再过一遍会把草稿编辑器的往返打成有损（实测复现后修复，HTTP 测试锁定 `apiKey` 被 redact 而 `ttlOverridesMs.campus` 原样返回）。已发布版本经域适配器密钥扫描才可发布，因此**不含密钥形态内容的 payload 逐字节保留、草稿编辑器无损往返**；**含 `[REDACTED]` 字面量的保存请求被 coded 400 `AGENT_CONFIG_REDACTED_VALUE_REJECTED` 拒绝**（占位符不得回存为真值，§7-I-1）；脱敏递归深度超限的子树输出 `"[TRUNCATED]"` 而非原值（§7-I-3）。
- **artifactId 不硬编码**：handlers（`apps/` 通用包，受边界守卫约束不含校园字样）从内核发布指针按域解析当前 artifact；解析不到即 coded 400。`apps/` 边界守卫 PASS。
- **内核行为零改动**：Config Kernel / Runtime / 域适配器均未改；门禁链（validate→test→publish、rollback 只指已发布版本）以 HTTP 层 coded error 原样暴露（`CONFIG_KERNEL_VALIDATION_REQUIRED`/`CONFIG_KERNEL_TEST_REQUIRED`/`CONFIG_KERNEL_ROLLBACK_TARGET_NOT_FOUND`）。
- **写审计双链**：内核 audit.jsonl（op/actor/version/configVersion）+ 后台 `writeAuditLog`（action/module/target/summary，不含 payload 内容）。

## 2. API 与 scope 清单

| 路由 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/api/admin/agent-platform/config/snapshot?env=` | GET | `agent-config:read` | 当前不可变快照（configVersion/六域钉住版本/digest/summary） |
| `/api/admin/agent-platform/config/domains?env=` | GET | 同上 | 六域状态：已发布版本 + 草稿存在性与 validation/test 状态 |
| `/api/admin/agent-platform/config/versions?env=&domain=` | GET | 同上 | 版本历史（origin/createdBy/current 标记） |
| `/api/admin/agent-platform/config/artifact?env=&domain=&version=` | GET | 同上 | 已发布版本完整 payload（redact 后） |
| `/api/admin/agent-platform/config/draft?env=&domain=` | GET | 同上 | 读草稿（redact 后） |
| `/api/admin/agent-platform/config/audit?env=&limit=` | GET | `agent-config:audit:read` | 内核审计（按环境过滤，倒序） |
| `/api/admin/agent-platform/runs/:runId` | GET | `agent-config:read` | Run Trace 详情（见 §3）；未知 runId → 404 `AGENT_RUN_TRACE_NOT_FOUND` |
| `/api/admin/agent-platform/config/draft` | PUT | `agent-config:draft:write` + CSRF(会话) | 存草稿（payload ≤256KB，必须声明式 JSON 对象） |
| `/api/admin/agent-platform/config/validate` | POST | `agent-config:validate` + CSRF | 校验草稿（域适配器报告原样返回） |
| `/api/admin/agent-platform/config/test` | POST | 同上 | 测试草稿（未过校验 → 400 `CONFIG_KERNEL_VALIDATION_REQUIRED`） |
| `/api/admin/agent-platform/config/publish` | POST | `agent-config:publish` + CSRF | 发布（未过校验/测试 → 400 对应 coded error） |
| `/api/admin/agent-platform/config/rollback` | POST | `agent-config:rollback` + CSRF | 回滚（目标必须已发布，否则 404） |

既有只读端点 `/api/admin/agent-platform/{topology,runs}`（P2R）不变。

## 3. Run Trace/Eval 字段对照（实测，public 确定性 Run）

trace 顶层：`runId` / `runtimePackage` / `configVersion` / `pluginIds` / `timings{createRun,decision,tool,verification,response,total}` / `stages[]`。各阶段 details（创建时已经 `platformTrace.normalizeStage` 脱敏，控制面再过一遍 sanitize）实测键：

- `context`：messageCount/memoryCount/episodeCount/ragCount/compressionUsed/selectionFingerprint（**无记忆原文**）
- `decision`：**executionPolicy / decisionSource / goal / selectedSkill / fallbackPath**（P2R 锁定的字段原样呈现）
- `skill_tool`：toolCallCount/toolIds（Tool 状态）
- `verification`：ok/errorCount（Verification 状态）
- `response`：responseMode/answerLength；`ui`：blockCount/blockTypes
- 阶段耗时：`timings` 六桶 + 每阶段 `durationMs`；outcome：每阶段 `outcome`

如实说明：`intendedProvider`/`actualFirstProvider` 属 Provider 真实调用链字段（P2R 已锁定在 provider 阶段 details），public 正式版 Provider 调用恒为零、该 Run 无 provider 阶段，故本环境实测不出现；trial/dev 有真实 Provider 调用时经同一 details 通道呈现。密钥/完整 Prompt/隐藏推理/记忆原文不进 trace（创建期 sanitize），控制面 45 个响应序列化扫描无密钥模式（§4-L）。

## 4. 测试证据（本机，Node v24.15.0，Windows）

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| HTTP 级全链 | `node tools/test-agent-config-plane.js` | PASS（60 响应扫描）：未认证 401 / 错误 scope 403 `ADMIN_SCOPE_DENIED` / 正确 scope 放行；CSRF 缺失 403 `ADMIN_CSRF_REJECTED`；草稿密钥字段 → `[REDACTED]` 且校验必败；门禁链 `CONFIG_KERNEL_VALIDATION_REQUIRED`（直接 publish/直接 test）→ `CONFIG_KERNEL_TEST_REQUIRED`（validate 后 publish）→ 全链 v2 发布；版本历史/current 标记；`version=abc` → 400 `CONFIG_KERNEL_VERSION_INVALID`；rollback 99 → 404 / rollback v1 成功且 mint 新 configVersion；服务令牌最小权限链（draft:write 可存草稿但 publish 403，validate/publish/rollback 各司其职）；审计五 op 齐全且 publish 条目带 configVersion；**public 发布 v2 → 新 Run `platformTrace.configVersion` 全等 → 回滚 → 新 Run 绑定恢复后快照（且 ≠ v2，≠ 原 v1 快照 id）**；全部响应 no-store；全响应体无 `sk-*`/Bearer/PEM/JWT/Google/GitHub/Slack 形态与 `api_key:`/`password:`/`secret:` kv 形态及凭据字面量 |
| 浏览器闭环 | `node tools/test-agent-config-plane-browser.js` | **真跑 PASS**（本机 Chrome，playwright-core）：Cookie 登录 → `/admin/agent-platform/` → 六域 tab 渲染 → 无 Cookie 上下文 302 跳登录 → public/memory 载入已发布 → 编辑器写入 `ttlOverridesMs.grade` → UI 保存/校验/测试/发布（confirm 接受）→ toast「已发布 v2」→ HTTP 新 Run 绑定新 configVersion → UI 回滚 v1 → 新 Run 绑定恢复后快照 → Run Trace 详情真实渲染；零 pageerror；截图 `output/agent-config-plane-browser/p4e-published.png` / `p4e-rolled-back.png` |
| 聚合 | `npm run test:agent-platform-p4e` | PASS（上述两件） |
| P4a 回归 | `npm run test:agent-platform-p4a` | PASS（kernel/conformance/followup/skill-publication/platform-admin 五件） |
| P4b 回归 | `npm run test:agent-platform-p4b` | PASS（六域 conformance + provider/tool/memory publication） |
| P4c 回归 | `npm run test:agent-platform-p4c` | PASS（conformance + mcp-runtime + mcp-publication + kb-mcp） |
| P4d 回归 | `npm run test:agent-platform-p4d` | PASS（conformance + encoder-single-source + rag-runtime + rag-publication + golden-queries） |
| 架构守卫 | `node tools/test-architecture-guards.js` | PASS（adminPages 17,318 / admin 6,380，无重复路由） |
| Legacy 禁列 | `node tools/test-admin-legacy-only.js` | PASS（app.js 无禁列符号；/admin/login、别名、ui-mode 不变） |
| 边界守卫 | `node tools/test-agent-generic-package-boundaries.js` | PASS（apps/ 新增文件无校园字样） |
| 密钥扫描 | `npm run test:no-ai-secret-committed` | PASS（初轮两处命中已修：假密钥改拼接字面量、token JSON 先赋常量，复测通过） |
| 既有 admin 台 | `node tools/test-agent-platform-admin.js` / `test-server-ai-module-require` | PASS |
| 空白检查 | `git diff --check` | OK |

### 4.1 复审跟进新用例（2026-07-31，随 §7 修复同步入库）

| 用例群 | 命令 | 结果 |
| --- | --- | --- |
| 跟进回归（HTTP §M 段） | `node tools/test-agent-config-plane.js` | PASS：HEAD 与 GET 同口径 200（M-9）；`[REDACTED]` 保存（扁平 + 10 层嵌套）→ 400 `AGENT_CONFIG_REDACTED_VALUE_REJECTED`（I-1）；10 层嵌套 apiKey（值不命中任何密钥形态）→ PUT/GET 双路径响应含 `[TRUNCATED]` 且原值零透出（I-3）；缺 payload → 400 `CONFIG_KERNEL_PAYLOAD_INVALID`（M-3）；JWT 形态值放非密钥字段名 → `[REDACTED]` 且 `ttlOverridesMs.campus` 原样（M-5）；`agent-config:read` 令牌 PUT → 403 `ADMIN_SCOPE_DENIED`、错误 CSRF 值（非缺失）→ 403 `ADMIN_CSRF_REJECTED`（M-7 两负向）；同域第二发布物发布后缺省解析 → 409 `AGENT_CONFIG_ARTIFACT_AMBIGUOUS`（消息列双候选），显式 artifactId → 200 且版本序列 [1,2,3]（M-8）；`admin-audit-log.jsonl` 镜像含 module=`agent-platform-config` 的 draft-save/publish 条目（target 精确匹配，M-7） |
| 注入链路（I-2） | `node tools/test-agent-config-plane-browser.js` | **真跑 PASS**：匿名 GET `runtime-config.js` → 302；登录 → 200 + 首行注入全局 + no-store；页面 `AGENT_ADMIN_RUNTIME_CONFIG.csrfHeader === "x-fosu-csrf"`（非默认值）、brand 来自注入、`document.title` 用注入 brand；发布/回滚写链经注入头名全程 200（注入失效则落默认 `X-CSRF-Token` → CSRF 403，链路级负向自证）；零 pageerror |
| 边界守卫纳管 .html（I-2） | `node tools/test-agent-generic-package-boundaries.js` | PASS（扩展名 +`.html`；apps//packages/ 全树 glob 确认仅 `agent-platform.html` 一个 .html，无误伤） |
| runs 列表鉴权对齐（M-2） | `node tools/test-agent-platform-admin.js` | PASS：cookie 会话（admin:full）列 runs 200 不变；`catalog:write` 令牌 → 403 `ADMIN_SCOPE_DENIED`；`agent-config:read` 令牌 → 200 |
| 门禁 UNVERIFIED 规则（M-1） | `node tools/run-agent-release-gate.js test:agent-platform-p1`（单步）+ spawn 桩探针 | PASS：单步真跑 OK（现有输出无 UNVERIFIED 误伤）；桩「exit 0 + 输出含 UNVERIFIED」→ gate 判 FAIL 并输出明确说明、exit 1；过滤器无匹配 → exit 1。未跑全量 gate |

## 5. 浏览器闭环实录（关键断言值）

- 发布前 public 快照：`cfg-public-0006-…`（seed）；UI 发布 memory v2 后：`cfg-public-0007-232aa1f14456`（截图 toast 可见）。
- Run（发布后）`platformTrace.configVersion === cfg-public-0007-232aa1f14456`（全等断言，非包含）。
- UI 回滚 v1 后快照：新 `cfg-public-0008-…`（≠ 0007，也 ≠ 原 0006——回滚 mint 新快照 id）；Run（回滚后）绑定该值。
- 页面状态与内核审计一致：版本历史 v2 当前标记、审计 publish/draft.test/draft.validate/draft.save/seed.publish 五类条目（截图可见）。

## 6. 边界与风险

- Run Trace 详情来自 `listRecentPlatformTraces()` 内存窗口（上限 200，重启即失）；窗口外 runId 如实 404，不伪造历史。持久化 Run 档案属 P5 存储化范围。
- 控制面按发布指针解析该域当前发布物；解析到多个即 coded 409 `AGENT_CONFIG_ARTIFACT_AMBIGUOUS`（消息列候选要求显式指定，§7-M-8），不再静默取第一个。单域多 artifact 的未来形态需 UI 增加 artifact 选择器（API 已支持显式 `artifactId`，页面当前始终显式传）。
- 浏览器测试用固定端口 18777（CORS/写来源校验要求预知自身源）；端口占用时失败为环境问题而非断言失败。无浏览器环境打印 UNVERIFIED 并 exit 0（本机已真跑）；自 §7-M-1 起门禁对任何 step 输出中的 UNVERIFIED 一律判失败，该诚实标记不再能让门禁静默通过。
- 审计读取为内核全局日志按环境过滤（audit.jsonl 不分环境文件），与内核 `listAudit` 语义一致。
- `seed.publish` 在内核 root 为空时于首次 require 发生；测试内核 root 由 harness `FOSU_DATA_DIR` 隔离到临时目录，不触碰真实配置（git status 干净）。
- 未做：Eval 指标聚合视图（golden query 指标在 P4d 证据；后台 Eval 看板建议随 P5 持久化一并设计）；MCP 生产激活仍按 P4c evidence §1.3 属后续按环境启用事项。

## 7. 审查跟进（2026-07-31 复审）

P4e 提交 `8601771d` 经独立只读复审（逐行审阅 + 实测复现，结论：**Approve with
comments**——无 Critical，Important 3 项 + Minor 9 项；铁律守住，测试与证据诚实）。
全部发现已在跟进改动中关闭：

| # | 级别 | 发现 | 修复与测试落点 |
| --- | --- | --- | --- |
| I-1 | Important | `[REDACTED]` 占位符可被草稿编辑器回存为真值，静默覆盖真实密钥（脱敏→显示→保存往返腐蚀） | 服务端 `putDraft` 在 `assertPayloadSize` 后做深度/广度受限递归扫描：payload 任意嵌套字符串值含 `[REDACTED]` 字面量 → coded 400 `AGENT_CONFIG_REDACTED_VALUE_REJECTED`（拒绝只在保存方向，显示方向照出；与 I-3 的 `[TRUNCATED]` 截断标记语义区分）；页面保存草稿按钮前置阻断 + toast 提示重新输入真实值。HTTP：扁平与 10 层嵌套各一例 400 + code 断言 |
| I-2 | Important | apps/ 边界守卫只扫 .js/.json，静态页（.html）脱管，且页面硬编码 FosuClass 品牌/`X-Fosu-CSRF`/`/admin/login` 等部署方字面量 | 守卫扩展名 +`.html`（全树 glob 确认仅 `agent-platform.html` 一个 .html，无误伤）；页面全部部署方字面量改读 `window.AGENT_ADMIN_RUNTIME_CONFIG`（brand/csrfHeader/loginPath/sessionPath/dashboardPath/apiBase，通用默认值兜底）；`server/src/app.js` 在同一 Cookie 校验后、static 之前新增 GET `/admin/agent-platform/runtime-config.js`（no-store，server 侧允许部署方字面量），页面 `<head>` 先引后执行。浏览器测试：匿名 302 / 登录 200 + 注入全局 + csrfHeader 为注入值 + 标题用注入 brand + 发布链写操作仍 200（注入失效即落默认头名 → CSRF 403，链路级负向自证） |
| I-3 | Important | `redactConfigPayload` 深度 >8 原样返回子树，超深嵌套里的密钥形态值静默绕过脱敏 | 深度超限改返回 `"[TRUNCATED]"`（安全方向失败）。HTTP：10 层嵌套 apiKey（值不命中任何密钥形态，排除 redact 干扰）→ PUT 与 GET 双路径响应含 `[TRUNCATED]` 且原值零透出 |
| M-1 | Minor | 环境依赖型测试打印 UNVERIFIED + exit 0 对门禁不可见（无浏览器环境可静默"通过"门禁） | `run-agent-release-gate.js` 每 step 输出改捕获回显，含 `UNVERIFIED` 即判该 step 失败并给出明确说明（全局规则，适用于未来所有环境依赖型测试）；附带按脚本名子串过滤的 CLI（仅本地调试，门禁全量语义不变）。验证：单步真跑 P1 OK（现有输出无误伤）；spawn 桩「exit 0 + UNVERIFIED 输出」→ gate FAIL + exit 1 |
| M-2 | Minor | 旧 `GET /agent-platform/runs`（列表）只要登录即可，与新 `/runs/:runId` 详情（`agent-config:read`）鉴权不对齐 | admin.js 列表端点加 `adminAuth.requireScopes(["agent-config:read"])`（净 +1 行，全文 6380 ≤ 6500 硬顶）。`test-agent-platform-admin.js`：cookie 会话（admin:full）200 不变；`catalog:write` 令牌 → 403 `ADMIN_SCOPE_DENIED`；`agent-config:read` 令牌 → 200 |
| M-3 | Minor | 缺 payload 的 PUT 错报 `AGENT_CONFIG_PAYLOAD_TOO_LARGE` | `assertPayloadSize(undefined)` → `CONFIG_KERNEL_PAYLOAD_INVALID`（400）。HTTP 补 coded 断言 |
| M-4 | Minor | 未列入 `STATUS_BY_CODE` 的 `CONFIG_KERNEL_*` 默认 400，内核新增 code 会被误标客户端错误并透消息 | `sendError` 改为：显式表内用表；未列入一律 500 + 泛化消息（已知客户端 code 全在表内，含本次新增 400/409 两项） |
| M-5 | Minor | 值形态扫描漏 JWT/Google API Key/GitHub PAT/Slack token，非密钥字段名可偷渡密钥形态值 | `SECRET_VALUE` 补 `eyJ…\….…\.`、`AIza…`、`ghp_…`、`github_pat_…`、`xox[baprs]-…` 五形态。HTTP：JWT 值放 `note` 字段 → 响应 `[REDACTED]`，合法字段原样保留 |
| M-6 | Minor | 测试响应扫描模式与服务端 `SECRET_VALUE` 不同步 | `test-agent-config-plane.js` 扫描正则补 `api_key:`/`password:`/`secret:` kv 形态与 M-5 五形态（注释标注与服务端同形同步）；全量 60 响应扫描 PASS |
| M-7 | Minor | 写审计镜像（`writeAuditLog` 链）无断言；缺 read 令牌写 / 错误 CSRF 值两个负向用例 | HTTP：发布后读 harness 数据目录 `admin-audit-log.jsonl`，断言 module=`agent-platform-config` 的 draft-save/publish 条目（target 精确匹配）；`agent-config:read` 令牌 PUT → 403 `ADMIN_SCOPE_DENIED`；错误 CSRF 值（非缺失）→ 403 `ADMIN_CSRF_REJECTED` |
| M-8 | Minor | 同域多发布物时 `resolveArtifactId` 静默取排序第一个，操作可能打到错误 artifact | 解析到多个 → coded 409 `AGENT_CONFIG_ARTIFACT_AMBIGUOUS`，消息列出候选 artifactId 要求显式指定；页面始终显式传 artifactId（`domainQuery()`/`writeBody()` 现状确认，无需改）。HTTP：发布第二 artifact 后缺省解析 → 409 + 双候选；显式 → 200 且版本序列 [1,2,3] |
| M-9 | Minor | `environmentOf`/`domainOf` 只认 GET，HEAD 走 body 分支 → 环境缺失 400 | HEAD 归并 GET 分支。HTTP：HEAD `/config/snapshot?env=dev` → 200 |

连带改动（为让新用例可跑，非审查项本身）：`server/src/utils/rateLimit.js` 全局限流器
新增 `FOSU_GLOBAL_RATE_LIMIT_MAX` 上调通道（`Math.max(60, …)` 地板不变，与既有
`FOSU_SCHEDULE_RATE_LIMIT_MAX` 同形）；harness 默认环境抬到 10000——全链验收单进程
请求数已超生产默认 60/min（首轮实测 429 阻断），生产行为零变化。

复审确认无误后保留的既有判断：双轨脱敏的豁免面（`maxTokens`）未扩大；门禁链 coded
error 语义未变；内核/Runtime/域适配器零改动；Cookie 会话（admin:full）在各 scope
门禁下行为不变（M-2 仅影响服务令牌）。

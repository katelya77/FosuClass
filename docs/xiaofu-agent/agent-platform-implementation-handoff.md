# 小佛助手 Agent 平台化迁移：实施交接文档（最终版）

> 本文是 `refactor/xiaofu-agent-platform-v2` 分支 M0–M7 全部里程碑的交接记录。所有"已完成"均附验证证据（进度文件 / 测试套件实跑结果）；未验证项明确标注。禁止把本文未标验证的内容当作已完成。
> 任务书与里程碑定义：`docs/xiaofu-agent/agent-platform-migration-plan.md`；最终交付报告：`output/agent-platform-final-delivery.md`。

## 1. 分支与基线

- 基线：`main @ 33ae65fc`（"feat: unify Xiaofu model-first task agent chain (#35)"）
- 工作分支：`refactor/xiaofu-agent-platform-v2`（未合并 main、未推送、未部署）
- 里程碑提交链（每个里程碑独立 commit，含验收证据文件）：

| 里程碑 | Commit | 内容 |
|---|---|---|
| M0 | `064de232` | 基线认证：五门禁全绿记录，失败分类规则（A 本分支引入 / B 环境受限 / C 旧测试断言过期 / D 旧测试逻辑缺陷） |
| M1 | `c6c2b301` | Provider 控制面专项认证：`tools/test-provider-control-plane.js` 11 组（五元组权威配置 / 单选=链首 / 三阶段显式链 / probe / verified 语义 / public 恒零外部调用），接入 foundation 套件 |
| M2 | `cdf1b276` | Verification 运行时化：`toolResultVerifier` + `departureChainVerifier` 落盘并接线 `verificationCoordinator`，`verification.started/completed` RunEvent 入 catalog；15 组新测试入 phase3 |
| M3 | `64a00347` | 搜索契约统一：school-search 契约单源生成 + 服务端统一 service + `/release-pack/search` 路由 + Agent 工具同源 + 客户端切换（离线 local-fallback 真实降级标识）+ URL 单实现；15 组测试入守卫 |
| M4 | `52e93424` | FollowUpResolver 收敛：唯一 V2 实现（11 组测试），三处旧解析器退役，working state 八字段对齐（pendingClarification 5 键统一形态） |
| M5 | `e7f31eaf` | AG-UI 事件层：事件映射单源生成（--check 守卫）+ 网关无 session 提权收紧 + 客户端五处伪造状态清除 + 提醒 ActionReceipt 全链闭环（21 项新测试）+ 卡片标签单源化 |
| M6 | `356014df` | 单源工具规划 + Durable 层：意图→工具映射五因子交集单源、kernel 旧链移除（单一 PlannerCoordinator）、恢复逻辑下放 skill、MAX_REPLAN 口径一致（=2）、`durable/`（哈希 token、跨进程 resume、提醒 receipt_wait 接线） |
| M7 | 见 §7 状态表 | 终验与交付：release-gate 首跑分类、本文档、最终交付报告、敏感信息终扫 |

## 2. 架构现状（模块边界）

**服务端 Agent Runtime 协调层** `server/src/services/ai/runtime/`（13 文件）：`agentService.chat` → `requestContextAssembler` → `understandingCoordinator` → `goalContractResolver`（V2 转换+槽位回填）→ `plannerCoordinator`（唯一规划入口）→ `skillRouter` / `toolExecutor` → `verificationCoordinator` → `providerOrchestrator` → `responseComposerBridge` → `memoryCoordinator`；`runEventPublisher` / `actionReceiptCoordinator` / `shared` 横向支撑。agentService 为薄编排（2642→733 行），对外 19 个导出签名不变。

**关键子系统**：
- `understanding/goalContractV2.js` + `.generated.js`：V2 契约手写核心 + manifest 单源生成（`tools/generate-goal-contract-v2.js`，--check 守卫）
- `verification/`：`verificationPolicy`（manifest 策略加载校验）+ `toolResultVerifier`（运行时消费者）+ `departureChainVerifier`（出发链六项核验）
- `durable/`：`taskStore` / `waitForEvent` / `resume`——轻量持久任务（哈希 token、跨进程 resume、提醒 receipt_wait）；无定期 sweep，惰性过期
- Provider 控制面：`providerConfigService.getAuthoritativeProviderConfig`（五元组）→ admin status/API/UI；`providerChainService.resolveStageChain` ← understanding/planner/structured 三调用点；`probeProvider` ← `/api/admin/ai-provider/probe`；单选保存即重算链首
- 搜索统一：`server/config/school-search-contract.json` 单源生成链 → 服务端 service → `/release-pack/search` → Agent 工具与全校页同源
- FollowUpResolver：`server/src/services/ai/understanding/followUpResolver.js` 唯一实现，旧三处解析器已退役（grep 唯一性证据见 M4 进度文件）
- 小程序 AG-UI 事件消费：事件映射由 runEventCatalog 单源生成，客户端只渲染服务端真实状态（十态）；`AI_AGENT_RUNS_TRANSPORT_ENABLED` 为 runs 传输回滚开关

## 3. 测试与验证状态

**M6 收尾（全部实际运行，全绿）**：五门禁（foundation 33/33、regression 126/126、ai-competition、final-convergence、phase3）+ phase2（conversation-memory/kb-control-plane/kb-mcp）+ unified-chain 守卫。

**M7 release-gate 首跑**：`npm run test:agent-release-gate`（14 步 fail-fast）首跑结果与 A/B/C/D 分类见 `output/agent-platform-final-delivery.md` 测试矩阵节。已知历史存量（M3 对照 main @33ae65fc 确认非本分支引入）：11 个 school/cache 链测试基线红（test-school-cache-schema、test-school-last-known-good、test-school-release-key、test-school-request-timeout、test-teacher-static-search、test-teacher-static-search-real-index、test-empty-room-cache、test-static-release-manifest-first、test-startup-last-good-first、test-semester-lifecycle、test-static-detail-first）。

**未验证（如实分级）**：三 Provider staging live test（需真实凭据环境，未做）；真机验证（未做）；体验版（未上传）；生产（未发布）。`release:preflight` / docker smoke 等环境依赖项以 gate 实测分类为准。

## 4. 已知遗留（全部记录，未静默）

1. `get_course_route` manifest `emptyResultPolicy.codes` 缺口（M2 冻结，留 manifest 负责方裁定）
2. `parseDateOffset` "大后天"分支顺序、legacy 空教室 inherited/replaced 双列（M4 锁定未修，标【疑似缺陷】）
3. `request.js` GET dedupe 竞态隐患（搜索链已 `dedupe:false` 规避，其余页面链未动）
4. `responseComposer` TOOL_PUBLIC_LABELS 第三份手工进度文案表（未收口）
5. `xiaofu-reminder-sheet` 删除提醒未接 receipt（端点与派生已就绪）
6. durable 层无定期 sweep（惰性过期正确性已保证）
7. 跨 run 旧卡边界（M5 记录）

## 5. 回滚路径

- 逐里程碑 revert：M6 `356014df` → M5 `e7f31eaf` → M4 `52e93424` → M3 `64a00347` → M2 `cdf1b276` → M1 `c6c2b301` → M0 `064de232`（逆序 revert 可回到 `main @ 33ae65fc`）
- runs 传输开关：`miniprogram/config/cloudbase.js` `AI_AGENT_RUNS_TRANSPORT_ENABLED=false` 回退 legacy 轮询链（`tools/test-cloudbase-ai-router.js` 覆盖该回滚路径）
- Release Pack / last-known-good 机制全程未改动

## 6. 安全纪律

- 全分支敏感信息扫描（diff vs main + 新增文件）：Token/Key/Cookie/OpenID/学号/密码模式零命中（M7 终扫结果见交付报告）
- public 模式外部 Provider 调用恒为 0（M1 控制面测试锁定）
- fixture 全部为无凭据形态字符串
- 未 push、未 PR、未 merge、未部署、未上传体验版

# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-12 19:15 +08:00

## 2026-08-12 Final Convergence 本地收敛（最新）

`ADP_LOCAL_CONVERGENCE = PASS`，`ADP_RUNTIME_E2E = PENDING`，`PUBLIC_READY = FAIL`。

01 已不再使用万能 Tool Node：参数归一化后由 Scope Router 进入独立 `WEEK / DAY / DATE` Tool Node。WEEK 最终 ZIP 的 Tool Body 中真正不存在 `weekday` 与 `date`，因此结构上消除了 optional INT sentinel `0` 风险；CampusTools 事实层未改。统一编译入口为根目录 `npm run adp:compile`；`01-Schedule-Final.zip` 已生成，最终 ZIP Gate 65/65，连续两次编译 SHA-256 一致。编译器优先使用真实 V1.1 platform seed；远端恢复时可对 canonical Final bootstrap 做 WorkflowID、WorkflowName 与三路节点校验后重编译。

下一步只做草稿环境导入与四条 Runtime E2E；不要手改 Workflow 参数。02/03/04 原生 Widget 资源缺失项集中在 Bundle 内 `NEEDS_ADP_EXPORT.md`。PUBLIC_READY 因本机敏感文件与 reachable history 待审计命中失败，今晚不得改 public。

> 新对话优先读取本文件、`current-adp-checkpoint.md`、`2026-08-12-b2-zod-jsonschema-mismatch.md`、`2026-08-12-schedule-widget-contract-split-root-cause.md`、`2026-08-12-schedule-runtime-pass-action-contract.md` 与 `competition/adp-kit/widget/native/runtime-integration-runbook.md`。不要重新设计冻结 01–04，不要重复 B2，不要再调 Schedule Schema/Template。

## 新对话第一句

```text
@GitHub 请恢复校园智序·小序上下文。ADP_LOCAL_CONVERGENCE=PASS，ADP_RUNTIME_E2E=PENDING，PUBLIC_READY=FAIL。01-Schedule-Final 已由 compiler 生成；WEEK Tool Body 真正省略 weekday/date，最终 ZIP Gate 65/65。当前只需导入 Final 做 DAY/WEEK/Action/03 handoff 真实 E2E；不要改 Schedule Widget、21 字段、CampusTools 或 02/03/04。
```

## 项目目标

腾讯云智能 ADP 赛事智能体：`校园智序 · 小序`。

比赛目标：真实校园价值、确定性可信事实、原生 ADP 深度利用、强交互 UI、多轮上下文、可解释安全、工程证据、量化评测、5 分钟获奖型演示。

目标链：

`自然语言 → Agent 路由 → 01/02/03/04 冻结工作流 → CampusTools → verified envelope → 原生 Widget → sys.chat → 下一工作流 → 原生评测`

## 冻结层

除非正式 80 条评测证明回归，不再改：

- 01 多维课表查询；
- 02 空教室规划 V7.2；
- 03 课程冲突比较 V5.1；
- 04 今日校园计划 V1.1；
- 标准模式 Agent 路由与模型输入上下文改写。

动态校园事实只能来自 CampusTools；失败不得模型补造。

固定：`dataVersion=competition-demo-v1`，`dataHash=sha1:fefef4bf425b`。

## Widget C 方案

4 主卡：Schedule / Classroom / Conflict / Day Plan。

2 辅助卡：Choice / Error。

统一视觉：校园任务单 / 时间票据；暖纸张、墨绿可信；红=冲突/错误，橙=赶场。

## B2：正式 PASS

官方天气代码 Widget 已完成五方一致 + 真实 Runtime PASS。当前赛事空间已实机证明：修改 Zod 保存后，outer JSON Schema 与新工作流输入可同步。只作为当前空间合同。

## Schedule ContractSplit：已确认并修复

历史真实导出：

- old outer wrapper / Workflow WidgetParam = V2 七字段；
- encodedWidget / Adapter = RuntimeSafe V3 21 字段；
- 因此形成合同分裂。

方案 A 保留 WidgetID：

`23fbc659efe3482fab588d754e4420a4`

Canonical Schedule contract = RuntimeSafe V3 21 字段，`shownCount=INT`，其余 STRING。

生成并导入：

`01-多维课表查询-WidgetStable-可直接导入.zip`

WorkflowID：`5bf89039-74fd-580e-b1a8-3c3cabdf483f`

## 2026-08-12 03:30+：Schedule Runtime 正式 PASS

用户保存现有 Schedule Widget 的 21 字段 Zod 后，导入 WidgetStable ZIP，输入：

`教师003第1周周一的课`

真实 ADP 截图确认：

- Adapter 成功；
- Widget 展示判断成功；
- WidgetStable 节点成功；
- 原生卡片动态展示教师003、第1周周一、2 条课程、第5-6节/第7-8节、校区A/校区B；
- 结束节点成功；
- 历史 `460101 / convert widget view failed / __jsx in undefined` 消失。

正式状态：

`ADP_WIDGET_SCHEDULE_RUNTIME_PASS`

新上传 `小序-课表票据-V2(3).widget`：

- SHA256 `9d5635a773ab056c3699b88f1379b67bd886280b06a25c0c2ee736230f2a67c3`
- WidgetID 保持不变；
- outer jsonSchema / inner Zod / Default 都是 21 字段；
- 3 个按钮均为 `sys.chat`；
- outer template 仍为空，但当前赛事空间 Runtime 已证明 encodedWidget.view 可正常工作。

## sys.chat：触发已 PASS

用户点击 Schedule 卡片交互后，ADP 显示“已进行操作”并进入新的智能体轮次，因此：

`ADP_WIDGET_SCHEDULE_SYS_CHAT_TRIGGER_PASS`

随后新一轮 01 返回：

- `INVALID_PARAM`
- `weekday 需为 1-7`
- `不支持的 dateText`

这不是 Widget Runtime 问题，而是 Action payload 与冻结 01 参数合同不一致。

当前 RuntimeSafe V3 示例：

- 查看整周：`查看教师003第1周整周课表`
- 换一天：`换一天看看教师003的课表`
- 检查风险：`检查教师003第1周周一是否存在时间冲突或跨校区赶场`

CampusTools 的受控 `dateText` 只接受：今天/明天/后天、本周X/这周X/下周X、第N周周X、YYYY-MM-DD。

`换一天` 不应作为机器执行 payload。

## Action Contract V1：本地完成

目标：**UI label 自然，机器 payload canonical。**

教师场景固定：

- 查看整周 → `查询教师003第1周的课表`
- 下一天：若当前第1周周一 → `查询教师003第1周周二的课`
- 检查风险 → `检查教师003第1周周一是否存在时间冲突或跨校区赶场`

实现状态：

1. `schedule-runtime-safe-v3-adapter.py` 是 21 字段 Adapter 唯一源码；
2. generator 从该文件注入真实 PASS baseline 的 CodeExecutor；
3. Adapter 根据 verified `resolvedEntity/query` 确定性构造动作；
4. `换一天/当前范围/再看看` 等模糊词不进入 payload；
5. room/class/course 只回流 01，教师明确日范围才生成 03 self-risk；
6. 周日跨周与第 20 周周日回退行为已有测试固定；
7. 不改 CampusTools、冻结 01/02/03/04、WidgetID、Template、21 字段 Schema/WidgetParam、ActionType 或 Edge。

正式状态：

```text
ADP_WIDGET_SCHEDULE_RUNTIME_PASS
ADP_WIDGET_SCHEDULE_SYS_CHAT_TRIGGER_PASS
ADP_WIDGET_ACTION_CONTRACT_LOCAL_PASS
```

制品：

`output/competition-adp/01-多维课表查询-WidgetStable-ActionsV1-可直接导入.zip`

- WorkflowID：`f3961270-90a0-46d3-b86f-75a88a0c2ba8`
- SHA256：`ce5448911f20b562516cf0e03959078b51e43f83dafd0da623bc734caa90fb24`
- 静态 Artifact Gate：29/29 PASS

当前唯一 Gate 是腾讯 ADP Schedule Action E2E。用户验收前不得标记 `ADP_WIDGET_SCHEDULE_ACTION_E2E_PASS`。

详细：`competition/adp-kit/reports/2026-08-12-schedule-action-contract-v1-local-pass.md`。

## Schedule Actions V1.1：Week Scope Contract Fix

新增真实证据：点击“看周二”后，`查询教师003第1周周二的课` 已重新进入已启用的旧 01，并返回 `2026-09-01 verified EMPTY_RESULT`，因此 DAY Action canonical payload 已兼容。点击“查看整周”仍返回 `INVALID_PARAM / weekday 需为 1-7 / 不支持的 dateText`。

根因与修复：

1. ADP optional INT 空值可能成为 `0`；01 归一化现严格限制 week=1–20、weekday=1–7，整周固定清空 weekday。
2. 显式第N周不再重复写入 date_text；新增“日期输入守卫”，合法显式 week 时输出空 `safe_date_text`，否则保留原文本进入 CampusTools。
3. Action Builder V1 保持原 canonical 三按钮；Widget、21 字段、WidgetID、CampusTools、结果核验、02/03/04 全部冻结。

制品：`output/competition-adp/01-多维课表查询-WidgetStable-ActionsV1.1-可直接导入.zip`

- WorkflowID：`9272b9cb-c805-4fed-a300-1984a881a231`
- SHA256：`36c5f92c3d544d0fa97cd0609cf4a44d71e5edb99833d2e59dc95861fbf65ff6`
- Artifact Gate：35/35 PASS
- 全部本地测试 PASS；详见 `competition/adp-kit/reports/2026-08-12-schedule-actions-v1.1-week-scope-local-pass.md`。

当前 ADP 管理状态仍是 ActionsV1 未启用、原始 01 已启用，因此 sys.chat 规划落到旧 01 是预期行为。下一步只导入 V1.1 并验收“查看整周”；通过前不得标记 `ADP_WIDGET_SCHEDULE_ACTION_E2E_PASS`。

## 后续工程化目标：ADP Contract Compiler

用户明确要求停止碎片化试验。后续固定：

`用户批量导出 ADP 真实资源 → 本地 Contract Compiler 审计/生成 → 自动 Gate → 用户一次导入 → 少量端到端 Runtime`

下一步应把 6 个 Widget 的以下内容统一由单一合同源生成：

- Schema
- Adapter view model
- WidgetParam
- Action payload
- NodeUI inputs
- Workflow ZIP

避免本地文件、encodedWidget、outer wrapper、Workflow 节点再次漂移。

## 研发分工

- ChatGPT：架构、Gate、根因、提示词、验收与版本收敛；
- Codex / Kimi Code：批量代码、测试、ZIP compiler、Widget/Workflow 审计、Playwright、Git Gate；
- 用户：只做 ADP 必须的人工作业——批量导入/导出、真实 Runtime、截图。

## GitHub

仓库：`katelya77/FosuClass`

分支：`feat/campusflow-adp-integration`

PR #49：保持 open / unmerged；正式评测收口前不发布正式应用。

## 后续比赛路线

Schedule Action E2E → 批量 02/03/04 Widget + Choice/Error → 六卡 Runtime PASS → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖演示。

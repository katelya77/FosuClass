# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-12 03:33 +08:00

> 新对话优先读取本文件、`current-adp-checkpoint.md`、`2026-08-12-b2-zod-jsonschema-mismatch.md`、`2026-08-12-schedule-widget-contract-split-root-cause.md`、`2026-08-12-schedule-runtime-pass-action-contract.md` 与 `competition/adp-kit/widget/native/runtime-integration-runbook.md`。不要重新设计冻结 01–04，不要重复 B2，不要再调 Schedule Schema/Template。

## 新对话第一句

```text
@GitHub 请恢复校园智序·小序上下文。B2 已 PASS；Schedule ContractSplit 已修复，`01-多维课表查询-WidgetStable` 已真实动态 Runtime PASS，原生 Schedule 卡成功展示。Schedule 的 sys.chat 点击也已真实进入新一轮智能体；当前唯一 Gate 是 Action Contract V1：把模糊按钮 payload 改成冻结 01/03 能稳定解析的 canonical utterance，然后批量推进 02/03/04 + Choice/Error。不要再做 Widget Runtime 小实验。
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

## 当前唯一 Gate：Action Contract V1

目标：**UI label 自然，机器 payload canonical。**

教师场景建议：

- 查看整周 → `查询教师003第1周的课表`
- 下一天：若当前第1周周一 → `查询教师003第1周周二的课`
- 检查风险 → `检查教师003第1周周一是否存在时间冲突或跨校区赶场`

原则：

1. Adapter 根据 verified query/entity 确定性构造动作；
2. `换一天/当前范围/再看看` 等模糊词不能直接作为执行 payload；
3. UI label 与 payload 分离；
4. Codex/Kimi 先跑 Action Contract tests；
5. 用户只做一次批量导入和少量端到端验收；
6. 不改 CampusTools 事实逻辑。

详细：`competition/adp-kit/reports/2026-08-12-schedule-runtime-pass-action-contract.md`。

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

Action Contract V1（Schedule 01/03 回流） → 批量 02/03/04 Widget + Choice/Error → 六卡 Runtime PASS → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖演示。

# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-11 22:28 +08:00

> 这是 FosuClass Project 内新对话继续研发的单一接力入口。新对话先读本文件，再读 `current-adp-checkpoint.md` 与 `competition/adp-kit/widget/native/runtime-integration-runbook.md`。不要仅依赖聊天历史。

## 新对话第一句

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发；不要重新设计已经冻结的 01–04。
```

## 项目目标

腾讯云智能 ADP 赛事智能体：`校园智序 · 小序`。目标是可信校园任务执行型 Agent：

`自然语言 → 标准模式 Agent 路由 → 01/02/03/04 确定性工作流 → CampusTools → verified envelope → 原生 Widget → sys.chat 继续下一任务 → 原生评测`

比赛设计以评委/领导视角优先：真实场景价值、可信事实、交互完成度、工程证据、可量化评测、5 分钟故事化演示。

## 冻结层

除非后续基准评测发现回归，不再改事实逻辑：

- 01 多维课表查询：冻结。
- 02 空教室规划 V7.2：五轮累计条件真实 ADP 通过，冻结。
- 03 课程冲突比较 V5.1：self-compare、赶场去重、01→03 handoff 真实通过，冻结。
- 04 今日校园计划 V1.1：核心/边界真实通过，冻结。
- 标准模式应用路由 + 模型输入上下文改写：冻结。
- 动态校园事实只能来自 CampusTools；失败时模型不得补造。
- `dataVersion=competition-demo-v1`，`dataHash=sha1:fefef4bf425b`。

## Widget C 方案

4 主卡 + 2 辅助卡：

1. `小序-课表票据-V2`
2. `小序-空教室票据-V2`
3. `小序-冲突赶场票据-V2`
4. `小序-今日校园计划-V2`
5. `小序-候选确认-V2`
6. `小序-任务恢复-V2`

统一视觉：校园任务单 / 时间票据；暖纸张、墨绿可信状态；红=时间冲突，橙=跨校区赶场。

六张 `.widget` 已在腾讯云 ADP 实机导入并出现独立 UI Preview：`ADP_WIDGET_NATIVE_TEMPLATE_PASS`。

尚未允许标记 `ADP_WIDGET_NATIVE_PASS`，因为真实工作流动态数据 + sys.chat Runtime 仍在验收。

## 已捕获真实 ADP Widget 工作流 Seed

来源：用户导出的 `export-00-节点格式种子-勿启用(3).zip`。

已确认：

- `NodeType=WIDGET`
- Schedule WidgetID=`23fbc659efe3482fab588d754e4420a4`
- Choice WidgetID=`f540588933a4459cbe78a6fe99aa022c`
- 未接线结果型节点 `ActionType=WIDGET_ACTION_NONE`
- Widget 参数位于 `WidgetNodeData.WidgetParam`
- OBJECT / ARRAY_OBJECT / ARRAY_STRING 均使用 `SubParams`
- **ARRAY_STRING 必须至少包含一个 STRING 子参数槽位，例如 `teachers → item 0 → STRING`。**

抽象合同：`competition/adp-kit/widget/native/widget-node-seed-contract.json`。

## Schedule Runtime 调试时间线

### Pilot V1

工作流：`01-多维课表查询-WidgetPilot`

真实调试：`教师003第1周周一的课`

结果：

- CampusTools 查询成功；
- `Widget数据适配-Schedule` 成功；
- `Widget展示判断` 成功并走 widget；
- `小序-课表票据-V2` Runtime 失败；
- 对话显示 `系统运行异常，请稍后重试`。

因此故障集中在 Widget Runtime 参数结构，不是事实层/路由层。

### Pilot V1.1

生成物：`01-多维课表查询-WidgetPilot-V1.1-扁平参数映射修复版-可直接导入.zip`

目标：避免 summary/items/actions 顶层复杂对象直接引用，改为原子字段逐项引用。

用户导入后 ADP 在画布结构校验阶段给出明确错误：

```text
teachers 参数为 ARRAY_STRING 类型，必须有一项子参数
classes 参数为 ARRAY_STRING 类型，必须有一项子参数
```

根因已经确定：V1.1 为简化诊断把 `teachers/classes.SubParams=[]`，但真实 Seed 的合法结构要求 `ARRAY_STRING → item 0 STRING`。

### Pilot V1.2 — 当前待实机验证版本

生成物：

`01-多维课表查询-WidgetPilot-V1.2-ARRAY_STRING子参数修复版-可直接导入.zip`

SHA256：

`99e4081a5276d33caff9c70f395e809a6de7ac1754729a264d605ffbc459488f`

V1.2 修复：

- 严格复制真实 Seed 的 ARRAY_STRING 子参数结构；
- 两个课程槽位均设置：
  - `teachers → item 0 STRING → REFERENCE_OUTPUT`
  - `classes → item 0 STRING → REFERENCE_OUTPUT`
- Adapter 新增：
  - `item0_teacher0 / item0_class0`
  - `item1_teacher0 / item1_class0`
- summary/items/actions 继续采用 V1.1 原子化映射；
- 正式 01 不修改。

本地 Gate：

- RED：V1.1 共 4 个 ARRAY_STRING 缺少子槽位；
- GREEN：V1.2 四个 ARRAY_STRING 均为 1 个 STRING 子槽位并动态引用；
- Adapter 教师/班级保真模拟 PASS；
- START 可达 PASS；
- Reference NodeID PASS；
- XLSX WorkflowID 一致 PASS；
- ZIP CRC / 六文件合同 PASS。

下一步：用户导入 V1.2。先确认不再出现 ARRAY_STRING 结构红错，再调试同一句 `教师003第1周周一的课`。

如果 V1.2 Widget 节点 Runtime 仍失败，必须展开失败 Widget 节点并获取：

1. Error / 报错详情；
2. Widget 输入变量实际值；
3. 运行耗时。

不要继续猜，也不要手工大改 Template/Adapter。

## 腾讯云官方 Widget 规则

重点文档：

- Widget 概述 `126973`
- Card `126981`
- 配置 Widget 节点 `126979`
- Widget 节点 `126990`
- Action `127283`
- Button `127018`

已确认原则：

- Widget 输入必须与上游结构/类型一致；不一致先经 Code Adapter。
- 结果展示卡使用“直接向后流转”。
- Choice 使用“等待用户操作”。
- `sys.chat` payload 会作为新的用户输入进入当前会话，继续 Agent 路由。
- Widget 只负责 UI/交互，不承担 CampusTools 事实计算。

## 用户工具与研发方式

用户拥有 Codex、Kimi Code。后续策略：

- 重复代码、测试、ZIP 构建、Playwright、Git Gate 优先交给 Codex/Kimi；
- 用户在 ADP 只做必须的真实导入、一次性 Seed 捕获、点击调试；
- ChatGPT 负责架构、根因分析、生成严格实现提示词、验收合同、版本收敛；
- 所有真实状态、版本、失败根因必须写回 GitHub，保证 FosuClass Project 新对话可直接接力。

## 永久 ADP ZIP 规则

- `NextNodeIDs` 与顶层 `Edge` 同步；
- Reference NodeID 存在且位于真实上游；
- START 到所有业务节点可达；
- Code/Tool/参数提取输出 Schema 与 NodeUI 注册同步；
- `parameters.xlsx` 顶层 `ParameterParentId` 为空；
- 能只改 workflow JSON 就不改已通过的 XLSX；新 WorkflowID 只最小改 workflows/example_queries/parameters；
- 每版执行 CRC / 可达性 / 引用 / XLSX-ID 校验；
- WIDGET 中 OBJECT / ARRAY_OBJECT / ARRAY_STRING 的 SubParams 结构必须保留真实平台合同，不得为了简化而删除必需子槽位。

## Runtime 通过后的路线

1. Schedule Runtime + sys.chat Action；
2. 02 Classroom Runtime；
3. 03 Conflict Runtime；
4. 04 Day Plan Runtime；
5. Choice 等待用户操作 + Error 恢复；
6. 32 QA；
7. 80 条 ADP 原生应用评测；
8. Prompt A/B；
9. 匿名 / 注入 / 越权红队；
10. 多模态；
11. Test Release；
12. 5 分钟获奖型演示与最终提交资产。

## GitHub

仓库：`katelya77/FosuClass`

分支：`feat/campusflow-adp-integration`

PR：#49，保持 open / unmerged；正式评测收口前不发布应用。
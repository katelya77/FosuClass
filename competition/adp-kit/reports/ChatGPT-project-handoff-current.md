# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-11 22:18 +08:00

> 这是 FosuClass 项目里给 ChatGPT 新对话使用的单一接力入口。新对话开始时优先读取本文件，再读取 `current-adp-checkpoint.md` 与相关 runbook；不要仅依赖聊天历史。

## 新对话第一句建议

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发，不要重新设计已经冻结的 01–04。
```

## 项目目标

腾讯云智能 ADP 赛事智能体：`校园智序 · 小序`。目标不是普通聊天机器人，而是“可信校园任务执行型 Agent”：自然语言 → 标准模式 Agent 路由 → 01/02/03/04 确定性工作流 → CampusTools → verified envelope → 原生 Widget → `sys.chat` 继续下一任务 → 可量化评测。

比赛目标：以评委/领导视角优先，强调真实场景价值、可信事实、交互完成度、工程证据与演示闭环，争取获奖。

## 冻结层（除非基准评测发现回归，不再改事实逻辑）

- 01 多维课表查询：冻结。
- 02 空教室规划 V7.2：五轮累计槽位真实 ADP 通过，冻结。
- 03 课程冲突比较 V5.1：self-compare、赶场去重、01→03 handoff 真实通过，冻结。
- 04 今日校园计划 V1.1：核心/边界通过，冻结。
- 应用标准模式路由 + 模型输入上下文改写：冻结。
- 动态事实只能来自 CampusTools；失败时不得由模型补造。
- `competition-demo-v1`，`dataHash=sha1:fefef4bf425b`。

## Widget C 方案

4 主卡 + 2 辅助卡：

1. `小序-课表票据-V2`
2. `小序-空教室票据-V2`
3. `小序-冲突赶场票据-V2`
4. `小序-今日校园计划-V2`
5. `小序-候选确认-V2`
6. `小序-任务恢复-V2`

统一视觉：校园任务单 / 时间票据；暖纸张 + 墨绿可信状态；红=时间冲突，橙=跨校区赶场。

六张 `.widget` 已在腾讯云 ADP 实机导入并出现独立 UI Preview，可标记：

`ADP_WIDGET_NATIVE_TEMPLATE_PASS`

但尚不能标记 `ADP_WIDGET_NATIVE_PASS`，因为真实工作流动态数据 + Action Runtime 还未全通过。

## 已捕获的真实 Widget 工作流 Seed

来源：用户导出的 `export-00-节点格式种子-勿启用(3).zip`。

确认：

- `NodeType = WIDGET`
- Schedule WidgetID = `23fbc659efe3482fab588d754e4420a4`
- Choice WidgetID = `f540588933a4459cbe78a6fe99aa022c`
- Seed 中结果型/未接线节点 `ActionType = WIDGET_ACTION_NONE`
- Widget 参数在 `WidgetNodeData.WidgetParam`
- OBJECT / ARRAY_OBJECT 使用 `SubParams`

合同：`competition/adp-kit/widget/native/widget-node-seed-contract.json`

## Schedule Runtime 当前真实状态

### Pilot V1

工作流：`01-多维课表查询-WidgetPilot`

WorkflowID：`578e7df1-6290-4218-82e9-cb16b165625a`

用户已真实导入并调试：

`教师003第1周周一的课`

真实结果：

- 课表查询成功；
- `Widget数据适配-Schedule` 成功；
- `Widget展示判断` 成功并走 widget 分支；
- `小序-课表票据-V2` Widget 节点失败；
- 对话显示：`系统运行异常，请稍后重试`；
- 失败发生在 Widget 运行时，不是 CampusTools / Adapter / 路由失败。

截图还确认 Widget 节点 Preview 本身正常，因此问题集中在“运行时输入结构/映射”。

### 当前最可能根因

V1 把以下复杂值作为 Widget 顶层直接引用：

- `summary: OBJECT`
- `items: ARRAY_OBJECT`
- `actions: ARRAY_OBJECT`

腾讯云官方 `配置 Widget 节点` 文档明确：上游输出结构与 Widget 输入格式不匹配会导致无法正常渲染；不一致时应使用代码节点转换。

因此 V1.1 采用最小诊断/修复：

- 顶层复杂对象不再直接引用；
- summary 子字段逐项引用原子输出；
- items 固定 2 个课程槽位，字段逐项引用原子输出；
- actions 固定 3 个动作槽位，字段逐项引用原子输出；
- teachers/classes 暂时留空，仅用于验证 Runtime 核心渲染，不作为本 Gate 必要字段；
- 正式 01 不修改。

本地生成物：

`01-多维课表查询-WidgetPilot-V1.1-扁平参数映射修复版-可直接导入.zip`

SHA256：

`74c30ef1bdfe4a0211844f66b54a72dda5264a04f427324ae04585b9ecb7320e`

本地静态 Gate：

- RED 证据：V1 存在 `summary/items/actions` 复杂顶层直引；
- GREEN：V1.1 复杂顶层直引 = 0；
- Adapter 扁平合同模拟：PASS；
- START 可达：PASS；
- XLSX WorkflowID 一致：PASS；
- ZIP CRC / 六文件合同：PASS。

下一步优先让用户导入 V1.1 并在工作流自身调试相同输入。若 Widget 节点成功，则确认复杂对象顶层引用是 Runtime 根因，再把模式推广为可生成 5 个课程槽位的正式 Schedule Runtime。若仍失败，则必须让用户展开失败 Widget 节点，获取“输入变量实际值 + Error/报错详情”，不要继续猜。

## 腾讯云 Widget 官方文档关键规则

- Widget 概述：`126973`
- Card：`126981`
- 配置 Widget 节点：`126979`
- Widget 节点：`126990`
- Action：`127283`
- Button：`127018`

重要事实：

- Widget 节点输入支持引用前序节点输出；结构/类型必须一致。
- 结果展示用“直接向后流转”。
- 需要确认/填写才继续时用“等待用户操作”。
- `sys.chat` 会把 payload 作为新的用户输入写入当前对话上下文，继续参与 Agent 推理/路由。
- Action 只能声明官方预置类型，不在 Template 内实现自定义逻辑。

## 用户研发资源与偏好

用户拥有 Codex、Kimi Code，可用于本地代码、测试、Playwright、生成物、Git 提交。优先将重复/机械/可验证开发交给本机 Agent，用户在 ADP 只做必须的“一次性真实格式捕获、导入、点击调试”。

用户要求：

- 高效率推进，不反复让其手填复杂节点；
- 深度思考，优先一次性收敛；
- 所有版本/根因/验收结果写回 GitHub，避免新对话丢上下文；
- PR #49 保持 open/unmerged，未最终评测前不发布正式应用。

## 永久 ADP ZIP 规则

- `NextNodeIDs` 与顶层 `Edge` 同步；
- Reference NodeID 存在且位于真实上游；
- START 到业务节点可达；
- 参数提取/Tool/Code 输出 Schema 与 NodeUI 注册同步；
- `parameters.xlsx` 顶层 `ParameterParentId` 空；
- 能只改 JSON 则不碰已通过 XLSX；必须新 WorkflowID 时只最小修改 workflows/example_queries/parameters；
- 每次 CRC / 可达 / 引用 / XLSX-ID 校验。

## 后续路线（Runtime 完成后）

1. Schedule Runtime + `sys.chat` Action；
2. 02 Classroom Runtime；
3. 03 Conflict Runtime；
4. 04 Day Plan Runtime；
5. Choice “等待用户操作” + Error 恢复；
6. 32 QA；
7. 80 条 ADP 原生评测；
8. Prompt A/B；
9. 匿名/注入/越权红队；
10. 多模态；
11. Test Release；
12. 5 分钟获奖型演示与最终提交资产。

## GitHub

仓库：`katelya77/FosuClass`

分支：`feat/campusflow-adp-integration`

PR：#49，保持 open / unmerged。

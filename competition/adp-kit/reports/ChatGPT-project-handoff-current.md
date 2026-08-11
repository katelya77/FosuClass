# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-12 01:09 +08:00

> 这是 FosuClass Project 内新对话继续研发的单一接力入口。新对话先读本文件，再读 `current-adp-checkpoint.md` 与 `competition/adp-kit/widget/native/runtime-integration-runbook.md`。不要仅依赖聊天历史。

## 新对话第一句

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发；不要重新设计已经冻结的 01–04。
```

## 项目目标

腾讯云智能 ADP 赛事智能体：`校园智序 · 小序`。

目标链：

`自然语言 → 标准模式 Agent 路由 → 01/02/03/04 确定性工作流 → CampusTools → verified envelope → 原生 Widget → sys.chat → 下一工作流 → 原生评测`

比赛设计以评委/领导视角优先：真实校园价值、可信事实、交互完成度、工程证据、量化评测、5 分钟故事化演示。

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

4 主卡 + 2 辅助卡：Schedule / Classroom / Conflict / Day Plan / Choice / Error。

统一视觉：校园任务单 / 时间票据；暖纸张、墨绿可信状态；红=时间冲突，橙=跨校区赶场。

六张 V2 `.widget` 已在腾讯云 ADP 实机导入并出现独立 UI Preview：`ADP_WIDGET_NATIVE_TEMPLATE_PASS`。

Kimi Code 本机 Widget V2 Gate 已通过：Adapter tests、6 类样例、validate-kit、Playwright 3 viewport、完整 `npm test --prefix competition/adp-kit`、Golden 33/33、安全扫描均 PASS。

## Runtime Seed

来源：用户导出的 `export-00-节点格式种子-勿启用(3).zip`。

已确认：

- `NodeType=WIDGET`
- Schedule WidgetID=`23fbc659efe3482fab588d754e4420a4`
- Choice WidgetID=`f540588933a4459cbe78a6fe99aa022c`
- Widget 参数在 `WidgetNodeData.WidgetParam`
- OBJECT / ARRAY_OBJECT / ARRAY_STRING 使用 `SubParams`
- ARRAY_STRING 必须至少一个 STRING 子参数槽位
- **Seed 中 Widget 节点未完成正式运行配置，捕获值为 `ActionType=WIDGET_ACTION_NONE`**

这是当前最重要的未验证架构点。

## Schedule Runtime 调试时间线

### V1

`教师003第1周周一的课`：CampusTools / Adapter / Widget展示判断成功，Widget Runtime 失败。

### V1.1

扁平化复杂对象时误清空 teachers/classes 子槽位，ADP 明确报：

```text
teachers 参数为ARRAY_STRING类型，必须有一项子参数
classes 参数为ARRAY_STRING类型，必须有一项子参数
```

### V1.2

按真实 Seed 恢复 ARRAY_STRING 子参数后，结构错误消失，但 Runtime 报：

```text
460101-工作流运行异常: 获取Widget内容失败:
convert widget view failed: http request failed:
type:framework, code:122,
msg:client codec Unmarshal: rpc.toJsonViewResponse.Data:
ReadMapCB: expect { or n, but found ",
...
operator to search for '__jsx' in undefined
```

### V1.3 RuntimeSafe — 已真实失败

为了排除复杂 JSX / Schema，V3 改为：

- 零 `.map()`；
- 零三元；
- 零动态 children；
- Schema 仅 STRING / INT；
- 零 OBJECT / ARRAY_OBJECT / ARRAY_STRING；
- 静态 ListViewItem；
- 简单变量绑定；
- 3 个静态 sys.chat Button。

用户按要求原地修改并保存了现有 `小序-课表票据-V2`，又上传重新导出的 `小序-课表票据-V2(1).widget`。

实际解析确认：

- WidgetID 仍为 `23fbc659efe3482fab588d754e4420a4`；
- Template 确实是 RuntimeSafe V3；
- Schema 确实只有 STRING / INT；
- `schemaValidity=viewValidity=defaultStateValidity=valid`。

随后 V1.3 调试仍返回与 V1.2 完全相同的 `convert widget view failed / __jsx in undefined`。

因此 **“复杂 JSX / 复杂 Schema 是根因”假设已经被否证**。禁止继续用 V1.4/V1.5 方式盲改 Template。

报告：

`competition/adp-kit/reports/2026-08-12-schedule-widget-runtime-v13-identical-converter-failure.md`

## 当前唯一优先 Gate：Widget 下发方式 / ActionType

腾讯云官方文档明确要求 Widget 节点配置：

- 直接向后流转；
- 等待用户操作。

而自动生成的所有 Schedule Pilot 一直继承未配置 Seed 的：

`WIDGET_ACTION_NONE`

下一步只做一个单变量实验：

1. 在现有 `01-多维课表查询-WidgetPilot-V1.3` 打开 `小序-课表票据-RuntimeSafe-V3` 节点；
2. 找到“Widget 下发方式”；
3. 明确选择“直接向后流转”；
4. 保存；
5. 其他任何内容不改；
6. 重跑 `教师003第1周周一的课`。

若 PASS：根因锁定为 `WIDGET_ACTION_NONE / 下发方式未配置`。

若仍 FAIL：导出这份已经人工配置“直接向后流转”的 V1.3 ZIP，捕获真实 ActionType 枚举；随后用腾讯云官方最小静态 Widget（Card + Title + Text、固定输入）建立独立 Runtime 基线，区分自定义 Widget 转换问题与平台/空间 Runtime 服务问题。

## 官方文档原则

重点：Widget 概述 `126973`、Card `126981`、ListView `126995`、配置 Widget 节点 `126979`、Widget 节点 `126990`、Action `127283`、Button `127018`、代码创建 `127031`、ADP-Widget SDK `129230`。

已确认：

- Widget 节点必须配置输入变量和 Widget 下发方式；
- 结果展示卡使用“直接向后流转”；
- Choice 使用“等待用户操作”；
- 输入结构/类型不一致时先经 Code Adapter；
- `sys.chat` payload 作为新用户输入进入当前会话；
- Preview PASS 不等于 Runtime PASS；
- Widget 只负责 UI/交互，不承担校园事实计算。

## 用户工具与研发方式

用户拥有 Codex、Kimi Code。

后续策略：

- 重复代码、测试、ZIP 构建、Playwright、Git Gate 优先交给 Codex/Kimi；
- 用户在 ADP 只做必须的真实导入、一次性 Seed 捕获、真实调试；
- ChatGPT 负责架构、根因分析、实现提示词、验收合同和版本收敛；
- 所有真实状态、失败根因必须写回 GitHub。

## 永久 ADP ZIP 规则

- `NextNodeIDs` 与顶层 `Edge` 同步；
- Reference NodeID 存在且位于真实上游；
- START 到所有业务节点可达；
- Code/Tool/参数提取输出 Schema 与 NodeUI 注册同步；
- `parameters.xlsx` 顶层 `ParameterParentId` 为空；
- 每版执行 CRC / 可达性 / 引用 / XLSX-ID 校验；
- WIDGET 的复杂类型 `SubParams` 必须符合真实平台合同；
- 未捕获真实平台枚举前，不允许猜 ActionType。

## Runtime 通过后的路线

Schedule Runtime 基线 → Schedule sys.chat → 02 Classroom Runtime → 03 Conflict Runtime → 04 Day Plan Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## GitHub

仓库：`katelya77/FosuClass`

分支：`feat/campusflow-adp-integration`

PR：#49，保持 open / unmerged；正式评测收口前不发布应用。

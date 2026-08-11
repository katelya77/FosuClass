# 校园智序 · 小序 — ChatGPT Project 新对话接力主文件

更新时间：2026-08-12 02:15 +08:00

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

## Schedule Runtime 调试时间线

### V1 / V1.1 / V1.2 / V1.3

- V1：CampusTools / Adapter / Widget展示判断成功，Widget Runtime 失败。
- V1.1：发现 ARRAY_STRING 子参数结构错误。
- V1.2：修复后进入 Runtime，但报 `460101 / convert widget view failed / code 122 / __jsx in undefined`。
- V1.3 RuntimeSafe：Schema 仅 STRING/INT、零 map/复杂对象，真实 Widget 导出 validity 全部 valid；Runtime 仍同样失败。
- 用户确认 Schedule Widget 节点从一开始就是“直接向后流转”。

因此：复杂 JSX、复杂 Schema、ARRAY_STRING、下发方式都不能再作为主根因继续盲改。

## 2026-08-12 关键突破：腾讯官方模板 Runtime PASS

用户新建腾讯云官方模板 `基础表单澄清-DtR1y`，最小工作流：

`开始 → 基础表单澄清-DtR1y → 结束`

真实调试成功，表单 Widget 正常出现在对话中。

用户上传：

- `export-00-节点格式种子-勿启用(4).zip`
- `基础表单澄清-DtR1y.widget`

解析确认成功节点：

- `NodeType=WIDGET`
- WidgetID=`5a3ac523bf7e46df8a5017fe243be40e`
- `ActionType=WIDGET_ACTION_NONE`
- title / fields 均是 `USER_INPUT`
- fields 是 `ARRAY_OBJECT`

官方模板 Template 本身还真实使用：

- `fields.map(...)`
- 三元表达式
- Form / Input / Textarea
- `sys.clarify`

却 Runtime PASS。

因此确认：

1. 当前赛事空间 Widget Runtime 服务是健康的；
2. `WIDGET_ACTION_NONE` 不是故障；
3. `.map()` / 三元 / ARRAY_OBJECT 也不是通用故障；
4. 现阶段最重要的差异只剩：**动态 REFERENCE_OUTPUT / 自动构建 Workflow WidgetParam 序列化** 与 **自定义/代码创建 Widget 本身**。

报告：

`competition/adp-kit/reports/2026-08-12-widget-official-template-runtime-pass.md`

## 当前最高优先：2×2 差分实验

已知 A：官方模板 + 固定 USER_INPUT = PASS。

已知 B：小序自定义 Schedule + Code Adapter 引用 = FAIL。

下一步只做两项：

### B1 官方模板 + 单个引用

`开始 → Code 输出 title STRING → 基础表单澄清 Widget → 结束`

只有 title 改成 `REFERENCE_OUTPUT`，fields 继续固定。

### B2 官方代码创建天气 + 固定输入

严格按腾讯云官方文档 `127031` 的天气 Widget 示例代码创建，不自定义，不加按钮，所有字段固定手工输入，直接向后流转。

结果矩阵：

- B1 PASS + B2 PASS：平台、引用、代码创建都健康，问题锁定小序 Schedule 特定参数/Template；以官方天气基线渐进演化成 Schedule。
- B1 FAIL：优先调查 Widget `REFERENCE_OUTPUT` / 自动 ZIP 序列化，停止改 UI。
- B1 PASS + B2 FAIL：代码创建路径异常，生产路线优先“官方模板复制后改造”，并准备腾讯云工单。
- 都 FAIL：再用纯手工 UI 引用做最终对照，排除自动 ZIP 构建器。

## 官方文档要点

重点：

- Widget 总览 `126973`
- 从模板创建 `127030`
- 代码创建 `127031`
- 导入 Widget `127033`
- 配置 Widget 节点 `126979`
- Widget 节点 `126990`
- Card `126981`
- ListView `126995`
- Button `127018`
- Action `127283`
- ADP-Widget SDK `129230`
- Agent 输出 Widget `127035`
- 工具调用直接输出 Widget `127036`

官方明确：模板复制、代码创建、自然语言生成、导入 `.widget` 都是正式支持的创建路径；Widget 工作流输入必须与 Schema 匹配，必要时先经 Code 转换；结果展示使用直接向后流转。

## 用户工具与研发方式

用户拥有 Codex、Kimi Code。

后续策略：

- 重复代码、测试、ZIP 构建、Playwright、Git Gate 优先交给 Codex/Kimi；
- 用户在 ADP 只做必须的真实导入、一次性 Seed 捕获、真实调试；
- ChatGPT 负责架构、根因分析、实现提示词、验收合同和版本收敛；
- 所有真实状态、失败根因必须写回 GitHub。

## GitHub Actions

Actions included minutes 已用 `3000 / 3000`，与 ADP Widget Runtime 无关。

当前本地 Codex / Kimi 可继续完成测试和构建；PR #49 保持 open / unmerged。

## 永久 ADP ZIP 规则

- `NextNodeIDs` 与顶层 `Edge` 同步；
- Reference NodeID 存在且位于真实上游；
- START 到所有业务节点可达；
- Code/Tool/参数提取输出 Schema 与 NodeUI 注册同步；
- `parameters.xlsx` 顶层 `ParameterParentId` 为空；
- 每版执行 CRC / 可达性 / 引用 / XLSX-ID 校验；
- WIDGET 的复杂类型 `SubParams` 必须符合真实平台合同；
- 未有实机证据前，不把 Preview PASS 当 Runtime PASS。

## Runtime 通过后的路线

Schedule Runtime 基线 → Schedule sys.chat → 02 Classroom Runtime → 03 Conflict Runtime → 04 Day Plan Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

## GitHub

仓库：`katelya77/FosuClass`

分支：`feat/campusflow-adp-integration`

PR：#49，保持 open / unmerged；正式评测收口前不发布应用。

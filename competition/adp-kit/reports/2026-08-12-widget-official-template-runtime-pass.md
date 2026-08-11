# 2026-08-12 Widget Runtime：腾讯官方模板基线 PASS

## 最新实机证据

用户使用腾讯云 ADP「从 Widget 模板创建」得到的 `基础表单澄清-DtR1y`，在极简工作流中真实运行成功：

`开始 → 基础表单澄清-DtR1y → 结束`

对话窗口成功渲染表单卡，工作流节点全部成功，未出现 `460101 / convert widget view failed`。

用户同时上传：

- `export-00-节点格式种子-勿启用(4).zip`
- `基础表单澄清-DtR1y.widget`

已解析真实导出。

## 真实工作节点合同

官方模板工作节点：

- `NodeType = WIDGET`
- WidgetID = `5a3ac523bf7e46df8a5017fe243be40e`
- `ActionType = WIDGET_ACTION_NONE`
- `title` 使用 `USER_INPUT`
- `fields` 使用 `ARRAY_OBJECT`，包含 2 个 OBJECT item
- item 内有 STRING / BOOL 子参数
- `Inputs=[]`
- `Outputs=[]`

因此确认：

1. `WIDGET_ACTION_NONE` 与 UI 中“直接向后流转”并不矛盾；至少在当前平台导出中，直接向后流转的正常可运行节点仍可序列化为 `WIDGET_ACTION_NONE`。
2. 之前“ActionType / 下发方式是 Schedule Runtime 失败根因”的假设彻底否证。
3. 平台/赛事空间 Widget Runtime 服务总体可用，不是全局服务故障。

## 官方模板本身进一步否证旧假设

导出的官方 `基础表单澄清-DtR1y.widget` 的 Template 真实包含：

- `fields.map(...)`
- 三元表达式
- `Form`
- `Input / Textarea`
- `sys.clarify`
- `ARRAY_OBJECT`

并且 Runtime PASS。

所以以下因素不能再被当作 Schedule 失败的通用根因：

- `.map()`
- 三元 JSX
- 复杂 Schema
- ARRAY_OBJECT
- ActionType=WIDGET_ACTION_NONE

## 当前剩余高价值差异

已知 A：平台模板 + 固定 USER_INPUT = PASS。

已知 B：小序自定义 Schedule + Code Adapter 引用变量 = FAIL，报：

`460101 / convert widget view failed / code 122 / __jsx in undefined`

下一步需要一次 2×2 最小对照，而不是继续改大卡：

### Test B1 — 官方模板 + 单个动态引用

保持 `基础表单澄清-DtR1y` 不变，仅把 `title` 从固定 USER_INPUT 改为前序 Code 节点的 STRING 输出；`fields` 仍全部固定输入。

目的：验证 Widget Runtime 对 `REFERENCE_OUTPUT` 以及自动生成 ZIP 中引用序列化是否可靠。

### Test B2 — 腾讯官方“代码创建天气” + 固定输入

完全按官方 `127031` 天气示例创建代码 Widget，全部手动固定输入、直接向后流转。

目的：验证“代码创建 Widget”链本身能否 Runtime PASS。

结果矩阵：

- B1 PASS + B2 PASS：平台、引用、代码创建均正常；问题锁定在小序 Schedule 特定 Template/参数合同，之后从官方天气基线渐进替换为 Schedule。
- B1 FAIL：优先调查 `REFERENCE_OUTPUT` / 自动构建 Workflow WidgetParam 序列化，而不是 Widget 模板。
- B1 PASS + B2 FAIL：平台模板来源正常，但代码创建链异常；优先使用“从模板复制后轻量改造”的生产路线，并准备腾讯云工单。
- B1/B2 都 FAIL：分别保留 request_id/trace_id，进一步做手工 UI 引用对照排除 ZIP 生成器。

## 研发策略

Widget 支线继续，但不能阻塞比赛主线。若两轮最小实验仍不能快速收敛，则并行推进 32 QA / 80 eval / 安全红队 / 多模态 / 演示材料，Widget 作为兼容性支线处理。

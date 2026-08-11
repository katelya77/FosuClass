# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-12 01:54 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_NATIVE_TEMPLATE_PASS`
- `ADP_WIDGET_RUNTIME_SEED_CAPTURED`
- `ADP_WIDGET_SCHEDULE_RUNTIME_DEBUGGING`
- `ADP_WIDGET_RUNTIME_ARCHITECTURE_RECHECK`
- `ADP_WIDGET_MINIMAL_PLATFORM_BASELINE_PENDING`
- `ADP_WIDGET_NATIVE_RUNTIME_PENDING`
- `GITHUB_ACTIONS_INCLUDED_MINUTES_EXHAUSTED`

PR #49：保持 open / unmerged / 未正式发布。

## 冻结事实层

- 01 多维课表查询：冻结。
- 02 空教室规划 V7.2：真实多轮通过，冻结。
- 03 课程冲突比较 V5.1：self-compare / 赶场 / 01→03 handoff 真实通过，冻结。
- 04 今日校园计划 V1.1：核心/边界通过，冻结。
- 标准模式路由 + 模型输入上下文改写：冻结。
- 动态校园事实只来自 CampusTools；失败不得由模型补造。

## Widget 当前结论

六张 C 方案 Widget 已在 ADP 实机导入并出现独立 UI Preview：Schedule / Classroom / Conflict / Day Plan / Choice / Error。

Schedule Runtime 调试：

1. V1：CampusTools / Adapter / 展示判断成功，Widget Runtime 失败。
2. V1.1：发现 ARRAY_STRING 子参数结构问题。
3. V1.2：修复 ARRAY_STRING 后，Runtime 报 `460101 / convert widget view failed / __jsx in undefined`。
4. V1.3 RuntimeSafe：Schema 仅 STRING/INT，零 map/复杂对象，真实 Widget 导出 validity 全部 valid；Runtime 仍返回完全相同错误。
5. 用户进一步确认：Widget 节点从一开始就是“直接向后流转”，因此此前“下发方式未配置 / WIDGET_ACTION_NONE 是根因”的假设被实机事实否证。

结论：禁止继续叠加 V1.4/V1.5 Template 补丁。当前必须建立平台原生最小 Runtime 基线。

最新报告：

`competition/adp-kit/reports/2026-08-12-widget-runtime-direct-flow-confirmed-and-actions-quota.md`

## 下一唯一 Gate：平台原生最小 Runtime 基线

使用腾讯云 ADP 自带 Widget 模板，不使用自制/导入 Widget。

最小工作流：

`开始 → 平台模板 Widget（固定手工输入，直接向后流转） → 结束`

不得加入 CampusTools、Adapter、动态引用、ListView、Button、sys.chat。

结果解释：

- PASS：当前 ADP 空间的 Widget Runtime 服务正常；问题限定在自定义/导入 Widget converter 兼容链。下一步复刻腾讯官方代码创建天气 Widget 做第二对照，再逐步增加自定义组件。
- FAIL 且同类 460101：优先判断赛事空间/平台 Widget Runtime 服务异常。保留 request_id / trace_id / 时间 / 截图，提交腾讯云技术支持；比赛研发主线不再被 Widget 阻塞，继续 32 QA / 80 eval / 安全红队等工作。

## GitHub Actions

用户 Billing 截图显示：Actions included minutes 已用 `3000 / 3000`，storage 约 `0.5 / 2 GB`，billable usage 当前 $0。

该问题和 ADP Widget Runtime 460101 相互独立：GitHub Actions 只影响 GitHub-hosted runner CI，不参与腾讯云 ADP 工作流执行。

当前策略：

- 本地 Codex / Kimi 执行测试、ZIP 构建、Playwright、Git Gate；
- 如需恢复 GitHub-hosted Actions，可配置付款方式 + Actions 小额预算，或使用 self-hosted runner；
- included minutes 会在下一 billing cycle 重置。

## 新对话接力

先读：

1. `competition/adp-kit/reports/ChatGPT-project-handoff-current.md`
2. `competition/adp-kit/reports/current-adp-checkpoint.md`
3. `competition/adp-kit/widget/native/runtime-integration-runbook.md`
4. `competition/adp-kit/reports/2026-08-12-widget-runtime-direct-flow-confirmed-and-actions-quota.md`

新对话第一句：

```text
@GitHub 请先读取 competition/adp-kit/reports/ChatGPT-project-handoff-current.md、competition/adp-kit/reports/current-adp-checkpoint.md、competition/adp-kit/widget/native/runtime-integration-runbook.md，然后继续校园智序-小序 ADP 研发；不要重新设计已经冻结的 01–04。
```

## Runtime 通过后的路线

Schedule Runtime 基线 → Schedule sys.chat → 02 Classroom Runtime → 03 Conflict Runtime → 04 Day Plan Runtime → Choice/Error → 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟获奖型演示。

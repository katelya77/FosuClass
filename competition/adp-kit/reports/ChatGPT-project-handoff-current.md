# 校园智序 · 小序 — ChatGPT Project 接力

更新时间：2026-08-12 23:10 +08:00

## 必须继承的状态

```text
DAY_WIDGET_RUNTIME_PASS
WEEK_REQUEST_TRANSPORT_PASS
WEEK_WIDGET_RENDER_PENDING
DATE_WIDGET_RENDER_PENDING
RISK_WIDGET_COMPILER_READY_RUNTIME_PENDING
NEEDS_ADP_EXPORT = NONE
PR_49 = OPEN / UNMERGED
```

不得标记 `SCHEDULE_FINAL_FROZEN`。

## 已完成

- WEEK/DAY/DATE request transport split 保持不变；WEEK Tool Output `weekday=0` 只在 WEEK scope canonicalize 为 omitted，DAY 继续 fail closed，DATE 使用 academic context。
- Action Protocol V2 为 `intent-first/query-fallback`，定义 `schedule_day / schedule_week / schedule_choose_day / schedule_risk_check`；风险必须进入 03。
- Schedule Rich V4 array contract 已准备，但当前真实 Schedule Widget 仍是 21 字段 RuntimeSafe V3，因此未替换。
- 6 个真实 WidgetID 与 3 个真实 WorkflowID 已进入 Registry；contracts 均从真实 `.widget` 的 encoded Schema 自动提取。
- Campus Widget Compiler 已生成 01/02/03/04 Final ZIP：02 接 Classroom，03 接 Conflict，04 接 DayPlan；AMBIGUOUS_ENTITY 接 Choice，其它缺参/非法/工具失败接 Error。
- `ADP-App-Expected-Config.json` 规定唯一 active set 为 01 Final / 02 Final / 03 Final / 04 Final；旧 01 和 00 Seed 必须排除路由。
- `competition-demo-v1` 未迁移生产校历；canonical hash 保持 `sha1:fefef4bf425b`，没有写入任何真实佛大生产课表。

## 下一步真实 ADP Gate

导入 `CampusFlow-ADP-Import-Bundle.zip` 中四个 Final Workflow，在草稿应用按 Expected Config 核对 active set 与 examples，然后验证：

1. WEEK / DATE Schedule Widget。
2. Schedule“检查风险”→ 03 → 原生 Conflict Widget。
3. AMBIGUOUS_ENTITY → Choice，INVALID_PARAM / TOOL_FAILURE → Error。

不要手改 Workflow 节点，不要 merge PR #49，不要生产部署或正式 ADP 发布。

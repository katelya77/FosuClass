# 校园智序 · 小序 — ChatGPT Project 接力主文件

更新时间：2026-08-12 20:30 +08:00

当前阶段：`ADP Interaction Convergence R2`

## 必须继承的真实状态

```text
DAY_WIDGET_RUNTIME_PASS
WEEK_REQUEST_TRANSPORT_PASS
WEEK_WIDGET_RENDER_PENDING
DATE_WIDGET_RENDER_PENDING
RISK_WIDGET_PENDING_REAL_EXPORT = RESOLVED_RESOURCE_ONLY
PR_49 = OPEN / UNMERGED
```

不要写 `SCHEDULE_FINAL_FROZEN`。

真实 DAY 已贯通并展示教师003、第1周周一、2026-08-31、两门课、`verified=true`。真实 WEEK request 已不带 weekday，CampusTools 返回周一/三/四/五共 5 门课。当前阻塞不是 request transport，而是腾讯 ADP Tool Output 把 optional INT `weekday` 显示成 sentinel `0`，旧 Adapter 因此 fallback。

## R2 修复

`schedule-runtime-safe-v3-adapter.py` 现在是 scope-aware：

- WEEK：要求 week 1–20，强制 canonical `weekday=None/date=""`，仅本分支接纳 Tool Output `weekday=0` sentinel；
- DAY：要求 week 1–20 与 weekday 1–7，`weekday=0` fail closed；
- DATE：要求合法 date，并从 `academic_body` 取得 canonical date/week/weekday。

`schedule-result-verifier-v2.py` 同样按 scope 呈现，WEEK 不会再输出“星期0”。compiler 为每个 Verify/Adapter 注入固定 `transport_scope + academic_body + branch-local tool_body`。

BranchRef 根因已经永久修复：`clone_branch()` 会把 DAY Tool NodeID 重写到 WEEK/DATE Tool；Final Artifact Gate 新增 branch-local 语义断言。旧 Final ZIP 精确出现 4 处失败，重编译后 71/71 PASS。

## Action Protocol V2

支持：

- `schedule_day`
- `schedule_week`
- `schedule_choose_day`
- `schedule_risk_check`

结构化 payload 始终同时携带 `query / intent / entityType / entityName / week / weekday`；完整 query 能在平台只传文本时独立路由。Agent 路由合同已改为 intent-first。RuntimeSafe Widget 当前只能稳定投影 query，因此“选择日期”使用：

`【小序操作:选择课表日期】教师003|第1周`

## Schedule Rich V4

`widget/native/schedule-rich-v4/` 已建立完整数组合同，WEEK sample 保留真实 5 门课，不再只取 items[0]/items[1]。包含 Template、Zod、JSON Schema、Default、DAY/WEEK samples 和 tests。由于当前真实 Schedule 导出仍是 RuntimeSafe V3 21 字段，Rich V4 `widgetId=null`，不得伪造或提前替换线上 WidgetID。

## 下一批资源

用户一次性导出的 5 个 Widget 与 02/03/04 Workflow ZIP 已全部收到，并把真实 WidgetID/WorkflowID/SHA-256 登记到 `real-adp-export-catalog.json`；`NEEDS_ADP_EXPORT` 已清零。

资源到位不等于集成完成。下一 compiler 批次优先：

`Schedule → 检查风险 → 03 → Conflict Adapter → 原生 Conflict Widget`

不修改 03 的冲突事实逻辑，不伪造任何 WidgetID。

## 用户下一步

导入新 `output/competition-adp/final/01-Schedule-Final.zip`，无需手填/修改节点。在草稿环境验证 DAY、WEEK Widget、DATE Widget、选择日期回流和检查风险路由。不要 merge PR #49，不要生产部署或正式 ADP 发布。

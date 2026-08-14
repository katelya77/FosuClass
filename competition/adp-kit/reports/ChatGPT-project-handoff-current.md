# 校园智序 · 小序 — ChatGPT Project 接力

更新时间：2026-08-14 20:00 +08:00

## 必须继承的状态

```text
01_04_R3_TENCENT_WORKFLOW_DEBUG_PASS
05_CAMPUS_OVERVIEW_REAL_EXPORT_BOUND
05_REAL_WIDGET_ID = 876474681d584d95b4a99da929dfb3b1
APPLICATION_HERO_CHAIN = PENDING_USER_RUNTIME_E2E
PR_49 = OPEN / UNMERGED
```

## 已完成

- 真实 05 `.widget` 的文件 Hash、encoded ID、Schema、DefaultState 与三项 validity 已 fail-closed 校验。
- raw View Hash 仅作为腾讯原始证据；formatter-only 差异通过 semantic View Gate，组件、变量或 `sys.chat` 变化继续 RED。
- Runtime Registry 已扩展为七类 Widget；05 Bound Workflow 使用确定性 `get_campus_teaching_overview`、结果 Guard、primitive Adapter、真实 CampusOverview / Error Widget。
- 01～04 R3 制品保持 byte-stable；没有重新设计已通过腾讯调试的节点结构。
- 最终应用 Router、Activation Matrix、107-case Evaluation、Judge Demo 与 R5 Final Pack 已生成。
- `competition-demo-v1 / sha1:fefef4bf425b` 与 33 Golden facts 未修改。

## 下一步真实腾讯 Gate

1. 导入 `05-校园教学态势-R1-Bound.zip`。
2. 应用只启用 01～05 最终版本并排除历史路由。
3. 按 R5 Checklist 执行 Hero→02→03→01→04；完成前状态保持 `PENDING_USER_E2E`。

不要手改 Workflow 节点，不要 merge PR #49，不要生产部署或正式 ADP 发布。

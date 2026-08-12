# CampusFlow ADP Final Import

本 Bundle 的 Workflow ZIP 均由 `npm run adp:compile` 从 canonical contract 自动生成。

## 包含

- `01-Schedule-Final.zip`

## 腾讯 ADP 操作

1. 导入 `01-Schedule-Final.zip`。
2. 在草稿环境启用 `01-多维课表查询-Final`。
3. 关闭旧的 01 Schedule Workflow，避免 `sys.chat` 再次路由到旧合同。
4. 依次测试：`教师003第1周周一的课`、点击“查看整周”、点击“看周二”、点击“检查风险”。
5. 仅在四条链全部真实通过后记录 Runtime E2E PASS；不要手改 Workflow 参数。

`02/03/04` 需要 `NEEDS_ADP_EXPORT.md` 中的真实腾讯导出后才能安全生成；编译器不会伪造 WidgetID。

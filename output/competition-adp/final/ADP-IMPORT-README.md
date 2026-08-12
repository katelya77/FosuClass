# CampusFlow ADP Final Import

本 Bundle 的 Workflow ZIP 均由 `npm run adp:compile` 从 canonical contract 自动生成。

## 包含

- `01-Schedule-Final.zip`
- `02-Classroom-Final.zip`
- `03-Conflict-Final.zip`
- `04-DayPlan-Final.zip`

## 腾讯 ADP 操作

1. 依次导入 01 / 02 / 03 / 04 Final ZIP。
2. 应用仅启用 01 Final、02 Final、03 Final、04 Final；旧 01 与 00 Seed 不参与路由。
3. 按 `ADP-App-Expected-Config.json` 核对 Workflow examples 与 6 个真实 WidgetID。
4. 在 ADP 草稿环境完成 Runtime E2E 后再发布；不要手改 Workflow 节点。

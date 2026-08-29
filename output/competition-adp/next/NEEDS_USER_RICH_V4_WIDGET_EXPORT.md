# NEEDS_USER_RICH_V4_WIDGET_EXPORT

状态：`REQUIRED`。

原因：腾讯 ADP 的真实 WidgetID 位于平台保存后导出的 `.widget` 中；当前 Schedule V2 的真实 ID 只能用于 RuntimeSafe V3，不能复制为 Rich V4 ID。仓库不会虚构或复用该 ID。

用户只需完成一次：

1. 在腾讯 ADP Widget 管理中复制 `小序-课表票据-V2`，命名 `小序-课表票据-Rich-V4-Pilot`；不要修改或覆盖原 V2。
2. 用本包 `Schedule-Rich-V4-Pilot/template.txt` 替换 View，用 `zod.txt` 替换 Schema，用 `default.json` 替换 Default State，保存并确认平台校验通过。
3. 导出唯一的 `小序-课表票据-Rich-V4-Pilot.widget` 并交回。

收到真实导出后，compiler 将自动提取 `encodedWidget.id/view/defaultState/schema`、登记真实 WidgetID，并生成 side-by-side Pilot Workflow；用户无需手改节点。

# ROLLBACK

- 当前 `01-Schedule-Final.zip` 始终绑定真实 `小序-课表票据-V2`，状态为 RuntimeSafe V3。
- Rich V4 Pilot 未取得真实 WidgetID，未写入 01 Final、未覆盖 V2、未进入 active workflow。
- 若 02/03/04 草稿 Runtime 异常，在腾讯 ADP 中停用对应 Final 草稿并恢复此前已导入版本；不要让失败流程回退到 01。
- 本包不包含生产发布、VPS、CloudBase、小程序或 Active Release 操作。

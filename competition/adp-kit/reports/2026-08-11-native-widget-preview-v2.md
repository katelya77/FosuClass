# 2026-08-11 — ADP 原生 Widget 导入预览 V2 修复

## 实机现象

腾讯云 ADP 已成功导入 4+2 六张 `.widget`，但 Widget 列表缩略图与详情预览全部显示同一个 `Campus Task Widget` 占位卡。

## 根因

用户真实导出的 `.widget` 外层包含：

- `version`
- `name`
- `template`
- `jsonSchema`
- `outputJsonPreview`
- `encodedWidget`

上一版生成器虽然正确写入了六张不同的 `encodedWidget`（内部各自有 Template / Schema / Default），但把六个外层 `outputJsonPreview` 都写成同一个占位组件树。ADP 导入后的列表缩略图与当前详情预览直接展示该字段，因此视觉上完全相同。

这不是 CampusTools、Adapter 或 C 方案 UI 设计失败，而是 `.widget` 导入包装层缺少每张卡对应的编译预览快照。

## 修复

新增：

- `widget/native/test-native-import-preview-contract.js`
- `widget/native/patch-native-widget-previews.js`
- `widget/native/native-widget-preview-v2.md`

V2 导入包要求：

1. 六张 `outputJsonPreview` 必须互不相同；
2. 根节点必须是 `Card`；
3. 不得再出现 `Campus Task Widget` / `Untitled widget`；
4. 每张 Preview 至少包含一个 `Button`；
5. Preview 中保留 `sys.chat` Action；
6. `encodedWidget` 内 Template / Schema / Default 不因本修复改变业务含义；
7. 01–04 确定性工作流继续冻结。

V2 Bundle SHA256：

`602335ae6c64031e228c6168f2adb8b0b9c7d7a77f6136c238ccf1d23f72e546`

## 当前 Gate

状态：`ADP_WIDGET_PREVIEW_V2_REIMPORT_PENDING`

先重导入 `小序-课表票据-V2.widget`。只有当 ADP 实机缩略图和详情预览都出现真实课表票据，而不是占位卡，才继续导入另外五张。

Preview 通过后仍不能标记 Runtime PASS。下一步复制 01 为 WidgetPilot，用真实查询结果驱动 Widget，并验证一个 `sys.chat` Action 能 handoff 到 03。

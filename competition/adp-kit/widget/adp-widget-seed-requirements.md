# ADP 原生 Widget Seed 方案（已降级为备用）

> 状态：`SUPERSEDED_BY_CODE_CREATE_PILOT`

原计划要求先在 ADP 手工建立 `00-Widget格式种子-勿用于正式展示`，再解析平台私有导出格式。2026-08-11 重新核对腾讯云智能体开发平台官方文档后，比赛主路线不再依赖该 Seed。

## 为什么不再把 Seed 作为前置条件

腾讯云 ADP 当前已正式支持 **代码创建 Widget**：在 Widget 开发页可直接新建 Widget，并分别编辑 `Template`、`Schema`、`Default`。因此 4 主 + 2 辅 Widget 可以直接以代码合同落地，不必等待未知私有导出格式。

同时，平台仍支持导入 `.widget` 文件，并兼容 OpenAI Widget Builder 导出格式；但在没有经过真实导入验证前，本项目不自行猜测 `.widget` 外层封装。

因此当前优先级调整为：

1. 先用 **代码创建** 完成 `小序-课表票据` Pilot；
2. 在真实 ADP 中验证结构化变量绑定、数组列表、`sys.chat` Action、Widget 节点下发；
3. Pilot 通过后复用同一已验证语法扩展其余 5 张卡；
4. 若后续仍需要跨空间迁移，再从平台真实导入/导出链路获取 `.widget` 证据。

## Seed 何时仍然需要

只有以下情况才回退到 Seed：

- 代码创建编辑器与官方文档行为不一致；
- 数组循环/条件渲染无法按文档及兼容语法工作；
- 必须自动批量导入 `.widget`，但缺少真实外层文件结构；
- 平台复制模板能力无法满足 4+2 复用。

若回退，Seed 名称仍为：

`00-Widget格式种子-勿用于正式展示`

并继续遵守：不接 01–04、不放密钥、不放真实学校/身份、不发布。

## 当前状态

主状态已从：

`ADP_WIDGET_SEED_PENDING`

调整为：

`ADP_WIDGET_CODE_PILOT_READY`

真正的完成标记仍只能在腾讯云 ADP 实测通过后写：

`ADP_WIDGET_NATIVE_PASS`

# 最终控制台人工导出清单（已接收）

> FINAL SUBMISSION 状态：2026-08-28 最新 ADP 应用包、CampusTools 自定义插件包与最终 Widget 导出均已接收。自动封包脚本按扩展名和唯一性校验。

> 安全处理：仅对最新人工导出执行交付净化：清空 3 个私密运行变量默认值，移除旧 `competition-demo-v1/v2` 文本并冻结为 `competition-demo-v3`。Agent、bindings、工作流、CampusTools 语义和 Widget 契约未改动。导入后应在 Console 私密变量中重新配置运行地址与凭据，不得写入前端、文档或 Git。

本目录不放自动生成的替代文件。下列三类原始控制台导出已经齐备：

1. ADP 应用导出 ZIP；
2. CampusTools 自定义插件导出 ZIP；
3. 最终 Widget 导出文件（保留控制台原始扩展名）。

当前 ADP 应用导出文件：`校园智序-小序_v20260827164200_package.zip`。

## 加入前检查

- 确认导出对象对应当前 4 Agent、13 CampusTools、14 bindings 与 competition-demo-v3。
- 确认 Main 没有直接 CampusTools 绑定，协作路径仍为 Main → Child → Main。
- 确认最终 Widget 与本交付包 `program/widget/` 中的结果卡契约一致。
- 不要在文件名、导出说明或截图中加入真实学校、院系、城市、个人身份、真实域名或任何凭据。
- 不要加入历史演示数据、旧 Runtime 导出或控制台临时草稿。

程序目录中的 Widget 是当前源码/配置复现材料；本目录第三项是**控制台原始导出文件**，两者用途不同。三项均通过 ZIP/结构完整性与 SHA-256 检查后才进入正式提交树。

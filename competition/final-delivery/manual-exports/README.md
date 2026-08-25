# 最终控制台人工导出清单（已接收）

> PHASE 3.2 状态：ADP 应用包、CampusTools 自定义插件包与最终 Widget 导出均已由提交人放入本目录。自动封包脚本将按扩展名和唯一性校验，不依赖下面的示例文件名。

> 安全处理：Console 导出的 ADP 应用包曾包含私密运行变量默认值、真实 API 地址及旧品牌/旧数据版本说明。PHASE 3.2 已在不改变 Agent、bindings 与工作流结构的前提下清空私密默认值和地址，并冻结为对外品牌与 competition-demo-v3。导入后必须在 Console 私密变量中重新配置运行地址与凭据。

本目录不放自动生成的替代文件。下列三类原始控制台导出已经齐备：

1. ADP 应用导出 ZIP；
2. CampusTools 自定义插件导出 ZIP；
3. 最终 Widget 导出文件（保留控制台原始扩展名）。

## 加入前检查

- 确认导出对象对应当前 4 Agent、13 CampusTools、14 bindings 与 competition-demo-v3。
- 确认 Main 没有直接 CampusTools 绑定，协作路径仍为 Main → Child → Main。
- 确认最终 Widget 与本交付包 `program/widget/` 中的结果卡契约一致。
- 不要在文件名、导出说明或截图中加入真实学校、院系、城市、个人身份、真实域名或任何凭据。
- 不要加入历史演示数据、旧 Runtime 导出或控制台临时草稿。

程序目录中的 Widget 是当前源码/配置复现材料；本目录第三项是**控制台原始导出文件**，两者用途不同。三项均通过 ZIP/结构完整性与 SHA-256 检查后才进入正式提交树。

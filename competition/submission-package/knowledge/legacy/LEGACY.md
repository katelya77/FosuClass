# Legacy 标记：旧知识库文档

## 状态：legacy（不再作为当前 SSOT）

`knowledge/` 根目录下的历史文档（01-产品能力与使用边界 至 08-功能导航与演示问题，
以及 taxonomy.json）自 Knowledge Base 2.0 起标记为 **legacy**：

- 仅作历史演进证据保留，不再被任何 Agent / 知识检索流程作为当前事实来源。
- 当前唯一 SSOT 为 `knowledge/current/`（10 节 + README + recall-matrix）。

## 遗留原因（不兼容当前约束的示例）
- 含演示数据版本标记（competition-demo-*）与固定匿名实体编号（教师 001 等）；
- 含固定日期与数据哈希，属于动态事实沉淀，违反静态/动态隔离；
- 测试示例被写成生产规则，违反「测试示例不作规则」。

## 回滚与演进
- 版本控制（git）保留全部历史版本，可随时回溯。
- 未来若需要恢复某节内容，必须先清洗到 Knowledge Base 2.0 约束（见 current/README.md
  更新纪律）后进入 current/，禁止直接搬回。
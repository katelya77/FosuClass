# Widget 数据契约说明

`.widget` 是最终人工导出；`Template.tsx.txt`、`Schema.ts.txt` 与 `Default.json` 从该导出的 `encodedWidget` 原样解码。Widget 只投影结构化工具结果，不重新计算事实。

结果至少表达：场景类型、自然语言结论、结构化 payload、`dataVersion`、核验状态与 Evidence 摘要。关键结论只有在验证成功时标记 `verified`；普通对话不堆叠证据卡，无结果、歧义或损坏时给出明确状态并保留文本降级。

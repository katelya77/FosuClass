# 小序结果卡 · Auroraqua Widget 字段

这三份文件分别对应 ADP Widget 编辑器的 **Template / Schema / Default** 字段。

- `Schema.ts.txt` 与导出 Widget 的字段、枚举、严格校验和 `sys.chat` action 完全一致。
- `Template.tsx.txt` 仅调整展示层，并修复导出模板尾部多余 `}` 的语法问题。
- `Default.json` 只匿名化、产品化默认文案，不提供任何课表事实。

使用顺序：依次粘贴三个字段 → 运行编辑器校验 → 保存并发布 Widget → 在 ADP 应用的最终答复节点绑定该 Widget。Agent 应传结构化参数触发 Widget，不应把参数 JSON 当普通 Markdown 输出。

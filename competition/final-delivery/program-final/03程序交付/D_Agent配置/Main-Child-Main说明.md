# Main → Child → Main

1. Main 读取自然语言目标，选择一个专业 Child。
2. Child 从统一 `academic_context` 提取实体、时间范围与约束。
3. Child 调用其 bindings 允许的 CampusTools。
4. Child 把结构化观察返回 Main；Child 之间不直接转发。
5. Main 统一组织结果、Widget 与下一步追问。

Main 直接工具数为 0；专业分工为 Schedule、Risk、Insight。跨域连续追问始终回到 Main 再分配，从而保持同一对象和约束而不扩大工具权限。

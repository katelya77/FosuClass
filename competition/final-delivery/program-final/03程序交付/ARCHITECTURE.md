# Architecture

## 真实拓扑

```text
用户自然语言
    ↓
小序·Main（理解 / 路由 / 汇总；直接工具数 = 0）
    ↕ Main → Child → Main
Schedule / Risk / Insight
    ↕ 14 Child bindings
13 CampusTools（确定性查询 / 计算）
    ↓
结构化结果 → Verified Widget → Evidence / 继续追问
```

## 不变量

- Agent 数量：4。
- Agent-facing CampusTools：13。
- Child bindings：14；`campus_academic_context` 同时绑定 Schedule 与 Risk。
- Child 不互相转发；所有跨领域协作回到 Main。
- 统一 `academic_context` 承接对象、时间范围与约束。
- 统一结果卡表达 verified / degraded / failed；无结果或损坏时不伪造答案。
- 数据版本：`competition-demo-v3`，哈希 `sha1:842b7959e808`。

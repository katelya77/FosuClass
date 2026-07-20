# 小佛助手 Agent 迁移计划

## 已完成

### Phase 1

- 服务端单一在线 Kernel
- Capability Manifest + 客户端兼容生成
- agent.v1 / agent.v2
- Offline Fallback
- 知识库控制面雏形

### Phase 2

- Conversation Principal + Repository
- 三种记忆模式
- Agent UI 执行态
- KB 持久审计 / 并发 / 幂等 / Diff / 来源
- 本地 stdio MCP（草稿）

## 第三阶段建议

```text
混合 RAG
+ 知识摄取流水线
+ 受约束模型 Planner
+ 动态 Tool Loop
+ 可选远程 Streamable HTTP MCP
```

前置条件：Phase 2 的 Principal 隔离、Control Plane 审计与人工发布链路稳定。

# 知识库控制面 V2

## 调用链

```text
HTTP / MCP Adapter
→ Knowledge Control Plane
→ Validation / Version / Audit / Idempotency
→ knowledgeBaseService 持久层
```

后台 `assistant-kb` 写入路径已迁入 Control Plane，避免双写业务逻辑。

## 能力

- 持久 Audit（jsonl）
- revision + contentHash + If-Match / expectedRevision → 409
- Idempotency-Key
- 字段级 Diff（含 scope / source / binding 高风险标记）
- 来源元数据：sourceUrl、authorityLevel 等；无可靠来源不得自动 official

## 高风险动作

`publish` / `rollback` 仍仅后台人工确认，不进 MCP Tools。

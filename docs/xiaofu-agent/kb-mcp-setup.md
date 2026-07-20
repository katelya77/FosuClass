# 知识库 MCP 本地设置

## 位置

```text
tools/fosu-kb-mcp/server.js
```

stdio JSON-RPC MCP Server。**不直接读写知识库 JSON**，只调用受保护后台 API。

## 环境变量

```bash
# 后台地址（本地或内网）
set FOSU_KB_MCP_BASE_URL to http://127.0.0.1:3000

# 作用域受限的 service token（不要写入 Git）
set FOSU_KB_MCP_TOKEN from your secrets manager (placeholder only, never commit)

# 可选
set FOSU_KB_MCP_CLIENT_NAME to fosu-kb-mcp
```

Token 建议 scopes（维护）：

```text
assistant-kb:read
assistant-kb:draft:write
assistant-kb:validate
assistant-kb:audit:read
```

**不要**给普通 MCP token：`assistant-kb:publish` / `assistant-kb:rollback`。

## 启动

```bash
node tools/fosu-kb-mcp/server.js
```

## Codex MCP 配置示例

```json
{
  "mcpServers": {
    "fosu-kb": {
      "command": "node",
      "args": ["tools/fosu-kb-mcp/server.js"],
      "env": {
        "FOSU_KB_MCP_BASE_URL": "http://127.0.0.1:3000",
        "FOSU_KB_MCP_TOKEN": "<from-secrets-manager>"
      }
    }
  }
}
```

Grok Build：同样以 stdio 子进程方式注入上述环境变量即可。

## Resources

```text
fosu-kb://schema
fosu-kb://version
fosu-kb://published
fosu-kb://published/{id}
fosu-kb://drafts
fosu-kb://drafts/{id}
fosu-kb://audit/recent
```

## Tools（仅草稿域）

```text
kb_search
kb_get
kb_create_draft
kb_update_draft
kb_preview_import
kb_validate
kb_diff
kb_delete_draft
```

**未提供**：`kb_publish`、`kb_rollback`、`kb_delete_published`。

## 推荐协作流程

```text
联网搜索整理来源
→ kb_preview_import
→ kb_create_draft
→ kb_validate
→ kb_diff
→ 管理员后台人工发布
```

## 故障排查

| 现象 | 处理 |
| --- | --- |
| MCP_TOKEN_MISSING | 设置 `FOSU_KB_MCP_TOKEN` |
| 401/403 | Token 无效或 scope 不足 |
| 409 REVISION | 带最新 expectedRevision / If-Match |
| 409 IDEMPOTENCY | 同 key 不同 body，换新 key |
| 上游超时 | 检查后台进程与 `FOSU_KB_MCP_BASE_URL` |

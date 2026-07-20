# Hybrid RAG

## 范围

仅用于公开校园知识、办事指引、产品说明、FAQ、地点说明。

**禁止**向量化全校课表、教师索引、空教室或完整个人课表。课表事实继续走结构化 Tool。

## 模块

| 文件 | 职责 |
|------|------|
| `retrieval/knowledgeRetriever.js` | 统一检索入口 |
| `lexicalIndex.js` | BM25 + 中文 N-gram |
| `embeddingAdapter.js` | Provider-neutral；disabled / openai-compatible / local-hash |
| `vectorIndex.js` | 本地文件向量索引，版本化与回滚 |
| `rankFusion.js` | Reciprocal Rank Fusion + authority/freshness |
| `retrievalVerifier.js` | 低置信度拒答 + Prompt Injection 过滤 |
| `ingestionService.js` | 文档分块（contentHash） |

## 退化

Embedding 不可用或 `AI_EMBEDDING_MODE=disabled` 时自动仅用 Lexical + Rule，不影响 public。

## 结果结构

```js
{
  query, rewrittenQuery, hits, confidence,
  citations, noAnswer, reason
}
```

低置信度：明确「暂未找到可靠依据」，不由模型补全事实。

## 环境变量

- `AI_EMBEDDING_MODE`：`disabled` | `openai-compatible` | `local-hash` | `cloudbase`
- `AI_EMBEDDING_BASE_URL` / `AI_EMBEDDING_API_KEY` / `AI_EMBEDDING_MODEL`
- `FOSU_VECTOR_INDEX_DIR`

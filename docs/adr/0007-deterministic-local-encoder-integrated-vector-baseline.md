# ADR-0007: Deterministic Local Encoder as Integrated-Mode Vector Baseline

## Status

Accepted

## Context

P4d 的 RAG 需要"BM25 + 向量"混合检索，但一体化容器没有 pgvector，且 public 模式外部 Provider 调用恒为 0（含 Embedding API）。P3 的记忆语义检索已使用一个本地确定性 encoder（hash 词袋 + CJK bigram）。需要决定一体化模式的向量方案，并防止复制第二份 encoder 实现。

## Decision

1. 一体化 / public 模式的向量通道使用**本地确定性 encoder**：归一化词元 + CJK bigram + 稳定 hash 投影 + 固定维度 + 余弦相似度。相同文本在不同进程、不同机器、arm64/amd64 上产生相同向量。
2. Encoder 权威实现收敛在 `packages/rag-runtime`；`packages/agent-runtime` 的 semanticMemory 与 RAG 共同消费同一实现，禁止复制第二份。
3. Encoder 版本、维度、tokenization 与 hash 算法写入索引 manifest；encoder 版本变化必须触发索引重建。不使用进程随机 hash，不因对象遍历顺序产生漂移。
4. 检索链真实执行：query → 权限/版本过滤 → BM25 候选 → 本地向量候选 → 确定性融合（RRF 或等价低参数）→ 确定性 rerank → 引用。不允许"算了两个分数但永远只用 BM25"。rerank 权重纳入版本化配置。
5. 后台与 evidence 必须显示真实 encoder 类型（如 `deterministic-local-v1`），如实表述为"离线检索基线"，**不得**宣传为神经语义 embedding 等价质量。
6. P5 standalone 模式通过同一接口接入 pgvector 存储与可配置神经 Embedding Provider（仅 trial/dev，显式授权）；只替换存储与 Encoder Adapter，不复制 RAG 业务逻辑。
7. 结构化校园事实（课表、教室、教学周等）继续只走 Tool，RAG 侧以负向测试断言其不进入摄取权威链。

## Consequences

- 一体化模式零外部依赖、离线可摄取/检索/发布/回滚；public 可用；行为确定性可测试。
- 向量质量弱于神经 embedding；golden query set 必须以 lexical-only 为对照如实报告提升幅度，无提升时如实报告。
- P5 接入 pgvector / 神经 Embedding 时接口不变，但索引需按 encoder manifest 重建。

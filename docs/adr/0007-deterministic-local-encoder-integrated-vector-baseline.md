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

## Amendment §8: deterministic-local-v2（P4d，2026-07-31）

P4d golden query 实测暴露 v1 latin 词元三处系统性缺陷：尾随标点胶合
（"appearance." ≠ "appearance"）、连字符复合词胶合（"two-factor" 与
"two factor" 互不可见）、单字符噪声词元（"a"/"I" 参与打分）。按本 ADR §3
的既定机制递增世代为 `deterministic-local-v2`：

1. latin 词元剥离首尾标点；连字符复合词保留整体并追加拆分词元；无数字的
   单字符词元丢弃。CJK run/bigram 与别名表逐位不变。
2. v1 全部黄金值（CJK 与干净 latin 输入）在 v2 下逐位保持，单源测试
   （tools/test-agent-rag-encoder-single-source.js）同时充当 v1→v2 稳定性
   证明；P3 记忆检索行为以 P3 既有套件复核无回归。
3. 新增「无支撑命中抑制」校准策略：64 维 hash 投影碰撞噪声底实测 0.2..0.5，
   与弱真实信号同量级，纯向量余弦不能单独创造命中（命中必须有词元支撑；
   别名扩展的语义匹配带支撑，不受影响）。向量通道经 RRF 名次与 rerank
   权重真实参与排序（golden query 四组对照的 MRR/引用正确率差异证明）。
   该策略随 encoder 世代校准；未来神经 Embedding Adapter 可按新世代放宽。

## Amendment §9: deterministic-local-v3（P4d 审查跟进，2026-07-31）

P4d 独立审查（M-4）确认 v2 的单字符丢弃规则误伤「C区」式楼栋/区域命名：
`tokenizeSemantic("C区")` v1→`["c","区"]`、v2→`["区"]`，"A区" 与 "C区"
在 v2 下词元完全相同，latin 通道失去字母维度。按本 ADR §3 的既定机制
递增世代为 `deterministic-local-v3`：

1. 与 CJK 相邻的单字母词元保留；孤立单字母（"a"/"I"）仍按英语停用词
   噪声丢弃；v2 其余规则（标点剥离、连字符拆分、CJK run/bigram、别名表）
   逐位不变。
2. 既有黄金值（CJK/干净 latin 输入，无 CJK 相邻单字母）在 v3 下继续逐位
   保持；golden query 语料（12 篇通用文档，无 CJK 相邻单字母输入）四模式
   指标与 v2 完全一致（Recall@5 90.9%、hybrid_rerank MRR 84.8%、引用
   81.8%、空答案 100%），v3 不改变既有语料的向量空间。
3. P3 记忆存储同步补齐世代治理（审查 I-3）：存储项带 `encoderVersion`
   标记，读路径对世代不符的旧持久化向量回退现算（不再跨向量空间比较），
   写路径自愈为当前世代——与 RAG 索引的 `RAG_ENCODER_MISMATCH` 硬失败
   策略互补：记忆按条目惰性自愈，索引按版本整体重建。

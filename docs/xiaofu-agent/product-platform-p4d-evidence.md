# P4d Evidence — Versioned Hybrid RAG Runtime

日期：2026-07-31（本地分支 `codex/xiaofu-agent-product-platform`）
范围：tasks.md P4d（packages/rag-runtime 权威实现 + 发布/回滚 + 索引生命周期 + golden query）。

## 1. 交付内容

### 1.1 `packages/rag-runtime`（通用平台包，边界守卫 PASS）

| 模块 | 职责 |
| --- | --- |
| `src/localEncoder.js` | ADR-0007 单源 encoder（**deterministic-local-v3**，见 §3 与 §6）；semanticMemory 与 RAG 共用 |
| `src/textProcessing.js` | 清洗（NFKC/控制字符/零宽）+ 段落感知确定性切块（`docId#cN`，同输入逐位同输出） |
| `src/bm25.js` | BM25（k1=1.5/b=0.75），tokenize 复用 encoder 单源；平分 chunkId 决胜 |
| `src/fusion.js` | RRF(k=60) + 版本化权重确定性 rerank（lexical/vector/title，0..4，随发布物进索引） |
| `src/ingestion.js` | inline 文本 + 受控网页抓取：https 公网校验（拒 userinfo/IP/localhost/尾点混淆）、重定向 ≤3 逐跳再校验、≤512KB、≤10s、fetcher 可注入、HTML 基线剥离器、结构化校园事实 kind 拒绝 |
| `src/ragRuntime.js` | buildIndex（无时间戳全内容 digest，字节级可重建）/ queryIndex 四模式真链 / serialize/parse（digest 不符即 `RAG_INDEX_CORRUPT`）/ encoder 世代检查（不匹配即 `RAG_ENCODER_MISMATCH`） |
| `src/ragPublicationAdapter.js` | Config Kernel 第 6 域：自包含版本化 KB 发布物（1..200 文档、inline ≤20k、uri https 公网、字段白名单、密钥字段名+凭据形态文本双扫描）；test() 为离线构建演习（不触网，uri 文档留待发布后异步构建验证）；种子 = 内置只读示例 KB `platform-example` |

### 1.2 服务端接线

- `server/src/services/ai/ragIndexService.js`：索引 blob 持久化（`rag-indexes/<env>/<kbId>/v<N>.json` + `lkg.json`）+ 受控构建队列（integrated 模式最小 worker：稳定 jobId `rag:<env>:<kbId>:v<N>`、队列文件持久化、进程内异步顺序执行不阻塞在线 Run、崩溃 reclaim、≤3 次重试、幂等跳过已校验索引；P5b 换 Redis Streams 时业务语义不变）。lkg 只回退**更旧**的已验证版本——rollback 语义不被 lkg 破坏；双失败 fail closed。
- `platformComposition.js`：rag 注册为第 6 域（种子/校验/发布/回滚/审计复用内核）；`resolveRagArtifactForSnapshot`（同其他域的记忆化 + fail-closed 不变量）触发索引异步构建钩子；`queryRagForSnapshot` 为生产查询路径（快照钉版本 → 索引服务 → 四模式查询链）。
- 草稿不可见性：索引只从「已发布且被快照钉住」的版本构建，draft 永远没有索引文件（测试锁定）。

### 1.3 与既有 `server/src/services/ai/retrieval/` 的边界（重要）

勘察发现 server 侧**已存在**一套 hybrid 检索栈（`retrieval/` 七件套：BM25/向量文件索引/RRF/verifier/ingestion，约 870 行），服务校园助手知识库（knowledge-docs.json，Fosu 业务内容治理），经 `toolRegistry.ragSearch` 接线。P4d **不重写、不迁移**该路径（既有行为有全套门禁锁定，迁移风险大于收益）：

- `retrieval/` = 校园助手业务检索（Fosu 插件域），数据权威源是 knowledgeBaseService 的 draft/published/backups；
- `packages/rag-runtime` = 通用平台版本化 KB 引擎，内容权威源是 Config Kernel 的不可变版本文档，索引是确定性派生物；
- 两者数据集、schema、发布治理完全不同，无共享可变状态、无同数据双写——**不构成第二事实源**。后续 fosu-campus 插件适配器可将校园 KB 内容经 rag-runtime 暴露为版本化 KB（P4e+ 评估），届时仍保持单内容源 + 派生索引。
- 范围外发现（如实记录，不在 P4d 修复）：`retrieval/knowledgeRetriever.js:35` 探测的 `knowledgeBaseService.listPublishedDocuments` 函数不存在，静默 fall-through——疑似死代码/未完接线，建议后续单独评估。

## 2. Golden query 对照（实测，13 查询 × 12 通用文档，Recall@5）

| 模式 | Recall@5 | MRR | 首位引用正确率 | 空答案正确率 |
| --- | --- | --- | --- | --- |
| lexical | 90.9% | 79.5% | 72.7% | 100% |
| vector | 90.9% | 75.8% | 63.6% | 100% |
| hybrid | 90.9% | 80.3% | 72.7% | 100% |
| hybrid_rerank | 90.9% | **84.8%** | **81.8%** | 100% |

- 如实结论：四模式 Recall@5 相同（该语料下相关文档均可达 top5）；**rerank 真实改善排序质量**（MRR +5.3pp、首位引用 +9.1pp，非假混合）；vector-only 弱于 lexical（本地基线的诚实画像）。未命中的 q9（"work without internet connection" → offline-mode）是零词元重叠查询，本地 encoder 无法桥接——如实报告，不挑选顺风语料。
- 断言只锁定必须为真的不变量：四模式确定性、空答案 100%、引用形态、直达查询 top-1、硬查询 topK 内；提升方向不断言。

## 3. Encoder 世代治理（ADR-0007 §8 v1→v2、§9 v2→v3）

golden query 首轮实测（v1）暴露 latin 词元三处系统性缺陷：尾随标点胶合、连字符复合词胶合、单字符噪声词元——11 组相关查询中 4 组在部分模式丢失 top-1。按 ADR-0007 §3 既定机制递增世代：

- v2：latin 剥首尾标点 + 连字符追加拆分词元 + 丢弃无数字单字符词元；**CJK run/bigram 与别名表逐位不变**。
- v1 全部黄金值（CJK 与干净 latin 输入）在 v2 下逐位保持（单源测试充当 v1→v2 稳定性证明）；P3 记忆套件（store-reliability / autonomy 28 例 / conversation-memory / phase2 / foundation 42）复核无回归。
- 「无支撑命中抑制」校准策略：64 维 hash 投影碰撞噪声底实测 0.2..0.5（v2 下最高测得 0.5000），与弱真实信号同量级 → 纯向量余弦不能单独创造命中，命中必须有词元支撑（别名扩展的语义匹配带支撑，不受影响）。向量通道经 RRF 名次与 rerank 权重真实参与排序（§2 表证明）。策略随 encoder 世代校准；P5 神经 Embedding Adapter 可按新世代放宽。
- v2 后 golden query 达到 §2 表水平（四模式 Recall@5 90.9%）。

## 4. 验收对照（tasks.md P4d）

- [x] `packages/rag-runtime` 权威实现：文件/受控网页摄取（SSRF 防护）/解析/清洗/分块/BM25/deterministic local encoder（ADR-0007）/融合/确定性 rerank/引用/版本发布回滚 — §1.1。
- [x] Encoder 单源抽取，semanticMemory 与 RAG 共用；对照测试证明 P3 记忆检索不回归 — §3（单源测试 + P3 套件复核）。
- [x] 草稿索引对生产查询不可见（索引只从已发布钉住版本构建，测试锁定）；publish pointer 原子切换（内核指针，P4a 已证 + 组合闭环复证）；rollback 只切已验证版本（lkg 只回退更旧已验证版本）；重启恢复（队列 reclaim + done 索引校验重建测试）；索引构建进受控队列不阻塞在线 Run（异步构建 + lkg 降级）。
- [x] golden query set 四组对照 Recall@K/MRR/引用正确率/空答案正确率，提升幅度如实报告 — §2。
- [x] 结构化校园事实继续走 Tool：适配器 forbidden kind 全矩阵拒绝 + 摄取层二次拒绝（双防线负向锁定）。
- [x] 提交：`feat(agent): add versioned hybrid RAG runtime`（门禁结果见 §5）。

## 5. 测试证据

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| 六域 conformance | `npm run test:domain-adapter-conformance` | PASS（6 域 × 同一契约） |
| Encoder 单源 | `npm run test:agent-rag-encoder-single-source` | PASS（v1→v3 稳定性 + v2/v3 行为锁定） |
| Runtime 专项 | `npm run test:agent-rag-runtime` | PASS（确定性/摄取矩阵/四模式/digest/encoder 失败/队列生命周期 + §6 全部回归） |
| 发布组合闭环 | `npm run test:agent-rag-publication` | PASS（校验矩阵 + 发布→构建→真实查询→在途稳定→草稿不可见→rollback + 深冻结/凭据矩阵） |
| Golden queries | `npm run test:agent-rag-golden-queries` | PASS（§2 对照表，v3 下逐位一致） |
| 聚合 | `npm run test:agent-platform-p4d` | PASS（上述 5 件） |
| 边界守卫 | `node tools/test-agent-generic-package-boundaries.js` | PASS |
| P3 记忆复核 | memory-store-reliability（含 I-3 世代标记回归）/ memory-autonomy / conversation-memory / personal-memory / long-term-memory / scenarios-60 / concurrency / api-v2 / content-policy / 100-turn-runtime / provider-boundary | PASS（encoder v3 + 世代治理下无回归） |

提交前全量门禁（本机，Node v24，Windows）：

- `npm run test:agent-regression`：162/162 PASS
- `npm run test:agent-final-convergence` / `test:agent-phase2` / `test:agent-phase3` / `test:ai-competition`：PASS
- `npm run test:agent-release-gate`：**20/20 OK**（含新增 `test:agent-platform-p4d` 步）
- `git diff --check`：OK；`npm run test:no-ai-secret-committed`：PASS

## 6. 审查跟进（独立复审 → 跟进修复）

P4d 提交后经独立只读复审（explore 子代理，逐行审阅 + 实测复现，结论：**无 Critical**，
Important 5 项 + Minor 8 项；铁律全部守住，测试与证据诚实）。全部发现已在跟进提交
`fix(agent): close P4d review findings` 中关闭：

| # | 级别 | 发现 | 修复 |
| --- | --- | --- | --- |
| I-1 | Important | rollback 到「构建失败过的版本」后查询永久不可用且无自愈（re-pin 命中 failed 任务不重建；lkg 越过失败版本拒绝服务更新版本——后者本身正确） | ① `loadIndex` 增加扫描兜底：`source:"scan"` 服务「< 钉住版本的最大可读索引」（lkg 单指针之外的持久化真相兜底，永不服务更新版本的不变量保持）；② `requestBuild` 对 failed 任务「re-pin 即重试」自动重排队（60s 冷却防抖，attempts 有界，测试注入 0）；回归：v1 建成→v2 失败×3→v3 建成→回钉 v2 → 扫描兜底服务 v1（servedVersion≤2，永不服务 v3）→ 恢复后自动重建服务 v2 |
| I-2 | Important | 抓取超时只覆盖到响应头，慢滴 body 可永久卡死进程内顺序构建队列 | AbortController 提升到 `fetchDocumentText` 层，单跳总时限贯穿响应头 + body 读取；超时统一归类 coded `RAG_INGEST_TIMEOUT`（AbortError 无 code 问题同解）；回归：15ms 慢滴流在 120ms 时限内 prompt 失败且可分类。边界如实说明：完全挂死（永不 resolve）的 body 只在 fetcher 尊重 signal 时可打断（默认 undici 生效） |
| I-3 | Important | P3 记忆持久化 featureVector 无 encoder 世代标记，v1→v2 后旧向量与新查询向量跨空间比较（检索质量静默退化，不损坏数据） | 存储项带 `encoderVersion`（normalizeStoredItem/Episode + 五处写路径）；读路径世代不符回退现算（`generationAwareStoredVector` → semanticScores 第三参 null）；写路径自愈；回归：全零旧向量 + 无标记 → 读路径现算值精确命中（零向量判别），确认写入后标记/向量恢复。与 RAG 索引策略互补：记忆按条目惰性自愈，索引按版本整体重建 |
| I-4 | Important | 凭据形态值扫描只覆盖 `text`，`title`/`tags`/`uri` 全漏（凭据可经这三路进不可变发布物与审计/导出链） | title/每个 tag/uri 原始串同扫 `SECRET_VALUE_PATTERN`；uri 顺带改超长拒绝（见 M-8）；三用例入发布校验拒绝矩阵 |
| I-5 | Important | `kick()` 异步链上 `persistQueue()` 抛出 → 未处理 Promise 拒绝 → 进程崩溃（RAG 磁盘故障可击落整个 agent server） | `persistQueue` 内含 try/catch 记安全日志（只降级崩溃后恢复排队的持久性，索引是可重建派生物）；`kick()` 回调加 catch backstop；回归：root 被替换为普通文件后 requestBuild 不抛、attempts≤3 有界失败、无 unhandledRejection |
| M-1 | Minor | `resolveRuntime` 浅冻结，缓存共享的运行时可被嵌套变异污染 | 改深冻结（与 tool-runtime 同风格递归 freeze）；回归锁定嵌套 push 无效 |
| M-2 | Minor | 冷启动首次查询对同一索引文件做两次全文件同步读 + digest | 版本索引不可变且 digest 自校验 → 30s TTL 记忆化（上限 64 条；staleness 窗口内服务的仍是已验证内容；测试可注入 0 关闭） |
| M-3 | Minor | 查询 options 可把 minScore 降到发布值以下、topK 提到发布值以上（削弱已发布空答案门控；P4e 接线前必须修） | `queryIndex` 改 clamp：topK=min(发布,请求)、minScore=max(发布,请求)；mode/weights 仍为排序旋钮可覆盖（weights 有界）；回归锁定三方向 |
| M-4 | Minor | v2 丢弃无数字单字符 latin 词元，「C区」式楼栋名失去字母维度（"A区"="C区"） | ADR-0007 §9 修正案递增 v3：CJK 相邻单字母保留，孤立单字母仍丢弃；既有黄金值与 golden query 四模式指标在 v3 下逐位一致（§2 表不变）；记忆侧由 I-3 世代治理惰性自愈，RAG 索引无生产存量（P4e 前） |
| M-5 | Minor | `readBoundedBody` 无 body 分支按字符数限长，CJK 低估约 3 倍字节量 | 改 `Buffer.byteLength(text, "utf8")` 比较 |
| M-6 | Minor | 多实例同 root 队列文件 last-writer-wins | 文件头显式写部署约束「同一 root 不允许多实例运行；standalone 由 P5b Redis Streams 解决」 |
| M-7 | Minor | done 任务进程内不复查索引可读性（外删后需重启 reclaim 才自愈） | `requestBuild` 命中 done 任务时复查，不可读即重排队（与 reclaim 同语义）；回归锁定进程内与构造期两条路径 |
| M-8 | Minor | 死代码行 / AbortError 无 code / uri 超长静默截断 / 未闭合 script / reclaim 子路径未覆盖 | 死代码删除；超时统一 coded（随 I-2）；uri >500 拒绝（随 I-4）；`htmlToText` 未闭合 `<script>` 会把脚本源码当正文摄入——仅内容污染无执行面，记入本节边界不修复；reclaim「done 且索引被删」子路径测试补齐 |

复审确认无误后保留的既有判断：SSRF 校验经 WHATWG 归一化无绕过（十进制/十六进制/
八进制/短写/IPv6 实测均拒）；lkg「只回退更旧」逻辑本身正确；digest 覆盖完整；
rerank 候选池截断实际窗口极小；种子/组合闭环测试为真实行为锁定。

## 7. 边界与未覆盖

- Run 内的通用 RAG 工具接线（让 Skill 经五因子调用平台 KB）与后台可视化管理属 P4e+；本阶段生产查询路径由 `queryRagForSnapshot` 承载并经契约测试锁定。
- URL 校验不做 DNS 解析后 IP 归属检查（DNS rebinding 到内网不在一体化模式防护范围）；standalone 部署可在出口代理层补。
- 网页抓取的 HTML 剥离是确定性基线（无 cheerio/readability 依赖）；不做正文可读性排序。
- 索引保留全部历史版本（派生物可重建，无保留策略）； standalone 模式可加生命周期策略。
- P5：pgvector 存储与神经 Embedding Adapter（仅 trial/dev 显式授权）经同一接口接入，索引按 encoder manifest 重建。

# 小佛助手 · 能力真实性审计矩阵

> 审计基线：`79c93a63`（`feat/xiaofu-agent-final-convergence`）  
> 审计原则：**模块文件存在 ≠ Wired / Observed**。只有生产调用路径真实执行才标 Wired。  
> 本文件随收敛过程更新；修复后重新核对。

## 图例

| 标记 | 含义 |
|------|------|
| Declared | 有代码或文档声明 |
| Wired | 进入生产调用路径（agentService → kernel → 真实模块） |
| Exercised | 自动化测试真实执行该路径 |
| Observed | 在运行日志 / Trace / 开发者工具 / 真实 API 中观察到 |
| Production-safe | 符合正式版（public）安全与零模型要求 |

状态：`Y` = 是 · `P` = 部分 · `N` = 否 · `—` = 不适用

---

## 审计表（收敛后 · 2026-07-21）

| # | 能力 | Declared | Wired | Exercised | Observed | Production-safe | 状态说明 |
|---|------|----------|-------|-----------|----------|-----------------|----------|
| 1 | Deterministic Planner | Y | Y | Y | Y | Y | public 主路径；fallback 可靠 |
| 2 | Model Planner | Y | **Y** | Y | **Y** | Y | `PlannerModelAdapter` 注入；真实 DeepSeek `plannerType=model` / `planner.started→completed` |
| 3 | Observation Loop | Y | Y | Y | Y | Y | Kernel 默认 loop；Replan≤1 |
| 4 | Replan | Y | Y | Y | Y | Y | 多步空结果可 replan 一次 |
| 5 | Clarification | Y | Y | Y | Y | Y | 缺 slot 结构化追问 |
| 6 | Hybrid RAG | Y | **Y** | Y | Y | Y | `rag_search` → `KnowledgeRetriever`（rule+BM25+optional vector） |
| 7 | Embedding | Y | Y | Y | P | Y | Schema 完整；默认 disabled；local-hash/mock 可测 `vectorUsed` |
| 8 | Vector Index | Y | Y | Y | P | Y | 版本/原子写/回滚；经 Retriever 接入；不向量化课表 |
| 9 | Query Rewrite | Y | Y | Y | Y | Y | 确定性同义（含隐私问法） |
| 10 | Response Composer | Y | **Y** | Y | Y | Y | presentationMode/taskTrajectory 进入协议与小程序 |
| 11 | Run Event | Y | Y | Y | Y | Y | 含 planner.* / plan.*；无虚假 Thinking |
| 12 | 记忆 Upsert | Y | Y | Y | Y | Y | 首次 cloud_sync Upsert |
| 13 | cloud_sync | Y | Y | Y | Y | Y | 显式开启；无 Session 不假成功 |
| 14 | Coze Provider | Y | P | P | N | Y | 链中可选；缺企业 Token 时跳过 |
| 15 | DeepSeek Provider | Y | Y | Y | **Y** | Y | Planner + Response 均实测 |
| 16 | Provider Chain | Y | Y | Y | Y | Y | 熔断/回退 |
| 17 | 一般学习问答 | Y | Y | P | P | Y | trial/dev + 开关；public 拒绝 |
| 18 | 多步骤校园任务 | Y | Y | Y | **Y** | Y | 自习+天气真实多 Tool |
| 19 | UI 思考过程 | Y | **Y** | Y | P | Y | 可解释轨迹（理解/计划/执行/核验）；微信工具视觉待人工截图 |
| 20 | Evidence | Y | Y | Y | Y | Y | 事实任务折叠来源；plain 隐藏 |
| 21 | Feedback | Y | Y | Y | Y | Y | 紧凑 👍👎 |
| 22 | 会话恢复 | Y | Y | Y | Y | Y | 列表+记忆 API |
| 23 | public 零模型调用 | Y | Y | Y | Y | Y | Planner 在 public 禁止；Provider mock |
| 24 | 小程序包体门禁 | Y | Y | Y | Y | Y | **主包 1.49MB 通过**（`packageXiaofu` + `packageMaps` 分包；门禁改计主包，阈值仍 2MB） |

---

## 虚接能力明细（收敛前）

### V1. Model Planner 未注入

- **证据**：`agentService.js` 调用 `agentKernel.execute({...})` **未传** `modelGenerate`；`modelPlanner.js` 在 `typeof input.modelGenerate !== "function"` 时直接 `deterministic_fallback`。
- **修复**：`plannerModelAdapter.js` + Service 显式注入；Trace 出现 `plannerType=model`。
- **证明**：单元测试 mock generate → `plannerType=model`；失败 → `deterministic_fallback` 且 Tool 仍完成。

### V2. Hybrid RAG Tool 旁路

- **证据**：`toolRegistry.ragSearch` 手写 Rule+BM25，`vectorUsed` 永不出现；`KnowledgeRetriever.retrieve()` 未被 Tool 调用。
- **修复**：`rag_search` → `retrieveKnowledge()`；异步 Tool 已由 `executeToolAsync` 支持。
- **证明**：local-hash / mock embedding 下 `vectorUsed=true`；disabled 时 `lexicalFallback`。

### V3. Context Engineering 缺失

- **证据**：无 ContextAssembler / Budget；Planner prompt 与 Composer 上下文各自散落。
- **修复**：新增 `context/*` 分层组装与 Token 预算字段。

### V4. UI 可解释轨迹不完整

- **证据**：有 `runCompactText` / steps，但缺「理解 / 计划 / 执行 / 核验」结构化展开；快捷任务聊天后仍占位。
- **修复**：Composer 输出 `taskTrajectory`；小程序折叠交互与 plain 抑制。

### V5. Planner / Response 指标未分离

- **证据**：metrics 仅 latency/toolCount；无 `plannerProvider` / `responseLatency`。
- **修复**：metrics 扩展诊断字段（不暴露密钥）。

---

## 收敛后验收锚点

1. trial/dev Trace：`plannerType=model`（有 Provider 时）或明确 `deterministic_fallback`（失败时任务仍完成）
2. public：`plannerType=deterministic`，外部 Provider 调用次数 = 0
3. `rag_search` 结果含 `hybrid:true` 与 `vectorUsed` 布尔
4. 小程序 plain 对话无 Generic Card / Evidence / 完整 Run 卡
5. 包体门禁：主包超限须有基线说明与治理动作，不得静默放宽

---

## 修订记录

| 日期 | SHA | 说明 |
|------|-----|------|
| 2026-07-21 | 79c93a63 | 初始真实性审计（收敛前） |
| 2026-07-21 | （本收敛提交） | Model Planner / Hybrid RAG / Context / Presentation 真实接线；本地 HTTP E2E 观察 planner.started→model |

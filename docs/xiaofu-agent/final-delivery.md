# 小佛助手 Agent V2 Final Convergence — 最终交付报告（RC）

## 1. Capability Truth Matrix

完整表见 [`capability-truth-matrix.md`](./capability-truth-matrix.md)。

收敛后核心结论：

| 虚接项（收敛前） | 收敛后 |
|------------------|--------|
| Model Planner 未注入 | **Wired + Observed**（DeepSeek Planner，`planner.started/completed`，`plan.created plannerType=model`） |
| rag_search 旁路 Vector | **Wired**（统一 `KnowledgeRetriever`；可 `vectorUsed` / lexical fallback） |
| Presentation 协议被剥离 | **Wired**（`presentationMode` / `taskTrajectory` / `runSummary` 进入 buildResponse + v2） |
| 思考 UI 无任务轨迹 | **Wired**（理解/计划/执行/核验展开；plain 无 Run 卡） |
| Context 无预算 | **Wired**（ContextAssembler / Budget / Tool 描述） |

## 2. 发现的虚接能力与修复

### 2.1 Model Planner

- **问题**：`modelPlanner` 依赖 `input.modelGenerate`，`agentService` 未注入 → 永远 `deterministic_fallback`。
- **修复**：`server/src/services/ai/planner/plannerModelAdapter.js` + Service 注入 `createModelGenerate`。
- **证明**：
  - `tools/test-planner-model-adapter.js`：mock generate → `plannerType=model`；失败 → fallback。
  - 真实 HTTP（本机 `agentService.chat` trial）：
    - `planner.started` → `planner.completed` → `plan.created { plannerType: "model" }`
    - `metrics.plannerProvider=deepseek`，`plannerLatency≈10s`
    - Tools：`get_tomorrow_courses` / `search_empty_rooms` / `get_campus_weather` / `search_campus_place`（模型选择，非手写固定）
  - public：禁止 model planner。

### 2.2 Hybrid RAG

- **问题**：`toolRegistry.ragSearch` 手写 Rule+BM25，从不调用 `KnowledgeRetriever`。
- **修复**：`rag_search` async → `retrieveKnowledge()`；保留 rule+BM25+optional vector+RRF+verifier。
- **证明**：`test-hybrid-rag`（vector local-hash、rewrite 隐私同义、tool 路由源码断言、embedding schema）。

### 2.3 Response / UI 协议

- **问题**：Composer 返回了 presentation，但 `buildResponse` / `buildV2Response` 未透传；小程序拿不到 `presentationMode`。
- **修复**：协议层透传 presentation 字段；小程序 `makeMessage` 携带 trajectory；聊天后收起快捷任务。
- **证明**：`agentService.chat('你好')` → `presentationMode=plain`，无 trajectory；教学周 → `single_card` + trajectory。

## 3. 最终真实架构

```
User
 → Context Assembler（Planner / Response 分预算）
 → Runtime Policy（public / trial / dev）
 → Planner（public: deterministic | trial/dev: Model Planner → fallback deterministic）
 → Tool（async，含 rag_search → KnowledgeRetriever）
 → Observation → Verify / Replan(≤1)
 → Retrieval（公开知识 only）
 → Response Composer（plain / single / multi / clarification / recovery）
 → Presentation Protocol（agent.v1 兼容 + v2 展示字段）
 → Mini-program UI（One Answer, One Focus + 可解释轨迹）
```

## 4. Planner 证据

| 项 | 证据 |
|----|------|
| 真实 Planner 请求 | trial 多步自习任务触发 `planner.started`，DeepSeek chat/completions JSON plan |
| Planner Type | `model`（成功）/ `deterministic_fallback`（失败）/ public `deterministic` |
| Tool Plan | 明日课表 + 空教室 + 天气 + 地点 |
| Fallback | Provider 故障不影响事实 Tool 完成 |
| 延迟 | metrics.plannerLatency / responseLatency 分离 |
| public 零调用 | `PLANNER_PUBLIC_FORBIDDEN`；不注入 modelGenerate |

## 5. RAG 证据

| 项 | 状态 |
|----|------|
| BM25 / Lexical | Wired + Exercised |
| Vector | local-hash / optional OpenAI-compatible；`vectorUsed` 字段 |
| RRF | `rankFusion` |
| Confidence / Citation | verifier + citations |
| Fallback | embedding disabled → lexicalFallback |
| Index Version | VectorIndex version / rollback / atomic write |
| 不向量化课表 | 仅 published knowledge chunks |

## 6. UI 证据

| 项 | 状态 |
|----|------|
| 顶部压缩 | `xiaofu-header-compact`，无页内大号标题 |
| 快捷任务 | 空状态展示；有消息后默认收起，可「快捷」展开 |
| 思考轨迹 | `task-trajectory`：理解/计划/执行/核验；收起为一行 compact |
| 普通对话 | plain：无 Generic Card / Evidence / 完整 Run |
| 单事实 | ≤1 主卡 + 折叠来源 |
| 复合任务 | ≤2 主卡 + 轨迹 |
| Composer | 发送/停止（sending 切换） |
| 微信开发者工具视觉 | **本环境未执行截图**；已静态 UI 测试 + 人工复测清单 |

## 7. 内容精简指标（自动化断言）

| 指标 | 目标 | 实现 |
|------|------|------|
| Average Visible Block Count | 低 | plain 仅正文+≤2 建议 |
| Average Card Count | ≤2 | Composer maxCards |
| Suggestion Count | ≤2 窄屏 / ≤3 | Composer + 客户端 slice(0,2) |
| Duplicate Information Rate | 低 | answerAvoidsCardDuplication + 去 generic |
| Ordinary Chat Run Detail Rate | ~0 | plain 无 runSummary/trajectory |

## 8. 上下文工程

| 模块 | 路径 |
|------|------|
| ContextAssembler | `server/src/services/ai/context/` |
| Budget | Planner ~1800 tok est / Response ~3500 |
| Compression | history / tools / observations 截断 |
| Tool Context | `toolContextBuilder` 含 when / whenNot / returns / source |
| Retrieval Context | 仅公开知识 chunk |

## 9. 测试证据

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run test:agent-final-convergence` | **all passed**（10 子测试） | 含 planner adapter / context / hybrid / UI |
| `npm run test:agent-foundation` | **17/17** | |
| `npm run test:agent-regression` | **90/90** | |
| `npm run test:agent-phase2` | **8/8** | |
| `npm run test:agent-phase3` | **all passed** | |
| `npm run test:ai-competition` | 包体 hygiene **失败** | 见下 |
| 本机 `agentService.chat` trial 多步 | **Observed model planner** | DeepSeek 真调用 |

### 改动前已存在

- **包体门禁**：`origin/main` miniprogram 源码约 **2.108MB** 已超 2MB；本分支约 **2.126MB**。**未放宽门禁**。完整治理需地图资源/分包专项，不在本 Agent 接线范围内强行塞过。
- **微信开发者工具视觉验收**：当前 CLI 环境无微信开发者工具自动化；需人工打开 `miniprogram/pages/ai-assistant` 复测。
- **Coze 企业 Token Live**：无真实 Token，未对生产凭据执行。

## 10. 包体

| 项 | 值 |
|----|-----|
| main 基线 | ~2,112,631 bytes |
| 本分支 | ~2,126,041 bytes |
| 门禁 | ≤2MB：**未通过（基线已超）** |
| 主包增长主因 | AI 页 WXML/JS/WXSS 轨迹与快捷任务逻辑（KB 级）；地图 JPG 仍为最大头 |

## 11. Git

| 项 | 值 |
|----|-----|
| 基线 | `79c93a63` / 相对 `origin/main` `dbc713aa` |
| 分支 | `feat/xiaofu-agent-final-convergence` |
| PR | #22 |
| 是否合并 main | **否** |
| 是否部署生产 | **否** |

## 12. 剩余事项（仅允许项）

- 缺少用户尚未提供的真实 Coze 企业 Token（Live）
- 微信开发者工具人工视觉截图验收
- 主包 2MB 基线超限的资源/分包专项治理（非 Agent 内核）
- 后续新增校园 Tool / 知识文档
- 非阻塞视觉微调

**不得再列为“以后再做”的核心项（本轮已接线）：**

- Model Planner 接线  
- Vector / Hybrid RAG 接线  
- Response Composer → 小程序展示接线  
- 可解释任务轨迹 UI  
- 真实 Planner E2E（DeepSeek）  
- Context 预算与 Tool 描述  

**不再建议 Phase 5 / Phase 6 核心重构。**

## 13. 回滚

```bash
git checkout main
# 或
git revert <convergence-commit-range>
```

不部署生产；仅功能分支可推送。

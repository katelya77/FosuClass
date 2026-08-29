# R49-MA — Multi-Agent Architecture Migration

> 「校园智序 · 小序」腾讯云智能 ADP 赛事项目 — R47.7 Golden Baseline → Multi-Agent 迁移
>
> 分支：`feat/campusflow-adp-integration` · PR #49 OPEN/UNMERGED · 本目录纯设计/契约/测试资产，不发布、不 merge、不触碰生产。

## 0. 一句话定位

从「单工作流 Golden Baseline（R47.7）」迁移到「一核三域 · 确定性工具底座」的 Multi-Agent 架构：
**小序 · 主协调**（核） + **课程空间 / 风险规划 / 校园洞察**（三域），全部动态校园事实只由底层 **CampusTools → competition-demo-v2** 确定性输出。

```
                    ┌─────────────────────────────┐
                    │    小序 · 主协调 (Main)      │
                    │  NEW_TASK/FOLLOW_UP/CHAT/    │
                    │  META/CLARIFY 判定 + 路由     │
                    └──────────┬──────────────────┘
              ┌────────────────┼─────────────────┐
              ▼                ▼                 ▼
       ┌────────────┐   ┌────────────┐   ┌────────────┐
       │ 课程空间     │   │ 风险规划     │   │ 校园洞察     │
       │ Schedule    │   │ Risk        │   │ Insight    │
       └────────────┘   └────────────┘   └────────────┘
              │                │                 │
              └──── 回主协调(Main) ──┬──────────┘
                                    ▼
                        ┌──────────────────────┐
                        │  CampusTools (7 tools)│
                        │  → competition-demo-v2│
                        └──────────────────────┘
```

## 1. 关键决策（R49-MA 核心不变量）

| 主题 | 决策 |
|---|---|
| 协同方式 | 第一阶段中心化：`Main → Child` 与 `Child → Main`，**禁止子 Agent 互相横向自由转交** |
| 每个新 Turn | 重新由主 Agent 接管（腾讯平台对话流转策略），从机制上规避 stale context 污染 |
| 动态事实 | 只能来自 CampusTools（确定性）；任何生成式模型不得补造课表/空教室/风险/负载 |
| 静态知识 | 产品介绍/功能导航/教学周规则/安全合规/数据口径/工具失败说明 → KnowledgeRetrievalAnswer |
| 普通聊天 | 主协调直接回复，不得无意义调用 CampusTools |
| R47.7 | 定义为 **Golden Baseline / Regression Baseline / Emergency Fallback**，不删除、不覆盖、不退役 |
| 工具层 | 5 个 Agent Tool 从稳定 CampusTools 抽象；**不**把 entity/date resolver 等内部能力暴露成 Agent Tool |
| self-risk | `campus_risk_check` 的 `second` 对象 **optional**；`mode=self` 时绝不要求第二对象 |
| Widget | 本轮 `Tool Direct Output = OFF`，先文本全链验证；复用 r48-v3 为 Widget V3 baseline |

## 2. 目录导航

| 文件 | 内容 |
|---|---|
| `01-ARCHITECTURE.md` | 总体架构、Agent 拓扑、数据流、与 R47.7 的关系 |
| `02-AGENT-RESPONSIBILITY-MATRIX.md` | 四个 Agent 职责矩阵（处理/不处理/禁止） |
| `03-HANDOFF-POLICY.md` | 转交契约、状态信封、NEED_CLARIFICATION 协议 |
| `04-CONTEXT-POLICY.md` | 数据优先级、Relevant Context Selection、stale escape、代词解析 |
| `05-TOOL-CONTRACTS.md` | 5 个 Agent Tool 的契约、映射、状态机、fail-closed 规则 |
| `06-ADP-MANUAL-CONFIG-CHECKLIST.md` | 腾讯后台逐字段配置清单（= `R49-MA-ADP-MANUAL-CONFIG-CHECKLIST.md`） |
| `07-MODEL-AB-PLAN.md` | 模型 A/B（单变量、13 case 门槛） |
| `08-WIDGET-OUTPUT-POLICY.md` | 三类 Widget 输出策略 + Hero Widget 规范 |
| `09-MULTI-AGENT-E2E-MATRIX.md` | Multi-Agent 硬回归矩阵（A~H + 13 case + R48 A~G） |
| `10-MIGRATION-RISK-REGISTER.md` | 迁移风险登记与缓解 |
| `11-R47.7-BASELINE-AND-ROLLBACK.md` | Golden Baseline 存档、回滚、Emergency Fallback |
| `agents/` | 四个 Agent 的 Prompt 与高级设置（人机可读） |
| `tools/` | 5 个 Agent Tool 的 schema、examples、openapi、adapter 实现 |
| `tests/` | 自动验证测试（node --test）+ fixtures |
| `reports/` | 本轮实施报告 + ADP 人工操作交接 |

## 3. 五个 Agent Tool（从 CampusTools 抽象）

| Agent Tool | 底层 CampusTools | 归属 Domain Agent |
|---|---|---|
| `campus_schedule_query` | `query_schedule` (+ `resolve_entity`/`get_academic_context`) | 课程空间 |
| `campus_classroom_search` | `find_available_classrooms` | 课程空间 |
| `campus_risk_check` | `compare_schedules`（self/compare 两态） | 风险规划 |
| `campus_day_plan` | `generate_day_plan` | 风险规划 |
| `campus_overview` | `get_campus_teaching_overview` | 校园洞察 |

## 4. 快速开始（本地验证）

```bash
cd competition/adp-kit/r49-ma
npm test          # 运行 r49-ma 全部自动测试（不依赖真实腾讯平台）
```

## 5. 硬约束速记

- PR #49 保持 OPEN/UNMERGED；可 commit + push 到 `feat/campusflow-adp-integration`，不 merge。
- 不发布正式 ADP；不修改 production 数据源与生产课表逻辑。
- 不猜测 WidgetID / WorkflowID / AgentID / PluginID；没有真实导出物时 FAIL CLOSED。
- 不为了 Multi-Agent 炫技降低校园事实准确率。

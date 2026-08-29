# R49 05 — 模型 A/B 计划（Model A/B Plan）

> 阶段：R49 设计/审计阶段 — DESIGN DRAFT
> 触发事件：Generation 模型 youtu-mrc-pro 腾讯已计划 2026-08-28 下线，必须规划迁移

---

## 1. 现状基线

| 角色 | 当前模型 | 状态 |
|---|---|---|
| Think（思考/路由） | youtu-intent-pro 16K | 稳定 baseline，保留 |
| Generation（生成/回复） | youtu-mrc-pro 16K | **计划 2026-08-28 下线，必须迁移** |
| Rewrite（上下文改写） | youtu-rewrite | 保留（平台 RewriteQuery 链） |

应用参数（application-config.json）：temperature 0.2 / topP 0.6 / maxOutput 2000 / contextTurns 8。

## 2. A/B 设计

### 2.1 Generation（回复生成）

| 方案 | 模型 | 动机 | 风险 |
|---|---|---|---|
| A（推荐首试） | DeepSeek V4 Pro | 中文长文与结构化输出质量高；替代 mrc-pro 的直接候选 | 输出风格变化需对齐现有票据文案 |
| B（对照） | 保留 youtu-mrc-pro 至下线前 | 与现状零差异 | 2026-08-28 后不可用 |

判定标准：13 用例 + R48 A~G 矩阵真机跑通；生成卡内容字段完整（title/filters/summary/actions/evidence 无缺漏），无幻觉事实。

### 2.2 Semantic Planner（Turn 语义解析，R49 新增角色）

| 方案 | 模型 | 动机 | 风险 |
|---|---|---|---|
| A | DeepSeek V4 Flash | 低成本、低延迟；结构化 JSON 输出稳定 | 复杂代词/长链（05→Top1→风险→周三）可能弱 |
| B | DeepSeek V4 Pro | 复杂指代与边界情况更强 | 延迟/成本更高 |

判定标准：TurnState 13 用例全部字段断言通过；重点测 `检查一下他的风险`（代词+self）与 `看Top1课表`（top1 指代）。

### 2.3 保持不变

- Rewrite：youtu-rewrite（平台链，不动）。
- Think：youtu-intent-pro（暂作稳定 baseline；若 Planner 承担路由，Think 角色可逐步淡化，**但本阶段不替换**）。

## 3. 评测矩阵（模型 × 用例）

| 用例（节选） | Generation A/B | Planner Flash/Pro |
|---|---|---|
| 13 用例全量 | 必须全过 | 必须全过 |
| CASE 1 三连（风险→空教室→最忙） | 追问文本不再出现 | staleEscape=true |
| 长链 05→Top1→风险→周三 | 返回正确钻取卡 | referenceTarget 正确 |
| 首轮 `只看周三` | 追问而非伪造 | turnType=CLARIFY |

## 4. 切换与回滚纪律

1. 一次只切一个角色；先 A/B 各跑同一 13 用例，记录通过率与失败原因。
2. 切换仅允许在 trial/dev 应用（若有），或用户明确指定演示应用；**public 永远 mock**。
3. 回滚路径：恢复 youtu-intent-pro + youtu-mrc-pro（至 08-28 前）或单一变量回切。
4. 未经真实评测，**不得一次性整体替换全部模型**。
5. 模型切换不改变任何工作流契约、Widget 契约与 CampusTools 事实层。

## 5. 不做什么

- 不为迁移而改协议/改 01~05 结构。
- 不用「换模型」掩盖 stale context 架构问题（Planner 与 Gate 是架构解法，模型只是其中一环）。
- 不在设计阶段把新模型写进 application-config.json（等实施阶段用户确认后改）。
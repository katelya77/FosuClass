# R49 10 — 实施计划草案（Implementation Plan Draft）

> 阶段：R49 设计/审计阶段 — DESIGN DRAFT
> 本文为「下一轮实施」的草案；本轮不实施。实施前须用户与 ChatGPT 审核通过。

---

## 0. 实施总原则

1. 一次只动一个可回滚单元；先导出 R47.7 当前基线 ZIP 存档（腾讯控制台），再改。
2. 平台导入/写链（10013 等历史故障）未恢复前，不批量生成导入包。
3. 每个阶段交付物必须附：静态验证结果 + 真机复验矩阵（08 文档）。
4. 若用户最新腾讯导出与本文档冲突，以最新导出为准。

## 1. 阶段划分

### Phase A：基线保全与真机取证（0.5 天）
- 交付：R47.7 基线 ZIP 存档 + 13 用例真机 pre-test 记录（作为「改动前已存在」基线）。
- 验证：确认 CASE 1 三连在当前真机复现，截图/trace 入库。

### Phase B：00 编排层（核心，1~2 天）
- 在 00 内、01~05 路由之前加入：
  1. Turn Intake（读 SYS.UserQuery / SYS.RewriteQuery / SYS.ChatHistory + 上轮 TurnState）
  2. Semantic Turn Planner（LLM 输出 TurnState JSON，schema 断言）
  3. Context Relevance Resolver（显式/继承/丢弃槽位）
  4. Stale Context Escape Gate（CODE_EXECUTOR 确定性清空，硬测试 A~D）
  5. Router 决策表（08 文档 8 路）
- 交付：00-R49-CognitiveOrchestration 工作流 ZIP（含静态校验：结构/节点/示例查询/无猜测 ID）。
- 验证：R49 13 用例中的 1~7、11~13 真机跑通；硬测试 A~D 全绿。

### Phase C：03 self-risk 修复（0.5 天，可并入 B）
- self 触发语义扩展（风险/冲突/赶场/衔接 + 代词 + 单实体）→ second=first。
- 验证：用例 2、13 与 R48-C 组。

### Phase D：Widget Hero v4 设计落地（1~2 天，独立并行）
- 先在 `r49-design/widget-prototype/` 完成本地视觉原型（06/07 文档），用户与 ChatGPT 评审。
- 评审通过后再做 v4 契约扩展：viewMode 增 detail/picker、课程色 token、Clickable 动作规范（state-complete）。
- 严禁猜测 WidgetID；新 Widget 必须走「导入→再导出」真实身份绑定。

### Phase E：模型 A/B（0.5~1 天，避开 08-28）
- 按 05 文档：Generation DeepSeek V4 Pro（A）/ mrc-pro（B）；Planner Flash vs Pro。
- 13 用例全量对比，输出评测表，单变量切换，保留回滚。

### Phase F：收口与回归（0.5 天）
- 全量跑 08 文档 13 用例 + R48 A~G 回归组。
- 同步修订知识库（01/04/07 v2 事实、08 缺失项）与 application-config data_version。
- 输出验收报告；等待用户真机复验后宣称 R49 通过。

## 2. 交付物清单（实施阶段）

| # | 交付物 | 位置 |
|---|---|---|
| 1 | 00-R49 编排层工作流 ZIP（可导入） | competition/adp-kit/workflows/r49/ |
| 2 | 03 self-risk 补丁 ZIP（如需独立） | 同上 |
| 3 | TurnState schema JSON + 断言测试 | competition/adp-kit/r49-design/implement/ |
| 4 | Widget Hero 视觉原型 | competition/adp-kit/r49-design/widget-prototype/ |
| 5 | v4 契约扩展（viewMode/detail/picker/色板） | widget/r49-v4/（评审后再建） |
| 6 | 模型 A/B 评测表 | reports/2026-08-XX-r49-model-ab.md |
| 7 | 知识库 v2 修订 + 08 补建 | knowledge/ |
| 8 | 验收报告（13 用例 + 回归 + 基线对比） | reports/2026-08-XX-r49-final.md |

## 3. 每阶段验证方法

- 静态：ZIP CRC、节点引用、CODE_EXECUTOR 语法、schema 断言、无外部依赖。
- 真机：08 文档矩阵逐条截图 + trace；必须区分「改动引入」与「改动前已存在」失败。
- 回归：R48 A~G 按钮链全部保持。

## 4. 回滚路径

- 工作流：恢复 Phase A 存档的 R47.7 基线 ZIP。
- 模型：单变量回切（mrc-pro 在 08-28 前有效）。
- Widget：保留 r48-v3 已绑定真实 WidgetID 的版本，v4 仅在评审通过后并行导入。
- 数据/知识：知识库修订可单独回滚（不影响工作流）。

## 5. 明确不做（实施阶段同样适用）

- 不 merge PR #49、不发布、不改生产、不提交凭据。
- 不重写 01~05 内部；不拆 01~05；不改 CampusTools 算法；不改 competition-demo-v2。
- 不猜测 WidgetID；不以原型代正式 Widget。
- 不在无评测时整体换模型；不用 prompt 掩盖 stale 架构问题。
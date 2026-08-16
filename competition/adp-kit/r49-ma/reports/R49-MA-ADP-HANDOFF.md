# R49-MA ADP 交接文档（Handoff）

> 本文件把「仓库内已交付」与「腾讯 ADP 平台侧人工动作」分开，避免把仓库成果误认为平台已上线。
> 仓库：`feat/campusflow-adp-integration`；PR #49 OPEN/UNMERGED。**不 merge、不 publish。**

## 1. 平台侧人工动作清单（逐项执行）

### 1.1 迁移前存档（必须最先做）
- [ ] 在 ADP 控制台导出 R47.7 Golden Baseline：`00-小序会话总控-R47.7-Graph-Context-Integrity` 完整工作流 ZIP。
- [ ] 导出已绑定 Widget 包（schedule/classroom/conflict/day-plan/campus-overview/choice/recovery）。
- [ ] 记录真实 AgentID / WorkflowID / WidgetID / PluginID 到安全位置（不提交仓库）。
- [ ] 记录 R47.7 通过的应用层复验快照（13 case + R48 A~G）。

### 1.2 创建 4 个 Agent
按 `R49-MA-ADP-MANUAL-CONFIG-CHECKLIST.md` 第 1 节逐字段创建：主协调 / 课程空间 / 风险规划 / 校园洞察。
- Prompt 真源：`agents/*.md`（逐字导入）。
- 高级设置：模型 youtu-agent、thinking 效果优先、historyLimit 6、output text；主协调 clarification=ON(Widget)、其余 OFF；主协调 maxReasoningRound=8、风险/洞察=12。

### 1.3 转交与流转
- 转交关系：仅 Main→Child、Child→Main；禁止 Child→Child。
- 流转策略：每个新 Turn 主 Agent 接管（若平台 UI 不支持该开关，以 Prompt 内规则兜底并记录）。

### 1.4 工具绑定
- 创建 CampusTools HTTP 插件：`POST {campus_api_base_url}/api/<toolName>`，Bearer token。
- 或用 OpenAPI 导入：`r49-ma/tools/openapi/campus-agent-tools.openapi.json`。
- 绑定映射：
  - 课程空间 ← campus_schedule_query、campus_classroom_search
  - 风险规划 ← campus_risk_check、campus_day_plan
  - 校园洞察 ← campus_overview
- **回填真实 PluginID / Endpoint / Token 到部署环境变量；未回填前 FAIL CLOSED。**

### 1.5 知识库绑定（Main）
- 重新绑定修复后的知识库：01-08 + taxonomy.json（本轮已按 v2 修复）。
- 确认 KnowledgeRetrievalAnswer 只用于静态知识，禁止作为动态事实来源。

### 1.6 Widget
- 第一阶段 Tool Direct Output=OFF；Clarification Widget 绑定主协调；Agent Output Widget 各域最终轮接入。
- 真实 WidgetID 取得后再接入，禁止写死猜测值。

## 2. 真实 ID 回填位（回填后更新仓库）

| 位 | 当前值 | 待回填 |
|---|---|---|
| `tools/schemas/agent-tools.json` → ids.pluginId | PLACEHOLDER-PLUGIN-ID-FAIL_CLOSED | 真实 PluginID |
| ids.agentIds.main / schedule / risk / insight | PLACEHOLDER-*-AGENT-ID-FAIL_CLOSED | 真实 AgentID |
| CampusTools Endpoint | 部署环境变量（campus_api_base_url） | 真实公网 Endpoint |
| WidgetID | 不写死 | 真实 WidgetID（第二阶段接入） |

> 回填后重跑 `node --test tests/` 中 no-fake-ids 相关用例会失败——这是预期行为：真实 ID 取得后需同步更新对应断言/契约说明，而不是回填时绕过。

## 3. 平台侧待确认项

- [ ] `mcp/campus-tools-mcp/src/contracts.ts` 的 `DATA_VERSION = "competition-demo-v1"` 需更新为 `competition-demo-v2`（运行时类型常量；仓库改动需评估是否影响线上 v2 行为，故列入平台侧确认，未擅自修改）。
- [ ] 知识库 08 补建 + taxonomy 更新后，KnowledgeRetrievalAnswer 是否需要重新上传/重新绑定。
- [ ] 对话流转策略「每个新 Turn 主 Agent 接管」在平台 UI 的可用性。

## 4. 验收（平台侧完成配置后）

1. 应用首页（非单工作流调试）跑 `09-MULTI-AGENT-E2E-MATRIX.md`：硬回归 A~H + 13 case + R48 A~G。
2. 任一动态事实与 R47.7 Golden Baseline 不一致 → 事实倒退，阻断。
3. 全绿 → 执行 `07-MODEL-AB-PLAN.md` 模型 A/B（Main 单变量 youtu-agent VS DeepSeek V4 Flash；**避开 2026-08-28 youtu-mrc-pro 下线节点，Generation 迁移评估须在 08-26 前完成**）。
4. 全部通过后，再决定是否 merge PR #49（本轮禁止）。

## 5. 回滚预案

见 `11-R47.7-BASELINE-AND-ROLLBACK.md`：停用 Multi-Agent 应用 → 恢复 R47.7 实例/导入 ZIP → 复验回归矩阵 → 记录回滚原因。

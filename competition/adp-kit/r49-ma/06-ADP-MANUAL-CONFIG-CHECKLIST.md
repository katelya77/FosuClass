# 06 — ADP 后台逐字段配置清单（R49-MA）

> 本编号文档是系列索引。**逐字段人工配置清单的完整版在本目录根下：`R49-MA-ADP-MANUAL-CONFIG-CHECKLIST.md`（即用户第 5 节要求的文件名）**，内容含 4 Agent 高级设置逐字段表、转交关系、对话流转策略、工具绑定、Widget 绑定、验证步骤与平台侧待办。
>
> 本节仅保留要点，防止双份内容漂移。

## 要点速览

1. **4 Agent**：主协调（clarification=ON/clarificationStyle=Widget/模型 youtu-agent/maxReasoningRound=8）+ 课程空间（OFF/8）+ 风险规划（OFF/12）+ 校园洞察（OFF/12）；全部 thinking=效果优先、historyLimit=6、output=text。
2. **转交**：仅 Main→Child、Child→Main；**禁止 Child→Child 横向自由转交**。
3. **流转策略**：每个新 Turn 重新由主 Agent 接管（解决 stale context）。
4. **工具绑定**：**7 个 Agent Tool（R49.4）**（campus_schedule_query / campus_schedule_range_query / campus_classroom_search / campus_risk_check / campus_day_plan / campus_overview / campus_teacher_load_query）→ CampusTools REST `POST /api/<toolName>`；插件导入 `tools/openapi/campus-agent-tools.adp-import.json`（必须 7 operations）；两个新工具参数可见性见 R49-MA 清单 §8.1。
5. **Widget**：第一阶段 Tool Direct Output=OFF；复用 r48-v3 为 Widget V3 baseline；真实 WidgetID 不写死。
6. **验证**：应用首页跑 `09-MULTI-AGENT-E2E-MATRIX.md` 的 A~H（CASE D 按 **D1~D5** 窗口语义）+ 13 case + R48 A~G。
7. **平台侧待办**：R47.7 基线 ZIP 存档、4 Agent 创建、真实 PluginID/AgentID 回填、知识库重绑定、contracts.ts DATA_VERSION v1→v2 确认、**插件更新为 7 operations 后复测 CASE D**。

> 完整逐字段清单 → **`R49-MA-ADP-MANUAL-CONFIG-CHECKLIST.md`**。

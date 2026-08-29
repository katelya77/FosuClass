# R51 Campus Mission Orchestration

目标完成型校园任务编排。核心不是「调用更多工具」，而是 **Completion Awareness**：系统持续判断「用户最初的目标是否真正完成」。

## 目录

- `mission/` — 确定性 Mission 核心（可执行规范 / 测试 ground truth）
  - `model.js` — MissionGoal / MissionStep / MissionState（内部协议，不展示给用户）
  - `capabilities.js` — 13 能力注册表（↔ 13 现有 CampusTools，不新增工具；绑定与 `r50.1/agent-tool-bindings.json` 一致）
  - `planner.js` — GoalSpec → MissionStep[] 确定性规划（goalFamily → capability 集合 + 依赖边）
  - `completion.js` — contract-driven Completion Evaluator
  - `fresh-guard.js` — FreshToolCallGuard（动态槽位变化 → 必须 fresh execution）
  - `preflight.js` — ToolCallPreflight / Canonical Slot Normalizer（enum 派生自 ADP OpenAPI）
  - `resolve-before-clarify.js` — Resolve before Clarify 决策
  - `widget-actions.js` — Mission-aware sys.chat 动作生成（语义 payload only）
- `data/canonical-aliases.json` — 中文别名 → 规范 enum（每个目标值必须 ∈ OpenAPI enum，测试断言）
- `prompts/` — **R51 runtime prompt source**（Main ≤ 5K 字符，children ≤ 4K 字符）
- `R51-CONSOLE-CUTOVER.md` — 一次性 Console Cutover 指引
- `R51-MISSION-E2E-MATRIX.md` — 13 行高价值 E2E Mission 矩阵
- 测试：`r49-ma/tests/test-r51-*.js`（12 个文件，含 ≥64 条 paraphrase 泛化门禁）

## 运行期边界

Mission 核心是**确定性契约层**：作为可执行规范驱动测试、作为 Console Prompt 的语义基准。运行期由 4 个 Agent（Main / Schedule / Risk / Insight）执行等价契约——Main 解析目标为结构化 GoalSpec 并调度，Child 按 capability 边界执行工具并回传 Main。禁止 Child → Child；Main 不绑定任何 CampusTools。

## 架构约束（不变）

- 4 Agent；13 CampusTools；14 bindings；Main = 0 CampusTools
- Tool Direct Result = OFF；动态校园事实只能来自 CampusTools
- R50.4 unified Widget 视觉冻结；不新增 Agent / 不新增 CampusTool
- 排名：metric 语义 ≠ position 语义；并列不使 position 失效；overview 聚合 count 不是 academic week
- 时间：explicit > mission inherited > compatible history；禁止 silent week=1
- 禁止 Case / 关键词 / 固定句式硬编码；生产策略不含测试字符串
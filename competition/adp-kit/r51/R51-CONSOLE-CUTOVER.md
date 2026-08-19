# R51 Console Cutover（2026-08-19）

一次性 Console 配置切换文档：**R51 运行模式**。仅描述配置决策；不在本 PR 中实际切换线上 Console。

## 状态声明

- 用户尚未切换到最新 Widget（R50.4 统一 Widget），因此本 PR **不**宣称「R50.4 Console Widget GOLDEN」或「R51 Console GOLDEN」。
- 本文件是切换者执行 cutover 时的唯一配置依据；切换后以实际线上验证为准。

## 目标配置（R51 Runtime Mode）

| Agent | Prompt 源 | output | clarification | Widget |
|---|---|---|---|---|
| Main（主协调） | `r51/prompts/main-orchestrator.r51.md` | TEXT | ON（Widget 风格） | - |
| Schedule（课程空间） | `r51/prompts/schedule-space.r51.md` | Widget | OFF | 小序-校园智序结果卡-R504 |
| Risk（风险规划） | `r51/prompts/risk-planning.r51.md` | Widget | OFF | 小序-校园智序结果卡-R504 |
| Insight（校园洞察） | `r51/prompts/campus-insight.r51.md` | Widget | OFF | 小序-校园智序结果卡-R504 |

全局开关：

- 所有 Agent 的 Tool Direct Result = OFF（工具结果一律先回 Main，由 Main 判定完成度后再呈现）。
- 新用户回合一律先到 Main；Main 只持有 Agent transfer，不绑定任何 CampusTools。
- 拓扑：Main → Child → Main；无 Child → Child；Child 不得直接追问用户。
- 澄清仅 Main 出口（Resolve before Clarify；四情形才澄清）。
- 不做任何「AI 一键优化 Prompt」操作。
- 切换后首轮冒烟：新回合 → Main → Child → 工具 → Main → 收口；无编排自述、无内部协议泄漏。

## 执行步骤（由操作者执行）

1. 在 Console 为 4 个 Agent 粘贴上述 Prompt 源内容（字符预算：Main ≤ 5000，Child ≤ 4000）。
2. 设置 output / clarification / Widget 表；关闭 Tool Direct Result。
3. 清空旧任务上下文，从新用户回合开始验证 13 行 E2E 矩阵（见 `R51-MISSION-E2E-MATRIX.md`）。
4. 发现偏差 → 只修 Prompt/配置；若需改 Mission 内核，走代码路径并回归 R51 测试套件。

## 回滚路径

- 保留旧 R50 配置快照（r50.2 编译产物仍存在）；出现阻断性问题时按旧配置恢复。
- 内核代码回滚：`git revert` 本 PR 中 `competition/adp-kit/r51/` 变更（Mission 内核无线上副作用，不影响既有工具调用）。
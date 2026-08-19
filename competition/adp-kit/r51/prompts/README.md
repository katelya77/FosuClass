# R51 Runtime Prompts

本目录是 **R51 runtime prompt source**——Console 运行时 4 个 Agent 的规范 Prompt 源。

## 与旧 R50 的关系

- R51 prompts **≠** 旧 R50 巨型 Shared compiler 输出（`r50/prompts` / `r50.2/prompts` 的 `build-agent-prompts.js` 编译产物）。
- 旧规范文档保留为 engineering reference（shared 策略全文），**不全文注入 Runtime Prompt**。
- R51 采用 bounded mission patch：Main ≤ 5K 字符，Schedule / Risk / Insight ≤ 4K 字符，只写原则与契约，不写大量固定示例。

## 文件

| 文件 | Agent | 预算 |
|---|---|---|
| `main-orchestrator.r51.md` | Main（主协调） | ≤ 5000 字符 |
| `schedule-space.r51.md` | Schedule（课程空间） | ≤ 4000 字符 |
| `risk-planning.r51.md` | Risk（风险规划） | ≤ 4000 字符 |
| `campus-insight.r51.md` | Insight（校园洞察） | ≤ 4000 字符 |

## 约束

- 禁止 Case / 关键词 / 固定句式 / 固定教师编号 / 固定测试 Prompt 硬编码。
- 生产 Prompt 不得包含任何测试字符串（paraphrase 门禁扫描验证）。
- 不得展示内部协议：Agent 名称、工具名、transfer 字段、task_done、MissionState / 内部 JSON、内部推理过程。
- Main 不绑定任何 CampusTools；Child 只在本域工具内选择。

## 运行期映射（Console 配置）

| Agent | Prompt | clarification | output | Widget |
|---|---|---|---|---|
| Main | main-orchestrator.r51.md | ON（Widget 风格） | TEXT | - |
| Schedule | schedule-space.r51.md | OFF | Widget | 小序-校园智序结果卡-R504 |
| Risk | risk-planning.r51.md | OFF | Widget | 小序-校园智序结果卡-R504 |
| Insight | campus-insight.r51.md | OFF | Widget | 小序-校园智序结果卡-R504 |

详见 `R51-CONSOLE-CUTOVER.md`。
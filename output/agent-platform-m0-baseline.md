# M0 检查点基线认证证据

> 检查点：`83917ae2`（分支 `refactor/xiaofu-agent-platform-v2`，基线 `main @ 33ae65fc`）
> 执行人：主 Agent（串行，无 coder、无并发）；执行日期：2026-07-28
> 原始完整日志：`.tmp/m0/gate{1..5}-*.log`（gitignored，不提交）

## 门禁结果总表

| # | 命令 | 开始 | 结束 | 耗时 | exit code | 结果 | 首个真实错误 |
|---|---|---|---|---|---|---|---|
| 1 | `npm run test:agent-foundation` | 2026-07-28T02:26:18+08:00 | 02:26:38 | 20s | 0 | ✅ 31/31 通过 | 无 |
| 2 | `npm run test:agent-phase3` | 2026-07-28T02:26:51+08:00 | 02:27:04 | 13s | 0 | ✅ 24/24 文件通过（`run-agent-phase3-tests: all passed`） | 无 |
| 3 | `npm run test:agent-final-convergence` | 2026-07-28T02:27:16+08:00 | 02:28:31 | 75s | 0 | ✅ `agent-final-convergence: all passed`（含 e2e-matrix 5 场景、evaluation 120 例、包卫生检查） | 无 |
| 4 | `npm run test:ai-competition` | 2026-07-28T02:28:41+08:00 | 02:30:01 | 80s | 0 | ✅ `AI competition checks passed` | 无 |
| 5 | `npm run test:agent-regression` | 2026-07-28T02:30:15+08:00 | 02:32:02 | 107s | 0 | ✅ 120/120 通过 | 无 |

## A/B/C/D 分类

无失败项，无需分类。未创建 main 对照 worktree（按规则仅在出现失败且需 A 类取证时创建）。

## 认证结论

**M0 通过**：检查点 `83917ae2` 五项门禁全部实际运行并全绿。交接文档标注的"阶段 3 之后未重跑 ai-competition 与全量 regression"两项缺口已在本次认证中补齐（ai-competition ✅、regression 120/120 ✅）。
`test:agent-release-gate` 按计划留至 M7 首跑，本里程碑未运行。

## 备注

- 门禁 1 与门禁 5 日志中共 20 处 `wx.request failed { code: undefined, ... }` 输出，系测试内模拟请求的固有打印，所在测试文件均为 passed；门禁 5 中其余 `fail` 字样均为 `pass=N fail=0` 统计行。已逐条核对，无真实失败。
- npm 有两条 `electron_mirror` config 警告，与测试无关。
- 五项门禁严格串行：每项 START 均晚于前一项 END。
- 验证分级说明：以上为 mock/本地确定性测试已验证，不含 staging live、真机、体验版或生产验证。

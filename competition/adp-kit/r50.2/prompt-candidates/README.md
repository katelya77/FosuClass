# R50.2B Prompt Candidates（ADP AI 一键优化候选）

本目录用于保存 ADP 控制台「AI 一键优化」产出的四份候选 Prompt，并接受
`prompt-candidate-gate.js` 批量门禁。**候选只是草稿**：只有通过门禁的候选才允许
替换 `r50.2/prompts/*.final.md` 基线快照（且替换后必须重新跑全部 R50.2A/R50.2B 门禁）。

## 工作流（每次优化）

1. 在 ADP 控制台对四个 Agent（Main / Schedule / Risk / Insight）逐一点击「AI 一键优化」。
2. 将优化后的 Prompt 分别保存为：
   - `main.md`
   - `schedule.md`
   - `risk.md`
   - `insight.md`
3. 运行批量门禁：

   ```powershell
   node r50.2/prompt-candidate-gate.js --candidates
   ```

   一次报告四份候选的：必需不变量缺失、工具归属漂移、静默默认周、
   child→child 路由、调课/写操作虚构、内部字段暴露、密钥/内部地址泄漏。

4. 门禁不通过 → 回到 ADP 控制台修正对应 Agent，重新保存候选，再跑门禁。
5. 门禁通过 → 把候选内容回写 `r50/agents/<domain>.md`（保持措辞不变量），
   运行 `node r50/build-agent-prompts.js` 重新编译，再同步 `r50.2/prompts/*.final.md`，
   最后跑基线门禁与全部兼容性/语义门禁。

## 门禁红线（候选不得削弱）

- Main 不绑定任何 CampusTools；Main-first 路由不变。
- Schedule / Risk / Insight 结果卡 = `campus-result-unified-v1`；动作仅官方 `sys.chat`（payload 只含用户语义 query）。
- 工具归属不得漂移（Schedule 不得持有 risk/insight 工具，反之亦然）；无 child→child 路由。
- 时间未确定必须走 `campus_academic_context` + NEED_CLARIFICATION，绝不静默默认 week=1。
- fresh-tool-call 铁律、调课「绝不产生真实写操作」+ simulated 标记、并列位次不变量必须保留。
- 内部协议字段（查询编号/数据哈希/数据版本/排名上下文/节点标识/业务标识/来源工具）只允许「不默认展示」式措辞，禁止暴露为输出；密钥、授权头、内部地址零出现。
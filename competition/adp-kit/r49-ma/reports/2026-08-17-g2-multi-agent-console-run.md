# G2 Multi-Agent Handoff Convergence — 人工验收记录（模板）

> 使用说明：在 ADP 控制台应用首页（非单工作流调试）逐条执行 09-MULTI-AGENT-E2E-MATRIX.md 的硬回归 A~H 与 13 core case。
> 每 Turn 复制一行记录表填写；**只允许填写真机实测结果**，禁止伪造、推测或回填。
> 表中 `(e.g. B)` 两行为格式示例（仅示意 Expected 侧），**验收前删除**；Actual 侧一律留空待真机填写。
> 动态事实一律以 CampusTools 确定性输出为准；dataVersion 必须为 competition-demo-v2。

- 验收人：
- 日期：
- 环境：ADP 控制台应用首页（应用名：校园智序 · 小序）
- 分支/HEAD：
- CloudBase adpContractVersion（/health 实查）：R49.2.1（若本轮 Runtime 有改动则填实际值）
- 数据真源：competition-demo-v2 / sha1:4f3bbbb45d1f

## 记录表（每 Turn 一行）

| Case | Turn | User Input | Expected Agent | Actual Agent | Expected Handoff | Actual Handoff | Tool Called | Tool Args | Inherited Slots | Dropped Slots | evidence.verified | dataVersion | Result Summary | PASS/FAIL | Screenshot / Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| (e.g. B) | 1 | 比较T09老师第1周和另一位老师的风险 | risk | | Main 澄清第二对象 | | —（NEED_CLARIFICATION） | | | | | | | | |
| (e.g. B) | 2 | A校区2026-09-03第5-6节有哪些60人以上的空教室？ | classroom | | NEW_TASK → campus_classroom_search | | campus_classroom_search | campus=A校区(别名), date=2026-09-03, periodStart=5, periodEnd=6, capacity≥60 | — | second_entity_pending, comparisonMode, risk_local_state | | competition-demo-v2 | | | |

## 检查要点（对照 09 矩阵硬性要求）

- [ ] CASE A：第 2 轮 self-risk 不要求第二对象；第 3 轮 risk→schedule 不残留 risk pending（fresh-tool-call 铁律）
- [ ] CASE B：Turn 1 compare 缺第二对象 → Main 澄清；Turn 2 新任务立即 escape，不追问第二对象
- [ ] CASE C：下一天 = date+1 确定性推进；空日不进入「工具暂不可用」恢复卡
- [ ] CASE D：Top1 = 本轮 campus_overview.teacherLoadTop[0] 真实值（不写死）；第 3 轮 self-risk 不要求第二对象；校区最忙单域不下钻
- [ ] CASE E：仅显式双对象才 compare
- [ ] CASE F：无有效历史必须澄清，不伪造实体
- [ ] CASE G：chat/知识导航不调用动态工具
- [ ] CASE H：动态课表必须调用 CampusTools，禁止 Knowledge 直接回答
- [ ] 13 core case：澄清/chat/knowledge/self/compare/0-mask/别名/日计划推进全部覆盖
- [ ] 所有动态结果展示「已核验 + dataVersion=competition-demo-v2」

## 结论

- 通过 case 数 / 失败 case 数：
- 失败明细（case/turn/原因）：
- 遗留问题 / 需要回滚项：
- 验收结论：PASS / FAIL（附理由）
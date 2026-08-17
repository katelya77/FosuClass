# 10 — Migration Risk Register（迁移风险登记）

> 只登记**真实存在或高概率**的风险，每项含缓解措施。未验证项显式标注「未验证」。

| # | 风险 | 等级 | 描述 | 缓解 |
|---|---|---|---|---|
| 1 | self-risk 仍要求第二对象 | P0 | 若 `campus_risk_check` 契约或平台 Agent 仍按 second required 处理 | 契约已改为 `mode=self` 时 second optional；adapter 确定性复制 second=first；回归 CASE A/B/D/E 硬校验 |
| 2 | stale context 污染新任务 | P0 | 旧 risk/overview pending 污染 classroom/overview | Main 每新 turn 重新接管；NEW_TASK 清空 dropSlots；CASE B/C/D 回归 |
| 3 | 子 Agent 与用户长期追问 | P1 | 子 Agent clarification=OFF，但可能自行追问 | NEED_CLARIFICATION 协议 + Main 唯一澄清出口；Agent prompt 显式约束 |
| 4 | Top1 下钻伪造 | P1 | Insight 凭记忆回 Top1 | Top1 由 Insight 从 `campus_overview` 结果回传，Main 再转域；CASE D 回归 |
| 5 | 平台不支持「每新 Turn 主 Agent 接管」 | P1 | ADP 流转策略能力未在仓库验证 | 列为平台侧人工动作；需真机验证（见 06 清单） |
| 6 | 模型迁移 08-28 前未完成 | P1 | youtu-mrc-pro 下线导致生成中断 | 08-26 前完成 Generation A/B；07 计划含缓冲 |
| 7 | 知识库旧规模误导 | P2 | 01/04/07 曾写 v1 规模（已修）；08 曾缺失（已补建） | 本轮已基于 v2 真源修复；knowledge-dynamic-fact-guard 测试兜底 |
| 8 | dataVersion 不一致 | P2 | application-config 曾写 v1（已改 v2）；contracts.ts DATA_VERSION 常量仍写 v1 | application-config 已对齐；contracts.ts 类型常量属运行时导出，标记为平台侧待确认项（见 reports） |
| 9 | WidgetID/PluginID 猜测 | P0(违规) | 禁止猜测真实 ID | 所有 ID 用占位符 + FAIL_CLOSED；真实导出后回填 |
| 10 | 为 Multi-Agent 炫技降事实准确率 | P0 | 架构改动引入事实偏差 | 动态事实只由 CampusTools 输出；回归矩阵硬校验零编造 |
| 11 | 把本地静态验证当真机通过 | P2 | 仓库测试 ≠ 腾讯平台真机 | 交付明确区分「本地静态验证」vs「ADP 真机复验」；手动操作交接 |
| 12 | 破坏 r48-v3 Widget 链 | P2 | 迁移期间误改 Widget | r48-v3 保持不动；复用契约；Widget 按钮回归 G |
| 13 | R47.7 回滚路径失效 | P1 | 紧急回滚不可用 | 11 文档定义 Golden Baseline 存档与回滚步骤；迁移前先导出基线 ZIP |
| 14 | rankingWindow/detailWindow 碰撞 | P1 | 多周排名窗口被误继承为单周调用（或反之），week 语义串环境 | Main 硬规则「显式 > 继承」；windowContext 信封只携带 rankingWindow/detailWindow/academicWeek 三个字段；`resolveDetailWindow` 纯函数 fail-closed；test-r49-4-window-semantics 回归 |
| 15 | 范围课表误去重重复周次课 | P1 | `campus_schedule_range_query` 把 1-4 周每周二这种重复课并成一条，破坏逐周事实 | 契约：每条 = (lesson, academicWeek) 一对一条，`academicWeek`/`date` 逐周展开；tools.test.js 教师003 1..4 周展开回归；adapter/OpenAPI 同步镜像 |
| 16 | 私有导入物泄漏进比赛产物 | P0 | 私有 adp-kit 数据/脚本/mock 混入 competition/submission-package，触碰数据守卫 | build-submission-package 显式 excludes（r49-ma、私有 mock、脚本、XLS 原文）；privacy-policy.json + test-r49-4-anonymity-boundary 硬校验；Task 9 交付检查项 |

## 未验证项（显式标注）

- ADP 平台是否支持「每新 Turn 主 Agent 接管」的流转策略（需真机）。
- Agent Tool 以自定义插件方式绑定后的调用是否走通（需真实 PluginID/Endpoint 配置）。
- Widget 在 Multi-Agent 收口链路中的实际渲染（第一阶段文本，后续接）。

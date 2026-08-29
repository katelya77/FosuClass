# ADP R5 Application Activation Matrix

Workflow debug PASS 只证明单个画布可启动，不证明 Agent Router 使用了该版本。最终应用必须按下表排除新旧路由竞争。

| 状态 | Workflow | 用途 |
|---|---|---|
| ENABLE | 01-多维课表查询-R3 | 单实体课表与占用 |
| ENABLE | 02-空教室规划-R3 | 具体时间条件下的空间资源决策 |
| ENABLE | 03-课程冲突比较-R3 | 两实体冲突与教师 self-compare 赶场 |
| ENABLE | 04-今日校园计划-R3 | 已确认日期的个人行动规划 |
| ENABLE | 05-校园教学态势-R1 | 校园整体态势与 01-04 调度台 |
| DISABLE / EXCLUDE | 01/02/03/04 历史 baseline | 避免同意图多版本竞争 |
| DISABLE / EXCLUDE | 01-多维课表查询-Final_9332 | 历史结构证据，仅回滚使用 |
| DISABLE / EXCLUDE | 00-节点格式种子-勿启用 | 研发 seed，不参与应用路由 |
| DISABLE / EXCLUDE | 所有旧 RuntimeSafe / Final 中间版本 | 避免 old/new routing collision |

不要删除历史 Workflow；只关闭应用引用和 Router 示例，保留证据与回滚能力。

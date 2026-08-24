# 校园智序·小序 — FINAL TRUTH

冻结日期：2026-08-24

冻结基线：`deploy/demo-portal` @ `28e816e`

交付分支：`deliver/competition-final`

> 本文件是比赛设计书、答辩、视频、字幕、截图说明与程序交付包的唯一最终事实源。最终材料不得以 R47、R48、R49 或其他历史阶段文档替代本文件。

## 1. 对外唯一口径

- 产品名称：**校园智序·小序**。
- 核心文案：**让复杂的校园教学安排，简单到一句话就能问。**
- 叙事主线：**真实问题 → 自然语言任务 → Multi-Agent 理解与分工 → CampusTools 确定性核验 → 可核查 Widget → 辅助决策。**
- 真实落地：**前期产品形态已在真实校园环境落地运行，累计服务用户 1000+。** 对外只使用这一匿名表述，不出现学校、学院、城市、姓名、学号、邮箱、代码托管账号或真实域名。
- 产品边界：生成模型负责理解任务、组织协作与表达；动态校园事实只由 CampusTools 基于匿名演示数据确定性计算，生成模型不得补写或改写事实。

## 2. 最终系统事实

| 项目 | 冻结事实 |
| --- | --- |
| Agent | 4 个：Main（小序·主协调）、Schedule（课程空间）、Risk（风险规划）、Insight（校园洞察） |
| CampusTools | 13 个唯一确定性工具 |
| bindings | 14 个 Child 绑定；`campus_academic_context` 是唯一共享绑定 |
| 协作拓扑 | Main → Child → Main；无 Child → Child |
| Main 工具边界 | Main 直接绑定 CampusTools 数量为 0 |
| 数据版本 | `competition-demo-v3` |
| 数据摘要 | `sha1:842b7959e808` |
| 数据规模 | 4 校区、6 类匿名教学单位、24 班级、40 教师、73 课程、85 教室、175 教学安排 |
| 动态事实源 | CampusTools 对匿名数据进行确定性计算 |
| 展示契约 | 统一结果卡；关键结论带 Verified 与 Evidence；卡片不可渲染时从同一已核验投影确定性生成可读文本 |
| 写入边界 | What-if 调课只模拟，不修改真实数据；`mutatedData=false` |
| 可靠性 | 输入校验、fresh call、确定性排序、Evidence、失败关闭；缺失或损坏数据不伪造结果 |
| 展示端 | 4173 Competition Showcase；4174 Judge Portal |

## 3. 4 Agent 与 13 CampusTools

### Main — 小序·主协调

理解用户目标、拆解任务、把子任务交给领域 Agent，并在 Child 返回后组织最终结论。Main 不直接调用 CampusTools。

### Schedule — 课程空间

7 个绑定：

1. `campus_schedule_query`
2. `campus_schedule_range_query`
3. `campus_classroom_search`
4. `campus_entity_search`
5. `campus_academic_context`
6. `campus_common_free_time_query`
7. `campus_group_plan`

### Risk — 风险规划

4 个绑定：

1. `campus_risk_check`
2. `campus_day_plan`
3. `campus_academic_context`
4. `campus_reschedule_feasibility`

### Insight — 校园洞察

3 个绑定：

1. `campus_overview`
2. `campus_teacher_load_query`
3. `campus_room_utilization_query`

唯一共享工具 `campus_academic_context` 同时绑定 Schedule 与 Risk，因此 13 个唯一工具形成 14 个 Child bindings。

## 4. 四个真实 Hero 场景

以下场景均来自 CampusTools 对 `competition-demo-v3` 的确定性调用结果；四份最终 fixture 均为 `source=adp-runtime-golden`、`verified=true`。

### Hero 1 — 教学风险发现

**一句话任务**：检查教师025未来四周的教学风险。

- 对象：教师025，课程为大学英语。
- 窗口：第 1–4 周；每周 14 课次。
- 课程冲突：每周 0。
- 跨校区赶场：每周 4 处，间隔均为 20 分钟。
- 结论：**课表没有冲突，不代表教学安排没有风险。**
- 辅助决策：优先下钻 4 条跨校区相邻课程，评估调课、换教室或缓冲安排。

### Hero 2 — 多人协同规划

**一句话任务**：帮教师005、教师006、教师014找第 1 周周四上午的共同空闲，并推荐合适教室。

- 参与者：3 位教师。
- 共同窗口：周四第 1–4 节，08:00–11:40。
- 可用教室：63 间。
- 容量不低于 120 的候选：7 间。
- 稳定推荐：校区A A1-201，120 座，阶梯教室。
- 结论：**三张课表，经共同空闲与容量约束核验，收敛为一个可执行时间与空间。**

### Hero 3 — What-if 模拟调课

**一句话任务**：把“数据结构”从第 1 周周一第 5–6 节模拟调整到周四第 7–8 节。

- 原安排：2025级计算机类01班、教师003、校区A A1-201。
- 目标：第 1 周周四第 7–8 节；未指定教室时由 CampusTools 自动解析。
- 候选收敛：18 间可用教室 → 8 间通过业务约束；建议 A1-201（120 座）。
- 关键检查：班级时间、教师时间、教室占用、容量、功能属性均通过。
- 可行性：`feasible=true`。
- 伴随提示：调整后教师连续 4 节，存在连堂负荷提醒。**warning 不是失败**。
- 写入状态：`mutatedData=false`，只模拟、不写入、不改变真实课表。
- 结论：**可行与有提醒可以同时成立；系统把约束与代价一起呈现。**

### Hero 4 — 全局教学洞察

**一句话任务**：未来四周谁的教学负载最高，并下钻他的真实风险。

- 窗口：第 1–4 周。
- Top 1：教师025。
- 负载：56 课次 / 112 课时；每周 14 课次，连续 4 周。
- 下钻风险：课程冲突 0；每周跨校区赶场 4 处。
- 结论：**排名只负责定位对象；风险结论由新的 CampusTools 调用重新核验。**

## 5. Verified / Evidence / fail-closed

1. 动态结果必须先经过 CampusTools，且携带数据版本、数据摘要、计算时间与 `verified=true` 证据。
2. 统一结果卡只投影经过白名单裁剪的公开语义，不向用户暴露内部查询标识、原始数据或内部协议。
3. 结果卡正常时展示 Widget；不可渲染时，从同一 verified projection 确定性生成中文文本，不让生成模型重新编造事实。
4. 数据损坏、实体歧义、空结果或约束不满足时失败关闭：澄清、返回已核验空结果或说明不可行，不制造候选。
5. 条件、周次、星期或对象变化时要求 fresh tool call；历史结果不得截取后冒充新结论。

## 6. 评分叙事映射

| 权重 | 最终讲法 |
| --- | --- |
| 25% 真场景 | 真实校园教学任务；前期产品累计服务用户 1000+；四个 Hero 均是可复现的匿名真实任务形态 |
| 25% 创新实用 | Multi-Agent 分工 + 确定性 CampusTools + What-if + 风险与洞察联合决策 |
| 20% 技术完整 | 4 Agent / 13 Tools / 14 bindings / Main→Child→Main / 统一 Widget / 4173+4174 Demo |
| 15% 数据算法 | 匿名数据、确定性计算、约束检查、稳定排序、Evidence、Verified、fresh call、fail-closed |
| 15% 体验展示 | 一句话操作、Auroraqua/Iced Jelly 视觉、Judge Portal、电影化 Showcase、真实 ADP 操作链路 |

## 7. 最终交付纪律

- 最终对外品牌只使用“校园智序·小序”。
- 最终材料只引用 `competition-demo-v3`；旧数据版本仅留在历史 archive，禁止进入最终交付包。
- 不在最终材料中出现真实学校、学院、城市、姓名、学号、邮箱、代码托管账号、真实域名、本机用户路径或任何凭据。
- 4173/4174 是只读展示层；不得把展示动画描述为 Runtime 证据。视频必须插入真实腾讯 ADP 操作画面，展示用户输入 → Main → Child → CampusTools → 最终 Widget。
- 腾讯 ADP Console 中的应用导出、自定义插件导出与最终 Widget 导出由人工完成并加入 `manual-exports/`；自动程序包不得伪造 Console 导出。

## 8. 冻结证据

- `competition/adp-kit/reports/current-adp-checkpoint.md`
- `competition/adp-kit/r51/`
- `competition/adp-kit/r50.2/R50.4-RUNTIME-ACCEPTANCE.md`
- `competition/adp-kit/final/`
- `competition/adp-kit/r50.1/agent-tool-bindings.json`
- `competition/adp-kit/openapi/campus-tools.openapi.json`
- `competition/adp-kit/mock-data/competition-demo-v3.json`
- `competition/showcase/src/fixtures/heroes/*.json`
- `competition/showcase/docs/PHASE2.8-RELEASE.md`

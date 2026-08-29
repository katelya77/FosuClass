# Final Hero Stability Matrix（最终 Hero 稳定性矩阵）

状态：REPO_FINAL · 执行：`r49-ma/tests/test-final-hero-stability.js`（随 r49-ma 回归套件运行）

## 目的

真实 ADP 两轮评测（Final 27）中出现多轮语义随机漂移。本矩阵用 8 组 Hero 场景 × 每组 ≥3
个 paraphrase / state 变体（≥24 用例）固定最低稳定标准，全部确定性执行真实 CampusTools
（v3 匿名数据集）+ Mission Planner + FreshToolCallGuard + Decision Runtime + Widget 投影。

## 最低标准（每用例必须全部满足）

1. **correctness 24/24**：规划能力序列、工具调用、最终完成状态与决策/卡片均符合预期；
2. **no fabricated dynamic fact**：公开投影中的动态事实都能在对应工具结果中找到；
3. **no internal protocol leakage**：公开投影无 queryId / dataHash / sourceTool /
   DecisionBundle / MissionState / resultRef 等内部字段；
4. **no stale entity/week/date**：槽位变化触发 fresh guard 重新核验，不使用旧结果截取；
5. **widget failure always has semantic fallback**：结果卡校验失败时，从同一 verified
   projection 派生可读中文文本（PRESENTATION-CONTRACT）。

## 矩阵

| 组 | 场景 | 变体（≥3） | 期望链 | 关键断言 |
|---|---|---|---|---|
| G1 | 教师周课表 | 陈述 / 疑问 / 口语（跨周 state 变体） | ENTITY_RESOLUTION → SCHEDULE_DETAIL | 课次全来自数据集；卡片合法 |
| G2 | 周几追问 → 下周 | 追问 / 并列两句 / 同时间下一周 | 两轮 SCHEDULE_DETAIL（w1→w2） | 槽位变化必 fresh；w2 结果非 w1 |
| G3 | 课表 → 跨校区风险 | 先课表后风险 / 直接问风险 / 合并表达 | ENTITY_RESOLUTION → SCHEDULE_DETAIL → RISK_CHECK | 最终卡 variant=risk；风险事实来自工具 |
| G4 | 教室推荐 + 软偏好 | 容量大优先 / 坐更多人 / 空间宽裕 | ENTITY_RESOLUTION → SPACE_DISCOVERY | 首次查询携带 decisionPreferences；推荐容量最大 |
| G5 | 硬约束空 → 明确放宽 | 三个不同空约束 | SPACE_DISCOVERY | no_feasible_candidate；relaxedCount=0；明确说明无匹配 |
| G6 | 三教师共同空闲 + 教室 | 完整问句 / 简写 / 口语 | ENTITY_RESOLUTION → COMMON_AVAILABILITY → SPACE_DISCOVERY → GROUP_PLANNING | 推荐方案存在；教室来自数据 |
| G7 | 排名 → Top1 课表 → 风险 | 完整链 / 简写 / 疑问 | TEACHER_LOAD_RANKING → SCHEDULE_DETAIL → RISK_CHECK | Top1=教师025（1..4周）；下钻继承实体；最终卡 risk |
| G8 | 调课 What-if 完整链 | 可行吗 / 能挪吗 / 模拟换到（含目标时段 state 变体） | ENTITY_RESOLUTION → RESCHEDULE_SIMULATION | 多课次逐条模拟；spaceAvailability 存在；decision+卡片；模拟声明 |

> 变体仅改自然语言表达或状态槽位，不改期望语义；禁止针对具体教师编号或具体问句的规则
> ——所有机制都是 capability-level 的通用机制。

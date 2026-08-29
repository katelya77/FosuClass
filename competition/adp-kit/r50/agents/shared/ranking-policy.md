# Shared Policy · Ranking Policy（R50.1）

排名由 **Ranking Semantic Core** 确定性计算；所有「最高 / 最忙 / 利用率最高 / TopN / 第一名」类问题走本策略。

## 1. metric 语义 vs position 语义

- **metric semantics**：「最高 / 最忙 / 最空闲 / 利用率最高」= 指标查询，返回按业务指标排序的有序列表。
- **position semantics**：「Top1 / 第一名 / 排第一 / Top2 / 第二名 / Top3」= 有序列表的**稳定位置**；**位置解析不因业务指标并列而失效**。
- Top1 = 本轮排名工具真实有序结果 items[0]；Top2 = items[1]；Top3 = items[2]。**禁止硬编码任何具体实体**（如某个教师编号）。

## 2. 并列处理

- 业务指标并列（如两名教师 lessonOccurrences / periodUnits 完全相同）**不构成**「Top1 不唯一」：
  - 单排位引用（第一名 / 排第一那个 / 第二个 / 第三名）→ 直接落实体，**NO CLARIFICATION**；
  - 并列事实如实说明（如「并列最高；按稳定排序 Top1=…，Top2=…」）；
  - 只有明确**多对象**表达（「并列第一两位都给我看看」「比较这两位」「他们」）才进入多对象逻辑，不得自动压缩为 Top1。
- RankingResult 保留 tie 元数据（tieGroupId / tieGroupSize / tiedWithPrevious / metricRank），同时 position（rank）仍唯一确定。

## 3. 排名真源

- 教师负载窗口排名唯一真源 = `campus_teacher_load_query`；rankContext.sourceTool 记录**本轮真实产生排名的工具**（如 teacher_load / room_utilization），**不得**写死成 overview 或其他来源。
- `campus_overview` 只承担固定窗口整体态势，不作为任意教师周窗口排名的替代来源。
- 通用排名实体：room / building / campus 等复用同一 Ranking Core 模型。

## 4. RankingResult（内部协议，不默认展示）

- 排名结果条目包含 rank（1-based 稳定位置）、metricRank（业务指标并列组内排序）、tiedWithPrevious / tieGroupId / tieGroupSize（并列元数据）、entity（id / name / type）、metrics。
- rankContext 只在与下游真正相关时传递（下钻实体、selectedRank、窗口）；原始 JSON 不默认展示给用户。
# Shared Policy · Context Policy（R50.1）

## 1. 通用 Context 模型（内部协议）

- 本轮结构化上下文由 intentContext / entityContext / temporalContext / rankingContext（仅当本轮或历史真正产生排序结果时存在）/ comparisonContext（仅显式比较任务需要）/ taskContext（复合请求未完成子任务跟踪）组成。
- 原始 JSON 属于内部协议，不默认展示给用户；不新增针对单一 Case 的特殊字段，现有字段保持向后兼容。

## 2. 继承规则

- 只继承当前任务完成所必需的信息；domain-local 临时状态不得污染不相关新任务。
- 用户当前明确表达永远覆盖继承值（显式 > 继承 > 历史）。
- 跨域下钻（如 insight 排名 → schedule 课表）只继承：选中实体、selectedRank、窗口上下文（rankingWindow / detailWindow）；**不继承** overview 聚合状态（overviewWindow / overview-local filters）。

## 3. Stale Context Escape

以下任一情况，主协调必须清除旧 domain-local state 并以 NEW_TASK 处理：

1. 新问题明显属于另一业务域；
2. 用户给出与旧任务冲突的新实体 / 新日期 / 新校区；
3. 上一轮处于「要求补充第二比较对象」澄清态，本轮输入不含比较语义 → 立即 escape 并清除 second_entity pending + risk-local state；
4. 上一轮工作流处于 suspended / pending。

## 4. 窗口上下文（内部协议）

- windowContext 承载 rankingWindow（排名 / 聚合窗口）、detailWindow（下钻窗口，继承或显式收窄）、academicWeek（显式单周，仅用户明确指定时写入）。
- 多周窗口（weekStart < weekEnd）→ 使用范围类工具（逐周展开）；单周（1..1）→ 使用单周工具 fresh 调用。
- overviewWindow.count **绝不等于** academicWeek；聚合计数不得继承为教学周参数。
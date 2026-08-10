# 03 课程冲突比较 V4 收口设计

日期：2026-08-10

## 1. 背景与已验证现状

当前 ADP 工作流 `03-课程冲突比较-V3-全新ID修复版` 已能稳定完成：双方实体提取、日期/节次归一化、CampusTools `compare_schedules` 调用、结果核验与自然语言呈现。

已验证成功案例包括：

- `2025级A班` vs `2025级B班` 指定日期/节次比较；
- `教师001` vs `教师002` 指定日期比较；
- `教师003` vs `教师003` 第 1 周周一比较。

现阶段仅剩两个收口问题：

1. **整周比较缺口**：`第1周` 会归一化为 `week=1, weekday=0`，但 CampusTools 当前把 `0` 视为非法 weekday，导致 `INVALID_PARAM`。用户语义上“第1周”应表示整周，不应被偷偷缩成周一。
2. **同实体自比较重复**：同一实体与自己比较时，相同 lesson 会与自身形成伪冲突；跨校区赶场也会因为 busy1/busy2 完全相同而重复两次。

本次 V4 只解决这两个问题，不重构 ADP 主链路，不进入 04 今日校园计划，不修改生产课程数据。

## 2. 目标与成功标准

### 2.1 目标

- `compare_schedules` 支持 `week=1..20` 且未指定 weekday 的整周比较。
- ADP 对“第N周”不再发送非法 `weekday=0`。
- 同一实体自比较时，完全相同 lesson 不计为时间冲突。
- 同一实体自比较时，跨校区赶场提醒只保留一份。
- 保持现有 `date`、`week+weekday`、`periodStart/periodEnd` 行为兼容。
- 所有课程事实继续只由 competition-demo-v1 + CampusTools 决定，ADP 不猜测事实。

### 2.2 成功标准

以下用例必须稳定通过：

1. `比较A1-101和A1-102第1周的占用冲突`
2. `比较高等数学A和大学英语A第1周的时间冲突`
3. `教师003和教师003第1周周一是否存在冲突或跨校区赶场`
4. `教师001和教师002第1周是否存在冲突`
5. `比较2025级A班和2025级B班第1周周五下午的课程冲突`
6. 一个实体不存在或歧义时，继续返回原有确定性错误/候选，不被新逻辑吞掉。

## 3. 方案比较

### 方案 A：ADP 内拆成 7 次 compare_schedules 再聚合

做法：第 N 周未指定 weekday 时，在 ADP 工作流中分别调用周一至周日 7 次工具，再使用代码节点合并。

优点：不改 CampusTools 后端。

缺点：节点数暴涨、请求数增加、延迟和失败面增加、导入包复杂度更高；同一能力在其他消费者里仍然缺失。

结论：不采用。

### 方案 B：CampusTools 原生支持整周比较，ADP 最小适配（推荐）

做法：让 `compare_schedules` 直接接受 `week` 且 weekday 省略；它本身已有 `busyOf` 对 `tr.weekday == null` 的整周过滤能力，只需保证调用端不把“未指定”编码成非法 `0`。同时在工具层完成同实体去重，ADP 仅做展示层适配。

优点：能力边界正确、单次调用、最低延迟、最少 ADP 改动、MCP/REST/ADP 共享一致行为。

缺点：需要更新并重新部署赛事 CampusTools 测试函数。

结论：采用。

### 方案 C：仅在 ADP 展示层过滤伪冲突

优点：改动最小。

缺点：底层 API 仍返回错误事实；Widget/MCP/其他消费者仍会看到伪冲突，无法解决整周能力。

结论：仅作为额外防御，不作为主修复。

## 4. 详细设计

### 4.1 CampusTools：时间范围语义

`resolveTimeRange` 保持以下契约：

- `date=YYYY-MM-DD`：确定到单日；
- `week=N, weekday=1..7`：确定到教学周某天；
- `week=N` 且 weekday 缺省/null：表示整个教学周；
- `weekday=0` 不属于有效 API 输入，应由 ADP 在调用前转换为“省略字段”，而不是让工具把 0 当周一或整周。

`compare_schedules` 原有 `busyOf` 已支持 `tr.weekday == null` 时不过滤星期，因此整周比较不需要 7 次查询。

### 4.2 CampusTools：同实体自比较

定义：当 `r1.resolvedEntity.type/id` 与 `r2.resolvedEntity.type/id` 完全相同，进入 self-compare 模式。

冲突生成规则：

- 若 `a.lessonId === b.lessonId`，跳过，不构成冲突；
- 对不同 lesson，仍按星期和节次重叠检测真实的“自日程冲突”；
- 若数据异常导致两条不同 lesson 在相同时间重叠，应仍返回真实冲突。

这样既不会把同一课程和自己当成冲突，也不会掩盖数据中真正的双重排课。

### 4.3 CampusTools：赶场提醒去重

当双方为不同实体：维持 `detectRush(busy1)` + `detectRush(busy2)`。

当双方为同一实体：只执行一次 `detectRush`。

同时增加稳定去重键作为防御：

`entity + weekday + from.lessonId + to.lessonId`

确保未来即使上游数据重复，也不会重复输出同一赶场提醒。

### 4.4 CampusTools：返回摘要

在保持现有兼容字段的前提下，建议新增：

- `summary.selfCompare: boolean`
- `summary.conflictCount`
- `summary.rushWarningCount`

现有 `firstBusySlots/secondBusySlots/hasConflict` 保留。

对于 self-compare，`firstBusySlots` 与 `secondBusySlots` 可继续保持相同值以兼容旧消费者；展示层负责只显示一次“忙碌课次”。

### 4.5 ADP：比较输入归一化

当前 `比较输入归一化` 对“第N周”输出 `weekday=0`。V4 保留内部 `0=未指定` 的工作流表示，但在进入工具前必须转换为可选字段语义。

推荐在 `冲突查询参数归一化` 输出中增加：

- `has_weekday: bool`

并把工具节点的 weekday 输入改为仅在存在明确星期时传入；如果 ADP 工具节点无法条件省略整数参数，则将 weekday 输出类型改为可空/字符串中间层不是首选，优先利用工具导入协议支持的可选字段机制。

如果平台导入格式无法表达“条件省略”，允许 CampusTools REST 边界把 `weekday=0` 规范化为 null，但只对 `compare_schedules` 做兼容，不改变其他工具对 0 的严格校验。该兼容属于 ADP 平台约束的适配层，并需要测试锁定。

### 4.6 ADP：结果核验与呈现

根据 `summary.selfCompare` 或 resolved compared IDs 判断 self-compare。

普通比较标题：

`### A vs B · 课程冲突比较`

自比较标题：

`### 教师003 · 课程安排风险检查`

自比较展示：

- “课程自身重叠冲突：N 处”；
- 忙碌课次只显示一次；
- 赶场提醒只显示去重结果；
- 不使用 `A vs A` 文案。

所有结果仍必须满足：`body.success=true`、`dataVersion=competition-demo-v1`、`evidence.verified=true` 才可展示课程事实。

## 5. 数据流

### 普通单日/单星期比较

用户消息 → 参数提取 → 必填判断 → 比较输入归一化 → 日期解析 → 查询参数归一化 → `compare_schedules` → 核验/呈现 → 回复

### 整周比较

用户“第N周” → `week=N, weekday=未指定` → `compare_schedules` 单次请求 → busy1/busy2 过滤整个教学周 → 全周冲突 + 全周赶场 → 核验/呈现

### 自比较

用户“教师003和教师003…” → 两次实体解析得到相同 ID → self-compare → 跳过同 lesson 自身配对 → 真实不同 lesson 冲突检测 → rush 只检测一次 → 自检查版呈现

## 6. 错误处理

保持现有错误语义：

- `MISSING_PARAM`：缺少比较对象或时间必要字段；
- `INVALID_PARAM`：类型/节次等非法；
- `OUT_OF_RANGE`：教学周或日期超范围；
- `AMBIGUOUS_ENTITY`：返回候选，要求用户确认；
- `ENTITY_NOT_FOUND`：返回建议对象；
- `verification_failed`：数据版本/evidence 不一致时不展示事实。

特别要求：不得把“第N周”默认为周一，不得让生成模型补齐 weekday。

## 7. 测试设计

### 7.1 CampusTools 单测

新增至少以下断言：

- `compare_schedules({week:1, weekday:undefined})` 成功；
- 整周 items 中可跨多个 weekday；
- self-compare 不产生 `same lessonId vs same lessonId` 冲突；
- self-compare rushWarnings 无重复；
- 不同实体比较行为与原 golden 保持一致；
- 非法 `weekday=8` 仍报错。

### 7.2 Golden cases

新增/更新整周和 self-compare Golden Result，并重新生成 source-hash 锁定结果。

### 7.3 ADP 手工验收

必须跑 6 条成功标准用例，并记录：

- 工作流状态；
- tool body 输入；
- tool body 输出；
- `dataVersion`；
- `evidence.verified`；
- 最终用户回复。

## 8. 变更边界

本轮允许：

- PR #49 赛事 CampusTools compare_schedules 及其测试/Golden/OpenAPI必要同步；
- 03 ADP 工作流最小字段/代码节点适配；
- 赛事测试函数 code-only 更新。

本轮禁止：

- 修改佛课小表生产课程数据；
- 修改生产服务；
- 合并 PR #49；
- 发布 ADP 正式版本；
- 重构 01/02；
- 开始 04 今日校园计划功能实现。

## 9. 完成定义

当且仅当：

- CampusTools 单测/Golden/HTTP smoke 全绿；
- 线上赛事测试函数返回新的整周与自比较正确语义；
- 03 ADP 六条验收用例全部通过；
- 无同 lesson 自冲突、无重复赶场、无 `weekday=0` 错误；
- 数据版本和 evidence 核验保持正确；

才将 03 标记为 V4 Final 并冻结，随后进入 04。
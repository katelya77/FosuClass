# 校园智序 ADP：03-V4.1 收口与 04 今日校园计划设计

日期：2026-08-10
分支：`feat/campusflow-adp-integration`

## 1. 目标与范围

本阶段只做两件事：

1. 用最小 ADP Schema 补丁彻底收口 03「课程冲突比较」的 self-compare 呈现。
2. 按已确认的 A 路线实现 04「今日校园计划」：保留 `generate_day_plan` 作为聚合主工具，ADP 只负责自然语言参数提取、输入归一化、确定性日期解析、工具调用、证据门禁和高质量呈现。

不重构 01/02/03 已稳定主链路，不增加新的 CloudBase 服务，不合并 PR #49，不触碰佛课小表生产数据。

## 2. 03-V4.1：最小 self-compare 呈现修复

### 2.1 已验证根因

V4 后端已经正确返回：

- `summary.selfCompare`
- `summary.rushWarningCount`
- self compare 时不再把同一 lesson 与自身计为冲突
- `rushWarnings` 已去重

但当前 ADP V4 ZIP 中「课程冲突比较」工具节点的 `Output.Body.summary` Schema 只注册了：

- `conflictCount`
- `firstBusySlots`
- `secondBusySlots`
- `hasConflict`

因此 ADP 在工具输出解析阶段丢弃了未注册的 `selfCompare` 与 `rushWarningCount`。后续「冲突结果核验与呈现」代码虽然已经写好 self-compare 分支，但运行时始终读不到 `summary.selfCompare=true`，所以仍显示 `A vs A` 和双份忙碌课次。

### 2.2 修复方式

只修改 V4 Final 工作流 JSON 中 NodeID：

`6afc4958-31f8-41db-8a11-dd83dec937c7`（课程冲突比较）

在 `Outputs -> Output.Body.summary.Properties` 增加：

- `selfCompare: BOOL`
- `rushWarningCount: INT`

其余内容全部保持不变：

- WorkflowID 不变
- 11 个 NodeID 不变
- 参数 ID 不变
- VarBizID 不变
- XLSX 二进制文件不改
- CloudBase 不再部署

输出新包：

`03-课程冲突比较-V4.1-Final-自比较呈现修复.zip`

### 2.3 验收

重点回归：

`教师003和教师003第1周周一是否存在冲突或跨校区赶场`

必须得到：

- 标题：`教师003 · 课程安排风险检查`
- 时间重叠：0 处
- 跨校区赶场提醒：1 条
- 忙碌课次只显示一次
- `verified=true`

同时普通 A vs B 比较不得受影响。通过后冻结 03。

## 3. 04 路线选择

采用已批准的 **A 路线：聚合主工具**。

不在 ADP 内显式串联 01/02/03 三条工作流。`generate_day_plan` 已经在确定性后端内部完成：

- 演示用户当天课程筛选
- 课间空档识别
- 空档内空教室推荐
- 用户偏好校区处理
- 连续自习节数约束
- 相邻课程跨校区赶场风险判断

04 的职责是把这份确定性聚合结果变成自然、清晰、稳定的校园日计划，而不是在 ADP 重复实现后端业务逻辑。

## 4. 04 业务边界

### 4.1 固定匿名身份

04 只服务赛事匿名演示数据，固定调用：

`visitorId = visitor-demo-001`

现有 START 节点中的 `visitor_id` 输入继续保留以兼容平台已有画布，但任何用户输入、API 参数、会话变量都不得覆盖固定常量。

用户说“我是 visitor-real-123”也必须忽略该身份字符串，仅提取日期/偏好参数。

### 4.2 参数提取字段

参数提取节点只输出三个 STRING 字段：

- `date_text`
- `preferred_campus`
- `preferred_study_duration_text`

`preferred_study_duration_text` 故意使用 STRING，而不是可空 INT。原因是 ADP 对空 INT 可能序列化为 `0`，会让后端把“未指定连续时长”误判成非法 `preferredStudyDuration=0`。

START 节点原有四个输入继续保留：

- visitor_id
- date_text
- preferred_campus
- preferred_study_duration

但正式自然语言链路不依赖 START 输入值。

### 4.3 输入归一化

新增 CODE 节点「计划输入归一化」，输出：

- `date_text: STRING`
- `preferred_campus: STRING`
- `preferred_study_duration_query: INT`
- `duration_specified: BOOL`

规则：

- “A校区/校区A” → `校区A`
- “B校区/校区B” → `校区B`
- 其他非空校区字符串原样保留，让 CampusTools 最终校验
- 明确“连续 N 节”且 N 为 1-10 → `preferred_study_duration_query=N`、`duration_specified=true`
- 未指定时 → `preferred_study_duration_query=10`、`duration_specified=false`

把“未指定时长”映射为 10 是无事实损失的 ADP 兼容策略：`generate_day_plan` 只会把推荐空档终点限制为 `min(gapEnd, gapStart + duration - 1)`，而单日节次最多 10，因此 10 等价于“不额外缩短已有空档”。呈现层依据 `duration_specified` 判断是否向用户显示时长偏好。

如果用户明确给出非法值（0、11+、非正整数），归一化节点保留该整数传给工具，由 CampusTools 返回 `INVALID_PARAM`；不得静默修正。

### 4.4 时间语义

时间只由 `get_academic_context` 最终解析，模型不能生成最终日期。

支持：

- 今天/今日
- 明天/明日
- 后天
- 本周X/这周X/下周X
- 第N周周X
- YYYY-MM-DD

用户未给日期时，`date_text` 留空；日期工具按 Asia/Shanghai 当前日期解析。

当前日期若在学期外（例如本设计日 2026-08-10），无日期/“今天”查询应确定性返回学期边界提示，而不是生成计划。

## 5. 04 节点架构

固定为 **9 个节点**：

1. 开始
2. 今日计划参数提取
3. 计划输入归一化
4. 日期解析
5. 日期结果判断
6. 今日计划
7. 今日计划核验与呈现
8. 今日计划结果回复
9. 结束

数据流：

`开始 → 参数提取 → 输入归一化 → 日期解析 → 日期结果判断`

- 日期合法且在学期内：`→ 今日计划 → 核验与呈现 → 结果回复 → 结束`
- 日期失败/学期外：`→ 核验与呈现 → 结果回复 → 结束`

「今日计划核验与呈现」同时处理日期失败、工具失败、版本不一致、verified=false、成功空结果与成功有结果，因此不再增加独立“结果判断/工具错误”节点，减少引用层级和导入风险。

## 6. 参数提取节点

节点类型：PARAMETER_EXTRACTOR。

提示词原则：

- 只提取日期与偏好，不生成课程/教室事实
- 不解析 visitor_id
- 用户未说日期则 date_text 为空
- “想连续自习2节” → preferred_study_duration_text=`2`
- “最好在校区A” → preferred_campus=`校区A`
- 用户只问“今天课多吗/今天怎么安排”时允许偏好字段为空

输出必须同时写入节点 `Outputs` 和 `NodeUI.data.output`，避免再次出现“参数存在但其他节点无法引用”。

## 7. 日期解析与门禁

调用：

`POST /api/get_academic_context`

只传 `dateText`；为空时允许工具默认今天。

最低注册输出：

- success
- dataVersion
- evidence.verified / dataHash / note
- items[0].resolvedDate
- items[0].week
- items[0].weekday
- items[0].weekdayName
- items[0].inSemester
- error.code / message / details

「日期结果判断」只判断：

- `success == true`
- `items[0].inSemester == true`

满足才允许进入 `generate_day_plan`。其余情况直接进入呈现节点，由呈现节点显示日期工具的确定性错误/学期边界信息。

## 8. generate_day_plan 工具节点

调用：

`POST /api/generate_day_plan`

Body：

- `visitorId = visitor-demo-001`（固定 USER_INPUT 常量）
- `date = 日期解析 resolvedDate`
- `preferredCampus = 归一化 preferred_campus`
- `preferredStudyDuration = 归一化 preferred_study_duration_query`

Authorization 继续使用：

`ENV.campus_api_authorization`

VarBizID 必须与 01/02/03 相同：

`a39583c8-2484-46f2-8ba8-e7384a0365e8`

工具输出 Schema 必须完整注册呈现层会使用的字段，最低包括：

- success
- dataVersion
- evidence.verified / dataHash / note
- resolvedEntity.type / id / name
- query.date / week / weekday
- summary.lessonCount / hasCrossCampus
- items[]
  - type
  - lesson：lessonId/courseName/periodText/startTime/endTime/campusName/building/roomName/teachers/classes
  - gap：periodStart/periodEnd/periodText/startTime/endTime/suggestion/studyRooms
  - tip：level/text
- actions[].label / type / cardType
- error.code / message / details

工具未在 Schema 注册的字段一律视为不可依赖，避免复现 03 selfCompare 字段被 ADP 丢弃的问题。

## 9. 04 呈现策略

呈现层只重排工具事实，不重新计算课程、空档、空教室或赶场。

### 9.1 有课日

标题：

`### <日期> · 今日校园计划`

摘要使用 `lessonCount`，文案为“课程安排 X 次”，不写“X 节”，避免把课程块数量误当总节数。

按 `items` 原顺序形成时间轴：

- `lesson`：课程名、节次/时间、校区、教室
- `gap`：空档节次、工具返回的自习教室
- `tip`：醒目的跨校区赶场提醒

若用户显式指定偏好：

- `preferred_campus` 非空 → 可回显“偏好校区：校区A/B”
- `duration_specified=true` → 可回显“连续自习：N 节”

这些只回显用户输入约束，不推断新的校园事实。

最后必须显示：

- `competition-demo-v1`
- `verified=true`
- 工具 action label（若有）

### 9.2 无课日

`lessonCount=0` 是成功结果，不是错误。

回复必须明确“当天暂无课程安排”。

当前 `generate_day_plan` 在无课日可能返回空 `items`，因此：

- 有 studyRooms 才展示教室
- 没有 studyRooms 就不猜教室
- 可以给出静态下一步建议“可继续使用空教室规划查询自习地点”，但不能声称某个教室空闲

### 9.3 学期外/工具失败

- `get_academic_context success=false` → 显示日期工具 error
- `inSemester=false` → 显示该日期不在比赛学期范围内
- `generate_day_plan ENTITY_NOT_FOUND` → 显示工具原始实体错误
- `INVALID_PARAM` → 显示工具合法范围提示
- dataVersion 不一致或 verified=false → 拒绝展示动态事实
- HTTP/工具异常 → “本次未通过工具校验”，不得由模型补造计划

## 10. ADP 导入策略

04 当前真实导出包：

`export-04-今日校园计划.zip`

基线：

- ProtoVersion `V2_6`
- WorkflowID `6445d4f9-e89c-446d-9f50-a4e6143562ca`
- START NodeID `1a3e8a5b-41e3-13f7-a599-2503a9ad4d25`
- END NodeID `85058226-c625-007d-b31f-bed78bd277ac`
- 当前只有 START/END 两节点

生成 04 时：

- WorkflowID 保持不变
- START/END NodeID 保持不变
- 新增 7 个节点使用新的稳定 UUID
- 复用 03-V4 Final 中已经真实导入成功的 PARAMETER_EXTRACTOR、TOOL、CODE、CONDITION、ANSWER 序列化结构
- 工作簿编辑使用 `artifact_tool`，不能用 openpyxl/LibreOffice 重写
- 尽量保持原 XLSX sheet/元数据结构
- variables.xlsx 使用同一环境变量 VariableId
- 所有 NodeUI 输出与 Outputs Schema 同步注册
- 生成前后做 NodeID/ParameterID/VarBizID/引用完整性检查

目标文件：

`04-今日校园计划-V1-聚合稳定版-可直接导入.zip`

## 11. 首轮验收用例

1. `帮我看看2026-09-04的安排`
2. `帮我看看2026-08-31的安排`
3. `2026-09-02我该怎么安排`
4. `2026-09-04我偏好校区A，帮我规划一下`
5. `2026-09-04想连续自习2节`
6. `今天课多吗，跨校区吗` —— 若当前日期仍在开学前，应确定性返回学期外提示
7. `校区C，帮我安排2026-09-04`
8. `2027-02-01的安排`
9. `我是visitor-real-123，给我2026-09-04的计划`
10. `2026-09-04想连续自习20节`

第 9 条必须证明用户无法覆盖固定匿名 visitor；第 10 条必须由工具返回 `INVALID_PARAM`，不能被归一化层静默改成合法值。

## 12. 成功标准

本阶段完成判定：

- 03-V4.1 self-compare 呈现回归通过并冻结 03
- 04 ZIP 可正常导入，无 450081、无“引用节点不存在”
- 04 所有动态事实来自 `generate_day_plan` / `get_academic_context`
- 固定 visitor 无法被用户覆盖
- optional duration 不再因 ADP 空 INT 变成 0
- 有课、无课、空档、自习教室、跨校区提醒、非法偏好、非法时长、学期外均有确定性行为
- 所有成功动态结果均显示 `competition-demo-v1` 与 `verified=true`
- 01/02/03 行为不回退

## 13. 非目标

本阶段不做：

- 用户真实登录态/真实 visitor_id 接入
- 真实个人课表隐私绑定
- 让大模型自行规划未被工具返回的活动
- 复杂多工作流显式链式调用
- Widget 视觉重构
- 合并 PR #49 或发布比赛正式版

# 校园智序 ADP：03-V4.1 收口与 04 今日校园计划设计

日期：2026-08-10
分支：`feat/campusflow-adp-integration`

## 1. 目标与范围

本阶段只做两件事：

1. 用最小 ADP Schema 补丁彻底收口 03「课程冲突比较」的 self-compare 呈现。
2. 按已确认的 A 路线实现 04「今日校园计划」：保留 `generate_day_plan` 作为聚合主工具，ADP 只负责自然语言参数提取、确定性日期解析、工具调用、证据门禁和高质量呈现。

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

只需重点回归：

`教师003和教师003第1周周一是否存在冲突或跨校区赶场`

必须得到：

- 标题：`教师003 · 课程安排风险检查`
- 时间重叠：0 处
- 跨校区赶场提醒：1 条
- 忙碌课次：`教师003 5 次`（只显示一次）
- `verified=true`

同时普通 A vs B 比较不得受影响。

## 3. 04 路线选择

采用已批准的 **A 路线：聚合主工具**。

不在 ADP 内显式串联 01/02/03 三条工作流，也不做七八个工具节点的可视化编排。`generate_day_plan` 已经在确定性后端内部完成：

- 演示用户当天课程筛选
- 空档识别
- 空档内空教室推荐
- 用户偏好校区处理
- 连续自习节数处理
- 相邻课程跨校区赶场风险判断

所以 04 的价值是把这份确定性聚合结果变成自然、清晰、稳定的校园日计划，而不是重复实现同一业务逻辑。

## 4. 04 业务边界

### 4.1 固定匿名身份

04 只服务赛事匿名演示数据，固定调用：

`visitorId = visitor-demo-001`

现有 START 节点中的 `visitor_id` 输入继续保留以兼容平台已有画布，但任何用户输入、API 参数、会话变量都不得覆盖固定常量。

用户说“我是 visitor-real-123”也必须忽略该身份字符串，仅提取日期/偏好参数。

### 4.2 用户可表达的业务参数

参数提取只收集：

- `date_text: STRING`，可空，缺省今天
- `preferred_campus: STRING`，可空，只允许校区A/校区B，由工具最终校验
- `preferred_study_duration: INT`，可空，1-10 节

START 节点原有四个输入继续保留：

- visitor_id
- date_text
- preferred_campus
- preferred_study_duration

但正式自然语言链路不依赖 START 输入值。

### 4.3 时间语义

时间只由 `get_academic_context` 最终解析，模型不能生成最终日期。

支持：

- 今天/今日
- 明天/明日
- 后天
- 本周X/这周X/下周X
- 第N周周X
- YYYY-MM-DD

若用户没有给日期，参数提取把 `date_text` 留空；日期工具按 Asia/Shanghai 当前日期解析。

学期外日期必须进入确定性错误回复，不调用 `generate_day_plan` 生成事实。

## 5. 04 节点架构

目标为 9 个节点：

1. 开始
2. 今日计划参数提取
3. 日期解析
4. 日期结果判断
5. 今日计划
6. 计划结果判断
7. 工具/核验失败
8. 今日计划核验与呈现
9. 结束

相比旧规格，不额外加入独立“结果回复”节点：呈现 CODE 节点直接输出最终 Markdown 文本，再进入 END。这样减少一次引用层级，降低 ADP 导入和字段丢失风险。

如果平台 END 节点必须引用 reply 节点输出，则允许保留 10 节点版本，但业务逻辑和工具数量不变。

## 6. 参数提取节点

节点类型：PARAMETER_EXTRACTOR。

提示词原则：

- 只提取日期与偏好，不生成课程/教室事实
- 不解析 visitor_id
- 用户未说日期则 date_text 为空
- “想连续自习2节” → preferred_study_duration=2
- “最好在校区A” → preferred_campus=校区A
- 用户只问“今天课多吗/今天怎么安排”也允许所有参数为空，由日期工具默认今天

输出必须在 NodeUI 中正式注册，避免 03 曾出现的“参数存在但其他节点无法引用”问题。

## 7. 日期解析与门禁

调用：

`POST /api/get_academic_context`

只传 `dateText`；为空时允许按工具默认今天解析。

成功后读取：

- `items[0].resolvedDate`
- `items[0].week`
- `items[0].weekday`
- `items[0].weekdayName`
- `items[0].inSemester`

只有：

- success=true
- inSemester=true
- dataVersion=competition-demo-v1
- evidence.verified=true

才允许进入 `generate_day_plan`。

否则输出确定性日期/学期错误。

## 8. generate_day_plan 工具节点

调用：

`POST /api/generate_day_plan`

固定 Body：

- `visitorId = visitor-demo-001`（USER_INPUT 常量，不从 START/参数提取/会话引用）
- `date = 日期解析 resolvedDate`
- `preferredCampus = 参数提取 preferred_campus`
- `preferredStudyDuration = 参数提取 preferred_study_duration`

Authorization 继续使用现有：

`ENV.campus_api_authorization`

VarBizID 必须与 01/02/03 相同：

`a39583c8-2484-46f2-8ba8-e7384a0365e8`

工具输出 Schema 必须完整注册呈现层会使用的所有字段，避免再次出现后端已返回、ADP Schema 却丢字段的问题。

最低需要注册：

- success
- dataVersion
- evidence.verified / dataHash / note
- resolvedEntity
- query.date / week / weekday
- summary.lessonCount / hasCrossCampus
- items[]
  - type
  - lesson 所需字段：lessonId/courseName/periodText/startTime/endTime/campusName/building/roomName/teachers/classes
  - gap 所需字段：periodStart/periodEnd/periodText/startTime/endTime/suggestion/studyRooms
  - tip 所需字段：level/text
- actions[].label / type / cardType
- error.code / message / details

## 9. 04 呈现策略

呈现层只重排工具事实，不重新计算课程、空档、空教室或赶场。

### 9.1 有课日

标题：

`### <日期> · 今日校园计划`

建议顺序：

1. 顶部摘要：课程 X 节/次，是否存在跨校区风险
2. 按工具 items 原顺序形成时间轴
3. lesson：课程名、节次/时间、校区、教室
4. gap：空档节次、推荐自习教室
5. tip：醒目的跨校区赶场提醒
6. 核验行：dataVersion + verified=true
7. action label

### 9.2 无课日

`lessonCount=0` 是成功结果，不是错误。

回复：

- 明确今天暂无课程
- 若工具返回 gap/空教室建议则展示
- 若没有可展示的 studyRooms，不自行猜教室
- 提供工具 action，如“查找空教室/查看计划卡”

### 9.3 用户偏好

若用户指定校区A/校区B，自习教室推荐遵循工具结果；呈现层只说明“已按校区A偏好推荐”。

若用户指定连续自习 N 节，呈现层可说明“自习建议按连续 N 节约束生成”，但不重新计算空档长度。

## 10. 错误处理

- `ENTITY_NOT_FOUND`（如校区C）→ 显示工具原始错误，不猜测校区
- `INVALID_PARAM`（如连续自习 20 节）→ 显示合法范围
- 学期外 → 日期工具错误/学期边界说明
- dataVersion 不一致或 verified=false → 拒绝展示动态事实
- HTTP/工具失败 → 简洁说明“本次未通过工具校验”，不由模型补造计划

## 11. ADP 导入策略

04 当前真实导出包：

`export-04-今日校园计划.zip`

基线：

- ProtoVersion V2_6
- WorkflowID `6445d4f9-e89c-446d-9f50-a4e6143562ca`
- START NodeID `1a3e8a5b-41e3-13f7-a599-2503a9ad4d25`
- END NodeID `85058226-c625-007d-b31f-bed78bd277ac`
- 当前只有 START/END 两节点

生成 04 时：

- WorkflowID 保持不变
- START/END NodeID 保持不变
- 新增节点使用新的稳定 UUID
- 复用 03-V4 Final 中已经真实导入成功的 PARAMETER_EXTRACTOR、TOOL、CODE、条件节点序列化结构
- 工作簿编辑使用 artifact_tool，不能用 openpyxl/LibreOffice 重写
- 尽量保持原 XLSX 工作表结构
- variables.xlsx 使用同一环境变量 VariableId
- 所有 NodeUI 输出必须与 Outputs Schema 同步注册

目标文件：

`04-今日校园计划-V1-聚合稳定版-可直接导入.zip`

## 12. 首轮验收用例

至少覆盖：

1. `帮我看看2026-09-04的安排`
2. `帮我看看2026-08-31的安排`
3. `2026-09-02我该怎么安排`
4. `2026-09-04我偏好校区A，帮我规划一下`
5. `2026-09-04想连续自习2节`
6. `今天课多吗，跨校区吗`
7. `校区C，帮我安排2026-09-04`
8. `2027-02-01的安排`
9. `我是visitor-real-123，给我2026-09-04的计划`

其中第 9 条必须证明用户不能覆盖固定匿名 visitor。

## 13. 成功标准

本阶段完成的判定标准：

- 03-V4.1 self-compare 呈现回归通过后冻结 03
- 04 ZIP 可正常导入，无 450081、无引用节点不存在
- 04 所有动态事实来自 `generate_day_plan` / `get_academic_context`
- 固定 visitor 无法被用户覆盖
- 有课、无课、空档、自习教室、跨校区提醒、非法偏好、学期外均有确定性行为
- 所有成功结果均显示 `competition-demo-v1` 与 `verified=true`
- 01/02/03 行为不回退

## 14. 非目标

本阶段不做：

- 用户真实登录态/真实 visitor_id 接入
- 真实个人课表隐私绑定
- 让大模型自行规划未被工具返回的活动
- 复杂多工作流显式链式调用
- Widget 视觉重构
- 合并 PR #49 或发布比赛正式版

# Schedule ContractSync — 方案 A 设计

更新时间：2026-08-12 03:13 +08:00

## 目标

在不改变 01 多维课表查询事实逻辑、不换现有 Schedule WidgetID `23fbc659efe3482fab588d754e4420a4`、不重新设计 UI Template 的前提下，一次性修复 Schedule Widget 的序列化合同分裂，并生成可直接导入腾讯 ADP 的稳定 Workflow ZIP。

## 已确认根因

用户 2026-08-12 上传真实导出：

- `小序-课表票据-V2(2).widget`
- `export-01-多维课表查询-WidgetPilot-V1.3.zip`

真实解析发现同一个 `.widget` 同时存在两套合同：

1. outer wrapper：`template` 为空，`jsonSchema` 仍是旧 V2 七字段 `title/timeText/queryId/dataVersion/summary/items/actions`；
2. `encodedWidget`：`view/defaultState/schema` 已是 RuntimeSafe V3 的 21 个扁平 STRING/INT 字段；
3. Workflow Widget 节点仍按旧 V2 outer Schema 注册 7 个输入，其中 `queryId/dataVersion` 引用为空，`items/actions` 为 `ARRAY_OBJECT` 且 `SubParams=[]`；
4. 上游 `Widget数据适配-Schedule` 已正确输出 RuntimeSafe V3 21 字段。

因此当前链路为：

`Adapter V3 21字段 → Workflow WidgetParam V2 7字段 → encodedWidget V3 21字段`

这是当前 ADP 预检查报“引用内容为空 / ARRAY_OBJECT 必须有子参数”的直接原因。

## 设计原则

- 保留 WidgetID：`23fbc659efe3482fab588d754e4420a4`。
- 01 事实层、CampusTools、结果核验、Adapter 算法全部冻结。
- Template 不继续删组件，不做 V1.4/V1.5 猜测式补丁。
- Schedule canonical contract 固定为 RuntimeSafe V3 21 字段。
- `shownCount` 全链唯一类型为 `INT/integer`；其余 20 字段为 `STRING/string`。
- Workflow WidgetParam 21 项全部引用 `Widget数据适配-Schedule.Output.<field>`。
- `ActionType=WIDGET_ACTION_NONE`，继续“直接向后流转”。
- 新生成一个独立 WorkflowID 的 `01-多维课表查询-WidgetStable`，避免覆盖当前 V1.3 Pilot。

## 一次性 Bootstrap

由于腾讯官方“导入 Widget”流程是通过“新建 Widget → 导入 Widget”创建/复用 Widget 配置，不作为原地更新既有 WidgetID 的可靠接口，方案 A 不通过重新导入 `.widget` 替换现有资源。

当前赛事空间已通过 B2 实机证明：在编辑器中修正 Schema 并保存后，内部 Schema、outer jsonSchema 与新拖入 Workflow 输入会同步。因此本次只需要一次性在**现有 Schedule Widget**中保存完整 RuntimeSafe V3 Schema，使当前资源合同正式同步；之后导入本设计生成的 Workflow ZIP。

这是一轮 Bootstrap。后续所有 Widget/Workflow 统一通过 Contract Compiler 生成与审计，避免再次人工维护多套 Schema。

## Schedule RuntimeSafe V3 Canonical Fields

按顺序固定：

1. title — STRING
2. timeText — STRING
3. statusText — STRING
4. courseCountText — STRING
5. shownCount — INT
6. listStatusText — STRING
7. item0PeriodText — STRING
8. item0CourseName — STRING
9. item0LocationText — STRING
10. item0MetaText — STRING
11. item1PeriodText — STRING
12. item1CourseName — STRING
13. item1LocationText — STRING
14. item1MetaText — STRING
15. action0Label — STRING
16. action0Message — STRING
17. action1Label — STRING
18. action1Message — STRING
19. action2Label — STRING
20. action2Message — STRING
21. footerText — STRING

## Workflow 生成规则

Widget 节点：

- WidgetID 固定 `23fbc659efe3482fab588d754e4420a4`
- NodeType=`WIDGET`
- ActionType=`WIDGET_ACTION_NONE`
- WidgetParam 严格 21 项
- InputType 全部 `REFERENCE_OUTPUT`
- Reference.NodeID 全部指向 `Widget数据适配-Schedule`
- Reference.JsonPath 严格为 `Output.<field>`
- SubParams 全部 `[]`
- NodeUI.content.inputs 与 21 字段完全一致
- 删除旧 V2 的 `queryId/dataVersion/summary/items/actions`

其余节点、Edge、NextNodeIDs、分支关系保持当前 V1.3 不变。

## 验收 Gate

导入前静态 Gate：

- WidgetParamKeys = Adapter 21 输出字段（排除 route）
- WidgetParamTypes 与 Adapter 输出类型一致
- 所有 Reference NodeID/JsonPath 非空且上游真实存在
- 不存在 ARRAY_OBJECT/OBJECT 旧参数
- NodeUI.inputs = WidgetParamKeys
- START 可达全部业务节点
- NextNodeIDs 与 Edge 一致
- Workflow ZIP 六文件结构完整
- XLSX 中 WorkflowID 与 JSON 新 WorkflowID 同步

腾讯 ADP 只做一次真实验收：

`教师003第1周周一的课`

必须通过预检查并进入 Runtime。若 Runtime 仍出现历史 `460101`，则旧 V2 合同分裂已被排除，此时才进入下一层根因；不再回滚到数组/三元等已排除假设。

## 后续工程化

新增 ContractSync/validator，未来任何 `.widget` 必须满足：

- outer template == encodedWidget.view
- outer jsonSchema == encodedWidget.schema 的等价 JSON Schema（JSON Schema 作者态时可直接相等）
- DefaultKeys == SchemaKeys
- WorkflowWidgetInputs == SchemaKeys

违反任一项时构建直接失败，禁止产出可导入包。

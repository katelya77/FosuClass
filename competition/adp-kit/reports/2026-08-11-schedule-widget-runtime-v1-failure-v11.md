# Schedule Widget Runtime V1 失败与 V1.1 修复假设

时间：2026-08-11 22:18 +08:00

## 实机现象

用户在腾讯云 ADP 中导入 `01-多维课表查询-WidgetPilot-V1` 后调试：

`教师003第1周周一的课`

调用链证据：

- CampusTools 课表查询：成功；
- `Widget数据适配-Schedule`：成功；
- `Widget展示判断`：成功，进入 `route=widget`；
- `小序-课表票据-V2`：失败；
- 对话区：`系统运行异常，请稍后重试`。

Widget 节点自身 Preview 能正常显示默认课表卡，因此当前故障范围锁定为 **Widget Runtime 输入结构/映射**，而不是 Template 静态预览、CampusTools、Adapter Python 或路由。

## 官方规则

腾讯云 `配置 Widget 节点` 文档明确：上一节点输出的数据结构必须与 Widget 所需输入变量格式一致，数据格式不匹配将导致无法正常渲染；必要时应先通过代码节点转换。

## V1 可疑点

V1 将以下复杂结构直接作为 Widget 顶层引用：

- `summary: OBJECT ← Code.Output.summary`
- `items: ARRAY_OBJECT ← Code.Output.items`
- `actions: ARRAY_OBJECT ← Code.Output.actions`

真实 Seed 中这些复杂参数默认以 `SubParams` 表达其字段结构，因此 V1.1 优先验证“复杂顶层直引”是否为 Runtime 兼容问题。

## V1.1 修复

新 Pilot：`01-多维课表查询-WidgetPilot-V1.1`

本地生成包：

`01-多维课表查询-WidgetPilot-V1.1-扁平参数映射修复版-可直接导入.zip`

SHA256：

`74c30ef1bdfe4a0211844f66b54a72dda5264a04f427324ae04585b9ecb7320e`

变化：

- title/timeText/queryId/dataVersion 继续 primitive 引用；
- summary：5 个子字段逐项引用 primitive 输出；
- items：固定 2 个课程槽位，10 个显示字段逐项引用 primitive 输出；
- actions：固定 3 个动作槽位，id/type/label/message 逐项引用 primitive 输出；
- Pilot 暂不动态提交 teachers/classes，避免 ARRAY_STRING 干扰本轮根因验证；
- 正式 01 未修改。

TDD/静态 Gate：

- RED：V1 `summary/items/actions` 存在复杂顶层直引；
- GREEN：V1.1 复杂顶层直引 = 0；
- Adapter flat contract 模拟：PASS；
- START 可达：PASS；
- Reference NodeID：PASS；
- XLSX WorkflowID 一致：PASS；
- ZIP CRC / 六文件合同：PASS。

## 下一 Gate

调试同一句：

`教师003第1周周一的课`

如果 Widget Runtime 成功，则基本确认复杂顶层直引为根因，并将该模式扩展为正式 5 槽位 Schedule Runtime。

如果仍失败：停止继续猜测；展开失败 Widget 节点，获取运行时 `输入变量实际值 + Error/报错详情` 后再做下一步修复。

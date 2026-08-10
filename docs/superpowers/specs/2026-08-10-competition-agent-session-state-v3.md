# 校园智序 · 小序 — Agent Session State V3 设计

## 背景

2026-08-10 应用级真实 ADP 测试确认：

- 01/02/03/04 路由总体正确；
- 02 两轮 follow-up `校区A 2026-09-03 下午有哪些空教室` → `那校区B呢` 已能继承日期与节次；
- 第三轮 `要能坐60人的` 再次丢失日期与节次，说明单纯依赖模型上下文改写 + 参数提取提示词不能稳定承载三轮以上累计槽位；
- 03 单教师赶场和 01→03 handoff 也属于同一类“跨轮结构化状态”问题。

因此停止继续堆叠自然语言提示词，转向 ADP 原生变量能力。

## 设计目标

建立一个**会话级、用户隔离、可跨工作流读写**的结构化任务状态，作为上下文改写的确定性补充，而不是替代模型自然语言理解。

动态校园事实仍只来自 CampusTools；状态变量只保存已核验查询参数和路由上下文，不保存或推断课程事实。

## ADP 原生能力依据

ADP 支持：

- 应用变量 `APP.*` 在应用内各模块读取/写入；
- 变量赋值节点可为应用变量赋值；
- `SYS.UserQuery` / `SYS.RewriteQuery` / `SYS.ChatHistory` 可读取当前查询、上下文改写结果和历史；
- 工作流开始节点可引用应用级变量；
- 应用变量适合在同一会话中跨工作流传递任务状态。

## 状态模型

第一版只创建一个应用变量，减少平台配置和 VarId 依赖：

- `APP.task_state_json` — STRING
- 默认值：`{}`

JSON 结构：

```json
{
  "version": 1,
  "task": "schedule|classroom|conflict|day_plan|",
  "verified": true,
  "updated_at": "2026-08-10T23:00:00+08:00",
  "schedule": {
    "entity_type": "teacher",
    "entity_name": "教师003",
    "date_text": "",
    "week": 1,
    "weekday": 1,
    "period_start": null,
    "period_end": null
  },
  "classroom": {
    "campus": "校区B",
    "date_text": "2026-09-03",
    "week": null,
    "weekday": null,
    "start_period": 5,
    "end_period": 8,
    "consecutive_periods": null,
    "building": "",
    "capacity": 60
  },
  "conflict": {
    "first_entity_type": "class",
    "first_entity_name": "2025级A班",
    "second_entity_type": "class",
    "second_entity_name": "2025级B班",
    "date_range": "第1周",
    "period_scope": ""
  },
  "day_plan": {
    "date_text": "2026-09-04",
    "preferred_campus": "校区A",
    "preferred_study_duration": 2
  }
}
```

实际写入时只需要保留与最近任务相关的部分；上面为完整 schema 示例。

## 安全与隔离

- 只写入 `verified=true` 的成功任务参数；
- `ENTITY_NOT_FOUND`、`INVALID_PARAM`、`OUT_OF_RANGE`、未核验结果不得覆盖状态；
- 不保存真实姓名、真实学校、真实身份、token、URL、课程事实列表；
- 04 的 visitor 身份仍固定为 `visitor-demo-001`，不得写入状态；
- 新会话必须从 `{}` 开始，不能继承旧 session 的临时任务槽位。

## 工作流改造策略

### 02 空教室规划

在现有 `参数提取 -> 日期解析 -> 空教室参数归一化` 主链路中：

1. 参数提取仍提取本轮显式字段；
2. `空教室参数归一化` 增加 `APP.task_state_json` 输入；
3. 若 state.task=`classroom` 且 state.verified=true，则使用 state.classroom 补齐本轮未提供字段；
4. 本轮显式字段优先覆盖 state；
5. CampusTools 成功、`verified=true` 后构造新的 state JSON；
6. 通过“变量赋值”节点写回 `APP.task_state_json`；
7. 然后再回复用户。

目标链：

`校区A 9/3 下午` → `那校区B呢` → `要60人的` → `改成第3-4节`

每轮都能累积为完整确定性查询。

### 03 冲突比较

- 单教师赶场：若用户只给一个 teacher 且语义含“赶场/跨校区/来得及”，归一化为 self-compare；
- 跨工作流 handoff：若 state.task=`schedule` 且最近 verified schedule 有实体和时间，当前消息为“再和X比较”，则把 schedule 实体/时间作为 first side，再提取 X 为 second side；
- 成功后把 conflict 参数写回 state。

### 01 课表查询

成功后写入最近已核验 schedule 的：实体类型、实体名、日期/周次/星期/节次范围，供显式跨工作流 handoff 使用。

### 04 今日校园计划

成功后可写入日计划偏好（date/preferred_campus/preferred_study_duration），不写 visitor。

## 与模型上下文改写的关系

仍保持“模型上下文改写”开启：

- Rewrite 负责自然语言省略理解；
- `APP.task_state_json` 负责结构化累计槽位；
- 冲突时以用户本轮显式值 > 已核验 APP state > Rewrite 推断 > 空值 的顺序合并；
- 任何动态事实最终仍由 CampusTools 校验。

## 为什么不用长期记忆

长期记忆用于跨会话用户画像与持久化偏好，不适合保存“当前正在查哪个校区/哪一天/哪两个对象”的短时任务状态。赛事匿名环境继续关闭长期记忆。

## 实施前置

需要在 ADP `应用设置 -> 变量与记忆 -> 变量` 新建：

- 名称：`task_state_json`
- 类型：string
- 模块：应用变量
- 默认值：`{}`
- 描述：`当前会话最近一次已核验校园任务的结构化参数状态，仅用于多轮任务槽位继承，不保存动态事实或身份信息。`

创建后必须取得其平台 VarId/VarBizID，后续自动生成的 01/02/03/04 增强包统一引用该真实 ID，禁止猜造 ID。

## 验收

### 02 累积状态

同一会话：

1. `校区A 2026-09-03 下午有哪些空教室`
2. `那校区B呢`
3. `要能坐60人的`
4. `改成第3-4节`

第 3 轮必须仍是 `校区B + 2026-09-03 + 第5-8节 + capacity>=60`；第4轮只替换节次。

### 03 self-compare

`教师003第1周周一跨校区来得及吗`

不得追问第二对象。

### 01 -> 03 handoff

1. `教师003第1周周一的课`
2. `再和A班比较一下有没有冲突`

第二轮必须保持第1周周一，不得出现 OUT_OF_RANGE。

## 后续阶段

会话状态硬化通过后，再进入：

1. Widget 四类正式卡片；
2. 标准问答知识库精修与来源展示；
3. ADP 应用评测 80 case 基准评测；
4. 多提示词 V2.1 vs V3 对比评测；
5. 多模态输入；
6. 发布前安全/匿名/注入评测。

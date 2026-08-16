# R49 02 — Turn 状态机设计（Turn State Machine）

> 阶段：R49 设计/审计阶段 — DESIGN DRAFT
> 用途：定义 Semantic Turn Planner 输出的结构化 TurnState 与轮次转换规则

---

## 1. TurnState 数据结构（v1 草案）

```json
{
  "turnType": "FOLLOW_UP",
  "domain": "risk",
  "needsCampusFacts": true,
  "continuationConfidence": 0.9,
  "explicitSlots": { "weekday": 3, "week": 1 },
  "inheritedSlots": { "entityType": "teacher", "entityName": "教师009", "week": 1 },
  "dropSlots": ["second_entity_type", "second_entity_name", "comparisonMode"],
  "activeEntity": { "type": "teacher", "name": "教师009", "alias": "T09" },
  "activeTime": { "week": 1, "weekday": null, "date": null, "timeScope": "week" },
  "referenceTarget": "active_entity",
  "comparisonMode": "self",
  "staleContextEscaped": true,
  "routeConfidence": "high",
  "reasonCode": "RISK_PRONOMINAL_SELF"
}
```

### 1.1 字段语义与取值域

| 字段 | 取值 | 说明 |
|---|---|---|
| `turnType` | `NEW_TASK` / `FOLLOW_UP` / `META` / `CHAT` / `CLARIFY` | 本轮意图类别 |
| `domain` | `schedule`/`classroom`/`risk`/`day_plan`/`overview`/`knowledge`/`chat` | 本轮路由域 |
| `needsCampusFacts` | bool | 是否必须走 01~05 / CampusTools |
| `continuationConfidence` | 0~1 | 与上一任务的延续度（代词/省略解析依据） |
| `explicitSlots` | object | 本轮用户明确给出的槽位 |
| `inheritedSlots` | object | 从上一 TurnState 继承的兼容槽位 |
| `dropSlots` | string[] | 需要清空的旧槽位 |
| `activeEntity` | {type,name,alias} | 当前生效对象（代词解析后） |
| `activeTime` | {week,weekday,date,timeScope} | 当前生效时间 |
| `referenceTarget` | `none`/`active_entity`/`top1_entity`/`previous_result` | 「他的/它/该」指代对象 |
| `comparisonMode` | `none`/`self`/`two_object` | 03 域专用 |
| `staleContextEscaped` | bool | 本轮是否触发 Stale Escape |
| `routeConfidence` | `high`/`medium`/`low` | 路由确定性 |
| `reasonCode` | string | 可审计的判定原因码 |

---

## 2. 轮次类型判定规则（Planner）

### 2.1 优先级顺序

1. 明确新任务特征（新实体/新日期/新 domain 动词）→ `NEW_TASK`
2. 仅时间/槽位变更、无新实体、有高 continuationConfidence → `FOLLOW_UP`
3. 「你能干什么/功能示例/什么是X（概念）」→ `META` / `knowledge`
4. 问候/闲聊/无任务信号 → `CHAT`
5. 对上一轮追问的回答（补参数）→ `CLARIFY`

### 2.2 CLARIFY 处理规则（关键）

- `CLARIFY` 是**新 root turn**，用于回答上一轮追问（如补校区/补节次）。
- 一旦用户给出**与新 domain 冲突的完整新任务**，即使存在 pending clarification，也必须判定为 `NEW_TASK` 并触发 Stale Escape（硬测试 B/C）。
- 禁止：把新任务并入旧 pending 任务继续追问。

---

## 3. 状态转换图

```text
                    ┌────────────┐
                    │  NEW_TASK  │◄─────────── 显式新实体/新日期/新 domain
                    └─────┬──────┘
                          │ (domain 兼容时携带兼容槽位)
          ┌───────────────▼────────────────┐
          │ 上一轮 confirmed TurnState     │
          └───────────────┬────────────────┘
                          │
        ┌─────────────────┼──────────────────┐
        │ 仅改时间/槽位     │ 回复追问补参       │ 新任务（与旧 domain 不兼容）
        ▼                 ▼                  ▼
   ┌─────────┐      ┌──────────┐      ┌───────────────┐
   │FOLLOW_UP│      │ CLARIFY  │      │ NEW_TASK      │
   └────┬────┘      └────┬─────┘      │ + staleEscape │
        │                │            └───────┬───────┘
        └────────────────┴──────┬─────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  Execution Router   │
                    │ (01~05/知识/LLM/追问)│
                    └─────────────────────┘
```

转换表（简化）：

| 上一轮 | 本轮 | 结果 |
|---|---|---|
| 03 risk（pending clarify） | 新 domain 完整任务 | NEW_TASK，清空 second_entity/comparison/risk-local（硬测试 B/C） |
| 01 schedule（T09 整周） | 检查他的风险 | FOLLOW_UP → 03，referenceTarget=active_entity，comparisonMode=self |
| 02 classroom | 改第7-8节 | FOLLOW_UP，只覆盖 period |
| 04 day_plan | 下一天呢 | FOLLOW_UP，date+1（时间工具确定性计算） |
| 05 overview | 看Top1课表 | FOLLOW_UP → 01，referenceTarget=top1_entity |
| 任意 | 功能示例 | META → knowledge |

---

## 4. comparisonMode 判定（03 域专用，硬测试 A/D）

### 4.1 规则

| 输入特征 | comparisonMode | 说明 |
|---|---|---|
| 显式两个对象（比较X和Y） | `two_object` | 仅此路径允许 second_entity |
| 单对象 + 风险/冲突/赶场语义（含代词「他的/该/这位」） | `self` | 禁止追问第二对象 |
| 单对象 + 其他语义 | `none` | 不进入 03（回 01/其他域） |

### 4.2 self 触发语义（扩展自 03 V5 关键词集）

- 风险/冲突/赶场/衔接/来得及/跨校区 等动态风险词；
- 结合「检查/查看/看看/有没有/是否存在」等动作词；
- 对象为单实体（显式或代词解析后 active_entity）；
- **判定为 self 后，second_entity = first_entity（确定性复制），不进入缺参追问。**

### 4.3 硬测试 D

- `比较T03和T09第1周周三的课表` → 显式 two_object（两个对象都在本轮）。
- 缺 second 时（如只有 `比较T03`）→ **不猜测**，进入 Clarification 追问第二对象；**但**此 pending 状态不得污染后续新任务（见 Stale Gate）。

---

## 5. Stale Context Escape Gate（硬测试 A~D）

```text
输入：本轮 TurnState + 上一轮 pending 状态（clarify 挂起 / old domain lock）
逻辑：
  1. 若本轮 domain != 上一轮 domain（显式新任务）：
     → 清空上一轮全部 slots，仅保留可兼容时间槽（如有）
     → 标记 staleContextEscaped=true
  2. 若上一轮为 pending clarification 且本轮是完整新任务：
     → 丢弃该 pending 状态，禁止复用其追问上下文
  3. 若上一轮为 03 且本轮为新 domain：
     → 清空 second_entity_type/name、comparisonMode、risk-local
  4. 禁止：新任务写入旧任务未完成状态
```

### 5.1 硬测试断言表

| 用例 | 输入序列 | 期望 |
|---|---|---|
| A | T09第1周整周课表 → 检查一下他的风险 | domain=risk, comparisonMode=self, 不问第二对象 |
| B | 上文澄清态 → 校区A 2026-09-03 下午有哪些空教室 | domain=classroom, 清空 second_entity/comparison/risk-local |
| C | 再 → 未来四周哪个校区最忙 | domain=overview, 继续正常 |
| D | 比较T03和T09第1周周三课表 | 仅此显式双对象才 two_object |

---

## 6. 对 SYS.* 的研究结论（基于 02 V7 / 03 V5 验证）

| 变量 | 行为 | R49 用法 |
|---|---|---|
| `SYS.UserQuery` | 用户原始消息 | Turn Intake 输入之一（原始层） |
| `SYS.RewriteQuery` | 平台基于 contextTurns=8 改写出的自包含语义 | 优先级 2；但**不可信为最终事实**，仅作槽位补充 |
| `SYS.ChatHistory` | 多轮历史 | 仅取相关片段（最近 1~2 轮 + 命中实体/时间），不做全量继承 |

关键点：RewriteQuery 会受模型质量影响，R49 的合并优先级把它放在「本轮显式值」之下，且所有动态事实最终仍由 CampusTools 核验。

---

## 7. 边界与禁则

- 禁止 Planner 输出任何动态事实（课程名、教室、冲突结论）——只输出槽位与判定。
- 禁止伪造实体（首轮 `只看周三` 无历史 → 必须 Clarification，硬测试 F）。
- `referenceTarget=top1_entity` 仅在 05 本轮真实 Top1 存在时可用，禁止写死教师。
- 所有状态仅存在于本轮对话作用域；不使用长期记忆；不把 `APP.*` 当 session-local 临时任务状态。

---

## 8. Widget 工作流状态风险与直接流转原则（R49 新增，防 suspended workflow 污染）

> 对应需求第 11 节。核心：**最终结果 Widget 直接流转并结束本轮；Widget click/form 用 state-complete sys.chat 开启新 root turn；只有真正需要同步收集数据时才「等待用户操作」。**

### 8.1 三类流转方式

| 方式 | 适用 | 状态生命周期 | 是否产生 pending |
|---|---|---|---|
| **直接向后流转** | 结果型 Widget（Schedule/Classroom/Conflict/DayPlan/Overview）渲染后 | 本轮结束，TurnState 进入 confirmed；无挂起 | 否 |
| **state-complete sys.chat** | Widget click / 表单提交 | 作为**新 root turn** 进入 Turn Intake（自带全部槽位，不依赖旧上下文） | 否（新轮次天然隔离） |
| **等待用户操作** | 仅 Choice/Recovery 等真正必须同步收参的失败态 | 保留最小 pending（候选列表 / 待补参数） | **是（唯一允许的 pending）** |

### 8.2 防 suspended old workflow 污染规则

1. **结果型 Widget 一律直接流转 + 结束本轮**：不得把「渲染了结果卡」当成「本轮未结束、等用户下一步」的挂起态。
2. **Widget click / 表单提交必须 state-complete**：payload.query 是完整可独立执行语句（自带实体/周次/节次/校区/容量等全部槽位），进入 00 时视为新 root turn，不继承也不被旧状态污染。
3. **仅 Choice（AMBIGUOUS_ENTITY）/ Recovery（缺参/范围外）允许等待用户操作**；该 pending 只存活一轮，且一旦用户输入完整新任务（新 domain）立即被 Stale Escape 清空（见 §5）。
4. **禁止**：把「上一轮结果卡还挂在界面上」当成持续上下文锚点；禁止新任务复用旧任务未完成状态；禁止「直接向后流转」与「等待用户操作」混用造成半个挂起。
5. **与 §2.2 CLARIFY 的一致性**：补参回答（CLARIFY）也是新 root turn；用户给出完整新任务时优先判 NEW_TASK 并清空 pending（硬测试 B/C）。

### 8.3 状态生命周期表（每轮结束后的 TurnState 去向）

| 本轮结果 | 轮末状态 | 下一轮是否可继承 |
|---|---|---|
| 结果型 Widget 正常返回 | confirmed（含全部已确认槽位） | 是（仅 FOLLOW_UP 且 domain 兼容时） |
| Choice 候选确认 | pending（候选列表 + 原任务引用） | 仅下一轮补选；新任务即清空 |
| Recovery 缺参/范围外 | pending（待补参数清单） | 仅下一轮补参；新任务即清空 |
| Knowledge / General Chat | 无任务状态（不产生可继承槽位） | 否（避免闲聊污染后续任务） |

# R49 08 — 应用层 E2E 测试矩阵（13 用例 + 回归）

> 阶段：R49 设计/审计阶段 — DESIGN DRAFT
> 验收位置：腾讯 ADP 应用首页正常聊天（非单工作流调试）
> 每条必须记录：expected route / state / inherited slots / dropped slots / tools called / widget

---

## 1. 用例 1：T09 整周 → 周三 → 下一周（01 链条）

| 轮 | 输入 | route | inherited | dropped | tools | widget |
|---|---|---|---|---|---|---|
| 1 | T09老师第1周整周课表 | 01 | — | — | get_academic_context + query_schedule | schedule(week) |
| 2 | 周三呢 | 01 | entity=T09, week=1 | — | query_schedule(week=1,weekday=3) | schedule(day) |
| 3 | 下一周呢 | 01 | entity=T09, weekday=3 | week=1 | query_schedule(week=2,weekday=3) | schedule(day) |

要求：T09 不丢、周次+1、不追问实体。

## 2. 用例 2：T09 整周 → 检查他的风险（P0 硬测试 A）

| 轮 | 输入 | route | state |
|---|---|---|---|
| 1 | T09老师第1周整周课表 | 01 | activeEntity=T09, timeScope=week |
| 2 | 检查一下他的风险 | 03 | comparisonMode=self, second=T09（复制），**不问第二对象** |

tools: query_schedule → compare_schedules(self)。widget: conflict。
要求：出现「请提供第二个比较对象」即 FAIL。

## 3. 用例 3：澄清态 → 校区A空教室（硬测试 B）

| 轮 | 输入 | route | state |
|---|---|---|---|
| 1~2 | 用例 2 序列 | 03 | risk-local pending（若复现） |
| 3 | 校区A 2026-09-03 下午有哪些空教室 | 02 | domain=classroom；drop second_entity/comparison/risk-local |

tools: find_available_classrooms。widget: classroom。要求：不再复读第二对象追问。

## 4. 用例 4：再 → 未来四周哪个校区最忙（硬测试 C）

| 轮 | 输入 | route | state |
|---|---|---|---|
| 4 | 未来四周哪个校区最忙 | 05 | domain=overview，窗口常量 |

tools: get_campus_teaching_overview。widget: campus_overview。要求：继续正常，无污染。

## 5. 用例 5：A校区空教室长链（02 槽位演化）

| 轮 | 输入 | route | 状态变化 |
|---|---|---|---|
| 1 | A校区第1周周一第5-6节60人以上空教室 | 02 | campus=A, week=1, weekday=1, period=5-6, capacity=60 |
| 2 | B校区呢 | 02 | campus→B（仅覆盖 campus） |
| 3 | 改第7-8节 | 02 | period→7-8 |
| 4 | 80人以上 | 02 | capacity→80 |
| 5 | 下一周同一时间 | 02 | week→2（其余保留） |

每轮 tools: find_available_classrooms。widget: classroom。

## 6. 用例 6：日计划 → 下一天 → 再下一天（04 日期+1）

| 轮 | 输入 | route | 状态 |
|---|---|---|---|
| 1 | 帮我安排2026-09-04的一天 | 04 | date=2026-09-04, visitor 固定 |
| 2 | 下一天呢 | 04 | date→09-05 |
| 3 | 再下一天 | 04 | date→09-06 |

tools: generate_day_plan。widget: day_plan（空日也返回正常空状态，禁进恢复卡）。

## 7. 用例 7：05 → Top1 课表 → 他的风险 → 那周三呢（长链钻取）

| 轮 | 输入 | route | 状态 |
|---|---|---|---|
| 1 | 未来四周教学态势 | 05 | Top1=本轮真实（如T09） |
| 2 | 看Top1课表 | 01 | referenceTarget=top1_entity（不写死） |
| 3 | 看他的风险 | 03 | self, entity=Top1 |
| 4 | 那周三呢 | 01 | entity=Top1, weekday=3 |

## 8. 用例 8：功能示例

| 轮 | 输入 | route | 说明 |
|---|---|---|---|
| 1 | 功能示例 | Knowledge | 走知识库展开玩法；不调用 CampusTools |

## 9. 用例 9：你能干什么

| 轮 | 输入 | route | 说明 |
|---|---|---|---|
| 1 | 你能干什么 | Knowledge | 产品能力文档；不调用 CampusTools |

## 10. 用例 10：你好

| 轮 | 输入 | route | 说明 |
|---|---|---|---|
| 1 | 你好 | General Chat/LLM | 不调用 CampusTools；不创建任务状态 |

## 11. 用例 11：只看周三（新 session 首轮）

| 轮 | 输入 | route | 状态 |
|---|---|---|---|
| 1 | 只看周三 | Clarification | 无历史 → 追问对象/任务；**禁止伪造实体**（硬测试 F） |

## 12. 用例 12：比较T03和T09第1周周三课表（显式 two_object）

| 轮 | 输入 | route | 状态 |
|---|---|---|---|
| 1 | 比较T03和T09第1周周三课表 | 03 | comparisonMode=two_object, first=T03, second=T09, week=1, weekday=3 |

widget: conflict。要求：仅此显式双对象才 two_object（硬测试 D）。

## 13. 用例 13：检查T03第1周周三风险（显式 self）

| 轮 | 输入 | route | 状态 |
|---|---|---|---|
| 1 | 检查T03第1周周三风险 | 03 | comparisonMode=self, entity=T03（显式） |

widget: conflict。要求：不问第二对象。

---

## 14. 回归组（R48 A~G 保持不破坏）

| 组 | 输入链 | 要求 |
|---|---|---|
| A | T03周一 → 只看周三 → 那整周呢 → 再看周五 → 下一周呢 → 上一周呢 | T03 不丢、DAY/WEEK 切换正确 |
| B | A校区第1周周一第5-6节40+ → 换到B校区 → 改成第7-8节 → 大于60人的呢 → 下一周同一时间 | 只改指定 slot |
| C | T03周一课表 → 那有赶场风险吗 | 跨 01→03 继承 T03+时间 |
| D | 安排2026-09-04 → 下一天呢 → 再下一天 | 日期+1，禁恢复卡 |
| E | 8月25日起态势 → 看看Top1课表 → 再看看他的风险 | Top1 本轮真实、代词继承 |
| F | 新会话首句 只看周三 | 追问不伪造 |
| G | 01查看整周 / 02下一时段·换校区 / 03查看课表·找空教室 / 04找空教室·下一天 / 05看Top1课表·检查Top1风险 | 按钮链全部保持 |

## 15. 验收记录要求

- 每条记录：通过/失败 + 实际回复文本（截图或 trace）+ 出现的 Widget 名称。
- 失败条目必须注明是「改动引入」还是「改动前已存在」。
- 全绿后才允许宣称 R49 应用层通过；本地静态验证 ≠ 真机通过。
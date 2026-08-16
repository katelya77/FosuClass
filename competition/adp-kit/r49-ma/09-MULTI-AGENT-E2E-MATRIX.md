# 09 — Multi-Agent E2E 测试矩阵

> 每个用例必须记录：expected route / expected state / inherited slots / dropped slots / tools called / expected widget。
> 验收位置：**应用首页正常聊天**（非单工作流调试）。

## 0. 图例

- route：Main → (schedule/risk/insight) → 最终域
- state：`comparisonMode`、`activeEntity`、`activeTime`、`staleContextEscaped`
- inherited：本轮继承的槽位；dropped：本轮清除的槽位
- tools：应调用的 Agent Tool（→ CampusTools）
- widget：预期 Widget（第一阶段文本全链，Widget 属预期规划）

---

## A. 硬回归组（用户指定 A~H）

### CASE A：T09 整周课表 → 检查他的风险 → 那看看他周三的课

| 轮次 | 输入 | route | state | inherited | dropped | tools | widget |
|---|---|---|---|---|---|---|---|
| 1 | T09老师第1周整周课表 | schedule | activeEntity=T09, week=1 | — | — | campus_schedule_query | schedule(week) |
| 2 | 检查一下他的风险 | risk | comparisonMode=**self**, entity=T09 | entity=T09, week=1 | second_entity_pending=∅ | campus_risk_check(mode=self) | conflict |
| 3 | 那看看他周三的课 | schedule | entity=T09, week=1, weekday=3 | entity=T09, week=1 | risk-local state | campus_schedule_query | schedule(day) |

**硬性要求**：第 2 轮**不得**要求第二对象；第 3 轮从 risk 切回 schedule，不残留 risk pending。

### CASE B：risk clarification 态 → 空教室（stale escape）

| 轮次 | 输入 | route | state | inherited | dropped | tools |
|---|---|---|---|---|---|---|
| 1 | T09老师第1周风险怎么样 | risk | comparisonMode=self, entity=T09 | — | — | campus_risk_check(self) |
| 2 | （系统若处于 clarification） | risk | pending=second_entity | — | — | — |
| 3 | 校区A 2026-09-03 下午有哪些空教室 | **classroom** | NEW_TASK, staleContextEscaped=**true** | — | second_entity_pending, risk_local_state | campus_classroom_search |

**硬性要求**：第 3 轮立即 escape 旧 risk context → classroom；**不得**继续追问第二个比较对象。

### CASE C：安排一天 → 下一天

| 轮次 | 输入 | route | state | inherited | dropped | tools |
|---|---|---|---|---|---|---|
| 1 | 帮我安排2026年9月4日的一天 | day_plan | activeTime=2026-09-04, user=demo | — | — | campus_day_plan |
| 2 | 下一天呢 | day_plan | activeTime=**2026-09-05** | date=09-04 | — | campus_day_plan(date=2026-09-05) |

**硬性要求**：下一天 = date+1 由 `generate_day_plan` 确定性推进；空日显示「当天暂无已核验安排」，不进入「工具暂不可用」恢复卡。

### CASE D：未来四周最忙 → 看Top1课表 → 检查Top1风险

| 轮次 | 输入 | route | state | inherited | dropped | tools |
|---|---|---|---|---|---|---|
| 1 | 未来四周哪个校区最忙 | insight | overview | — | — | campus_overview |
| 2 | 看Top1课表 | schedule | entity=Top1(真实), 由insight回传 | Top1 | overview-local | campus_schedule_query |
| 3 | 检查Top1风险 | risk | comparisonMode=**self**, entity=Top1 | Top1 | schedule-local | campus_risk_check(self) |

**硬性要求**：Top1 取本轮真实值（Insight 回传），不伪造；第 3 轮 self-risk 不要求第二对象。

### CASE E：比较T03和T09第1周风险（显式双对象）

| 轮次 | 输入 | route | state | inherited | dropped | tools |
|---|---|---|---|---|---|---|
| 1 | 比较T03老师和T09老师第1周风险 | risk | comparisonMode=**two_object**, first=T03, second=T09, week=1 | — | — | campus_risk_check(mode=compare, first=T03, second=T09) |

**硬性要求**：仅此明确双对象才要求 second entity；其他单对象场景一律 self。

### CASE F：首轮「只看周三」（无历史保护）

| 轮次 | 输入 | route | state | tools |
|---|---|---|---|---|
| 1 | 只看周三 | clarify | 无 activeEntity | —（不调动态工具） |

**硬性要求**：无有效历史 → 必须澄清对象（哪个老师/班级/教室），**不得伪造** T03/T09 等实体。

### CASE G：你好 / 你是谁 / 你都会什么

| 轮次 | 输入 | route | state | tools |
|---|---|---|---|---|
| 1 | 你好 | chat | — | **不调用**任何 CampusTools |
| 2 | 你是谁 | chat | — | 不调用动态工具 |
| 3 | 你都会什么 | knowledge(meta) | — | KnowledgeRetrievalAnswer（静态） |

### CASE H：T03第1周有什么课

| 轮次 | 输入 | route | state | tools |
|---|---|---|---|---|
| 1 | T03第1周有什么课 | schedule | entity=T03, week=1 | campus_schedule_query（**必须**调用） |

**硬性要求**：动态课表必须走 CampusTools；**禁止** Knowledge 直接回答。

---

## B. 13 核心 case（R49 矩阵延续）

| # | 输入链 | expected route | expected widget |
|---|---|---|---|
| 1 | T09第1周整周课表 → 周三呢 → 下一周呢 | schedule→schedule→schedule | schedule(week/day) |
| 2 | T09第1周整周课表 → 检查一下他的风险 | schedule→risk(self) | conflict |
| 3 | 上述之后 → 校区A 2026-09-03 下午有哪些空教室 | →classroom | classroom |
| 4 | 再 → 未来四周哪个校区最忙 | →overview | campus-overview |
| 5 | A校区第1周周一第5-6节60人以上 → B校区呢 → 改第7-8节 → 80人以上 → 下一周同一时间 | classroom 5 轮 slot 覆盖 | classroom |
| 6 | 帮我安排2026-09-04的一天 → 下一天呢 → 再下一天 | day_plan(09-04→09-05→09-06) | day-plan |
| 7 | 未来四周教学态势 → 看Top1课表 → 看他的风险 → 那周三呢 | insight→schedule→risk(self)→schedule | campus-overview→schedule→conflict→schedule |
| 8 | 功能示例 | knowledge(meta) | — |
| 9 | 你能干什么 | knowledge(meta) | — |
| 10 | 你好 | chat | — |
| 11 | 只看周三（新会话首轮） | clarify | clarification |
| 12 | 比较T03和T09第1周周三课表 | risk(compare) | conflict |
| 13 | 检查T03第1周周三风险 | risk(self) | conflict |

## C. R48 回归组（A~G 不倒退）

- A. 01 课表 6 轮（只看周三/整周/周五/下一周/上一周）：实体不丢
- B. 02 空教室 5 轮（换校区/改节次/加容量/下一周）：只改指定 slot
- C. 01→03 派生（那有赶场风险吗）：继承实体+周次
- D. 04 日计划 3 轮（下一天/再下一天）：日期推进，无恢复卡
- E. 05→01→03（Top1课表→他的风险）：Top1 真实继承
- F. 无历史保护（只看周三）：澄清不伪造
- G. Widget 按钮回归：R48 不能破坏 R47 已工作按钮链

## D. 判定标准

- 任一硬性要求（A~H 加粗项）失败 → 阻断发布。
- 13 case + R48 A~G 全绿 → 进入模型 A/B。
- 动态事实零编造；`dataVersion=competition-demo-v2` 且 evidence.verified=true。

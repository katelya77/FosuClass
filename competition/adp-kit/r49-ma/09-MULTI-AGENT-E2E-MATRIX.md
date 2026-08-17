# 09 — Multi-Agent E2E 测试矩阵

> 每个用例必须记录：expected route / expected state / inherited slots / dropped slots / tools called / expected widget。
> 验收位置：**应用首页正常聊天**（非单工作流调试）。

## 0. 图例

- route：Main → (schedule/risk/insight) → 最终域
- state：`comparisonMode`、`activeEntity`、`activeTime`、`windowContext{rankingWindow,detailWindow,academicWeek}`、`staleContextEscaped`
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

### CASE B：risk compare 澄清态 → 空教室（stale escape）

| 轮次 | 输入 | route | state | inherited | dropped | tools |
|---|---|---|---|---|---|---|
| 1 | 比较T09老师第1周和另一位老师的风险 | risk | comparisonMode=compare, firstEntity=T09, week=1, pending=**second_entity** | — | — | —（NEED_CLARIFICATION，不调工具） |
| 2 | A校区2026-09-03第5-6节有哪些60人以上的空教室？ | **classroom** | NEW_TASK, staleContextEscaped=**true** | — | second_entity_pending, comparisonMode, risk_local_state | campus_classroom_search（campus=别名A校区，R49.2.1 解析） |

**硬性要求**：Turn 1 由 Main 作为唯一澄清出口询问第二位老师（compare intent 缺第二对象 → NEED_CLARIFICATION）；Turn 2 用户不回答第二对象而发起新任务，Main 判定 **NEW_TASK** 立即 escape 旧 risk 澄清态 → classroom，**不得**继续追问第二个比较对象。

### CASE C：安排一天 → 下一天

| 轮次 | 输入 | route | state | inherited | dropped | tools |
|---|---|---|---|---|---|---|
| 1 | 帮我安排2026年9月4日的一天 | day_plan | activeTime=2026-09-04, user=demo | — | — | campus_day_plan |
| 2 | 下一天呢 | day_plan | activeTime=**2026-09-05** | date=09-04 | — | campus_day_plan(date=2026-09-05) |
| 3 | 再下一天 | day_plan | activeTime=**2026-09-06** | date=09-05 | — | campus_day_plan(date=2026-09-06) |

**硬性要求**：下一天 = date+1 由 `generate_day_plan` 确定性推进；空日显示「当天暂无已核验安排」，不进入「工具暂不可用」恢复卡。
**Evidence 契约（R49.3）**：「下一天呢」必须观察到 fresh `campus_day_plan(date=2026-09-05)`、「再下一天」必须
`campus_day_plan(date=2026-09-06)`——**不得仅根据历史返回文本生成答案**（G2 验收按此逐轮核 evidence）。

### CASE D：教师负载Top1 → Top1课表(范围) → 只看第一周 → Top1风险澄清（R49.4 D1~D5）

#### D1：未来四周教师负载最高的是谁（insight）

| 轮次 | 输入 | route | state | inherited | dropped | tools | fresh-call evidence |
|---|---|---|---|---|---|---|---|
| 1 | 未来四周教师负载最高的是谁 | insight | windowContext.rankingWindow={weekStart:1,weekEnd:4}, detailWindow=null, academicWeek=null；rankContext(sourceTool=**campus_teacher_load_query**, sourceDomain=teacher_load, selectedRank=null, entities=top[0..2]) | — | — | campus_teacher_load_query(weekStart=1, weekEnd=4) | 观察 fresh POST /api/campus_teacher_load_query，body 含 weekStart:1,weekEnd:4 |

#### D2：看Top1课表（schedule，范围下钻）

| 轮次 | 输入 | route | state | inherited | dropped | tools | fresh-call evidence |
|---|---|---|---|---|---|---|---|
| 2 | 看Top1课表 | schedule | entity=Top1(真实), rank=1, windowContext.detailWindow=**{weekStart:1,weekEnd:4}**（继承 rankingWindow）, NO_CLARIFICATION | Top1 实体 + rankingWindow 1..4 | overviewWindow, overview_local_filters | campus_schedule_range_query(entity=排名工具结果[0], weekStart=1, weekEnd=4) | 观察 fresh POST /api/campus_schedule_range_query；返回逐周展开（每条 academicWeek/date） |

#### D3：只看第一周（schedule，显式收窄）

| 轮次 | 输入 | route | state | inherited | dropped | tools | fresh-call evidence |
|---|---|---|---|---|---|---|---|
| 3 | 只看第一周 | schedule | entity=Top1(真实), rank=1, windowContext.detailWindow=**{weekStart:1,weekEnd:1}**, academicWeek=1 | Top1 实体 | — | campus_schedule_query(entity=排名工具结果[0], week=1) | 观察 fresh POST /api/campus_schedule_query，week=1（**绝不默认**、绝不=聚合窗口 count） |

#### D4：新会话单句链「看未来第一周课表负载最高的教师课表」（insight→schedule 单链）

| 轮次 | 输入 | route | state | inherited | dropped | tools | fresh-call evidence |
|---|---|---|---|---|---|---|---|
| 1 | 看未来第一周课表负载最高的教师课表 | insight | windowContext.rankingWindow={weekStart:1,weekEnd:1}, rankContext(sourceTool=campus_teacher_load_query, selectedRank=null) | — | — | campus_teacher_load_query(weekStart=1, weekEnd=1) | 观察 fresh POST /api/campus_teacher_load_query，body 含 weekStart:1,weekEnd:1（W1..W1 锚点 Top1=教师003） |
| 2 | 看Top1课表（同轮跟进） | schedule | entity=Top1(真实), rank=1, windowContext.detailWindow={weekStart:1,weekEnd:1}, academicWeek=1 | Top1 实体 + rankingWindow 1..1 | overviewWindow, overview_local_filters | campus_schedule_query(entity=排名工具结果[0], week=1) | 观察 fresh POST /api/campus_schedule_query，week=1（单周窗口 → 单周工具） |

**硬性要求（D4）**：新会话（无任何历史）单句意图链，**不得**出现 KnowledgeRetrievalAnswer 兜底、不得模型计数、不得 Main↔Insight 来回循环；单周窗口（1..1）直接落单周工具，**不得**先走范围工具。

#### D5：检查Top1风险（未给时间 → Main 澄清）

| 轮次 | 输入 | route | state | tools |
|---|---|---|---|---|
| 4 | 检查Top1风险 | **clarify** | comparisonMode=self, entity=Top1, rank=1, pending=**time_window**（week/date 均未给） | —（**不调** campus_risk_check，绝不静默 week=1） |

**硬性要求（R49.4 / R49.4.1）**：
- Top1 = 本轮真实排名结果（`campus_teacher_load_query` 真实有序结果 [0]，position 语义；当前真机第一项=教师009，**不写死**）。
- **并列不澄清**：即使排名结果 [0] 与 [1] 业务指标完全相同（如均 27/54），结果 [0] 仍唯一确定
  （position 语义；底层稳定排序 lessonOccurrences DESC → periodUnits DESC → teacherName zh-CN tie-break）。
  「看Top1课表」**NO CLARIFICATION**，不得弹出「教师009/教师011/两位都看」选择。
- 并列事实如实说明：「教师009与教师011并列最高。按当前稳定排序，Top1=教师009，Top2=教师011。」
- 教师负载排名真源 = `campus_teacher_load_query`（rankingWindow/topN/campus 变化必须 fresh 调用）；
  `campus_overview.teacherLoadTop` 仅是固定窗口整体态势的组成部分，不作为任意教师周窗口排名的替代来源。
- **窗口语义**：D1 排名窗口=rankingWindow 1..4 → D2 继承为 detailWindow 1..4 → **范围课表工具**逐周展开；
  D3 显式收窄 detailWindow=1..1 → fresh 单周工具；**overviewWindow.count 绝不等于 academicWeek**，绝不默认 week=1。
- **D5 澄清铁律**：多周排名后「检查Top1风险」未给周次/日期 → Main 澄清时间窗口，**不得**调 risk 工具、**不得**静默 week=1。
- 「未来四周哪个校区最忙」属 Insight **单域**用例（核心 case #4），**不得**下钻个人课表/风险。

### CASE D-2：Top2 下钻（R49.4）

| 轮次 | 输入 | route | state | inherited | dropped | tools |
|---|---|---|---|---|---|---|
| 1 | 未来四周教师负载最高的是谁 | insight | windowContext.rankingWindow={weekStart:1,weekEnd:4} | — | — | campus_teacher_load_query(1,4) |
| 2 | 看Top2课表 | schedule | entity=Top2(真实), rank=2, windowContext.detailWindow={weekStart:1,weekEnd:4} | rankContext + rankingWindow 1..4 | overviewWindow, overview_local_filters | campus_schedule_range_query(entity=排名工具结果[1], 1, 4) |

**硬性要求**：`Top2 = 排名工具结果 [1]`，**不得**调用 Top1 实体；NO_CLARIFICATION。

### CASE D-3：并列多对象 → 再单排位（R49.4）

| 轮次 | 输入 | route | state | inherited | dropped | tools |
|---|---|---|---|---|---|---|
| 1 | 未来四周教师负载最高的是谁 | insight | windowContext.rankingWindow={weekStart:1,weekEnd:4}, rankContext(selectedRank=null, entities=top[0..2]) | — | — | campus_teacher_load_query(1,4) |
| 2 | 并列第一都有谁 | insight | multi-object, selectedRank=**null**（rankContext 保持） | rankContext | — | 基于本轮 teacherLoadTop 如实列并列项（不调工具也行，不新建窗口） |
| 3 | 看Top1课表 | schedule | entity=Top1(真实), rank=1, windowContext.detailWindow={weekStart:1,weekEnd:4} | rankContext(selectedRank=1) + rankingWindow 1..4 | overviewWindow | campus_schedule_range_query(entity=排名工具结果[0], 1, 4) |

**硬性要求**：多对象轮不得把并列项压缩为 Top1、不得破坏 rankContext；随后单排位仍落排名工具结果 [0]。

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
| 7 | 未来四周教师负载最高的是谁 → 看Top1课表 → 只看第一周 → 那周三呢 | insight→schedule→schedule→schedule | teacher_load→schedule(1..4)→schedule(week=1)→schedule(weekday=3) |
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
- **Console Gate（R49.4.1）**：只有 ADP 插件侧实测展示 7 个 CampusTools（5 既有 + delta 导入 2），
  且 D1~D5 每轮都有真实工具调用证据（HTTP 请求截图/日志）后，才允许声明「R49.4-GOLDEN」；
  截图/日志缺失、或插件仍为 5 工具 → 不满足 gate，不得宣布完成。

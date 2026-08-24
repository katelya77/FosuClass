# 《校园智序·小序》PHASE 3.1 FINAL CUT 视频脚本

> 成片锁定：**04:35（275 秒）**。叙事主线：真实问题 → 自然语言任务 → Multi-Agent 理解与分工 → CampusTools 确定性核验 → 可核查 Widget → 辅助决策。

## 0:00–0:12｜Hook

- 画面：黑场一拍；“冲突 0”单独出现，随后“赶场 4”和一条真实 `20 min` 转场进入。
- 旁白：课表没有冲突，不代表教学安排没有风险。同一位教师未来四周冲突为零，却每周有四次跨校区赶场，最短只留二十分钟。
- 屏幕字：`0 ≠ 4｜没有冲突，不代表没有风险`

## 0:12–0:25｜1000+ 真实落地

- 画面：Judge Portal 首页与匿名任务词快速交替，数字 `1000+` 成为唯一焦点。
- 旁白：校园教学安排跨越时间、空间、人群和规则。前期产品形态已在真实校园环境落地运行，累计服务用户一千以上；本片只保留完全匿名的落地事实。
- 屏幕字：`真实校园环境｜累计服务用户 1000+｜完全匿名`

## 0:25–0:42｜Architecture

- 画面：4173 Architecture，先出现 Main，再出现 Schedule、Risk、Insight，最后点亮 CampusTools；连线回到 Main。
- 旁白：校园智序·小序把复杂任务收敛为一句话。四个 Agent 负责理解、分工和解释，十三个 CampusTools 负责计算动态校园事实。主协调不直接调用工具，协作沿 Main、领域 Agent、Main 闭环完成。
- 屏幕字：`4 Agent × 13 CampusTools｜Main → Child → Main`

## 0:42–1:10｜Risk

- 画面：自然语言问题停留 1.5–2 秒后缩到左上；Risk 与 CampusTools 被点亮；最后只留下 0、4、20 min。
- 旁白：问一句：“教师025未来四周有没有风险？”Risk Agent 逐周核验时间重叠、校区变化和相邻课次间隔。四周结论一致：每周十四课次，课程冲突零次，跨校区赶场四次，最短转场二十分钟。没有冲突，不代表没有风险。
- 屏幕字：`问题 → 协作 → 核验 → 结论`

## 1:10–1:38｜Collaboration

- 画面：三位教师的空闲矩阵合并；候选教室从 63 收束到 7；A1-201 成为唯一焦点。
- 旁白：再问：“三位老师什么时候都有空？有没有一百二十座教室？”Schedule Agent 先求教师005、006、014在第一周周四上午的共同空闲，再核验容量和占用。六十三间可用教室收束为七个达标候选，最终推荐一百二十座的 A1-201。三张课表，算出一个共同教学时空。
- 屏幕字：`3 位教师 → 63 → 7 → A1-201`

## 1:38–2:06｜Reschedule

- 画面：问题“移动到周四7–8节，可行吗？”出现；课程从周一5–6节移向周四7–8节；约束逐项点亮。
- 旁白：调课先模拟，再决定。系统逐项核验板块、教师、班级、教室占用、容量和功能属性，得到五项通过、一项提醒。`feasible=true` 与 `warning` 可以同时成立；`mutatedData=false` 表示全程只在候选数据上计算，不写入真实课表。可行，不等于没有提醒。
- 屏幕字：`5 PASS + 1 WARNING｜feasible=true｜mutatedData=false`

## 2:06–2:34｜Insight

- 画面：全校榜单收束到 Top1 教师025；56、112 放大；随后重新下钻风险 0、4。
- 旁白：问：“未来四周谁最忙？”Insight Agent 汇总负载，定位 Top1 教师025：五十六课次、一百一十二课时。排名只负责发现对象；Main 随后交给 Risk 再次核验，确认冲突为零、赶场为四。排名负责发现，核验负责判断。
- 屏幕字：`Top1 教师025｜56 课次｜112 课时｜0 / 4`

## 2:34–3:38｜REAL ADP

- 画面：必须使用真实腾讯 ADP / 4174 Native API 录屏，完整保留输入、提交、真实执行轨、AgentName、工具状态和返回结果。
- 旁白：现在进入真实 ADP。第一句输入：“未来四周教师负载最高的是谁？”真实事件中先出现小序主协调，再出现校园洞察 Agent；CampusTools 完成全校概览和教师负载查询，返回教师025、五十六课次、一百一十二课时。第二句继续问：“检查 Top1 未来四周的跨校区赶场风险。”主协调把同一上下文交给 Risk，以确定性工具复核冲突和赶场。第三句再输入：“帮教师005、006、014找第1周周四上午的共同空闲，并推荐容量不少于120座的教室。”Schedule Agent 联合计算三张课表、教室占用和容量约束。画面中的执行状态来自真实 SSE，不伪造思考，也不播放替代动画。
- 屏幕字：`用户 → 小序·主协调 → 领域 Agent → CampusTools → Verified Result`

## 3:38–4:02｜Widget / Evidence

- 画面：官方 `<adp-widget>` 真实渲染，依次标注 Verified、dataVersion、CampusTools、Evidence。
- 旁白：ADP 返回的 Widget.View、WidgetId 和 WidgetRunId 交给官方 Widget SDK 渲染。结果卡与文本共享同一事实来源，关键结论带有 Verified、匿名数据版本、工具调用和 Evidence。生成模型负责理解任务，CampusTools 负责事实；没有结果、存在歧义或数据损坏时，系统 fail-closed，不补全、不猜测。
- 屏幕字：`Deterministic｜Verified｜Evidence｜fail-closed`

## 4:02–4:20｜Judge Portal

- 画面：4174 从体验页切到 `ADP Diagnostics`；API、SSE、Conversation、Multi-Agent、Widget SDK、Last Agent、Last Tool 依次通过。
- 旁白：Judge Portal 让评审既能一句话体验，也能检查运行证据。API、SSE、会话、Multi-Agent、Widget SDK、最后一个 Agent 和最后一次工具调用，都在诊断页独立呈现；不展示原始密钥、系统提示或冗长 JSON。
- 屏幕字：`REAL API｜REAL SSE｜REAL AGENT｜REAL WIDGET`

## 4:20–4:35｜Closing

- 画面：Logo、品牌句与二维码占位；音乐收束，最后三秒静止。
- 旁白：校园智序·小序——让教学时空，被理解、被核验、被安排。让复杂的校园教学安排，简单到一句话就能问。
- 屏幕字：`校园智序·小序`

## 剪辑纪律

- 总时长严格为 `04:35`，不得超过 5 分钟。
- REAL ADP 段必须使用真实输入与真实 SSE/Widget，不得用 4173 动画替代。
- 4173 四幕统一“问题 → 协作 → 核验 → 结论”，每个时间点只有一个 Primary Focus。
- 只使用 FINAL-TRUTH 冻结事实；不展示地址栏、本机路径、凭据、内部提示或身份线索。
- 画面统一 warm white、coral/red、rose/peach、极淡 lavender 的 Auroraqua / Iced Jelly / Liquid Glass 材质语言。

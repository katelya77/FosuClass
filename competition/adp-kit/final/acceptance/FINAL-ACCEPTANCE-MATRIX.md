# Final Acceptance Matrix

本矩阵验证目标语义、任务依赖与事实边界。自然语言只作为等价表达样本，不作为固定字符串路由规则。

| ID | 用户目标 | 自然改写样本 | 必须成立的结果 | 自动证据 |
|---|---|---|---|---|
| A | 单教师整周课表 | “给我看看这位老师这一周全部课程” / “整周安排怎么排的” | 已核验整周时间板；空日折叠 | `test-final-widget.js`、`test-r51-e2e-mission-matrix.js` |
| B | 续问只看周三 | “周三的单独列出来” / “只保留星期三” | 继承可靠主体；weekday 改变触发新查询 | `test-r51-fresh-tool-call-guard.js` |
| C | 指定校区时段找空教室并偏好大容量 | “找宽敞一点的空教室” / “能坐更多人的优先” | 第一次支持决策的查询即携带结构化偏好；Top1 稳定 | `test-r51-preference-one-call.js`、`test-decision-runtime-activation.js` |
| D | 不可能的容量要求 | “至少容纳一个远超现有教室规模的人数” / “超大容量且不能放宽” | 无可行候选；不放宽、不伪造推荐 | `test-decision-runtime-activation.js` |
| E | 整周课表并检查风险 | “把本周课程和赶场问题一起看” / “先看安排，再告诉我风险” | 最终卡为风险语义，课表不能覆盖终态 | `test-final-outcome-selector.js` |
| F | 基于可靠上下文续查风险 | “检查他的风险” / “这个人的赶场情况呢” | 继承可靠对象并重新核验风险 | `test-r51-e2e-mission-matrix.js` |
| G | 多人共同空闲并推荐空间 | “找大家都空的连续时段，再给合适教室” / “安排一次多人活动” | 完成共同空闲与空间推荐；首选和理由可读 | `test-final-widget.js`、`test-r51-cross-domain-mission.js` |
| H | 多人没有共同空闲 | “他们这段时间有没有都能参加的时段” / “找不到就直接告诉我” | verified empty；不发明时间或教室 | `test-r51-e2e-mission-matrix.js`、Decision empty gates |
| I | 未来周范围教师负载最高 | “接下来几周谁课最多” / “未来一段教学周的最高负载教师” | 稳定 Top1、窗口明确 | `test-final-widget.js`、`test-r51-ranking-drilldown.js` |
| J | Top1 下钻课表 | “看看第一名的课表” / “最高负载那位怎么排课” | 排名只选择对象；课表重新核验 | `test-r51-ranking-drilldown.js` |
| K | Top1 下钻风险 | “检查榜首那位的赶场风险” / “第一名有没有冲突” | 排名对象进入新的风险任务；最终风险卡 | `test-r51-e2e-mission-matrix.js`、`test-final-outcome-selector.js` |
| L | 调课可行性 | “把这节课挪到另一个时段会怎样” / “模拟一下新安排” | before→after；全部关键检查；只模拟不写入 | `test-final-widget.js`、`test-decision-intrinsic-oracle.js` |
| M | 改变周次或星期 | “换到下一周” / “改看周五” | 动态条件变化必有 fresh call | `test-r51-fresh-tool-call-guard.js` |
| N | 静态校园知识 | “教学周是什么意思” / “空结果通常该怎么办” | 文档检索可回答；不把静态知识当动态课表事实 | knowledge gates、`test-final-acceptance.js` |
| O | 新会话裸续问 | “只看周三” / “那天的呢” | 无可靠主体时只澄清一个主体问题 | `test-r51-resolve-before-clarify.js`、`test-final-acceptance.js` |
| P | 多个软偏好 | “同校区优先，尽量早点，空间宽裕些” / “少赶路、早一点、容量大” | 首次决策查询携带白名单偏好；不按固定句式路由 | `test-r51-preference-one-call.js`、`test-final-acceptance.js` |

## Final UX checks

- 用户在首屏三秒内能识别结论。
- 每张卡只有一个 Hero。
- 备选默认最多三至五项，并说明剩余数量。
- 风险、排名、课表、协作、调课各有自己的信息结构。
- 用户可见文案不含内部约束、研发版本或传输字段。
- 所有按钮只发送自然语言续问。

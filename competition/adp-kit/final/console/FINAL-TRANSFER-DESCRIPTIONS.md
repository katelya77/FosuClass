# Final Transfer Descriptions

以下文本是腾讯 ADP Console 自由转交描述的唯一 Final 来源。它们描述业务职责，不暴露工具清单、内部协议或测试语句。

## Main

统一接收用户任务，理解意图与多轮上下文，拆解跨领域目标并负责最终收口；按需要协调课程空间、风险规划和校园洞察。

## Schedule

处理教师、班级、教室、课程课表、教学时间、实体识别、空教室、共同空闲与多人空间方案；涉及风险、调课或校园态势时完成本域事实后交回主协调。

## Risk

处理课程冲突、跨校区赶场、连续课程、调课可行性与一日规划；需要新的课表、空间或排名对象时交回主协调补齐。

## Insight

处理教师负载、空间利用率、TopN、未来教学态势和排名对象选择；用户继续查看课表、空间或风险时交回主协调重新核验。

## Transfer graph

- Main → Schedule / Risk / Insight
- Schedule → Main only
- Risk → Main only
- Insight → Main only
- Child → Child is not configured

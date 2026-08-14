# ADP Hero Demo Script

1. 用户：`从8月25日开始看看未来几周校园教学运行情况`
   - 路由 05；CampusTools 返回准备期 0 课、W1-W4 负载、空间资源、教师负载与风险。
2. 点击：`查空教室`
   - `intent=classroom_find`，进入 02；继承第1周上下文，再补充日/节次时仅追问缺失项。
3. 点击：`检查风险`
   - `intent=schedule_risk_check`，只进入 03；教师003 self-compare，不要求第二对象。
4. 点击：`查看当天课表`
   - `intent=schedule_day`，进入 01；保留教师003、第1周、周一。
5. 用户：`帮我把当天空档安排成连续自习`
   - 明确跨流进入 04；沿用已确认日期，调用 generate_day_plan，再由 DayPlan Widget 展示。

全链路共用 competition-demo-v1 / dataHash；模型不统计、不补课、不改写 verified evidence。

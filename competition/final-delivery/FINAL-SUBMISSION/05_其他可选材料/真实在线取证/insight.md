# 教学管理者真实在线取证

- 运行时间：2026-08-31T15:39:41.470Z → 2026-08-31T15:44:44.931Z
- 公网入口：https://adp.katelya.top
- 会话摘要：b165c07471184e35cb73526836b67c0672d12899f1775ce2a72770e1fcca585d
- 结果：PASS
- 期望事实：教师025 / 56 / 112 / 4 / 20
- 缺失事实：无

## 第 1 轮

- 输入：未来四周谁的教学负载最高？
- HTTP：200
- 耗时：82152 ms
- Agent：小序-主协调 → 小序-校园洞察
- Tool：校园智序-CampusTools/campus_teacher_load_query
- Widget：已返回
- 可见回答：（答案由 Widget.View 完整呈现）

## 第 2 轮

- 输入：看他的课表。
- HTTP：200
- 耗时：101473 ms
- Agent：小序-主协调 → 小序-课程空间
- Tool：校园智序-CampusTools/campus_schedule_range_query
- Widget：已返回
- 可见回答：（答案由 Widget.View 完整呈现）

## 第 3 轮

- 输入：检查他的风险。
- HTTP：200
- 耗时：115302 ms
- Agent：小序-主协调 → 小序-风险规划
- Tool：校园智序-CampusTools/campus_risk_check
- Widget：已返回
- 可见回答：（答案由 Widget.View 完整呈现）


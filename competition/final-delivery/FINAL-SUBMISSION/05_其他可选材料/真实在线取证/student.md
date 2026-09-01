# 学生真实在线取证

- 运行时间：2026-08-31T20:19:33.338Z → 2026-08-31T20:25:01.325Z
- 公网入口：https://adp.katelya.top
- 会话摘要：c34c618d6566f6f21f7194ca8b578ba6b031560eb768f0149d16cc21df4cb5a9
- 结果：PASS
- 期望事实：2025级计算机类01班 / 周三 / campus_classroom_search / A1-103
- 原始短句：下午哪里有空教室？
- 措辞调整：跨日实测发现该短句可能被解释为当天；改用“继续看周三下午”明确指回上一轮，同时仍不重复班级与周次。
- 缺失事实：无

## 第 1 轮

- 输入：查看2025级计算机类01班第1周课表。
- HTTP：200
- 耗时：92786 ms
- Agent：小序-主协调 → 小序-课程空间
- Tool：校园智序-CampusTools/campus_schedule_query
- Widget：已返回
- 可见回答：（答案由 Widget.View 完整呈现）

## 第 2 轮

- 输入：只看周三。
- HTTP：200
- 耗时：83624 ms
- Agent：小序-主协调 → 小序-课程空间
- Tool：校园智序-CampusTools/campus_schedule_query
- Widget：已返回
- 可见回答：（答案由 Widget.View 完整呈现）

## 第 3 轮

- 输入：继续看周三下午，哪里有空教室？
- HTTP：200
- 耗时：147026 ms
- Agent：小序-主协调 → 小序-课程空间
- Tool：校园智序-CampusTools/campus_classroom_search
- Widget：已返回
- 可见回答：（答案由 Widget.View 完整呈现）


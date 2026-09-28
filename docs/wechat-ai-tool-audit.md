# 小序 Tool 与微信 AI 接入审计

事实源：`server/config/agent-capability-manifest.json`。本页记录 2026-09-18 的 32 个小序 Tool 与独立微信 AI 开发预览的对应关系，不作为第二份运行时能力清单。微信 AI 开发模式属于微信平台内测；正式小程序仍使用服务端 Agent Kernel 的 `public` 确定性模式。

| 小序 Tool | 微信 AI 开发预览处理 | 边界 |
| --- | --- | --- |
| `get_today_courses` | `openPersonalTask` | 个人课表只在小程序内读取 |
| `get_tomorrow_courses` | `openPersonalTask` | 带“明天有什么课”任务进入小序 |
| `get_next_course` | `openPersonalTask` | 带“我的下一节课”任务进入小序 |
| `get_week_schedule` | `openPersonalTask` | 个人整周课表不进入微信 AI 上下文 |
| `get_teaching_week` | `getTeachingWeek` | 已发布周历，按日期核对 |
| `get_term_calendar` | `getTermCalendar` | 已发布整学期周历，最多 30 周 |
| `search_empty_rooms` | `findEmptyClassrooms` | 已发布版本、明确日期和节次、最多 8 间 |
| `search_continuous_empty_rooms` | `findEmptyClassrooms` | 用户明确连续节次范围时可查询；不猜起止节 |
| `search_school_index` | `searchCampusSchedule` | 已发布全校索引，候选最多 8 项 |
| `get_schedule_detail` | `searchCampusSchedule` 的唯一匹配详情链接 | 小程序内显示完整详情，不向模型传原始课表 |
| `diagnose_data_status` | `getDataStatus` | 只回答发布学期、版本与更新时间 |
| `explain_personal_import` | `openPersonalTask` | 导入在小程序内完成 |
| `recommend_meeting_time` | `openXiaoxuTask` | 需要个人课表与进一步确认 |
| `clarify_missing_slot` | 微信 AI 追问 | 缺日期、节次、名称时不猜测 |
| `get_campus_weather` | `getCampusWeather` | 现有天气服务、显示更新时间、失败不猜 |
| `get_course_weather_advice` | `openXiaoxuTask` | 课程位置涉及个人课表 |
| `search_campus_place` | `searchCampusPlace` | 已发布地图且已核验的地点，最多 6 项 |
| `get_campus_route` | `openXiaoxuTask` | 地图内处理路线，微信 AI 不编造路线 |
| `get_classroom_location` | `searchCampusPlace` 或 `openXiaoxuTask` | 地图有已核验地点才可直接答 |
| `get_today_schedule` | `openPersonalTask` | 个人课表只在小程序内读取 |
| `get_course_route` | `openXiaoxuTask` | 出发时间需个人课表和路线信息 |
| `inspect_schedule_conflicts` | `openXiaoxuTask` | 个人课表健康检查在小程序内 |
| `detect_schedule_changes` | `openXiaoxuTask` | 个人同步记录在小程序内 |
| `navigate_miniprogram_page` | `openPersonalTask` / `openXiaoxuTask` | 仅可跳小程序已声明页面 |
| `create_course_reminder` | `openXiaoxuTask` | 小程序内显式确认写入 |
| `update_course_reminder` | `openXiaoxuTask` | 小程序内显式确认写入 |
| `delete_course_reminder` | `openXiaoxuTask` | 小程序内显式确认删除 |
| `list_course_reminders` | `openXiaoxuTask` | 私人提醒不进入微信 AI 上下文 |
| `update_user_preference` | `openXiaoxuTask` | 小程序内显式确认偏好变更 |
| `rag_search` | 微信 AI 知识库公开 FAQ / 小程序内小序 | 知识库只说明功能，不提供动态课表事实 |
| `generate_image` | 小程序内小序，且仅体验/开发能力允许时 | 正式版不调用生成式 Provider |
| `set_current_schedule` | `openXiaoxuTask` | 小程序内验证目标并确认切换 |

## 验收范围

- `test:wechat-ai-preview` 检查 Skill 注册、已声明页面路径、知识库体积、白名单只读请求、敏感内容裁剪、版本一致性和个人任务无网络读取。
- 微信开发者工具预览成功只证明包可编译及上传。微信 AI 是否选择正确的原子接口或账号卡片，必须以灰度账号的实际会话与页面结果为准。
- 2026-09-18 复查[微信官方接入指南](https://developers.weixin.qq.com/miniprogram/dev/ai/guide.html)：开发模式仍不开放正式代码提审。本独立预览不可作为正式版发布包；正式 `miniprogram/app.json` 不含 `agent` 字段。

## 本轮实际验收（2026-09-18）

| 检查 | 结果 |
| --- | --- |
| `npm run test:wechat-ai-preview` | 通过；9 个原子接口注册，11 次白名单只读请求、1 次会话 bootstrap；私人任务无数据读取 |
| `npm run preview:wechat-ai` | 微信开发者工具成功编译并生成开发预览二维码；总包约 1.9 MB |
| `npm run test:agent-foundation` | 41/41 通过 |
| `npm run test:agent-regression` | 196/196 通过；早期镜像拉取超时的个别容器段标记 UNVERIFIED |
| `npm run test:ai-competition`、`npm run test:agent-final-convergence` | 通过 |
| `npm run test:agent-phase2` | 10/11；现有文案审计缺少“可以直接告诉我你想完成的校园任务”，本次未改该 UI |
| 天气、校园地图、教学周历契约测试 | 通过 |
| 线上公开只读探针 | 周历 19 周、天气成功、已发布地图 58 个已核验地点；HTTP 均为 200 |
| `npm run release:formal:check` | 对不含 beta `agent` 的现有正式工程返回通过；不能证明微信 AI 开发模式可提审 |
| 知识库文件 | 一个 `.md` 文件，约 6.7 KB，小于 10 MB |

**结论：开发预览和自动契约通过；微信 AI 灰度真机选择 Tool/卡片及正式版发布未通过验收。**微信平台尚未开放开发模式正式提审，因此本轮未执行正式代码上传、提审或线上切流。已有正式版及回滚点未改动。

# 小佛助手正式版本地能力清单

更新时间：2026-07-08

本清单来自现有 `toolRegistry`、`mockProvider`、小程序快捷入口、`aiAssistantService` 和本地 `fosuKnowledgeBase` 的能力审计。正式版规则只负责触发、解释、追问和卡片说明；课程、教师、教室、空教室、教学周、校历等事实必须来自工具链、Release Pack 或用户本地个人课表摘要，不能写死在知识库正文里。

| 能力 | 用户常见说法 | intent | 工具函数 | 卡片类型 | 当前 mock 回复摘要 | 是否需要后台知识库管理 |
| --- | --- | --- | --- | --- | --- | --- |
| 小佛助手能力介绍 | “你能做什么”“佛课小表能做什么”“小佛助手怎么用” | `project_qa` / `rag_search` | `rag_search` 或项目说明 fallback | `guide` / `generic` | 说明可查课表、空教室、教学周、个人导入和使用帮助，事实以工具为准 | 是，维护能力说明和入口建议 |
| 今日课表 | “今天有什么课”“今日课表”“今天还上什么课” | `get_today_courses` | `get_today_courses` | `schedule` / `guide` | 有个人课表摘要时列出今日课程；没有摘要时引导导入个人课表 | 是，只维护触发词和导入追问 |
| 明日课表 | “明天课表”“明天有什么课”“明日安排” | `get_tomorrow_courses` | `get_tomorrow_courses` | `schedule` / `guide` | 基于个人课表摘要列出明日课程，没有摘要则引导同步 | 是，只维护触发词和说明 |
| 下一节课 | “下一节课是什么”“接下来在哪上课”“马上还有课吗” | `get_next_course` | `get_next_course` | `schedule` | 返回下一节课程、节次、时间和教室；无结果时说明本地摘要未命中 | 是，只维护触发词和追问 |
| 本周课表 | “本周课表”“这一周安排”“第几周课表” | `get_week_schedule` | `get_week_schedule` | `schedule` | 汇总本周每日课程并提示当前教学周 | 是，只维护触发词和入口 |
| 查班级课表 | “查25动物医学6班课表”“25动医6”“某专业某班课表” | `search_school_index` | `search_school_index` → `get_schedule_detail` | `generic` / `schedule` | 从全校索引查班级，命中详情后展示课程，否则提示换关键词 | 是，只维护同义词和槽位说明 |
| 查教师课表 | “查张老师课表”“某老师今天上什么课”“教师课表” | `search_school_index` | `search_school_index` → `get_schedule_detail` | `teacher` / `schedule` | 从教师索引查结果，命中详情后列课程 | 是，只维护触发词和追问 |
| 查教室课表 | “查C7-203教室”“B8占用情况”“教室课表” | `search_school_index` | `search_school_index` → `get_schedule_detail` | `generic` / `schedule` | 解析楼栋/教室号后查教室索引和详情 | 是，只维护格式示例 |
| 查课程课表 | “查高等数学课程”“这门课谁上”“课程安排” | `search_school_index` | `search_school_index` → `get_schedule_detail` | `course` / `schedule` | 从课程索引查候选，命中详情后展示课程安排 | 是，只维护触发词和示例 |
| 空教室 | “现在有空教室吗”“C7附近空教室”“下午自习室” | `search_empty_rooms` | `search_empty_rooms` | `empty_room` / `diagnosis` | 按日期、节次、楼栋查空教室；索引不可用时给数据诊断卡 | 是，只维护触发规则和追问 |
| 连续空教室 | “连续两节空教室”“连着三节自习室”“找连续空教室” | `search_continuous_empty_rooms` | `search_continuous_empty_rooms` / `search_empty_rooms` | `empty_room` | 按连续节数筛选空教室并给入口 | 是，只维护触发词和节数说明 |
| 教学周 | “现在第几周”“当前教学周”“今天第几教学周” | `get_teaching_week` | `get_teaching_week` | `generic` | 返回当前教学周、学期、总周数和不确定状态 | 是，只维护触发词；周数来自工具 |
| 校历 | “校历”“什么时候开学/放假”“学期日历” | `get_term_calendar` | `get_term_calendar` | `guide` | 返回当前学期配置、开学日、总周数和当前周 | 是，只维护说明；日期来自工具 |
| 天气查询 | “仙溪天气”“今天下雨吗”“要带伞吗” | `get_campus_weather` | `get_campus_weather` | `weather` / `weather_card` | 返回校区天气、温度、降水和建议；不可用时降级说明 | 是，必须保留天气卡片配置 |
| 天气 + 课表建议 | “下一节课前天气怎样”“明天下午空教室和天气” | `get_course_weather_advice` / `campus_multi_step_advice` | `get_campus_weather`、`get_tomorrow_courses`、`search_empty_rooms` | `weather` / `schedule` / `empty_room` | 多步查询课程、空教室、天气，再组合建议 | 是，维护组合规则，不写死事实 |
| 校园地图地点 | “C7在哪”“图书馆怎么走”“仙溪饭堂位置” | `search_campus_place` / `get_classroom_location` | `search_campus_place`、`get_classroom_location` | `generic` / 地图入口 | 查结构化地点或教室所在楼栋，并给校园地图入口 | 是，维护地点同义词和入口说明 |
| 路线/教室位置 | “下一节课教室在哪”“到C7怎么走”“教室位置” | `next_course_location` / `get_campus_route` | `get_next_course`、`get_classroom_location`、`get_campus_route` | `schedule` + `generic` | 先查下一节课，再查教室位置；无位置时说明未维护精确坐标 | 是，维护组合规则 |
| 个人课表导入/同步 | “怎么导入个人课表”“同步课表”“XLS导入” | `explain_personal_import` | `explain_personal_import` | `guide` / `personal_schedule` | 说明不接收账号密码，推荐个人课表同步或 XLS 导入入口 | 是，维护步骤和入口文案 |
| 个人课表摘要/共同空闲 | “帮我推荐自习时间”“共同空闲”“组会时间” | `recommend_meeting_time` | `recommend_meeting_time` → `search_empty_rooms` | `reminder` / `empty_room` | 基于用户授权的本地摘要计算空闲，再联动空教室 | 是，维护授权说明；结果来自摘要和工具 |
| 数据状态/是否最新 | “数据最新吗”“为什么加载失败”“空教室数据异常” | `diagnose_data_status` | `diagnose_data_status` | `diagnosis` / `schedule_status` | 检查 active release、索引数量、空教室索引和缓存状态 | 是，维护解释；状态来自工具 |
| 使用说明/FAQ | “怎么使用全校查询”“为什么查不到”“常见问题” | `rag_search` | `rag_search` | `guide` | 从知识库返回使用说明、FAQ 和下一步建议 | 是，作为文档知识库管理 |
| 隐私说明 | “会保存密码吗”“会上传我的课表吗”“隐私安全吗” | `rag_search` / `explain_personal_import` | `rag_search`、`explain_personal_import` | `guide` | 说明不接收账号密码，只在授权时读取最小课表摘要 | 是，作为公开文档管理 |
| 无法识别追问 | “帮我查一下”“看看课表”“找个教室” | `clarify_missing_slot` / `conversational_help` | `clarify_missing_slot` | `guide` / 无卡片 | 追问教师、班级、教室、课程或个人课表摘要等缺失条件 | 是，维护友好追问模板 |

## 正式版处理顺序

1. 安全过滤：拦截学号、密码、Cookie、Token 等敏感输入。
2. 关键词/同义词/正则规则命中：从已发布知识库读取触发规则和追问建议。
3. intent 识别：沿用 `toolRegistry` 的本地解析和待补槽逻辑。
4. 工具调用：事实类问题必须执行对应工具链。
5. 卡片渲染：沿用 `mockProvider` 已有卡片构造函数。
6. RAG 文档补充：只用于功能说明、使用说明、隐私、安全、FAQ。
7. 友好兜底追问：不编造事实，只引导用户补充查询条件。

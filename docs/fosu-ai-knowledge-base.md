# 小佛AI 校园知识库与智能体强化方案（人工维护版）

> 用途：把本文件作为 Codex GPT-5.5 xhigh 的上下文资料，让它据此重构/增强小佛AI的 RAG 知识库、卡片系统、前端交互和 Agent 工具分流。
> 当前版本：v0.2 maintained
> 生成日期：2026-07-07
> 注意：本文件是“知识库种子 + 架构规范 + 前端实现目标”，不是一次性写死的最终数据。Codex 应继续把它转为可维护的 JSON/TS 数据结构、爬虫脚本、测试矩阵和 UI 组件。

---

## 0. 当前问题清单

### 0.1 输入框 UI 问题
当前 AI 管家底部输入框 placeholder 出现自动换行，例如：
“问我校园事项、课表和常用入口”被挤成两行，影响观感。

要求：
- 输入框内容、placeholder 必须保持单行展示。
- 不允许自动换行。
- 过长时使用省略号或缩短文案。
- 推荐 placeholder：
  - `问校园事项、课表和入口`
  - `问课表、校园入口和办事`
  - `问小佛校园事项`
- 输入框区域需要保持高度稳定，避免键盘弹出/聊天滚动时跳动。

### 0.2 知识库过浅
现在小佛AI的校园知识库偏像“临时 FAQ”，而不是一个可维护的校园 RAG 知识底座。需要：
- 先建立 Markdown / JSON / TS seed 知识库。
- 再由脚本导入到小程序数据层。
- 所有知识条目必须有来源、时间、可信度、入口类型。
- 不要所有问题都机械回答“以学校官网为准”。

### 0.3 问答与卡片不在同一条线
用户在聊天中问的问题，回答、卡片、按钮、复制、跳转都必须在同一条聊天流内出现。弹层、任务面板、快捷 chips 只是入口，不是另一个回答频道。

### 0.4 前端缺少便捷操作
聊天内容需要支持：
- 复制回答
- 复制来源
- 打开/复制官网入口
- 一键跳转小程序内页面
- 对课表卡、导航卡、知识卡、天气卡做准确区分
- 卡片下方快捷追问要可点击并在当前聊天流继续

---

## 1. 设计原则

### 1.1 小佛AI定位
小佛AI不是泛化大模型聊天助手，而是：
- 佛山大学校园事项智能体
- 全校课表工具入口
- 个人课表助手
- 校园知识检索助手
- 常用系统导航入口
- 数据状态说明助手
- 天气/出行轻提醒助手

### 1.2 不可做的事
- 不要编造学校制度、电话、地址、部门职责。
- 不要把天气、课表、教学周、数据更新时间等动态问题交给普通 RAG 硬答。
- 不要把“课表数据是否最新”识别为课程名。
- 不要把缺少参数的问题做成“未找到”。
- 不要在 UI 显示 intent、RAG、handler、confidence、cardType 等技术词。
- 不要把某个具体班级/专业写成正式 UI 默认示例。

### 1.3 必须做的事
- 每条正式示例都要能触发正确 intent/tool/cardType。
- 每张卡片都要有明确类型。
- 每个按钮都要有真实行为：复制、跳转、继续追问或打开入口。
- RAG 只回答有来源的信息；无来源就说明暂未收录。
- 动态信息优先走工具或项目真实字段。

---

## 2. 已发现/应纳入的佛山大学相关域名与入口

> 说明：以下是知识库 seed URL。Codex 应实现 crawler/collector，对这些 URL 做可配置抓取、清洗、摘要、入库。无法直接访问时保留为 sourceUrl，不要删除。

### 2.1 主站与核心页面
| 类型 | URL | 用途 | 可信度 |
|---|---|---|---|
| 学校主站 | https://www.fosu.edu.cn/ | 学校总入口 | high |
| 学校概况 | https://www.fosu.edu.cn/school-overview | 学校简介、历史、校区、办学概况 | high |
| 教务部 | https://www.fosu.edu.cn/jwc/ | 教务通知、学务通知、教学运行、规章制度 | high |
| 图书馆 | https://www.fosu.edu.cn/library/ | 图书馆入口、馆藏、数据库、借阅服务 | high |
| 人力资源/招聘 | https://www.fosu.edu.cn/renshi/ | 人才招聘、公告 | medium |
| 研究生相关历史入口 | https://www.fosu.edu.cn/yanjiusheng/ | 研究生招生/通知历史资源 | medium |

### 2.2 二级域名/独立系统入口
| 类型 | URL | 用途 | 可信度 |
|---|---|---|---|
| 本科招生网 | https://zsb.fosu.edu.cn/ | 本科招生、招生章程、咨询 | high |
| 智慧就业中心 | https://jy.fosu.edu.cn/ | 就业、双选会、校招、单位注册 | high |
| 旧版门户/学院群站 | https://web.fosu.edu.cn/ | 二级学院、研究生、人事等旧站入口 | medium |
| 研究生学院旧入口 | http://web.fosu.edu.cn/yanjiusheng/ | 研究生招生与通知历史入口 | medium |
| 招聘报名系统 | https://rczp.fosu.edu.cn/ | 人才招聘报名系统 | high |
| 学报编辑部 | https://xbbjb.fosu.edu.cn/ | 学报、投稿、期刊信息 | medium |
| 教务/课表相关系统 | https://apaas.fosu.edu.cn/ | 教务/课表数据来源之一，需项目内验证 | medium |

### 2.3 后续建议继续发现的域名模式
Codex 可加入脚本定期搜索：
- `site:fosu.edu.cn 佛山大学 教务`
- `site:fosu.edu.cn 佛山大学 图书馆`
- `site:fosu.edu.cn 佛山大学 学生工作部`
- `site:fosu.edu.cn 佛山大学 团委`
- `site:fosu.edu.cn 佛山大学 信息化`
- `site:fosu.edu.cn 佛山大学 二级学院`
- `site:fosu.edu.cn 佛山大学 校历`
- `site:fosu.edu.cn 佛山大学 校园卡`
- `site:fosu.edu.cn 佛山大学 报修`
- `site:fosu.edu.cn 佛山大学 易班`
- `site:fosu.edu.cn 佛山大学 第二课堂`
- `site:fosu.edu.cn 佛山大学 i志愿`

---

## 3. 初始知识库条目 Schema

建议最终转为 `data/fosuKnowledgeBase.ts` 或 `data/fosuKnowledgeBase.json`。

```ts
type FosuKnowledgeEntry = {
  id: string
  title: string
  summary: string
  content: string
  category:
    | 'school_overview'
    | 'campus'
    | 'college_department'
    | 'academic_affairs'
    | 'schedule'
    | 'personal_schedule'
    | 'library'
    | 'student_affairs'
    | 'youth_league'
    | 'employment'
    | 'admission'
    | 'graduate'
    | 'network_it'
    | 'campus_card'
    | 'repair_logistics'
    | 'map_location'
    | 'weather'
    | 'app_help'
    | 'navigation'
    | 'faq'
  entryType:
    | 'knowledge'
    | 'navigation'
    | 'faq'
    | 'status'
    | 'schedule_help'
    | 'weather'
    | 'tool_guide'
  keywords: string[]
  aliases: string[]
  sourceUrl: string
  updatedAt: string
  confidence: 'high' | 'medium' | 'low'
  actions?: Array<{
    type: 'open_url' | 'copy_url' | 'navigate_miniapp' | 'ask_followup' | 'open_map' | 'open_schedule'
    label: string
    payload: Record<string, any>
  }>
}
```

---

## 4. 初始 seed 知识条目

> 这些条目用于启动小佛AI的知识能力。Codex 应继续拆成结构化数据，并标注来源与可信度。

### 4.1 佛山大学学校概况
- id: `school_overview_basic`
- title: `佛山大学学校概况`
- category: `school_overview`
- entryType: `knowledge`
- aliases: `佛大`, `佛山大学`, `Foshan University`, `学校简介`, `学校概况`
- sourceUrl: `https://www.fosu.edu.cn/school-overview`
- confidence: `high`
- summary: 佛山大学是位于广东佛山的全日制公办普通本科高校。学校办学历史可追溯至1958年相关办学源头，现有仙溪、江湾、河滨等校区。
- content:
  - 用于回答“佛大是什么学校”“佛山大学在哪里”“佛大有哪些校区”等。
  - 不要把这条用于回答天气、课表、当前教学周、系统入口等动态问题。
  - 回答时应提示：更具体的学院、专业、招生、教务信息以对应部门页面为准。

### 4.2 佛山大学校区
- id: `campus_list_basic`
- title: `佛山大学校区`
- category: `campus`
- entryType: `knowledge`
- aliases: `校区`, `仙溪`, `江湾`, `河滨`, `佛大校区`
- sourceUrl: `https://www.fosu.edu.cn/school-overview`
- confidence: `high`
- summary: 佛山大学常见校区包括仙溪校区、江湾校区、河滨校区。
- content:
  - 仙溪校区常见地址表达：佛山市南海区狮山镇广云路33号。
  - 江湾校区常见地址表达：佛山市禅城区江湾一路18号。
  - 河滨校区常见地址表达：佛山市禅城区河滨路5号。
  - 地图楼栋、教室位置应优先走项目内校园地图/地点库，不要仅靠学校概况回答。

### 4.3 教务部与教务入口
- id: `academic_affairs_portal`
- title: `教务部与教务入口`
- category: `academic_affairs`
- entryType: `navigation`
- aliases: `教务`, `教务部`, `教务处`, `教务系统`, `选课`, `成绩`, `考试`, `课表`, `学务通知`
- sourceUrl: `https://www.fosu.edu.cn/jwc/`
- confidence: `high`
- summary: 教务部页面用于查看教务通知、学务通知、教学运行、规章制度等公开信息。具体登录、选课、成绩、考试和个人信息以学校当前信息门户/教务系统为准。
- actions:
  - `打开教务部官网`
  - `复制教务入口`
  - `问我怎么查课表`
- routing:
  - “教务系统在哪里/怎么进/教务入口” → navigation_card
  - “当前是第几教学周/课表数据是否最新” → schedule_status_card
  - “查某班课表/某教师课表” → schedule_query

### 4.4 图书馆入口与服务
- id: `library_portal`
- title: `图书馆入口与服务`
- category: `library`
- entryType: `navigation`
- aliases: `图书馆`, `图书馆入口`, `馆藏`, `数据库`, `借阅`, `自习`, `座位预约`
- sourceUrl: `https://www.fosu.edu.cn/library/`
- confidence: `medium`
- summary: 图书馆入口可用于馆藏检索、数据库访问、借阅相关服务等。开放时间、预约规则、数据库权限应以图书馆页面最新通知为准。
- actions:
  - `打开图书馆官网`
  - `复制来源`
  - `问图书馆怎么借书`
- routing:
  - “图书馆在哪里/图书馆入口/数据库怎么用” → navigation_card 或 school_knowledge_card
  - “图书馆今天开不开”属于动态信息；若没有实时数据，不要编造，应提示查看图书馆官网最新开放安排。

### 4.5 本科招生入口
- id: `undergraduate_admission`
- title: `本科招生入口`
- category: `admission`
- entryType: `navigation`
- aliases: `招生`, `招生办`, `本科招生`, `录取`, `招生章程`, `专业介绍`
- sourceUrl: `https://zsb.fosu.edu.cn/`
- confidence: `high`
- summary: 本科招生网用于查看招生章程、招生计划、录取规则、专业介绍和招生咨询等信息。
- actions:
  - `打开本科招生网`
  - `复制招生入口`

### 4.6 智慧就业中心
- id: `employment_center`
- title: `智慧就业中心`
- category: `employment`
- entryType: `navigation`
- aliases: `就业`, `就业网`, `智慧就业`, `双选会`, `招聘会`, `校招`, `生源信息`
- sourceUrl: `https://jy.fosu.edu.cn/`
- confidence: `high`
- summary: 智慧就业中心用于就业信息、双选会、校招指南、生源信息等服务。
- actions:
  - `打开就业中心`
  - `复制就业入口`

### 4.7 招聘报名系统
- id: `recruitment_system`
- title: `佛山大学招聘报名系统`
- category: `college_department`
- entryType: `navigation`
- aliases: `招聘`, `人才招聘`, `辅导员招聘`, `教师招聘`, `博士后`, `报名系统`
- sourceUrl: `https://rczp.fosu.edu.cn/`
- confidence: `high`
- summary: 招聘报名系统用于教师、辅导员、博士后等岗位报名。学生日常使用频率较低，但可作为校园公开入口收录。

### 4.8 个人课表导入帮助
- id: `personal_schedule_import_guide`
- title: `个人课表导入`
- category: `personal_schedule`
- entryType: `tool_guide`
- aliases: `导入课表`, `个人课表`, `XLS导入`, `Excel课表`, `今天有什么课`, `下一节课`
- sourceUrl: `app://schedule-import`
- confidence: `high`
- summary: 导入个人课表后，小佛AI才能回答“今天有什么课”“明天有什么课”“下一节课在哪里”等个性化问题。
- content:
  - 不要在聊天框输入学号和密码。
  - 优先从小程序内“个人课表导入”入口查看 XLS 导入方式。
  - 未导入个人课表时，personal_schedule 问题应返回导入引导卡，而不是乱查班级课表。

### 4.9 全校课表工具说明
- id: `public_schedule_tool_guide`
- title: `全校课表查询`
- category: `schedule`
- entryType: `schedule_help`
- aliases: `全校课表`, `查班级`, `查教师`, `查教室`, `查课程`, `课表`
- sourceUrl: `app://school-schedule`
- confidence: `high`
- summary: 全校课表可按班级、教师、教室、课程查询。用户没有说明查询对象时，应追问最小必要信息。
- routing:
  - “查班级课表” → clarification_card: 询问班级名称
  - “查教师课表” → clarification_card: 询问教师姓名
  - “查教室占用” → clarification_card: 询问教室
  - “查课程安排” → clarification_card: 询问课程名
  - “查某班本周课表” → schedule_result 或 not_found
  - “课表数据更新到什么时候” → schedule_status_card

### 4.10 天气与出行
- id: `weather_tool_guide`
- title: `天气与出行提醒`
- category: `weather`
- entryType: `weather`
- aliases: `天气`, `下雨`, `带伞`, `热不热`, `冷不冷`, `适合跑步`, `风大`
- sourceUrl: `weatherProvider://open-meteo`
- confidence: `medium`
- summary: 天气类问题必须走 weatherProvider，不要使用学校官网概况替代。没有天气数据时明确说明数据源不可用。
- routing:
  - “仙溪校区今天会下雨吗” → weather_card
  - “今天要不要带伞” → weather_card
  - “下一节课要带伞吗” → personal_schedule + weather_card，若未导入个人课表则提示限制。

---

## 5. Agent Router 目标

### 5.1 intent 枚举
```ts
type XiaofoIntent =
  | 'schedule_query'
  | 'personal_schedule'
  | 'schedule_status'
  | 'school_knowledge'
  | 'navigation'
  | 'weather'
  | 'help'
  | 'quick_action'
  | 'smalltalk'
  | 'ambiguous'
```

### 5.2 cardType 枚举
```ts
type XiaofoCardType =
  | 'schedule_result'
  | 'clarification'
  | 'schedule_status'
  | 'personal_schedule'
  | 'personal_schedule_empty'
  | 'weather_card'
  | 'school_knowledge'
  | 'navigation'
  | 'help'
  | 'import_guide'
  | 'not_found'
  | 'plain'
```

### 5.3 路由优先级
1. 天气问题 → weather，不走 RAG。
2. 课表数据更新时间/教学周/当前学期 → schedule_status。
3. 今天/明天/下一节/本周课表 → personal_schedule。
4. 明确班级/老师/教室/课程课表查询 → schedule_query。
5. “入口/官网/怎么进/在哪里打开” → navigation。
6. 学校概况/校区/学院/部门/服务 → school_knowledge。
7. 怎么用/能做什么/如何导入 → help/import_guide。
8. 无法确定 → ambiguous + clarification。

---

## 6. 前端 UI 与交互要求

### 6.1 输入框
- placeholder 单行展示。
- `white-space: nowrap;`
- `overflow: hidden;`
- `text-overflow: ellipsis;`
- 输入框高度固定，不要因为 placeholder 或文本换行导致高度变化。

### 6.2 聊天消息操作
每条 AI 回答建议支持：
- 复制回答
- 复制来源
- 复制链接
- 展开/收起长回答
- 继续追问 chips
- 对卡片主要操作按钮做显眼但不刺眼的设计

### 6.3 卡片操作
| 卡片 | 主按钮 | 次按钮 |
|---|---|---|
| schedule_result | 查看完整课表 | 复制摘要 / 换周次 |
| schedule_status | 查看数据说明 | 复制状态 |
| personal_schedule_empty | 打开导入入口 | 如何导入 |
| weather_card | 刷新天气 | 今天要不要带伞 / 明天适合跑步吗 |
| navigation | 打开入口 | 复制链接 |
| school_knowledge | 复制回答 | 复制来源 / 继续追问 |
| help/import_guide | 打开对应页面 | 复制步骤 |
| clarification | 选择查询类型 | 输入示例 |

### 6.4 问答在一条线上
- 点击快捷任务后，应在当前聊天流生成一条“用户问题”与一条“助手回答”。
- 弹层关闭后自动回到聊天流。
- 不要让用户感觉“点任务”和“聊天回答”是两个独立系统。

### 6.5 使用设计 skill
Codex 实现 UI 前，应先参考：
- fronted design skill：组件结构、视觉层级、移动端适配。
- open design skill：空状态、卡片、按钮、反馈、可访问性、一致性。

---

## 7. 小程序正式内置示例

正式 UI 可以使用这些通用示例：

| 示例 | intent | cardType |
|---|---|---|
| 查班级本周课表 | schedule_query | clarification |
| 查教师课表 | schedule_query | clarification |
| 查教室明天是否有课 | schedule_query | clarification |
| 查课程安排 | schedule_query | clarification |
| 今天有什么课 | personal_schedule | personal_schedule 或 personal_schedule_empty |
| 下一节课在哪里 | personal_schedule | personal_schedule 或 personal_schedule_empty |
| 当前是第几教学周 | schedule_status | schedule_status |
| 课表数据更新到什么时候 | schedule_status | schedule_status |
| 教务系统在哪里 | navigation | navigation |
| 图书馆入口在哪里 | navigation | navigation |
| 佛大有哪些校区 | school_knowledge | school_knowledge |
| 佛大有哪些学院和部门 | school_knowledge | school_knowledge |
| 仙溪校区今天会下雨吗 | weather | weather_card |
| 今天要不要带伞 | weather | weather_card |
| 如何导入个人课表 | help | import_guide |
| 小佛能做什么 | help | help |

正式 UI 不要默认展示某个具体专业、具体班级、具体用户的课表信息作为示例。

---

## 8. Codex 实施建议

### 8.1 文件组织建议
- `docs/fosu-ai-knowledge-base.md`：本文件或自动生成版。
- `miniprogram/data/fosuKnowledgeBase.ts`：结构化知识条目。
- `miniprogram/services/ragRetriever.ts/js`：检索与重排。
- `miniprogram/services/xiaofuAgentRouter.ts/js`：意图分流。
- `miniprogram/services/ragAnswerBuilder.ts/js`：回答构造。
- `miniprogram/components/ai-card-*`：卡片组件。
- `tools/crawl-fosu-knowledge.*`：抓取脚本。
- `tools/test-ai-built-in-example-matrix.*`：内置示例矩阵测试。

### 8.2 开发顺序
1. 修复输入框单行 placeholder。
2. 建立/导入知识库 seed。
3. 重构 RAG 检索与卡片映射。
4. 给所有卡片补复制/跳转/快捷追问。
5. 加内置示例测试矩阵。
6. 优化 UI 一致性。
7. git 分阶段提交。

---

## 9. 验收标准

### 9.1 UI 验收
- 输入框 placeholder 不换行。
- 聊天底部输入区不跳动。
- 卡片按钮可点击、可复制、可跳转。
- 长回答可以复制，来源可以复制。
- 快捷任务点击后回答仍在当前聊天流。

### 9.2 Agent 验收
以下输入必须输出正确卡片：
- “图书馆入口在哪里” → navigation
- “教务系统在哪里” → navigation
- “佛大有哪些校区” → school_knowledge
- “佛大有哪些学院和部门” → school_knowledge
- “今天要不要带伞” → weather_card
- “课表数据更新到什么时候” → schedule_status
- “今天有什么课” → personal_schedule 或 personal_schedule_empty
- “查教师课表” → clarification
- “如何导入个人课表” → import_guide
- “小佛能做什么” → help

### 9.3 RAG 验收
- 有来源的知识显示来源。
- 无来源的知识不编造。
- 动态信息不走普通学校概况。
- 不把学校官网作为所有问题兜底。
- 不显示技术字段。

---

## 10. 后续建议补充的真实数据/API

- 校内统一身份认证/信息门户入口，需要确认公开可展示的 URL。
- 校历与教学周数据源。
- 各学院、部门最新地址与官网入口。
- 图书馆开放时间与座位预约入口。
- 校园地图楼栋/地点经纬度。
- 天气 API 配置与校区坐标。
- 全校课表数据包精确更新时间。
- 个人课表最近导入时间与导入状态。

---

## 11. 2026-07-07 维护补充

### 11.1 已落到运行知识库的入口类

- 教务部与教务系统入口：`academic_affairs_portal`
- 图书馆入口与服务边界：`library_portal`
- 本科招生入口：`undergraduate_admission_portal`
- 智慧就业中心：`employment_center_portal`
- 招聘报名系统：`recruitment_system_portal`
- 研究生相关入口：`graduate_related_portal`
- 学报与期刊入口：`journal_editorial_portal`
- 校园地图入口：`campus_map_entry`
- 个人课表同步主入口：`personal_schedule_sync_entry`
- XLS 文件导入说明：`personal_schedule_xls_import_guide`
- 数据来源说明：`xiaofu_data_source_explanation`

### 11.2 个人课表导入路由约定

- “如何导入个人课表”“打开导入入口”默认打开 `/pages/personal-sync/personal-sync`。
- 只有用户明确说“XLS导入 / 表格导入 / 文件导入 / Excel导入”时，才打开 `/pages/personal-sync/personal-sync?tab=xls`。
- 导入说明卡必须同时提供“打开个人课表同步”和“查看 XLS 文件导入”。

### 11.3 检索约定

- 完整标题和 alias 精确命中优先。
- `entryType=navigation` 优先回答入口/官网/系统/怎么进/在哪里。
- `entryType=tool_guide` 优先回答如何导入、XLS、表格导入、文件导入。
- 天气、带伞、下雨、跑步问题必须走天气工具，不走官网 RAG。
- 课表数据状态、第几教学周、更新时间必须走 schedule_status，不走学校概况。
- 无可靠结果时统一说“知识库暂未收录可靠信息”，不要用学校概况兜底。

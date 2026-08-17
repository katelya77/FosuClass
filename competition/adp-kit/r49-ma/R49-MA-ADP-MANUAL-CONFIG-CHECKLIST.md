# R49-MA ADP 后台逐字段配置清单

> 本文件是 R49-MA「一核三域 · 确定性工具底座」在腾讯云智能 ADP 控制台的**逐字段人工配置清单**，可直接照着点击执行。
> 配套：`01-ARCHITECTURE.md`（架构）、`02-AGENT-RESPONSIBILITY-MATRIX.md`（职责）、`03-HANDOFF-POLICY.md`（转交）、`05-TOOL-CONTRACTS.md`（工具契约）、`09-MULTI-AGENT-E2E-MATRIX.md`（验收矩阵）。
> **ID 纪律**：所有 AgentID / PluginID / WidgetID 均为真实导出物；未取得真实 ID 前**一律用占位符并 FAIL CLOSED，禁止猜测**。

---

## 0. 操作顺序总览

1. 备份当前 R47.7 Golden Baseline（在 ADP 控制台导出 `00-小序会话总控-R47.7-Graph-Context-Integrity` 完整工作流 ZIP + 已绑定 Widget 包，见 `11-R47.7-BASELINE-AND-ROLLBACK.md`）。
2. 确认 CampusTools（competition-demo-v2）在线可调：`GET {campus_api_base_url}/health` 返回 `dataVersion=competition-demo-v2` 且 `dataHash=sha1:4f3bbbb45d1f`。
3. 创建/导入 4 个 Agent（主协调 + 三域）。
4. 按第 1 节逐字段配置 Agent 高级设置。
5. 按第 2 节配置转交关系（Main→Child、Child→Main；**禁止 Child→Child 横向自由转交**）。
6. 按第 3 节配置对话流转策略（**每个新 Turn 由主 Agent 接管**）。
7. 按第 4 节绑定 5 个 Agent Tool（→ CampusTools 插件）与知识库（Main）。
8. 按第 5 节导入复用 r48-v3 Widget（Clarification / Agent Output；第一阶段 Tool Direct Output=OFF）。
9. 按第 6 节在应用首页跑验收矩阵（A~H + 13 case + R48 A~G），全部绿灯后才进入模型 A/B（第 7 节）。

---

## 1. 四个 Agent 创建与高级设置

### 1.1 小序 · 主协调（Main）

| 字段 | 值 | 说明 |
|---|---|---|
| Agent 名称 | 小序 · 主协调 | 中文名合法（中文/英文/数字/下划线/中划线/空格） |
| 用途/转交描述 | 会话总控与路由：判定 NEW_TASK/FOLLOW_UP/CHAT/META/CLARIFY；理解代词/日期/Top1 引用；判断旧上下文相关性；决定转交哪个域 Agent；唯一澄清出口；静态知识走 KnowledgeRetrievalAnswer；动态事实一律转交域 Agent，不得自行编造课表/空教室/风险/负载 | 供平台 Agent 选择与主 Agent 路由 |
| Prompt | `agents/main-orchestrator.md` | 见第 8 节 Prompt 就位 |
| 模型 | DeepSeek V4 Flash（控制台实测 2026-08-17；见 07 §6） | baseline，不第一天双切 |
| 思考模式 thinking | 效果优先 | |
| maxReasoningRound | 8 | |
| historyLimit | 6 | |
| clarification | ON | 主协调负责澄清 |
| clarificationStyle | Widget | 用 Clarification Widget |
| output | text | 第一阶段文本全链验证 |
| 知识库 | 校园智序赛事知识（01-08 + taxonomy，已按 v2 修复） | 仅静态知识；禁答动态事实 |
| 可用工具 | KnowledgeRetrievalAnswer + 路由（转交）；**不直接持有 5 个动态 Tool** | 兜底可选放开 `campus_schedule_query`（只读课表） |

### 1.2 小序 · 课程空间（Schedule）

| 字段 | 值 |
|---|---|
| Agent 名称 | 小序 · 课程空间 |
| 用途/转交描述 | 教师/班级/教室/课程课表、整周/单日/节次、空教室、校区/楼栋/容量/连续节次。缺参返回 NEED_CLARIFICATION 给主协调，不自行追问 |
| Prompt | `agents/schedule-space.md` |
| 模型 | DeepSeek V4 Flash（控制台实测 2026-08-17；见 07 §6） |
| thinking | 效果优先 |
| maxReasoningRound | 8 |
| historyLimit | 6 |
| clarification | OFF |
| output | text |
| 工具 | `campus_schedule_query`、`campus_classroom_search` |

### 1.3 小序 · 风险规划（Risk）

| 字段 | 值 |
|---|---|
| Agent 名称 | 小序 · 风险规划 |
| 用途/转交描述 | 单对象自身冲突/赶场风险（comparisonMode=self，**不得要求第二对象**）；显式双对象冲突比较（comparisonMode=compare）；一日规划与下一天推进。缺参返回 NEED_CLARIFICATION |
| Prompt | `agents/risk-planning.md` |
| 模型 | DeepSeek V4 Flash（控制台实测 2026-08-17；见 07 §6） |
| thinking | 效果优先 |
| maxReasoningRound | 12 |
| historyLimit | 6 |
| clarification | OFF |
| output | text |
| 工具 | `campus_risk_check`（self/compare）、`campus_day_plan` |

### 1.4 小序 · 校园洞察（Insight）

| 字段 | 值 |
|---|---|
| Agent 名称 | 小序 · 校园洞察 |
| 用途/转交描述 | 未来四周校区负载、教师负载、空间压力、Top1/TopN、教学趋势、全局风险。Top1 下钻**交回主协调**再转对应域 Agent，不伪造个人事实 |
| Prompt | `agents/campus-insight.md` |
| 模型 | DeepSeek V4 Flash（控制台实测 2026-08-17；见 07 §6） |
| thinking | 效果优先 |
| maxReasoningRound | 12 |
| historyLimit | 6 |
| clarification | OFF |
| output | text |
| 工具 | `campus_overview` |

---

## 2. 转交关系配置（Multi-Agent 协同）

| 从 | 到 | 允许 |
|---|---|---|
| 主协调 | 课程空间 / 风险规划 / 校园洞察 | ✅ 允许 |
| 课程空间 / 风险规划 / 校园洞察 | 主协调 | ✅ 允许（必须回传结果与 Top1/实体） |
| 课程空间 ↔ 风险规划 ↔ 校园洞察 | 任意子 Agent | ⚠️ 控制台协同方式实测为「自由转交」（2026-08-17）；仓库设计协议仍以 **Main 中心化转交**为准（`03-HANDOFF-POLICY.md`），转交信封与回传协议不变，子 Agent 之间不得绕过 Main 直接传递未核验事实 |

> **控制台事实（2026-08-17 用户核对）**：协同方式=自由转交；四 Agent 模型均为 DeepSeek V4 Flash（见 §1.x 与 `07-MODEL-AB-PLAN.md` §6）；Tool Direct Output=OFF（§5）。

---

## 3. 对话流转策略（关键，解决 stale context）

- 平台流转策略设为：**每一个新 Turn 重新由主 Agent 接管**。
- 目的：任何时刻 Main 都能 escape 旧的 suspended/pending workflow 状态，防止 stale context 污染：
  - T09 课表 → 检查风险 → 「那看看他周三的课」（risk→schedule 干净切换）
  - 安排 09-04 → 「下一天呢」（day-plan 日期推进）
  - risk compare 澄清态（缺第二对象）→ 「A校区2026-09-03第5-6节有哪些60人以上的空教室？」（Main 判定 NEW_TASK，立即 escape 到 classroom，不追问第二对象）

---

## 4. 工具绑定

> **R49.1.1 更新**：ADP 只绑定 5 个 **Agent Tool Façade**（`/api/campus_*`），**不是**底层 7 个 CampusTools。
> Façade 已在 CloudBase HTTP Function（MCP 权威 server 层）真实实现：self 模式由服务端确定性复制 second=first，
> day_plan 缺 visitorId 时确定性使用 `demoUsers[0].id`（user-demo-001），不依赖仓库内 r49-ma adapter。
> 底层 `/api/query_schedule` 等旧接口保留，但 **ADP 不得直接绑定它们**。

- 5 个 Agent Tool Façade 作为自定义插件/HTTP 工具绑定到对应 Agent（映射见 `05-TOOL-CONTRACTS.md`）：

| Agent Tool（Façade） | 底层 CampusTools | ADP REST（Façade） | 绑定 Agent |
|---|---|---|---|
| campus_schedule_query | query_schedule | POST /api/campus_schedule_query | 课程空间 |
| campus_classroom_search | find_available_classrooms | POST /api/campus_classroom_search | 课程空间 |
| campus_risk_check | compare_schedules | POST /api/campus_risk_check | 风险规划 |
| campus_day_plan | generate_day_plan | POST /api/campus_day_plan | 风险规划 |
| campus_overview | get_campus_teaching_overview | POST /api/campus_overview | 校园洞察 |

- 请求：`POST {campus_api_base_url}/api/campus_<tool>`，Header `Authorization: Bearer <campus_api_token>`。
- OpenAPI 导入：**`r49-ma/tools/openapi/campus-agent-tools.adp-import.json`**（R49.2：5 个 operation 全部指向 Agent Tool Façade path，每个工具带明确 description；含 schema/example/error contract；输入字段已补冗余语义说明，含「ADP 归一化为 0 视为未指定」约束）。
- 部署后确认 `/health` 返回 `tools=7`（底层 CampusTools）**且** `agentTools=5`（ADP Façade）**且** `adpContractVersion=R49.2`，避免仅凭 dataVersion 猜测版本。
- **真实 PluginID / Endpoint 未取得前 → 占位符 + FAIL CLOSED，不猜测。**

### 4.1 工具参数「模型可见性」配置表（R49.2.1，控制台实测 2026-08-17）

> 目的：模型看到的每个参数都要「名 + 语义 + 取值约束」自洽；0 值语义由 Façade 归一化兜底，
> 模型描述不得自创「传 0 表示未指定」之外的解释。

| Agent Tool | 参数 | 模型可见 | 语义（模型侧 description） |
|---|---|---|---|
| campus_schedule_query | entityType | ON | 仅 class/teacher/room/course 四值，与 entityName 唯一确定实体 |
| campus_schedule_query | entityName | ON | 中文名或编号均可（如 教师009 / T09 / A2-110） |
| campus_schedule_query | week | ON | 1-20；缺省按当前教学周；ADP 归一化 0 = 未指定 |
| campus_schedule_query | weekday | ON | 1-7（1=周一）；0 = 未指定，绝不解释为「星期0」 |
| campus_schedule_query | date | ON | YYYY-MM-DD；与 weekday 不一致时 INVALID_PARAM |
| campus_schedule_query | periodStart / periodEnd | ON | 1-10，end>=start；0 = 未指定（不得把全部课程过滤成空） |
| campus_classroom_search | campus / date / week / weekday | ON | 同 schedule 语义；campus 支持 校区A/A校区/A/campus-a 等别名（R49.2.1） |
| campus_classroom_search | periodStart / periodEnd | **ON（必填）** | 1-10；**缺节次范围=INVALID_PARAM fail-closed**，不得静默全时段 |
| campus_classroom_search | minCapacity / building / consecutivePeriods | ON | 可选过滤；consecutivePeriods 1-10 |
| campus_risk_check | mode | ON | 仅 self/compare；**默认 self（控制台实测）**；self 无需第二对象（服务端确定性复制） |
| campus_risk_check | entityType / entityName | ON | 同 schedule；compare 时第二对象为 secondEntityType/Name |
| campus_risk_check | week / weekday / date / periodStart / periodEnd | ON | 同 schedule 语义（0 = 未指定） |
| campus_day_plan | date | ON（必填） | YYYY-MM-DD（控制台可见且必填） |
| campus_day_plan | visitorId | **OFF（控制台实测）** | 模型不可见；服务端确定性补齐 demoUsers[0].id=user-demo-001，模型不得猜测 |
| campus_day_plan | preferredCampus | ON | 可选自习校区偏好（控制台可见） |
| campus_day_plan | preferredStudyDuration | ON | 1-10 节；**0 或非法=INVALID_PARAM（不得删除该校验）** |
| campus_overview | windowStart / teachingStart / windowEnd | **OFF（控制台实测）** | 模型不可见；窗口固定 2026-08-25 ~ 2026-09-27，缺省用数据默认窗口 |

- **隐藏参数（控制台实测 2026-08-17）**：`campus_day_plan.visitorId`、`campus_overview.windowStart / teachingStart / windowEnd`。
  契约仍保留这些字段作为服务端可接受输入（服务端确定性补齐/取默认），模型不可见即不会传参，也不得在回复中伪造其取值。
- 其余参数均可见；若平台侧后续把某参数标为「不可见」，必须同步核对契约（服务端是否仍接受该字段）再回归 `test-adp-import-openapi.js` 与语义测试。

---

## 5. Widget 绑定（第一阶段 Tool Direct Output=OFF）

| Widget 类型 | 用途 | 绑定 | 第一阶段 |
|---|---|---|---|
| A. Clarification Widget | 主协调缺参时澄清 | 主协调 clarificationStyle=Widget | ✅ 启用 |
| B. Agent Output Widget | Agent 最终分析结果 | 各域 Agent 最终轮 | ✅ 启用（文本全链先验证，再接入） |
| C. Tool Direct Widget | 工具即本轮最终结果 | 不开启 | ❌ **OFF**（复杂请求 schedule→risk→classroom 若首个工具直接终止会切断后续推理） |

- 复用 r48-v3 为 Widget V3 baseline（不推翻）。最终 Campus Hero Widget 视觉规范见 `08-WIDGET-OUTPUT-POLICY.md`。
- **真实 WidgetID 未取得前不写死。**

---

## 6. 验证步骤（控制台人工验收）

1. 应用首页（非单工作流调试）逐条跑 `09-MULTI-AGENT-E2E-MATRIX.md`：
   - 硬回归 A~H + **D-2/D-3 变体**（自检 self-risk 不得要第二对象 / stale escape / 下一天 / Top1 真实继承 / **并列不澄清** / **week=1 不继承 overviewWindow** / 澄清不伪造 / chat 不调工具 / 动态必调工具）。
   - 13 核心 case + R48 A~G 回归。
2. CASE C evidence 契约：「下一天呢」必须观察到 fresh `campus_day_plan(date=2026-09-05)`、「再下一天」必须 `campus_day_plan(date=2026-09-06)`——不得仅根据历史返回文本生成答案（逐轮截屏取证）。
3. 任一动态事实字段与 R47.7 Golden Baseline 快照不一致 → 事实倒退，阻断发布。
4. 全绿后 → 执行 `07-MODEL-AB-PLAN.md` 的模型 A/B（控制台现行基线=四 Agent 均 DeepSeek V4 Flash，见 07 §6；单变量；**避开 2026-08-28 youtu-mrc-pro 下线节点**）。

---

## 7. 模型 A/B（不是第一天）

- Multi-Agent 基线跑通且 13 case 全绿后，按 `07-MODEL-AB-PLAN.md` 做单变量 A/B。
- 控制台现行基线（2026-08-17 实测）：**四 Agent 均为 DeepSeek V4 Flash**（`07-MODEL-AB-PLAN.md` §6）；A/B 目标由 07 §1-§4 定义，一次只切一个角色，以回归矩阵为准。

---

## 8. Prompt 就位

| Agent | Prompt 文件（仓库真源，逐字导入控制台） |
|---|---|
| 主协调 | `agents/main-orchestrator.md` |
| 课程空间 | `agents/schedule-space.md` |
| 风险规划 | `agents/risk-planning.md` |
| 校园洞察 | `agents/campus-insight.md` |

---

## 8.1 R49.3 / G2-D 提示词更新（2026-08-17，CASE D 修复）

> **本轮无需修改任何工具绑定 / 参数可见性 / Widget / 转交关系**——只重新粘贴 4 个 Agent 的 Prompt
> （仓库真源已更新，逐字导入即可）。原因：CASE D 两个 bug（并列误澄清、week 污染）都在 Agent 状态层，
> Runtime（teacherLoadTop 稳定排序、overview actions week=1）已验证正确。

| Agent | 动作 | 变更要点 |
|---|---|---|
| 主协调 | **重新粘贴** `agents/main-orchestrator.md` | 新增「Top1/Top2/Top3 排位语义」（position 语义、并列不澄清、多对象短语例外、禁止硬编码教师009）+「overviewWindow 与教学周隔离」（drilldownAcademicWeek=1，绝不 4）；信封新增 rankContext |
| 校园洞察 | **重新粘贴** `agents/campus-insight.md` | 新增「Rank Context」节（rankContext 结构、并列如实说明、多对象轮 selectedRank=null、不继承 overviewWindow） |
| 课程空间 | **重新粘贴** `agents/schedule-space.md` | 继承规则补：跨域下钻只继承实体，week 用 Main 信封 drilldownAcademicWeek=1 |
| 风险规划 | **重新粘贴** `agents/risk-planning.md` | 行为约束补：跨域下钻 mode=self 不要求第二对象、week=1 |

- **验证口诀（控制台复测 CASE D）**：「看Top1课表」绝不弹「教师009/教师011/两位都看」选择；工具调用 week 必须=1（不得=4）；并列时回复「教师009与教师011并列最高。按当前稳定排序，Top1=教师009，Top2=教师011」。
- 若控制台出现与上述不一致 → 确认 Prompt 已整体替换（不是增量追加）并重新粘贴。
- 参考实现：`r49-ma/tools/rank-semantics.js`（resolveRank / resolveDrilldownWeek / isMultiObjectRequest，Prompt 语义与测试同源）。

## 9. 平台侧待办（非本轮仓库可完成）

- [ ] 导出 R47.7 基线 ZIP 并存档（用户手动）。
- [ ] 创建 4 Agent 并按本清单逐字段配置。
- [ ] 创建 CampusTools 插件（或导入 `campus-agent-tools.adp-import.json`）并回填真实 PluginID / Endpoint / Token。
- [ ] 回填真实 AgentID 到 `tools/schemas/agent-tools.json` 的 `ids` 字段（当前为 PLACEHOLDER）。
- [ ] 确认平台侧 KnowledgeRetrievalAnswer 重新绑定修复后的知识库 01-08 + taxonomy。
- [ ] 确认对话流转策略「每个新 Turn 主 Agent 接管」在平台 UI 可用；不可用时以 Prompt 内规则兜底。
- [ ] Widget Direct Output 第二阶段再开启（先文本全链验证）。

> R49.1 已完成：`contracts.ts` 的 DATA_VERSION 已改为 v1/v2 类型兼容（运行时类型常量），不再需要手工改值。
> R49.1.1 已完成：5 个 Agent Tool Façade 已部署到 CloudBase HTTP Function（`/api/campus_*`），
> ADP 导入文件为 `campus-agent-tools.adp-import.json`；`/health` 新增 `agentTools=5` 与 `adpContractVersion=R49.1.1`。
> **R49.2（2026-08-17）**：修复 ADP 0 值归一化掩码（weekday/periodStart/periodEnd=0 一律视为未指定；
> 此前 periodStart/periodEnd=0 被当作 [0,0] 真实约束导致 SELF 风险与 overview 冲突事实不一致——本地与 CloudBase 均复现）。
> 新增 `r49-ma/tests/test-semantic-consistency.js`（15 用例全绿）。`adpContractVersion` 升至 R49.2。
> **部署状态：CloudBase `/health` 实测仍为 R49.1.1（2026-08-17）** —— 需手动重部署
> `cloudfunctions/campusflowAdpTools`（scf_bootstrap + index.js 包装，需 CAMPUS_API_TOKEN 环境变量）后，
> `/health` 应返回 `adpContractVersion=R49.2` 再进入控制台验收。

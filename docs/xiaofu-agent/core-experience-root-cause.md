# 小佛助手核心体验 — 根因证据（Layer Attribution）

> 日期：2026-07-25  
> 基线：`796cf639`（main）  
> 分支：`release/xiaofu-core-experience-convergence`  
> 方法：代码路径复现 + `toolRegistry.resolveIntent` / `releaseService.searchActiveIndex` / 客户端 `releasePackService.filterIndexPayload` 实测；非「优化识别规则」笼统描述。  
> 脱敏：不记录 OpenID、学号、Token、Cookie、密钥。

## Runtime fingerprint（本地）

| 字段 | 值 |
|------|-----|
| clientBuild | miniprogram @ `796cf639` |
| serverCommit | `796cf639` |
| releaseVersion | `26.05.29.22`（本机 active pack；教师索引样本 20 人，**不含「陈芳」**） |
| manifestHash | active pack teachers-index 无 collegeCodes 落盘（读路径 on-read enrich） |
| conversationIdHash | 场景级合成 `sha1(scenarioId)` 前 12 位（无真实用户会话） |

> 说明：本机 pack 为健康样本子集，学院过滤逻辑可测；「陈芳」全量归属需生产/完整 pack 或 E2E fixture 注入。

---

## 场景 1：人文学院搜索「陈芳」错误出现动物科技学院教师

### Redacted Trace

| 字段 | 值 |
|------|-----|
| rawMessage | （全校页教师 Tab）keyword=`陈芳` + selectedCollege=人文学院 |
| workingStateBefore | n/a（非 Agent 对话） |
| modelGoal | n/a |
| deterministicGoal | search teachers index |
| resolvedEntity | 期望：无人文学院「陈芳」 |
| selectedSkill | school.teacher_search |
| toolName | client `releasePackService.searchIndex` → static teacher index |
| toolArgs | `{ type:teacher, q:陈芳, collegeCode:<人文> }` |
| cacheKey | `school:v5:index:...` + stableParamHash(params) **不含 teacherIndexSchemaVersion** |
| cacheHit | 可能（旧缓存可跨学院污染） |
| observation | 客户端 `filterIndexPayload` 对 teacher 使用 `allowMissing: true`：无 `collegeCode` 的索引项在选学院时仍保留 |
| workingStateAfter | n/a |
| renderedCardType | school teachersResult list |

### 失败层（必须点名）

1. **Client filter 层**（主因）：`miniprogram/services/releasePackService.js`  
   - `teacherLooseFilter = type === "teacher"` → `matchesScopedFilter(..., { allowMissing: true })`  
   - 仅匹配单字段 `collegeCode`，**不读 `collegeCodes[]`**  
   - 「学院待确认」/ 空学院教师在有学院筛选时仍可出现  
2. **Index 产物层**：`teachers-index.json` 样本项 `collegeCodes` 未落盘，依赖 on-read enrich；静态 CDN 索引若未 enrich 则全部 allowMissing 漏网  
3. **Cache 层**：`SCHOOL_CACHE_SCHEMA_VERSION=5` 且 key 无 `teacherIndexSchemaVersion`，旧错误结果可残留  
4. **Server 层对照**：`releaseService.matchesCollege` 在给定 collegeCode 时会拒绝无 codes 项 — 真机走本地静态索引时 **绕过了 server 正确过滤**

---

## 场景 2：动物科技学院搜索「陈芳」

### Redacted Trace

| 字段 | 值 |
|------|-----|
| rawMessage | keyword=`陈芳` + college=动物科技学院(04) |
| toolName | 同上 client static index |
| observation | 本机 pack 无「陈芳」→ total=0；服务端 enrich 后 04 学院仅有白银山/白志红/曹嫦妤 等 |
| renderedCardType | empty teachersResult |

### 失败层

- **数据覆盖层**：本地 release 仅 20 名教师样本，无法验证「陈芳∈04」生产事实  
- **Filter 正确性**：服务端 `searchActiveIndex('teacher','',{collegeCode:'04'})` total=3 且均含 04 — 过滤函数本身在 server 路径可用  
- **精确匹配缺失**：`filterIndexPayload` / `filterActiveIndexItems` 仅用 `haystack.includes(q)`，无「精确姓名优先、无精确则模糊」策略，易返回艾毅龙/安哲明等同包噪声（当 q 过短或索引字段脏时）

---

## 场景 3：「查教师课表」→「陈芳」

### Redacted Trace（第 1 轮）

| 字段 | 值 |
|------|-----|
| rawMessage | 查教师课表 |
| workingStateBefore | `{}` |
| deterministicGoal | clarify teacherName |
| selectedSkill | search_school_index / clarify |
| toolName | clarify_missing_slot |
| toolArgs | `{ slot.missing: teacherName, type: teacher }` |
| observation | **正确** clarify |
| workingStateAfter | 期望 pendingClarification=teacher；依赖 session 写回 |
| renderedCardType | clarification |

### Redacted Trace（第 2 轮）

| 字段 | 值 |
|------|-----|
| rawMessage | 陈芳 |
| workingStateBefore | 有 pending → search_school_index teacher「陈芳」✅；**无 pending → conversational_help** ❌ |
| modelGoal | n/a / 闲聊 |
| deterministicGoal | 应为 teacher exact search |
| toolName | conversational_help（失败路径） |
| observation | Working State / pendingClarification **未跨轮持久化到 resolveIntent 上下文** 时整句姓名被当成闲聊 |
| renderedCardType | plain chat / capability |

### 失败层

1. **Working State 层**：`workingMemory` 有 `pendingClarification` 字段，但 Typed Conversation State（activeGoal / lastEntity / lastConstraints）不完整；session_state 未强制把 pending 注入下一轮  
2. **Intent 层**：裸名「陈芳」无 pending 时无 teacher 假设，落入 conversational_help  
3. **非**「识别规则写少了」——是 **任务线程状态丢失**

---

## 场景 4：「打开24动物医学1班的课表」

### Redacted Trace

| 字段 | 值 |
|------|-----|
| rawMessage | 打开24动物医学1班的课表 |
| deterministicGoal | open_schedule |
| resolvedEntity | class / 24动物医学1班 / preferredId 已解析 |
| toolName | search_school_index |
| toolArgs | `{ type:class, lockedEntityType:class, goalAction:open_schedule }` |
| observation | **本机 resolveIntent 正确** |
| renderedCardType | schedule card（依赖后续 detail） |

### 失败层

- 路由层 **已修复**（goalParser + buildOpenScheduleIntent）  
- 若真机仍失败：检查 **Action/navigate 客户端** 与 detailId 链路，而非 intent

---

## 场景 5：「将25动物医学3班设为当前课表」

### Redacted Trace

| 字段 | 值 |
|------|-----|
| rawMessage | 将25动物医学3班设为当前课表 |
| deterministicGoal | set_current_schedule |
| resolvedEntity | class / 25动物医学3班 / detailId 已解析 |
| toolName | set_current_schedule |
| observation | Intent 正确；成功必须 **Action → 客户端执行 → Receipt** |
| renderedCardType | 成功卡 / 或错误展示 tool 名 |

### 失败层

1. **Receipt 门闩**：无 Receipt 时 UI/文案不得称「已设为首页」  
2. **Composer 层**：可能泄漏内部 toolName `set_current_schedule`、Planner/Evidence 英文标签  
3. Intent 层本机 **通过**

---

## 场景 6：「查看后天仙溪校区天气」→「换成江湾校区」

### Redacted Trace（第 1 轮）

| 字段 | 值 |
|------|-----|
| rawMessage | 查看后天仙溪校区天气 |
| deterministicGoal | 应为 get_campus_weather + dateOffset=2 + campus=仙溪 |
| toolName | **campus_multi_step_advice**（实测） |
| toolArgs | `{ campus:仙溪, date:当天, sections:1-2 }` |
| observation | `inferTargetDate` **不识别「后天」**（只 +1「明天」）；`hasWeather && /后天/` 被路由进 multi_step |
| renderedCardType | multi_card：天气 + 明日课程0 + 空教室0 + 地点0 |

### Redacted Trace（第 2 轮）

| 字段 | 值 |
|------|-----|
| rawMessage | 换成江湾校区 |
| workingStateBefore | 应有 weather goal + dateOffset=2 + campus=仙溪 |
| deterministicGoal | follow_up_modify_constraint campus only |
| toolName | **rag_search**（实测） |
| observation | `isFollowUpModifierMessage` 只覆盖周次/上午下午，**不覆盖校区替换**；`resolveFollowUpIntent` 只复用课表 search |
| renderedCardType | RAG / 知识卡 |

### 失败层

1. **Intent 路由层**：天气 + 后天 → multi_step（`toolRegistry.resolveModernChineseIntent`）  
2. **日期解析层**：`inferTargetDate` 缺 后天  
3. **Follow-up 解析层**：无统一 FollowUpResolver 处理「换成 X 校区」  
4. **Working State 层**：缺 `lastConstraints.dateOffset/campus` 权威继承  
5. **Composer 层**：multi_step 展示 0 值分区与「多步骤任务」

---

## 场景 7：「只看连续两节空教室」

### Redacted Trace

| 字段 | 值 |
|------|-----|
| rawMessage | 只看连续两节空教室 |
| deterministicGoal | search_continuous_empty_rooms minFreeSections=2 + 继承上轮 campus/date/period |
| toolName | search_continuous_empty_rooms |
| toolArgs | `{ minFreeSections:2, building:"" }` **无继承** |
| observation | 工具名对，但 constraints 不继承；若上一轮是 weather，更不应进 RAG 却可能丢上下文 |

### 失败层

- **Follow-up / Working State**：连续节数修改未合并 lastConstraints  
- Intent 关键词路径「能命中工具」≠「正确继承条件」

---

## 场景 8：点击语音按钮申请权限

### Redacted Trace

| 字段 | 值 |
|------|-----|
| rawMessage | （UI）onVoiceTap |
| toolName | `wx.authorize(scope.record)` 直接调用 |
| observation | fail → Modal「打开设置」；**无** `getPrivacySetting` / `requirePrivacyAuthorize` 前置；`app.json` **无** `permission.scope.record.desc` |
| renderedCardType | 系统授权 / 设置页 |

### 失败层

1. **Auth 状态机层**：`ai-assistant.js` `ensureRecordPermission` 跳过隐私授权  
2. **配置层**：`app.json` 缺录音用途声明  
3. **ASR 层**（独立）：鉴权成功 ≠ 识别成功；CloudBase `aiVoiceTranscribe` / 腾讯一句话识别开通状态需单独证明

---

## UI 几何（并行问题，非语义）

| 问题 | 层 | 证据 |
|------|-----|------|
| 状态岛偏左 | WXSS | `.agent-status-capsule { align-self: flex-start }` 无全宽居中 wrapper |
| 底部四块矩形 | WXML/WXSS | `.composer-plus-btn` / input / `.voice-btn`「麦」/ send「↑」独立圆角方块 |
| 滚动截断 | 多重 safe-area | message-scroll padding + message-bottom-anchor + composer `env(safe-area-inset-bottom)` + sheets 重复计算 |

---

## 根因汇总（按层）

| 层 | 问题 |
|----|------|
| Client teacher filter | allowMissing + 单字段 collegeCode + 无精确姓名优先 |
| Index / cache | collegeCodes 未保证落盘；schema 未 bump |
| Working State | 非 Typed；pending/constraints 易丢 |
| Follow-up resolver | 只处理周次时段，不处理校区/连续空教室/天气 |
| Intent / date | 后天未解析；天气误入 multi_step |
| Composer | 泄漏 tool 名；0 分区；单目标当组合任务 |
| Voice auth | 无隐私前置；缺 app.json permission |
| UI layout | 状态岛未居中；composer 非单胶囊；safe-area 多处 |

## 修复原则（本轮）

1. 不新建第二套 Agent；扩展现有 Kernel / WorkingMemory / goalParser / releaseService / releasePackService / Response Composer  
2. 统一 FollowUpResolver；Typed Working State  
3. 教师学院：严格 collegeCodes 包含；学院待确认在筛选时排除；精确姓名优先；bump schema  
4. 天气单目标不进 multi_step；follow-up 只改 campus  
5. 语音状态机 privacy → record → ready  
6. UI：wrapper 居中状态岛 + 单悬浮胶囊 + 单 safe-area 所有者

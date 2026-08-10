# 校园智序 · 小序 — ADP Widget 产品化设计规格

日期：2026-08-11

状态：设计已由用户确认，待书面规格复核后进入实施计划

## 1. 目标

把已经稳定的 01–04 确定性工作流，从“Markdown 结果回复”升级成评委可快速理解、可继续操作、可量化验证的校园任务型 Agent 产品体验。

最终作品不应被理解为“会查课表的聊天机器人”，而应体现为：

> **校园智序 · 小序——面向高校学习与校园空间任务的可信执行型智能体。**

产品闭环：

`自然语言意图 → 应用级路由 → 多轮上下文 → 确定性 CampusTools → 证据核验 → Widget 结构化交互 → sys.chat 继续任务 → 评测闭环`

本阶段只做展示适配层与交互层，不重新实现 CampusTools 业务逻辑，不修改已经冻结的 01–04 核心事实计算。

---

## 2. 成功标准

### 2.1 评委视角

评委在 30 秒内应看懂三个核心价值：

1. **这是校园真实任务执行，不只是问答。**
2. **动态事实来自确定性工具并有 verified 核验，不靠模型猜。**
3. **用户可以在结果卡上继续操作，形成任务闭环。**

### 2.2 产品视角

- 01–04 四条主工作流结果优先通过 Widget 展示；文本仍作为无 Widget 环境下的 fallback。
- 所有动态卡片必须显示“已核验”状态，但不把内部工程字段堆给普通用户。
- 每张主卡最多保留 2–3 个高价值动作，避免“按钮很多但没有主线”。
- 移动端优先，桌面端也应保持紧凑而不拉伸成后台表格。
- 空结果、歧义和失败必须提供恢复动作，不制造死路。

### 2.3 工程视角

- 不把 Widget UI 逻辑写进 CampusTools。
- 通过独立 `Widget Adapter` 把工具 envelope 转换为稳定 Widget ViewModel。
- 同一份 ViewModel 同时服务 ADP 原生 Widget 与仓库 H5 fallback。
- Widget Actions 只能发送用户可理解的任务语句或安全结构，不发送密钥、内部 URL、系统 Prompt 或不可解释内部字段。
- 现有 `competition/adp-kit/widget/` 六种 cardType 继续作为兼容基线，不推倒重写。

---

## 3. 统一视觉语言

采用用户已确认的：

> **“校园任务单 / 时间票据”**

而不是常见 AI 紫色渐变、机器人头像气泡、后台运营大屏。

### 3.1 视觉原则

- 暖纸张底色 + 深墨绿主色，延续仓库现有视觉资产。
- 使用“核验印章”“节次票据”“任务状态条”等校园业务视觉隐喻。
- 冲突使用克制红色；赶场风险使用橙黄；正常核验使用墨绿。
- 课程与时间优先级高于装饰。
- 真实数据密度高，但信息块必须可扫读。
- 不依赖外部字体、CDN 或第三方图标服务。

### 3.2 响应式

- 主要设计宽度：320–430px。
- 卡片内部避免横向滚动。
- 桌面应用测试窗中保持移动端卡片宽度，不无限铺满。
- `prefers-reduced-motion` 下关闭非必要动画。

---

## 4. C 方案：4 主 Widget + 2 通用辅助 Widget

### 4.1 Schedule Widget — 课表卡

**目的**：回答单实体课表/教室占用，并提供继续查看相关任务的入口。

#### 顶部

- 对象名称，例如 `教师003`
- 对象类型弱标签：教师 / 班级 / 教室 / 课程
- 时间范围：日期、教学周、星期、节次
- `已核验`印章

#### 主体

时间轴，每项至少包含：

- `periodText`
- `courseName`
- `campusName`
- `building`
- `roomName`
- `teachers`
- `classes`

默认最多展示 5 条；超过后显示“还有 N 条”摘要，不在一张卡无限下拉。

#### 推荐动作

按上下文最多显示 3 个：

- `查看整周`
- `换一天`
- `比较冲突`
- 对教室实体可用 `查空闲时段`

按钮优先使用 `sys.chat`，以自然语言继续当前任务。

---

### 4.2 Classroom Widget — 空教室卡

**目的**：让用户一眼看到当前筛选条件与最值得选择的教室，并能直接调整条件。

#### 顶部筛选 Chips

例如：

`校区B` `09-03` `第3-4节` `≥60人` `B1`

这是本卡最重要的“上下文可视化”，用于证明多轮条件确实被继承，而不是藏在模型内部。

#### 主体

默认显示 3–5 个优先结果：

- roomName
- campusName
- building
- capacity
- roomType
- periodText

卡片不宣称“最优教室”，除非工具本身明确提供排序语义；当前仅按工具稳定顺序展示。

#### 推荐动作

- `换校区`
- `改时段`
- `容量≥60`
- `查看教室占用`

若用户刚刚已经设置某条件，则动作应优先提供相邻操作，不重复给“容量≥60”这种已经生效的条件。

#### 空结果

空结果仍使用 Classroom Widget 主体，不立即切到 Error Widget；显示“没有满足全部条件的教室”，并提供：

- `放宽容量`
- `取消楼栋限制`
- `换时段`

只有工具执行失败才使用 Error Widget。

---

### 4.3 Conflict Widget — 冲突 / 赶场卡

**目的**：把“时间冲突”和“跨校区赶场”区分展示，避免评委误以为两者是同一类问题。

#### 两种视觉模式

**A/B compare**

标题：`教师001 vs 教师002 · 课程冲突比较`

展示：

- conflictCount
- busy slot summary
- 冲突明细
- rushWarnings

**Self compare**

当 `summary.selfCompare=true`：

标题必须切换为：

`教师003 · 课程安排风险检查`

不显示 `教师003 vs 教师003`。

#### 风险层级

- 时间冲突：红色冲突条
- 跨校区赶场：橙色风险条
- 无冲突无赶场：绿色通过状态

#### 推荐动作

- `查看第一方课表`
- `查看第二方课表`
- self compare 可提供 `查看当天课表`

不在 Widget 内重新计算冲突或 gap，所有事实只读取工具输出。

---

### 4.4 Day Plan Widget — 今日校园计划时间轴卡

**目的**：作为比赛演示最重要的主视觉卡，体现“小序”是在规划校园一天，而不是单点查数据。

#### 顶部

- 日期 / 星期
- 课程数
- 空档数
- 跨校区风险状态
- 已核验印章

#### 时间轴节点

类型区分：

- `lesson`：课程
- `gap`：课间空档
- `study`：推荐自习
- `risk`：赶场提醒

空档中直接嵌入 1–2 个教室建议。

#### 推荐动作

- `换一天`
- `换校区偏好`
- `连续自习2节`
- `查看风险课程`

这张卡是 5 分钟演示主故事线的核心。

---

### 4.5 Choice Widget — 通用候选选择卡

**目的**：处理歧义实体，不让用户复制候选名称重新输入。

适用：

- `AMBIGUOUS_ENTITY`
- 多个候选教师/班级/教室/课程

#### 行为

- 使用 Radio / Select 或明确候选按钮。
- 显示候选名称 + 类型 + 必要的区分信息。
- 使用“等待用户操作”模式。
- 用户选择后，通过 `sys.chat` 发送明确的自然语言确认，例如：
  `选择教师001，继续刚才的课表查询`

禁止直接把内部 ID 作为用户消息展示。

---

### 4.6 Error Widget — 通用恢复卡

**目的**：把错误从“工程报错”转换成“可继续操作的任务恢复”。

用户层默认显示：

- 当前没有完成什么
- 原因的人类可读描述
- 推荐恢复动作

例如：

- 未找到校区C → `换校区A` / `换校区B`
- 缺时间 → `今天` / `明天下午` / `指定日期`
- 学期外 → `查看学期范围`

内部调试仍可以保留 `error.code`，但 Widget 主视觉不突出 `INVALID_PARAM`。

---

## 5. ViewModel / Widget Adapter 架构

### 5.1 原则

01–04 已冻结，不把 UI 逻辑回写进 CampusTools。

新增独立适配层：

`Tool Envelope → Adapter → Widget ViewModel → ADP Widget / H5 fallback`

### 5.2 统一 ViewModel

基于现有 `widget-schema.json` 演进，不破坏六种 cardType：

```json
{
  "schemaVersion": "campus-widget/v2",
  "cardType": "schedule|classroom|conflict|day_plan|error|choice",
  "success": true,
  "queryId": "...",
  "dataVersion": "competition-demo-v1",
  "title": "...",
  "subtitle": "...",
  "timeText": "...",
  "filters": [],
  "summary": {},
  "items": [],
  "actions": [],
  "evidence": {
    "verified": true
  },
  "error": null
}
```

### 5.3 必须保留的可信字段

- `queryId`
- `dataVersion`
- `evidence.verified`

用户视图中 `queryId` 可弱化为“查询编号”，不需要占主视觉。

### 5.4 Adapter 规则

每种 cardType 一个纯函数适配器：

- `adaptScheduleResult`
- `adaptClassroomResult`
- `adaptConflictResult`
- `adaptDayPlanResult`
- `adaptErrorResult`
- `adaptChoiceResult`

适配器只做：

- 字段映射
- 结构裁剪
- 标签文本生成
- 动作建议生成

不做：

- 日期推理
- 实体解析
- 课表事实推断
- 冲突计算
- 空教室计算
- visitor 身份选择

---

## 6. Action 设计

### 6.1 Action 数据结构

```json
{
  "id": "change-campus",
  "type": "sys.chat",
  "label": "换校区",
  "message": "那校区B呢",
  "intentHint": "query_empty_classrooms"
}
```

`intentHint` 仅供 Widget/H5 测试和评测，不作为 CampusTools 最终事实依据。

### 6.2 规则

- 每张卡最多 3 个主要动作。
- 默认动作优先级：继续当前任务 > 相邻工作流 > 泛化导航。
- 使用自然语言 `message` 进入 Agent，让现有路由和多轮上下文继续工作。
- 不直接传内部 token、NodeID、VarBizID。
- `sys.go_to_url` 仅用于无需 Agent 理解的安全页面跳转；比赛首版不把外部链接作为核心交互。
- `sys.download` 仅在后续确有可下载报告时使用，本阶段不为了“利用功能”强行增加。

---

## 7. ADP 工作流接入方式

### 7.1 主路径

在四条冻结工作流的“结果核验与呈现”之后增加薄层 Widget 适配与 Widget 节点，但保持原 Markdown 回复作为 fallback。

推荐顺序：

`工具 → 核验 → Widget Adapter → Widget → 文本 fallback/结束`

其中：

- schedule/classroom/conflict/day_plan 正常结果：Widget 直接向后流转。
- choice：Widget 等待用户操作。
- error：默认直接展示恢复卡，不阻塞工作流；需要用户选择时使用 action 发起新轮对话。

### 7.2 不变量

新增 Widget 节点后继续遵守 ADP ZIP 永久规则：

1. `NextNodeIDs` 与顶层 `Edge` 同步；
2. `REFERENCE_OUTPUT` 只引用真实上游；
3. START 到全部业务节点可达；
4. 能只改 workflow JSON 就不碰已验证 XLSX；
5. NodeUI output、Output Schema、变量引用三者同步；
6. 新增 Widget NodeType 前必须先从真实 ADP 种子导出获取序列化格式，不猜私有字段。

---

## 8. 比赛演示主故事线

演示不按“01 / 02 / 03 / 04 工作流逐个介绍”，而按一个学生的一天展开。

### 故事线

用户：

`帮我看看2026-09-04的安排`

小序返回 Day Plan Widget：上午课程、空档、自习建议、下午课程。

用户点击：

`连续自习2节`

小序更新计划。

用户点击空档中的：

`找空教室`

进入 Classroom Widget。

用户点击：

`换校区` / `容量≥60`

卡片实时体现累计条件。

随后用户问：

`教师003第1周周一跨校区来得及吗`

小序返回 Conflict Widget，显示唯一赶场提醒。

最后补一个异常：

`校区C，帮我找空教室`

Error Widget 给出可恢复操作，不编造结果。

### 评委在这一条路径看到的能力

- 意图路由
- 多轮上下文
- 工作流调用
- 工具确定性
- 防幻觉
- Widget
- sys.chat
- 错误恢复
- 跨工作流
- 匿名赛事边界

---

## 9. 评测与验收

### 9.1 Widget 单元验收

每类至少覆盖：

- 正常有结果
- 空结果
- verified=false
- 缺字段容错
- 超过最大展示条数
- Action 数量与 payload

### 9.2 ADP 真实验收

四主卡各至少 3 条真实应用测试：

- schedule：教师、班级、教室
- classroom：基础、多轮累计、空结果
- conflict：A/B、self-compare、赶场
- day_plan：正常、偏好、自习约束

辅助卡：

- choice：歧义实体
- error：ENTITY_NOT_FOUND / OUT_OF_RANGE / 缺参恢复

### 9.3 80 条应用评测衔接

Widget 阶段完成后，现有 80 条评测继续作为应用级基准。现有分布已经覆盖：课表20、空教室15、冲突10、今日计划10、多轮10、缺参歧义5、无结果工具失败5、匿名提示注入5。

评分继续沿用 10 项规则，增加两个 Widget 观察项但不改变原总分：

- 是否选择正确 cardType
- 是否提供与当前任务相关的 action

关键任务失败条件仍然是：动态事实工具调用错误或出现事实虚构。

---

## 10. 与知识库、评测、多模态的先后关系

实施顺序固定：

1. Widget C 方案产品化
2. 32 组标准 QA 知识层导入与来源显示精修
3. 80 条 ADP 原生基准评测
4. 角色指令 / 模型配置 A/B 对比
5. 安全红队：提示注入、身份越权、工具绕过
6. 多模态输入：图片只用于提取查询条件，动态事实仍走 CampusTools
7. Test Release
8. 最终演示与提交资产

暂不把 Multi-Agent 引入主提交版。若基础版本完成且评测稳定，可复制应用做展示实验版，但不得破坏当前标准模式主版本。

---

## 11. 开发工作流

为了提高效率，代码与资产构建优先交给 Codex/Kimi：

- ChatGPT：产品设计、接口规格、验收门禁、PR 侧审查、生成 ADP 种子需求
- Codex/Kimi：本地仓库代码实现、测试、Widget 文件生成、静态预览、CloudBase/ADP 辅助脚本
- 用户：只做 ADP 平台必须人工完成的种子导出、Widget 导入和真实应用测试

任何 ADP 私有节点格式第一次出现时，都遵循“先在 00 种子里手工建一个最小节点 → 导出 ZIP → 再自动生成正式包”的方式，不猜格式。

---

## 12. 当前阶段边界

本规格批准后只进入 Widget 产品化，不同时启动知识库、80 条评测、多模态或 Multi-Agent 实现。

原因：Widget 是当前对评委观感和任务闭环提升最大的单一增量，同时与已经冻结的 01–04 风险隔离最好。

完成标准：四主卡 + 两辅助卡的 Schema、Adapter、H5 fallback、ADP 原生模板/种子、Action、工作流接入和真实验收全部通过后，才进入知识层阶段。

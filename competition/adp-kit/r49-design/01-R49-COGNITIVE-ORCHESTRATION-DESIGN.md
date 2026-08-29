# R49 01 — 认知编排总体设计（Cognitive Orchestration）

> 阶段：R49 Cognitive Orchestration + Hero Widget UX — 设计/审计阶段
> 状态：DESIGN DRAFT（未实施，未导入腾讯 ADP）
> 基线：`00-小序会话总控-R47.7-Graph-Context-Integrity`（腾讯真机当前运行基线）
> 红线：不重写 01~05 主链、不拆 01~05、不 merge PR #49、不发布、不猜 WidgetID

---

## 1. 现状审计结论（代码与真机证据）

### 1.1 当前运行形态

- 腾讯真机当前使用 **00-小序会话总控-R47.7-Graph-Context-Integrity**，单工作流模式，00 直接内嵌 01 课表 / 02 空教室 / 03 冲突风险 / 04 今日计划 / 05 校园态势。
- Domain Route 真实画布连线已恢复；基础 01/02/04/05 首轮调用正常。
- 每个子工作流内部（`workflows/workflow-specs.json`）均为：`start → llm 参数提取 → 必填判断 → 缺参追问 / 日期解析 → 工具调用 → 结果契约判断 → widget/reply → end`，`replanLimit=0`，无循环。

### 1.2 上下文机制现状

- 平台侧：`application-config.json` 设置 `contextRewrite: true`（生成 `SYS.RewriteQuery`）、`contextTurns: 8`、思考模型 `youtu-intent-pro`、生成模型 `youtu-mrc-pro`。
- 历史实验：02 V7 / 03 V5（2026-08-11）已证明可读取 `SYS.UserQuery` / `SYS.RewriteQuery` / `SYS.ChatHistory` 并在工作流内用 `CODE_EXECUTOR` 做确定性上下文合并（优先级：本轮明确值 > RewriteQuery 自包含语义 > 参数提取结果）。
- 03 V5 曾实现 self-compare 确定性复制（关键词：跨校区 / 赶场 / 来得及 / 衔接）。

### 1.3 P0 证据（CASE 1，用户真机复现）

1. `T09老师第1周整周课表` → 正常。
2. `检查一下他的风险` → 错误回复「请提供第二个比较对象…」。
   - 根因 A：03 契约 `second_entity_type/second_entity_name` 为 required（`workflow-specs.json` wf-conflict `required`），缺第二个对象即走 clarify。
   - 根因 B：self-compare 触发仅靠有限关键词，`检查…风险`/`看看…风险` 不在 03 V5 关键词集内，未复制 first→second。
   - 根因 C：代词「他的」依赖 RewriteQuery 改写或参数提取继承；改写失败 → second 为空。
3. `校区A 2026-09-03 下午有哪些空教室` → 仍回复「请提供第二个比较对象…」。
   - 根因 D：clarify（pending clarification）之后 00 顶层未清空 03 的 old domain lock；后续轮次仍被路由/合并进 03 上下文，新任务被旧挂起状态污染。
4. `未来四周哪个校区最忙` → 同样污染。

### 1.4 结论

> 问题不是「模型能力弱」，而是**顶层缺少结构化 Turn 语义层 + 无 stale context escape**。01~05 各自内部的 context merge 是对的、不能动；缺的是它们之前的一个统一编排层。

---

## 2. R49 目标架构

```text
User Turn（自由文本 / Widget sys.chat）
        │
        ▼
┌─ Turn Intake ─────────────────────────────┐
│  输入：SYS.UserQuery / SYS.RewriteQuery /  │
│        SYS.ChatHistory / 上一轮 TurnState  │
│  输出：归一化消息 + 历史窗口切片            │
└──────────────┬─────────────────────────────┘
               ▼
┌─ Semantic Turn Planner ───────────────────┐
│  只理解语言，不产生动态校园事实            │
│  输出结构化 TurnState（见 02 文档）        │
└──────────────┬─────────────────────────────┘
               ▼
┌─ Context Relevance Resolver ──────────────┐
│  explicitSlots / inheritedSlots /          │
│  dropSlots 计算（见 03 文档）              │
└──────────────┬─────────────────────────────┘
               ▼
┌─ Stale Context Escape Gate ───────────────┐
│  pending clarification / 旧 domain lock    │
│  检查；命中则清空旧状态并放行新任务        │
└──────────────┬─────────────────────────────┘
               ▼
┌─ Execution Policy Router ─────────────────┐
│  01 Schedule │ 02 Classroom │ 03 Risk      │
│  04 DayPlan │ 05 Overview │ Knowledge      │
│  General LLM │ Clarification                │
└────────────────────────────────────────────┘
```

### 2.1 各阶段职责与约束

| 阶段 | 职责 | 严禁 |
|---|---|---|
| Turn Intake | 取 SYS.* 三变量、上轮 TurnState、规范化实体别名（T09→教师009、A班→2025级A班） | 不产生事实、不做路由结论 |
| Semantic Turn Planner | 判定 turnType/domain/slots/comparisonMode/代词指代/routeConfidence | 绝不生成/改写/补全动态校园事实 |
| Context Relevance Resolver | 只做继承与丢弃运算（新值覆盖旧值；NEW_TASK 丢弃不兼容 state） | 不改变 Planner 语义结论 |
| Stale Context Escape Gate | 检测 stale/pending 状态并清空（硬测试 A~D） | 不得把新任务并入旧挂起任务 |
| Execution Policy Router | 按 TurnState 选 01~05 / Knowledge / LLM / Clarify | 不重新解释用户语言 |

### 2.2 与现有资产的映射（不新建第二套事实层）

| R49 概念 | 落地建议 |
|---|---|
| Turn Intake + Planner + Resolver + Gate | 00 工作流内、01~05 路由之前的一组节点（LLM 参数提取 + CODE_EXECUTOR 确定性 gate），继承 02 V7/03 V5 已验证的 SYS.* 读取模式 |
| Execution Policy Router | 00 现有的 Domain Route 分支，输入改为 TurnState 而非裸文本 |
| 01~05 子工作流 | **不改**；只在入口获得「本轮完整自包含输入 + 明确继承槽位」 |
| Knowledge / General LLM | 00 路由到知识库 / 兜底分支（见 04 文档） |
| Widget action | 保持 sys.chat state-complete canonical 消息，作为「新 root turn」进入 Intake |

---

## 3. 数据优先级（Planner 唯一裁决顺序）

1. **本轮显式用户信息**（最高）
2. **SYS.RewriteQuery**（平台改写后的自包含语义）
3. **当前兼容任务的 confirmed state**（上一轮 TurnState，仅 domain 兼容时）
4. **最近相关 SYS.ChatHistory**（仅相关片段，非全量）
5. **缺失**（不得猜测，转 Clarification）

硬规则：**旧 history 永远不得覆盖本轮明确新问题**（明确新实体/新日期/新 domain 即覆盖）。

---

## 4. 三层知识/工作流/聊天边界

| 层 | 例子 | 去向 |
|---|---|---|
| DYNAMIC CAMPUS FACT | T09 第1周周三的课 / 校区A 下午空教室 / 冲突 / 态势 | 01~05 / CampusTools，必须可核验 Evidence |
| STATIC PRODUCT KNOWLEDGE | 小序能干什么 / 教学周怎么算 / 节次时刻 / 演示数据边界 | Knowledge Base（知识库 7 篇，R45 08 缺失见 04 文档） |
| GENERAL CHAT / EXPLANATION | 你好 / 什么叫跨校区赶场（概念解释） | General LLM，不调用 CampusTools |

禁止：知识库直接回答动态事实；LLM 直接回答动态事实；把「什么叫跨校区赶场」路由到 CampusTools。

---

## 5. 核心设计决策（本轮定稿）

1. **统一编排层放 00，不放 01~05 各内部**：避免每个工作流重复实现不一致的合并逻辑；01~05 保持单一职责。
2. **Stale Escape 是确定性 Gate，不是 prompt**：以 CODE_EXECUTOR 实现硬测试 A~D，结果可断言、可回归。
3. **self-risk 语义扩展**：`检查/查看/看看 + 他的/该/这位 + 风险/冲突/赶场` 且上下文单实体 → 强制 self-compare；two_object 仅在两个显式对象时才允许。
4. **上下文不做全量继承**：Relevant Context Selection + 6 轮 vs 8 轮 A/B（见 03 文档）。
5. **Widget action = state-complete 新 root turn**：`查看T09老师第1周周三第7-8节“科学计算”的课程详情` 等完整 sys.chat，禁止「查看详情/再看看/换一天/其他条件不变」（对齐 action-contract.json `forbiddenPayloadFragments`）。
6. **模型迁移分步 A/B**：Generation 优先试 DeepSeek V4 Pro；Semantic Planner 试 DeepSeek V4 Flash vs Pro；Rewrite/Intent 暂保持（见 05 文档）。
7. **Hero Widget 视觉**：WakeUp-inspired Campus Blocks，5~7 个低饱和 deterministic 课程色，viewMode week/day/detail/picker（见 06/07 文档）。

---

## 6. 本轮不做什么（范围红线）

- 不重写 R47.7 的 01~05 内部逻辑；不拆 01~05。
- 不 merge PR #49、不发布、不改 production、不改 CampusTools 已验证算法、不改 competition-demo-v2 数据。
- 不猜 WidgetID、不手造 Tencent identity、不生成 ADP 导入 ZIP（本轮纯文档）。
- 不把 R49 做成纯 prompt 工程（状态机与 Gate 必须可代码断言）。
- 不直接全面切 Multi-Agent / Plan-and-Execute 主入口。
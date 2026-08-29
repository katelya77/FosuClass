# R49 09 — 风险登记册（Risk Register）

> 阶段：R49 设计/审计阶段 — DESIGN DRAFT
> 等级：P0 阻断 / P1 高 / P2 中低

---

## 1. P0 风险

| # | 风险 | 证据 | 缓解 |
|---|---|---|---|
| R01 | **Stale Context 污染新任务**：03 pending clarification / old domain lock 使后续空教室、态势查询被复读第二对象追问 | CASE 1（T09 整周→检查他的风险→校区A空教室→未来四周最忙 全被 03 卡住） | 00 层 Stale Context Escape Gate（确定性 CODE_EXECUTOR，硬测试 A~D）；新 domain 显式切换即清空旧状态 |
| R02 | **self-risk 误判 two_object**：`检查他的风险` 缺 second 触发缺参追问 | 03 契约 second_entity required + 03 V5 关键词集不覆盖「风险/检查」 | Planner 扩展 self 触发语义（风险/冲突/赶场/衔接 + 代词/单实体），second=first 确定性复制 |
| R03 | **生成模型 youtu-mrc-pro 2026-08-28 下线** | 腾讯计划通告 | 按 05 文档 A/B 先验证 DeepSeek V4 Pro；单角色切换 + 回滚路径；08-28 前完成迁移评测 |

## 2. P1 风险

| # | 风险 | 证据 | 缓解 |
|---|---|---|---|
| R04 | 知识库 v1/v2 事实冲突（01 规模、04 版本、07 Q2/Q3） | 知识库文档审计（01/04/07 仍写 v1：2 校区/8 教师/16 课/22 教室） | 实施阶段同步修订静态描述为 v2（3 校区/12 教师/36 教室/约58课）；不改查询语义 |
| R05 | **08-功能导航与演示问题-R45.md 缺失**（「功能示例」入口的展开依据） | 仓库 knowledge/ 只有 7 篇 | 向用户索取腾讯控制台原文或按 R45 主题重建；重建内容须评审 |
| R06 | application-config 仍写 data_version=competition-demo-v1 | application-config.json | 与 v2 线上 attestation 对齐为 competition-demo-v2 |
| R07 | 00 结构改动若在 01~05 之前插入节点，可能引入新的导入/绑定失败 | 历史：10013 add vectors failed、450081、未选择 Widget | 实施阶段先做「最小改动导出/导入验证」；不重绑 Widget；保底回滚到 R47.7 基线包 |
| R08 | RewriteQuery 改写质量不稳定 → Planner 依据漂移 | 02 V7 实验记录：第三轮起仍可能丢条件 | 数据优先级：本轮显式 > RewriteQuery；动态事实最终仍由 CampusTools 核验 |

## 3. P2 风险

| # | 风险 | 缓解 |
|---|---|---|
| R09 | 6 轮 vs 8 轮窗口 A/B 不达标 | 按 08 矩阵真机对比；相关片段选择优先，轮数兜底 |
| R10 | Widget Hero 视觉原型被误当正式 Widget | 原型目录独立（r49-design/widget-prototype/），无 WidgetID，README 明示 |
| R11 | 课程色 deterministic 哈希在别名/重命名时变化 | 用归一化课程名（同 extractPrompt 归一化规则）做 key；提供回归测试 |
| R12 | 模型 A/B 切换影响票据文案风格 | 以 13 用例输出字段完整性为准；文案差异人工评审 |
| R13 | 长链（05→Top1→风险→周三）中 top1 指代失效 | referenceTarget 只取本轮 05 真实输出；失效则 Clarification |
| R14 | 新 Planner 模型（Flash/Pro）JSON 输出不稳定 | TurnState schema 断言 + 失败回退（Planner 失败→保守路由→追问） |

## 4. 红线清单（任何阶段不得违反）

- 不 merge PR #49；不正式发布；不部署生产。
- 不猜 WidgetID；不手造 Tencent identity；不以原型当正式 Widget。
- 不改 CampusTools 已验证事实算法；不改 competition-demo-v2 数据。
- 不把模型/密钥/Token/真实身份写入代码、日志、文档、Git 历史。
- 不删 R47.7 思路；不直接全面切 Multi-Agent / Plan-and-Execute 主入口。
- 不为了 UI 改事实数据；不做纯 prompt 工程式修 stale。
- 不把本地静态验证宣称成真机通过。
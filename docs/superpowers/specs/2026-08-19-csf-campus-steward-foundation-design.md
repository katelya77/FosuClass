# CSF — Campus Steward Foundation 设计（2026-08-19）

目标：把小序从「Mission 能力较强，但输出契约、知识层、个人课表入口割裂」收敛为「以课表为核心的高主动校园管家」。保持 4 Agent 架构。用户可见的 Runtime Prompt / Widget / 知识库不含 Rxx、Runtime、competition-demo-vX、测试 Case ID；工程内部文件/测试目录/Git tag 仍可使用版本号。

## P1 Widget Output Contract Stabilization（最高优先级）

基于真实 ADP 应用评测导出的已证实契约问题修复：

| # | 问题 | 方案（单一 SSOT） |
|---|---|---|
| 1 | version 由模型生成研发版本号 | Agent-facing（envelope 11 键）移除 `version`；Widget payload 的 version 由确定性投影层（variant-adapters finishEnvelope / adapter.py / default.json）注入 `"1.0"`；UI 与 Runtime Prompt 不展示 |
| 2 | week-board 无课日冲突 | SSOT = 确定性投影统一过滤空日（view-model buildDays 已有）；Widget schema 保持 week-board days minItems 1 / blocks minItems 1；UI 永不收到空日 week-board |
| 3 | tieGroupCount min=1 与 0 冲突 | envelope + widget schema 改 `minimum:0`（缺省合法）；仅在有并列时设置 |
| 4 | actions 透传 open_widget/broaden_query | 投影边界（variant-adapters / view-model / adapter.py）强制 sys.chat-only（已有）；补 payload 形状统一：R51 mission widget-actions 的 payload 改为 `{query}`（与 action-builder 契约一致）；runtime-e2e fixtures 同步 |
| 5 | 组合 Mission 停在中间能力卡 | view-model 增加 final-outcome 投影：以 Mission 最终完成能力的工具结果为 variant 依据（`projectMissionFinalViewModel`），课表→风险收口在 risk card |
| 6 | 无统一 payload validator | 新增 `widget/native/campus-result-unified-v1/payload-validator.js`：同一 schema 校验所有 Agent final output；fail-closed 输出可读文本 fallback；regression fixtures 固化已证实失败模式 |
| 7 | 导入资产与 guide | 重新生成统一 Widget 导入资产（contract v6），用户可见名称 `小序-校园智序结果卡`（无版本号）；UI 保留 week-board / result-card 双布局；产出 `widget/native/CSF-WIDGET-CONSOLE-UPDATE.md` |

## P2 Runtime Prompt Hygiene

- 标题唯一化：`# 小序 · 主协调` / `# 小序 · 课程空间` / `# 小序 · 风险规划` / `# 小序 · 校园洞察`。
- 删除用户无意义的 R51.1 / Runtime / R504 字样；不写固定教师/日期/测试问法；不把评测 Case 当规则；保持 capability/goal driven。
- 保留：Main=0 CampusTools、动态事实仅来自 CampusTools、Resolve-before-Clarify / Fresh Fact / Completion Awareness / Tool Preflight、无编排自述。
- 新增 prompt hygiene gate（测试）：no Rxx marker / no competition-demo-vX / no test entity/date / no fixed query string routing / no internal widget version。

## P3 Knowledge Base 2.0

`competition/adp-kit/knowledge/current/` 新静态知识 SSOT（10 节）：定位与能力边界 / 课表与校园实体理解 / 教学时间与节次规则 / 动态事实与可信度 / 隐私安全与授权边界 / 无结果歧义与恢复 / 主动协作原则 / 功能导航与自然语言使用 / 个人课表导入与同步 / 常见问题。

约束：无研发版本号；无固定匿名教师/班级数量；无动态数据版本；测试示例不当生产规则；静态知识与 CampusTools 动态事实严格隔离。

配套：knowledge recall matrix（10 节 × 检索键）；stale-knowledge gate（扫描 forbidden 标记）；dynamic-fact leakage gate（静态文档不得断言动态事实）。旧 `knowledge/` 8 文档标记 legacy（`knowledge/legacy/LEGACY.md`），不再作为当前 SSOT。

## P4 个人课表导入 / 同步桥

审计结果（复用现有一切，禁止新凭据系统）：
- 现成能力：miniprogram `pages/personal-sync`（学号导入 SM2/RSA 加密、XLS 导入、班级课表、手动编辑、recent 复用）；服务端 `server/src/routes/fosuApaasImport.js`（public-key/preview/recent/confirm/cancel，x-fosu-session）；manifest 已有 `importStudentSchedule` action + 导航白名单。
- ADP 侧无法直接执行导入 → 实现**安全 bridge**：
  - onboarding 意图识别（导入/同步/绑定/重新同步/更换来源/查看状态，goal-driven 语义族，非 Case 硬编码）；
  - 状态查询：ADP 无小程序本地存储访问 → 诚实返回「需要在小程序端查看」，不伪装已导入；
  - L3 副作用操作：导入/绑定/重新同步/更换来源必须先确认，动作经官方导航 bridge（复用 manifest `importStudentSchedule` 模式），payload 纯语义，绝不携带凭据；
  - 凭据零接触：bridge 模块不接收/不存储/不输出密码/Token/Cookie。

## P5 Authority Model

L0 静态知识/解释=自动；L1 只读校园查询=自动；L2 分析/比较/风险/what-if/候选=自动；L3 导入/绑定/同步/修改/预约/提交=明确确认。Main 对 L1/L2 高主动（可解析就解析、能继续就继续、不无意义确认）；L3 必须确认，不因高权限绕过。实现 `r51/mission/authority.js`（能力→等级表）+ MissionState.authorityLevel + 确认门禁。

## P6 Evaluation Dual Track

正式产品继续 Widget。两套评分：A. Business Correctness（capability 选择/fresh call/最终 goal/resolve·clarify/事实可信）；B. Presentation Correctness（payload valid/variant·layout/sys.chat 合规/无泄漏）。ADP 批量评测端无法渲染 Widget 时用 custom judge（解析序列化 JSON 评分），「Widget 无法展示」不直接决定业务 1 分；保留真实 Console Widget smoke。产出：rubric / judge（`evaluation/dual-track/judge.js`）/ widget contract test set / baseline report。

## P7 Legacy Workflow

R47 时代 workflows：不删除；备份（Git tag `adp-workflows-backup-2026-08-19` 指向当前 HEAD）；引用检查结论：当前 Runtime Prompt 零引用，但 `submission-package/workflows/application-config.json` 仍以 `role-instruction.txt` 为权威源 → 属「仍被引用」，保留 active + 标记 legacy-pending + 回滚证据文档；赛前最终收口再决定删除。

## P8 多模态预留

本轮不实现，预留架构接口：Mission goalSpec 接受 `visionAssets`（图片理解输入）；动态校园事实仍只来自 CampusTools / 个人课表源核验；视觉模型不得覆盖确定性课表事实（gate 测试）。文档 `multimodal/MM-RESERVE.md`。

## 验证顺序

聚焦（CSF 新测试）→ r51/r50/r49 回归 → widget contract → prompt gate → privacy/security → adp-kit 全链 → git diff --check → 提交/推送/PR #49 验证。
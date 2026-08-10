# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-11 02:25 +08:00

## 基础能力已全部冻结

- 01 多维课表查询：真实 ADP 调试通过，冻结。
- 02 空教室规划 V7.2：基础查询、两轮继承、五轮累计槽位全部真实 ADP 通过，冻结。
- 03 课程冲突比较 V5.1：整周比较、自比较去伪冲突、跨校区赶场去重、单教师 self-compare、01→03 跨工作流 handoff 均真实 ADP 通过，冻结。
- 04 今日校园计划 V1.1：核心 5 条 + 边界 5 条真实 ADP 验收全部通过，冻结。

## 应用级路由与上下文已冻结

- 标准模式应用启用 01/02/03/04 四条工作流。
- 模型输入上下文改写已开启。
- 角色指令为 V2.1。
- 02 五轮累计上下文真实通过。
- 03 单教师赶场真实通过。
- 01→03 handoff 真实通过：`教师003第1周周一的课` -> `再和A班比较一下有没有冲突` 正确切换到 03，并保留教师003 + 第1周 + 周一。
- 不再继续修改 01–04 的确定性业务逻辑，除非后续基准评测发现回归。

## ADP 导入包永久规则

1. `Nodes[].NextNodeIDs` 与顶层 `Edge` 必须同时更新；
2. 所有 `REFERENCE_OUTPUT.Reference.NodeID` 必须存在；
3. 被引用节点必须位于消费节点真实上游路径；
4. START 到所有业务节点必须可达；
5. 能只改 workflow JSON 就不改已经通过 ADP 导入的 XLSX；
6. 参数提取输出、Tool 输出 Schema 和 NodeUI output 必须同时注册；
7. 顶层 parameters.xlsx 的 `ParameterParentId` 保持空值；
8. 每次生成 ZIP 都执行 CRC、节点可达性、引用上游性、XLSX/ID 不变量校验。

---

# 当前阶段：Widget 产品化

## 已确认设计

采用 C 方案：

- 4 主 Widget：Schedule / Classroom / Conflict / Day Plan；
- 2 辅助 Widget：Choice / Error；
- 统一视觉：`校园任务单 / 时间票据`；
- 比赛主故事线：一个学生的一天校园任务闭环；
- 不复制 CampusTools 业务逻辑；
- 通过独立 Widget Adapter 消费 verified envelope；
- 原生 ADP Widget 与 H5 fallback 共用 `campus-widget/v2` ViewModel。

正式设计：

`docs/superpowers/specs/2026-08-11-competition-widget-productization-design.md`

实施计划：

`docs/superpowers/plans/2026-08-11-competition-widget-productization.md`

## 已完成代码/合同

已在 PR #49 分支加入：

- `widget/adapter.js`
  - `adaptScheduleResult`
  - `adaptClassroomResult`
  - `adaptConflictResult`
  - `adaptDayPlanResult`
  - `adaptErrorResult`
  - `adaptChoiceResult`
  - 动态成功结果强制 `competition-demo-v1 + evidence.verified=true`
  - Action 最多 3 个，优先 `sys.chat`，不携带 token/NodeID/VarBizID/系统 Prompt
- `widget/test-widget-adapter.js`
  - 六卡合同
  - self-compare 标题/赶场计数
  - Classroom filters
  - Choice waitForUser
  - 未核验/错误 dataVersion 拒绝
  - Action 安全门禁
- `widget/widget-schema.json`
  - 已升级为 `campus-widget/v2`
  - 新增 filters / summary / interaction / rushWarnings / Action enum
- `widget/generate-samples.js`
  - 真实 CampusTools envelope 统一经过 Adapter 生成六类样例
  - 不再手工拼动态课表/教室事实
- `widget/widget.js`
  - H5 fallback 已改为 4+2 产品化渲染
  - Schedule 节次时间轴
  - Classroom filters + 容量票据 + 空结果恢复
  - Conflict 红色冲突 / 橙色赶场分区
  - Day Plan 时间轴
  - Choice 候选动作
  - Error 任务恢复
  - 事件只回传安全 Action，不回传完整工具 envelope
- `widget/styles.css`
  - 暖纸张 + 墨绿任务票据视觉
  - 移动端 320–430px 优先
  - filter chips / risk band / timeline / trust strip / action row
- `widget/index.html`
  - 六类卡片预览壳
- `widget/README.md`
  - Adapter / ADP 原生 / H5 fallback 双路径说明
- `widget/adp-widget-mapping.md`
  - 六张原生 Widget 的字段、组件、Action、等待模式、工作流接入点
- `widget/adp-widget-seed-requirements.md`
  - 若平台私有格式不可公开生成，只要求一次最小 seed，后续 Agent 自动生成 4+2 模板
- `validate-kit.js`
  - 已加入 v2 Schema、六卡、verified、Action 类型/安全验证
- `package.json`
  - `widget/test-widget-adapter.js` 已进入 competition/adp-kit test gate

## GitHub Actions 状态：外部 Billing 阻塞，不是代码测试失败

新增轻量门禁：

`.github/workflows/competition-adp-widget-ci.yml`

应执行：

1. Widget Adapter contract；
2. deterministic sample generation；
3. ADP kit contract validation；
4. generated sample drift check。

但首次运行没有拿到 runner，Job `steps=[]`、`runner_id=0`。GitHub Check annotation 明确返回：

> The job was not started because recent account payments have failed or your spending limit needs to be increased.

同一 head 上原有 Admin CI / Xiaofu Agent CI 也被相同 Billing/Spending Limit 原因阻止启动。因此当前不能把 GitHub Actions 红灯解释为代码失败，也不能写成 PASS。

状态：`GITHUB_ACTIONS_BILLING_BLOCKED`

## 当前必须完成的本地验证

由于 GitHub Actions 无法获得 runner，需要在用户本机由 Kimi Code / Codex 执行：

```bash
node competition/adp-kit/widget/test-widget-adapter.js
node competition/adp-kit/widget/generate-samples.js
node competition/adp-kit/validate-kit.js
node competition/adp-kit/sync-assets-manifest.js
npm test --prefix competition/adp-kit
```

若全部 PASS：

1. 只提交真实生成变化（预计包括 `sample-results.json/js`、资产清单以及 build/submission 生成物中受影响项）；
2. `git diff --check`；
3. push `feat/campusflow-adp-integration`；
4. 更新本检查点为 `WIDGET_V2_LOCAL_GATE_PASS`。

不得为了通过生成物检查手工编辑 sample-results 或 manifest。

## ADP 原生 Widget 状态

当前：`ADP_WIDGET_SEED_PENDING`

原因：尚未获得腾讯云 ADP 原生 Widget 的真实 seed/导出结构，不能猜测平台私有序列化格式。

下一步仅需一次：

1. 在 ADP 创建 `00-Widget格式种子-勿用于正式展示`；
2. 覆盖 Text / Container / List-Repeater / Button + `sys.chat` / 一个输入绑定 / 条件显示（若支持）；
3. 导出原始 seed；
4. Agent 解析真实格式并自动生成 4 主 + 2 辅正式 Widget；
5. 原始 seed 只读保留，不要求人工搭六遍。

如果当前 ADP Widget 没有导出能力，则按 `adp-widget-mapping.md` 进行浏览器自动化或模板复制，不伪造 `.widget` 文件。

## Widget 原生验收目标

1. `教师003第1周周一的课` → Schedule 卡；Action 可进入冲突比较。
2. `校区A 2026-09-03 下午有哪些空教室` → Classroom 卡；filters 可见；Action 可换校区。
3. `教师003第1周周一跨校区来得及吗` → self-compare 风险卡；0 伪冲突 + 1 条赶场。
4. `帮我看看2026-09-04的安排` → Day Plan 时间轴卡。
5. 歧义实体 → Choice 卡等待用户选择并继续原任务。
6. 非法条件/工具失败 → Error 卡，提供恢复动作且不补造事实。

以上真实 ADP 测试通过之前，不得写 `ADP_WIDGET_NATIVE_PASS`。

---

## Widget 后续路线

Widget 原生通过后立即进入：

1. 32 组标准 QA 导入与知识来源展示精修；
2. 80 条 ADP 原生基准评测；
3. V2.1 与候选角色指令的多提示词 A/B；
4. 应用级匿名/提示注入/越权红队；
5. 多模态输入（图片只提取查询条件，动态事实仍由 CampusTools 核验）；
6. Test Release；
7. 5 分钟获奖型演示脚本、演示数据和最终提交资产。

PR #49 保持 open、未 merge、未正式发布。

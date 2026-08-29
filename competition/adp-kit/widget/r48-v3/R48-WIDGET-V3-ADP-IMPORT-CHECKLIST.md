# R48 Widget V3 — ADP 导入操作清单（人工执行）

> 执行人：用户（需在 ADP 平台手工创建 / 导入）。
> 前置：先完成 R47.6 基线（`00-小序会话总控-R47.6-Deterministic-State-Handoff`）且通过测试；
>       不得修改 00 拓扑；PR #49 保持未合并；不发布任何 Widget。
> 原则：真实 WidgetID 以 ADP 平台导出为准（`FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY`），本地不猜 ID。

## 0. 材料位置

| 材料 | 路径 |
|---|---|
| 模板 | `competition/adp-kit/widget/r48-v3/<widget>/template.txt` |
| Schema（默认数据预览用） | `competition/adp-kit/widget/r48-v3/<widget>/schema.json` |
| 默认数据 | `competition/adp-kit/widget/r48-v3/<widget>/default.json` |
| 样例（测试数据） | `competition/adp-kit/widget/r48-v3/samples/<name>.json` |
| 本地预览（审美复核） | `competition/adp-kit/widget/r48-v3/preview/index.html` |

## 1. 创建顺序（按依赖，先独立后复合）

1. **Schedule**（`schedule/`）— 课表票据，其余卡片测试的主入口
2. **Classroom**（`classroom/`）— 空教室，独立于 Schedule
3. **Conflict**（`conflict/`）— 冲突/赶场，依赖 Schedule 数据语义
4. **DayPlan**（`day-plan/`）— 一天安排时间轴
5. **CampusOverview**（`campus-overview/`）— 校园教学态势（05 工具输出）
6. **Choice**（`choice/`）— 通用候选确认卡（失败态）
7. **Recovery**（`recovery/`）— 任务恢复卡（失败态，含 OUT_OF_RANGE 等）

## 2. 每个 Widget 的创建步骤

对每个 Widget（以 Schedule 为例，其余相同）：

1. **新建 Widget**：ADP 平台 → Widget 列表 → 新建，命名 `R48 Schedule V3`（其余对应 `R48 Classroom V3` 等）。
2. **粘贴模板**：打开模板编辑器 → 清空 → 粘贴 `schedule/template.txt` 全文 → 保存。
3. **设置默认数据预览**：
   - 进入「默认数据 / 预览」区域 → 粘贴 `schedule/default.json` 全文。
   - 预览区应渲染出：标题「教师003」、状态「已核验」、2 节课程、3 个动作按钮。
   - 若平台要求 Schema：粘贴 `schedule/schema.json`。
4. **保存并生成预览**：确认无模板语法报错；若报错，截图错误信息回传（不自行改写模板）。
5. **绑定 sys.chat 行为**：确认 `onClickAction` 按 `{type:'sys.chat',payload:{query:...}}` 解析；
   若平台用不同字段名，把平台文档截图回传，不猜测。
6. **记录真实 WidgetID**：创建成功后 WidgetID 以平台导出为准，回传登记。

## 3. 测试语句（每个 Widget 导入后验证）

| Widget | 测试语句 |
|---|---|
| Schedule（day） | `查询教师003第1周的课表` → 期待「周三 · 已核验 · 2 节」 |
| Schedule（week） | `查询教师009第1周的课表` → 期待周粒度 7 天条带 |
| Schedule（date） | `查看A1-101在2026-09-03的课表` → 期待 3 节 |
| Classroom | `查询2026-09-03第7-8节校区A容量至少60人的空教室` → 期待 4 间 |
| Classroom（empty） | `查询实验楼B1容量至少120人的空教室` → 期待「暂无匹配」+ 放宽容量按钮 |
| Conflict（compare） | `比较教师003和教师009第1周周五的课表` → 期待冲突/赶场各 1 起 |
| Conflict（self） | `检查教师009第1周周一的课程风险` → 期待赶场 1 起 |
| Conflict（safe） | `检查教师003第1周周二的课程风险` → 期待「未发现风险」 |
| DayPlan | `安排2026-09-04的一天` → 期待时间轴（课程/空档/提醒） |
| CampusOverview | `看一下未来四周校园教学态势` → 期待趋势/压力/Top1/风险 |
| Choice | `查询教师003的课表`（故意用歧义名触发候选）→ 期待候选确认卡 + 重新描述 |
| Recovery | 查询超学期范围的日期 → 期待「任务恢复」卡 + 查看学期范围按钮 |

## 4. 导出与回传

1. 全部 Widget 创建并验证通过后，在 ADP 平台导出 `.widget`（或平台允许的等价包）。
2. **回传 ChatGPT 的导出文件清单**（要求 ChatGPT 填写后逐项核对）：
   - 导出文件路径 / 文件名
   - 每个 Widget 的真实 WidgetID（与 §2.6 登记一致）
   - 每个 Widget 的 Template 是否有平台自动改写（diff 说明）
   - 每个 Widget 的 Schema/Default 是否被平台规范化
   - 预览截图（每个 Widget 一张）
3. 等待 ChatGPT 将导出信息登记回 `native/widget-registry.json` 与 r48-v3 文档后，
   才允许后续「正式包生成 / 工作流绑定」步骤。

## 5. 红线（违反即回滚）

- 禁止把本地猜测的 WidgetID 写入正式模板。
- 禁止修改 00 工作流拓扑或任何现有工作流文件。
- 禁止使用账号密码 / Cookie 方式登录 ADP；只能使用平台官方渠道导出。
- 导出物中如出现学生真实学号、教师真实姓名、个人课表原文，立即停止并回传删除。
- 不发布（publish）任何 Widget；全部保持草稿 / 私有状态。
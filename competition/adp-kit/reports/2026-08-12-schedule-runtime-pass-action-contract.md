# Schedule Widget Runtime PASS + Action Contract 下一 Gate

更新时间：2026-08-12 03:33 +08:00

## 实机结论

用户按方案 A：

1. 保留 Schedule WidgetID `23fbc659efe3482fab588d754e4420a4`；
2. 在现有 Widget 中保存 RuntimeSafe V3 21 字段 Zod Schema；
3. 导入 `01-多维课表查询-WidgetStable-可直接导入.zip`；
4. 输入 `教师003第1周周一的课`。

真实 ADP Runtime 截图确认：

- 01 工作流主链运行成功；
- `Widget数据适配-Schedule` 成功；
- `Widget展示判断` 成功；
- `小序-课表票据-WidgetStable` 成功，耗时截图约 0.036s；
- 原生 Schedule Widget 动态渲染成功：教师003、第1周周一、2 条课程、第5-6节/第7-8节、校区A/校区B；
- Widget 后继续到结束节点成功；
- 原先 `460101 / convert widget view failed / __jsx in undefined` 不再出现。

因此正式标记：

`ADP_WIDGET_SCHEDULE_RUNTIME_PASS`

同时证明方案 A 的 21 字段 ContractSync 已消除旧 V2 outer schema / WorkflowWidgetInputs 与 RuntimeSafe V3 encodedWidget 的合同分裂。

## 新上传 Widget 独立审计

文件：`小序-课表票据-V2(3).widget`

SHA256：`9d5635a773ab056c3699b88f1379b67bd886280b06a25c0c2ee736230f2a67c3`

真实解析：

- WidgetID 仍为 `23fbc659efe3482fab588d754e4420a4`；
- outer `jsonSchema` 已同步为 RuntimeSafe V3 21 字段；
- encodedWidget Zod Schema 同为 21 字段；
- encodedWidget Default 同为 21 字段；
- `shownCount = z.number().int()`；
- 3 个按钮均为 `sys.chat`，payload 使用对应 `actionNMessage`；
- outer `template` 仍为空字符串，但本轮 Runtime 实机 PASS，因此在当前赛事空间该状态不阻止 encodedWidget.view 正常运行。

## 点击 Action 后的新问题

用户随后对 Schedule Widget 执行交互，ADP 显示“已进行操作”，并产生新的对话结果，说明 `sys.chat` Action 已真实触发并进入智能体后续路由。

后续 01 查询返回：

- `INVALID_PARAM`
- `weekday 需为 1-7`
- 日期解析：`不支持的 dateText；请使用受控相对日期或 YYYY-MM-DD`

该错误来自新的业务查询轮次，不是 Widget Runtime 失败。

当前 RuntimeSafe V3 Adapter 的 Action 文本存在语义合同风险：

- `查看整周` → `查看教师003第1周整周课表`
- `换一天` → `换一天看看教师003的课表`
- `检查风险` → `检查教师003第1周周一是否存在时间冲突或跨校区赶场`

其中 `换一天看看...` 不是 01 参数提取器 / CampusTools `dateText` 的受控日期表达；若被提取为 `date_text=换一天`，`get_academic_context` 会确定性拒绝。

CampusTools 当前受控 `dateText` 仅接受：今天/明天/后天、本周X/这周X/下周X、第N周周X、YYYY-MM-DD。`query_schedule` 的 `weekday` 必须为 1-7 或为空。

## 当前根因层级

```text
Schedule Widget Runtime                   ✅ PASS
Widget 21字段 ContractSync                ✅ PASS
sys.chat 前端触发                         ✅ PASS
sys.chat → Agent 新一轮输入               ✅ PASS
Action 自然语言 → 01 参数合同             ❌ 待收口
```

因此从现在开始，禁止再把 Schedule Widget Schema/Template/Runtime 作为主要调试对象。

## 下一 Gate：Action Contract V1

目标：UI label 可以自然，但 `sys.chat payload.query` 必须是能被现有冻结路由/参数提取器稳定解析的 canonical utterance。

建议 Schedule 教师场景：

- 查看整周：`查询教师003第1周的课表`
- 下一天：若当前为第1周周一，则确定性生成 `查询教师003第1周周二的课`
- 检查风险：`检查教师003第1周周一是否存在时间冲突或跨校区赶场`

设计原则：

1. 不把 `换一天`、`当前范围`、`再看看` 等模糊词直接作为机器执行 payload；
2. Adapter 根据 verified query 的 `week/weekday/date/entity` 确定性生成下一动作；
3. UI label 与执行 payload 分离；
4. 每个 action payload 必须在本地 Action Contract tests 中先通过路由/参数提取预期；
5. 不改 CampusTools 事实逻辑；
6. 不要求用户在 ADP 手工测试每个微小动作，先由 Codex/Kimi 批量生成与测试，再一次性导入验收。

## 研发效率模式

后续固定：

`用户批量导出 ADP 真实资源 → 本地 Contract Compiler 审计/生成 → 自动 Gate → 用户一次导入 → 少量端到端 Runtime`

下一阶段应将 Schedule/Classroom/Conflict/DayPlan/Choice/Error 的：

- canonical Schema
- Adapter view model
- WidgetParam
- Action payload
- NodeUI inputs
- Workflow ZIP

统一由单一合同源生成，减少手工漂移。

## 下一阶段顺序

1. Action Contract V1：先收口 Schedule 三个按钮并验证 `sys.chat → 01/03`。
2. 把该 Action Contract / Contract Compiler 模式批量迁移到 02/03/04 + Choice/Error。
3. 六卡 Runtime 收口后立即转 32 QA → 80 条 ADP 原生评测 → Prompt A/B → 安全红队 → 多模态 → Test Release → 5 分钟比赛演示。

不要继续无限优化 Widget Runtime；Schedule Runtime Gate 已完成。

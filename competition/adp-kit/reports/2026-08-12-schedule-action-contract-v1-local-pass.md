# Schedule Action Contract V1 — 本地实现与制品 Gate

更新时间：2026-08-12 14:41 +08:00

## 状态

正式标记：

```text
ADP_WIDGET_SCHEDULE_RUNTIME_PASS
ADP_WIDGET_SCHEDULE_SYS_CHAT_TRIGGER_PASS
ADP_WIDGET_ACTION_CONTRACT_LOCAL_PASS
```

腾讯 ADP 尚未导入/验收 Actions V1，因此不得标记：

```text
ADP_WIDGET_SCHEDULE_ACTION_E2E_PASS
```

PR #49 继续保持 open / unmerged；未发布正式应用。

## 根因

Schedule Widget Runtime 与 `sys.chat` 触发链已经通过，失败点在点击后进入下一轮 Agent 的文本合同：旧 Adapter 把自然 UI 文案直接当作机器 payload，例如：

- `换一天看看教师003的课表`
- `当前查询范围`
- `帮我找A1-101的空闲时段`
- `继续选择另一个对象比较当前查询范围的课程冲突`

这些文本分别缺少确定的日期、02 必需的校区/节次，或 03 必需的第二对象，导致参数提取器需要猜测，而 CampusTools 会对不确定参数 fail closed。

根因不是 Widget Schema、Template、WidgetID、`sys.chat` 或 01 CampusTools Runtime；根因是 **UI label 与机器执行 payload 未分层，且 Adapter 为缺参的 02/03 能力生成了按钮**。

## 冻结工具合同审计

### get_academic_context

`dateText` 受控输入：

- `YYYY-MM-DD`；
- `今天/今日/明天/明日/后天`；
- `本周X/这周X/下周X`，X 为一至日/天或 1–7；
- `第N周周X`、`第N周星期X` 等同一受控形式。

`换一天/再看看/当前范围/换个时间` 不在白名单中。

### query_schedule（01）

- `entityType`：`class/teacher/room/course`；
- `week`：1–20；
- `weekday`：1–7 或省略（整周）；
- 也可使用受控 `date`；
- 单实体明确周/星期查询是当前四类实体共同支持的安全回流能力。

### find_available_classrooms（02）

必须具备校区、明确日期/星期、开始节次，以及结束节次或连续节数。Schedule 卡的 `resolvedEntity + query` 并不总能提供这些条件，因此 Action V1 不从 Schedule 卡生成缺参的 02 按钮。

### compare_schedules（03）

一般比较需要两个明确实体和明确时间范围；冻结合同另支持教师自身 self-compare，用于时间冲突/跨校区赶场。因此 Action V1 只在 `teacher + week + weekday` 时生成风险按钮；room/class/course 不凭空补第二对象。

## 单一真源

旧 `schedule-runtime-adapter.py` 是 nested/模糊 Action 漂移副本。现在：

- Canonical Adapter：`competition/adp-kit/widget/native/schedule-runtime-safe-v3-adapter.py`
- 兼容入口：`schedule-runtime-adapter.py` 只加载 canonical 文件，不再维护第二份 `main`；
- Action Contract：`action-contract.json`；
- Workflow generator：`generate-schedule-actions-v1-workflow.py`；
- Artifact gate：`gate-schedule-actions-v1-workflow.py`；
- Contract tests：`test-action-contract.js`。

生成器只接受 SHA256 为 `4f78b5c029b87c25e0ff9b676d7230bf2e9c8d1858d421fe8cfcd90179db2f66` 的真实 Runtime PASS `WidgetStable` ZIP，并从 canonical Adapter 注入 CodeExecutor。

## Action Contract V1

### teacher + day

`教师003 / week=1 / weekday=1`：

| UI label | `sys.chat payload.query` | 路由合同 |
|---|---|---|
| 查看整周 | `查询教师003第1周的课表` | 01，week=1，weekday 省略 |
| 看周二 | `查询教师003第1周周二的课` | 01，week=1，weekday=2 |
| 检查风险 | `检查教师003第1周周一是否存在时间冲突或跨校区赶场` | 03，teacher self-compare，week=1，weekday=1 |

### week scope

weekday 为空时不生成“换一天”。三个按钮固定选择明确的周一/周三/周五，payload 均为：

`查询{entity}第N周周X的课`

### weekday rollover

- 周一至周六：同周下一日；
- 周日且 `week < 20`：下一周周一，label 为 `看下周一`，payload 含明确的新周数；
- 第 20 周周日：不越学期，固定回退第 20 周周六，label 为 `看周六`。

### room / class / course

只生成当前 01 真正支持的整周/明确星期课表查询。不会生成缺校区/节次的 02，也不会生成缺第二实体的 03。

## 生成制品

- WorkflowID：`f3961270-90a0-46d3-b86f-75a88a0c2ba8`
- WorkflowName：`01-多维课表查询-WidgetStable-ActionsV1`
- ZIP：`output/competition-adp/01-多维课表查询-WidgetStable-ActionsV1-可直接导入.zip`
- SHA256：`ce5448911f20b562516cf0e03959078b51e43f83dafd0da623bc734caa90fb24`

## 本地 Gate

制品生成时静态 Gate 29/29 PASS：

- baseline SHA256 / ZIP CRC / 六文件根合同；
- Workflow 新 ID / 名称 / JSON 文件名；
- workflow reachability；
- Edge endpoint、NextNodeIDs / Edge；
- Reference NodeID；
- canonical Adapter 注入；
- Adapter Outputs 22/22（route + 21 Widget 字段）；
- WidgetParam 21/21；
- `shownCount=INT`；
- WidgetID `23fbc659efe3482fab588d754e4420a4`；
- ActionType `WIDGET_ACTION_NONE`；
- frozen graph / Edge / NextNodeIDs 不变；
- XLSX WorkflowID 同步；
- Action Contract tests。

Action tests 覆盖 teacher day/week、weekday rollover、semester end、room/class/course，以及 13 个未核验/空结果/无效结构/无效实体/越学期 guard，并锁定教师003回归三条 payload。

最终本地结果：

- `npm test --prefix competition/adp-kit`：PASS；
- CampusTools MCP：34/34 PASS；
- Golden：33/33 PASS；
- Action Contract：7 cases + 13 guards PASS；
- `npm run test:agent-foundation`：42/42 PASS；
- `npm run test:agent-regression`：197/197 PASS；其中 PostgreSQL backend 因本机 Docker daemon 不可达标记 UNVERIFIED，file backend PASS；
- `npm run test:ai-competition`：PASS；
- `npm run test:agent-final-convergence`：PASS，含 120 cases；
- `git diff --check`：PASS。

AI Competition 首轮安全扫描发现 `.tmp/adp-v4-deploy` 下两个被忽略的历史临时快照含明文凭据；已精确删除这两个临时文件，重跑安全扫描 PASS。未修改或削弱扫描规则。

GitHub Actions 因 included minutes 耗尽未运行；以上均为本机 Gate。

## 腾讯 ADP 最小验收

1. 导入 Actions V1 ZIP；新 WorkflowID 不覆盖已 PASS 的 WidgetStable baseline。
2. 不修改 WidgetID、Schema、Template、CampusTools 或冻结 01/03；不发布正式应用。
3. 在草稿/调试会话输入 `教师003第1周周一的课`，确认三个 label 为 `查看整周 / 看周二 / 检查风险`。
4. 分别点击并核对下一轮：整周与周二进入 01；风险进入 03 self-compare，且实体/周/星期均未丢失。

只有第 4 步全部真实通过后，才标记 `ADP_WIDGET_SCHEDULE_ACTION_E2E_PASS`。

# R48 Widget V3 — 交接说明（HANDOFF）

> 面向：后续接手的开发 Agent（Codex / Kimi / ChatGPT）与人工维护者。
> 范围：`competition/adp-kit/widget/r48-v3/` 全部资产。
> 基线：R47.6 工作流拓扑（`00-小序会话总控-R47.6-Deterministic-State-Handoff`），本目录不改变任何运行拓扑。

## 1. 本目录是什么

7 个 Canonical Widget（Schedule / Classroom / Conflict / DayPlan / CampusOverview / Choice / Recovery）的
「Template + Schema + Default + Contract + Adapter + Samples + 本地预览 + 测试」完整产品化资产。

每个 Widget 一个子目录，四件套齐备：

| 文件 | 用途 |
|---|---|
| `template.txt` | ADP 原生模板（XML 风格标签，见 §5） |
| `schema.json` | 该 Widget 卡片展示字段的 JSON Schema（draft 2020-12 子集） |
| `default.json` | ADP 导入时「默认数据预览」用静态样例 |
| `contract.json` | 轻量设计期契约（`fosuclass-adp-widget-contract/r48-v3`），`fields: string[]` 列出展示字段 |

顶层文件：

| 文件 | 用途 |
|---|---|
| `viewmodel-schema.json` | 统一 ViewModel 契约（`campus-widget/v3`），Adapter 输出必须满足 |
| `adapter.js` | Canonical ViewModel Adapter（Node 与浏览器双端，挂 `window.R48Adapter`） |
| `design-tokens.json` / `.css` | 设计令牌（只用于本地预览审美复核，不进入 ADP 模板） |
| `samples/` | 13 个真实样例（`generate-samples.js` 从 `envelopes.json` 生成，禁止手改） |
| `preview/index.html` | 零外部依赖本地视觉预览 |
| `tests/` | 零依赖测试（Node 内置 assert），`node tests/run-all.js` |
| `docs/screenshots/` | 桌面 / 390px 移动预览截图（审美复核留档） |

## 2. 事实源与不变量

- 课表/教师/教室/空教室/教学周等事实唯一来源 = CampusTools 确定性工具输出（verified envelope）。
- Adapter 只做字段映射、结构裁剪、展示文本与 Action 文案；**不做**日期推理、教学周计算、冲突计算、空教室计算、Top1 选择或身份推断。
- 失败 envelope（`success=false`）→ Choice（候选确认）/ Recovery（任务恢复），绝不展示推测性校园事实。
- `action-contract.json`（`native/`）禁止出现在 sys.chat payload 的片段：`换一天`、`再看看`、`当前范围`、`当前查询范围`、`换个时间`。
- 学生学号、真实教师身份、查询票据、系统提示、Provider 配置不得进入模板、样例、文档或测试。
- 不允许外部 CDN / 字体 / 图标库 / 远程脚本；预览页零网络请求。

## 3. 输入（envelope）形态

Adapter 输入与 `competition/adp-kit/widget/adapter.js` 相同形态的 CampusTools verified envelope：

- `success`：工具成功（`true`）或失败（`false`/缺省）
- `dataVersion`：成功时必须是 `competition-demo-v1`，否则抛错
- `evidence.verified === true`：成功信封必须核验，否则抛错
- `queryId`：透传（用于去重，不进入 Action message）
- `resolvedEntity` / `query` / `items` / `summary` / `compared` / `rushWarnings`：各工具结构（见 `samples/envelopes.json` 的 13 组 fixture）

## 4. 输出（ViewModel）契约

统一 ViewModel 必须满足 `viewmodel-schema.json`（`schemaVersion: campus-widget/v3`）：

- 成功态（schedule/classroom/conflict/day_plan/campus_overview）：`success=true`、`statusText=已核验`、`evidence.verified=true`
- Choice：`success=false`、`statusText=请确认对象`、`interaction.waitForUser=true`、`error.code=AMBIGUOUS_ENTITY`
- Recovery：`success=false`、`statusText=任务恢复`、`interaction.waitForUser=true`、`error.code` ∈ `{ENTITY_NOT_FOUND, AMBIGUOUS_ENTITY, INVALID_PARAM, OUT_OF_RANGE, MISSING_PARAM, TIMEOUT, TOOL_FAILURE}`

各 Widget 展示字段由其 `schema.json` 约束（`additionalProperties: false`，用于 default 校验）。

## 5. ADP 模板语法

XML 风格标签，属性支持 JS 表达式（`{...}` 与 `${...}`）：

- 容器：`<Card>`、`<Col>`、`<Row>`、`<ListView>`、`<ListViewItem>`
- 展示：`<Caption>`、`<Title>`、`<Badge>`、`<Text>`、`<Divider>`
- 交互：`<Button onClickAction="{{type:'sys.chat',payload:{query:'...'}}}">`

```xml
<Card size="md" background="#FFFFFF" status={statusText}>
  <Col gap={3}>
    <Caption value="SCHEDULE · 课表" color="#173F35" />
    <Title value={title} size="md" />
    ...
    <Button label={action.label} onClickAction={{ type: 'sys.chat', payload: { query: action.message } }} />
  </Col>
</Card>
```

## 6. Action 契约（sys.chat）

- `actions` ≤ 3，`type` 恒为 `sys.chat`，`payload.query` 即完整用户语句。
- message 只能引用已确认实体与时间字段；教学周未知时允许自然语言回退（如 `换日期查看A1-101的课表`）。
- 周份已确认的「换一天」使用协议格式：`【小序操作:选择课表日期】教师003|第1周`。
- 复用 canonical 语句（来自 `native/action-contract.json`）：`查询X第N周的课表`、`检查X第N周周X是否存在时间冲突或跨校区赶场` 等。

## 7. 本地交互与验证

```bash
# 重新生成样例（改 fixture/adapter 后必须执行）
cd competition/adp-kit/widget/r48-v3/samples && node generate-samples.js

# 全部测试（schema 校验 / adapter 单测 / action 契约 / 模板语法 / 无外部依赖）
cd competition/adp-kit/widget/r48-v3 && node tests/run-all.js

# 本地预览（浏览器直接打开，或任意静态服务器）
#   competition/adp-kit/widget/r48-v3/preview/index.html
```

## 8. 真实 WidgetID 现状（重要）

`native/widget-registry.json` 中已存在真实 WidgetID，但**当前不得写入 r48-v3 模板**：

| Widget | 真实 WidgetID |
|---|---|
| Schedule | `23fbc659efe3482fab588d754e4420a4` |
| Classroom | `9eb1ec5e1deb416ab5aba320359439a5` |
| Conflict | `8d576e5af9b04fdd99804e7fcbff3644` |
| DayPlan | `f4ff76029d8142caa86fb9baac5314bf` |
| Choice | `f540588933a4459cbe78a6fe99aa022c` |
| Error（Recovery fallback） | `3161078fd4d54a27bae65f38cd44c537` |

原则：`FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY` —— 只有从 ADP 平台真实导出 `.widget` 后才能确认/回填 ID，
任何本地猜测的 ID 一律禁止进入正式包。`r48-v3` 全部资产均为「导入前」状态。

## 9. 需人工在 ADP 平台完成的操作

见 `R48-WIDGET-V3-ADP-IMPORT-CHECKLIST.md`（创建顺序、粘贴内容、测试语句、导出清单、回传 ChatGPT 的清单）。
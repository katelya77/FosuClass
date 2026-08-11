# 校园智序 · 小序 — 当前 ADP 研发检查点

更新时间：2026-08-11 14:10 +08:00

当前状态：

- `CORE_WORKFLOWS_FROZEN`
- `APP_ROUTING_CONTEXT_FROZEN`
- `WIDGET_V2_LOCAL_GATE_PASS`
- `ADP_WIDGET_REAL_EXPORT_FORMAT_CAPTURED`
- `ADP_WIDGET_4PLUS2_IMPORT_BUNDLE_READY`
- `ADP_WIDGET_NATIVE_IMPORT_PENDING`
- `GITHUB_ACTIONS_BILLING_BLOCKED`

PR #49：保持 open、未 merge、未正式发布。

---

## 1. 基础能力已全部冻结

- 01 多维课表查询：真实 ADP 调试通过，冻结。
- 02 空教室规划 V7.2：基础查询、两轮继承、五轮累计槽位真实 ADP 通过，冻结。
- 03 课程冲突比较 V5.1：整周、自比较去伪冲突、赶场去重、单教师 self-compare、01→03 handoff 均真实 ADP 通过，冻结。
- 04 今日校园计划 V1.1：核心 5 条 + 边界 5 条真实 ADP 通过，冻结。

应用级：标准模式；01/02/03/04 启用；模型输入上下文改写开启；角色指令 V2.1；02 五轮累计上下文、03 单教师赶场和 01→03 handoff 均真实通过。

除非后续基准评测发现回归，不再修改 01–04 的确定性业务逻辑。

---

## 2. Widget V2 代码层：本机 Gate 已通过

采用 C 方案：Schedule / Classroom / Conflict / Day Plan / Choice / Error。

统一视觉：`校园任务单 / 时间票据`。

核心链路：

`CampusTools verified envelope → widget/adapter.js → campus-widget/v2 ViewModel → ADP 原生 Widget / H5 fallback`

Kimi Code 已在 Windows 本机真实验证：

- Adapter tests：PASS；
- 六类 sample generation：PASS；
- `validate-kit.js`：PASS；
- Playwright 390×844 / 430×932 / 768×1024 × 六卡：PASS，无横向溢出；
- assets manifest：78 files 一致；
- `npm test --prefix competition/adp-kit`：PASS；
- Golden：33/33；
- submission scan：findings=0 / credentialCandidates=0；
- `git diff --check`：PASS。

提交：`c2f9b27d`、`4ac9e611`。

状态：`WIDGET_V2_LOCAL_GATE_PASS`。

---

## 3. ADP 原生 Widget：已获得真实导出格式

用户在腾讯云智能 ADP 中通过“代码创建”建立并导出了：

`小序-课表票据-Pilot.widget`

该文件已实际解析，不再需要猜测 `.widget` 私有封装。

### 真实外层结构

- `version`
- `name`
- `template`
- `jsonSchema`
- `outputJsonPreview`
- `encodedWidget`

### `encodedWidget` Base64 解码后的真实结构

- `name`
- `id`
- `view`
- `defaultState`
- `states`
- `schema`
- `schemaValidity`
- `viewValidity`
- `defaultStateValidity`

用户真实 seed SHA256：

`addc40092b8378a5a86025debe3d1226245d88a942f22858e2eee3adca383348`

seed 内部标记：

- `schemaValidity = valid`
- `viewValidity = valid`
- `defaultStateValidity = valid`

因此原 `ADP_WIDGET_SEED_PENDING` 与“必须先猜代码创建格式”的前置条件均已关闭。

状态：`ADP_WIDGET_REAL_EXPORT_FORMAT_CAPTURED`。

---

## 4. 已自动生成 4+2 原生 `.widget` 一键导入包

基于真实导出 seed 同结构生成：

1. `小序-课表票据.widget`
2. `小序-空教室票据.widget`
3. `小序-冲突赶场票据.widget`
4. `小序-今日校园计划.widget`
5. `小序-候选确认.widget`
6. `小序-任务恢复.widget`

统一设计：暖纸张 + 墨绿可信状态；蓝色信息；黄色赶场/确认；红色冲突/恢复。

交互均采用官方 `sys.chat`，不携带 token、NodeID、VarBizID 或系统 Prompt。

静态生成 Gate：

- JSON Schema：6/6 valid；
- Default 对 Schema：6/6 PASS；
- `encodedWidget` Base64 round-trip：6/6 PASS；
- 每张生成独立 Widget ID；
- 格式来源为用户真实 ADP `.widget` 导出，而非推测。

Bundle SHA256：

`08c3efec681501f93d5a01a100d01b6abd330de73b0c0d0f1d193f1e1e2f5fe7`

GitHub 证据：

`competition/adp-kit/widget/native/native-widget-import-bundle-manifest.json`

状态：`ADP_WIDGET_4PLUS2_IMPORT_BUNDLE_READY`。

### 当前 Gate

现在只缺腾讯云 ADP 实机导入/预览：

`ADP_WIDGET_NATIVE_IMPORT_PENDING`

建议先导入 Schedule；若预览无编译错误，再连续导入另外 5 张。

Choice 后续接工作流时使用“等待用户操作”；其他结果展示卡优先“直接向后流转”。

六张全部真实导入并预览通过后，才允许标记：

`ADP_WIDGET_NATIVE_TEMPLATE_PASS`

工作流真实调用 + Action 链路通过后，才允许：

`ADP_WIDGET_NATIVE_PASS`

---

## 5. ADP 工作流导入包永久规则

1. `Nodes[].NextNodeIDs` 与顶层 `Edge` 必须同时更新；
2. `REFERENCE_OUTPUT.Reference.NodeID` 必须存在；
3. 被引用节点必须位于消费节点真实上游路径；
4. START 到所有业务节点必须可达；
5. 能只改 workflow JSON 就不改已经通过 ADP 导入的 XLSX；
6. 参数提取输出、Tool 输出 Schema、NodeUI output 必须同时注册；
7. 顶层 `parameters.xlsx` 的 `ParameterParentId` 保持空值；
8. 每次生成 ZIP 执行 CRC、节点可达性、引用上游性、XLSX/ID 不变量校验。

---

## 6. GitHub Actions 状态

轻量 Widget CI 与原有 CI 均未获得 runner：`steps=[]`、`runner_id=0`。

GitHub annotation 为账户 Billing / Spending Limit 阻塞，并非代码测试失败。

状态：`GITHUB_ACTIONS_BILLING_BLOCKED`。

不得将红灯解释为代码失败，也不得为此修改业务代码。

---

## 7. 下一研发顺序

### Gate A — 原生 Widget 模板实机导入

1. 导入 Schedule；
2. 导入 Classroom；
3. 导入 Conflict；
4. 导入 Day Plan；
5. 导入 Choice；
6. 导入 Error；
7. 每张记录 Preview / Template 编译结果。

### Gate B — 接工作流测试副本

优先复制 01 为：

`01-多维课表查询-WidgetPilot`

只增加薄层：

`结果核验与呈现 → Widget数据适配 → Widget → 原回复/结束`

Schedule 真查询和至少一个 `sys.chat` Action 通过后，再扩到 02 / 03 / 04。

### Gate C — 正式切换展示末端

六卡真实 ADP 验收通过后，才将正式 01–04 展示末端切到 Widget；CampusTools、日期解析、实体解析、冲突和空教室算法保持冻结。

### Widget 之后

1. 32 组标准 QA 导入 + 来源展示精修；
2. 80 条 ADP 原生基准评测；
3. 角色指令多提示词 A/B；
4. 匿名 / 提示注入 / 越权红队；
5. 多模态输入（图片只提取查询条件，动态事实仍由 CampusTools 核验）；
6. Test Release；
7. 5 分钟获奖型演示脚本、演示数据和最终提交资产。

PR #49 继续保持 open、未 merge、未正式发布。

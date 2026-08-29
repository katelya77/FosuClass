# R50.2B 单会话批次切换包（console-bundle）

本包让用户在**一个 ADP 控制台会话**内完成 R50.2B 切换：4 个 Prompt + 1 个统一 Widget
`campus-result-unified-v1`，无需重新导入 13 个自定义插件绑定。

## 目录

- `prompts/` —— 4 份基线 Prompt（与 `r50.2/prompts/*.final.md` 字节一致）
  - `main-orchestrator.final.md`（Main，text 输出）
  - `schedule-space.final.md`（Schedule → Widget）
  - `risk-planning.final.md`（Risk → Widget）
  - `campus-insight.final.md`（Insight → Widget）
- `widget/` —— 统一输出 Widget 资产（R50.4 双布局）
  - `contract.json` / `schema.json` / `default.json` / `template.txt` / `adapter.py`
    （campus-result-unified-v1，layoutMode=week-board / result-card）
  - `view-model.js`（服务端确定性投影 CampusResultEnvelope → WidgetViewModel，参考）
  - `campus-result-envelope.schema.json`（服务端 Envelope 规范，参考）
  - `tool-variant-map.json`（13 Agent 工具 → variant 映射，参考）

## R50.4 双布局说明（升级导入包后）

- **week-board**：整周 / 周范围课表（`campus_schedule_query` / `campus_schedule_range_query`、
  无单日过滤、有课程事实）。渲染周视图：每日板块 + 课程块（节次 / 课程名 / 教室 / 人员与周次），
  空天折叠，并追加「看某日明细」续接按钮。
- **result-card**：风险 / 空教室 / 态势 / TopN / 调课模拟 / 单日明细 / 空结果 / 错误等，沿用 sections 结果卡。
- **规则单一**：layoutMode 由 `view-model.js` 确定性派生；week-board 数据损坏自动回退 result-card，
  事实不丢失（sections 兜底）。
- **导入方式不变**：仍然只有一个统一 Widget 资产（模板 + schema + default 一次导入），
  新增 4 个样例字段（layoutMode / weekBoardTitle / weekBoardSubtitle / days）随 default/samples 提供。

## 单会话执行清单（按顺序）

1. **Main Agent**
   - Prompt：粘贴 `prompts/main-orchestrator.final.md`
   - 输出模式：`text`
   - 澄清 Widget：`ON`
   - CampusTools 绑定：**无**（保持 13 插件绑定清单不变，Main 不勾选任何 campus 工具）
2. **Schedule / Risk / Insight Agent**
   - Prompt：分别粘贴 `prompts/schedule-space.final.md` / `risk-planning.final.md` / `campus-insight.final.md`
   - 输出模式：`Widget → campus-result-unified-v1`
   - Agent Output Widget：导入 `widget/template.txt` + `widget/schema.json` + `widget/default.json`
     （contract.json 仅登记用；adapter.py 为数据形状核对参考；widgetId 未注册时保持 null + FAIL_CLOSED）
   - Tool Direct Result：**OFF**
3. **转移关系**：Main → Schedule/Risk/Insight，且每个 child → Main（保持不变）
4. **插件绑定**：13 个自定义操作绑定保持当前清单；签名未变则**不重新导入、不重新部署**
5. **可选：AI 一键优化批处理**
   - 先保存 4 份基线（本包 `prompts/`）
   - 对 4 个 Agent 逐一点击「AI 一键优化」，保存候选到 `r50.2/prompt-candidates/{main,schedule,risk,insight}.md`
   - 运行 `node r50.2/prompt-candidate-gate.js --candidates` 批量门禁
   - 门禁通过才允许替换基线并重新跑全部门禁
6. **验收**：按 `r50.2/R50.2B-CONSOLE-ACCEPTANCE-MATRIX.md` 12 个家族逐条截图

## 回滚（一条命令级）

```powershell
# 恢复 R50.2A 基线 Prompt（本包 prompts/ 即回滚目标）
Copy-Item r50.2/console-bundle/prompts/*.final.md r50.2/prompts/
```

- 三个 child Agent 输出模式改回 `text`（R50.2A 基线即 text）
- 删除 / 停用 `campus-result-unified-v1` Widget 导入即可回到旧票证卡（无需删除票证卡资产）
- 工具 / 插件绑定零变更；13 个绑定无需回滚

## 发布纪律

- **不发布应用**：本包只做控制台配置切换与验收；任何发布动作需另行明确授权。
- widgetId 在真实腾讯导出登记前保持 `null` + `FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY`。
- 卡内动作仅官方 `sys.chat`；payload 只含用户语义 query；禁止把内部标识塞入动作载荷。
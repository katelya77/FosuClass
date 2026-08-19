# CSF Console 更新说明：小序-校园智序结果卡（契约 v6 稳定化）

> 本文档说明如何在 ADP 控制台把 `campus-result-unified-v1` 统一 Widget 更新为
> **fosuclass-adp-widget-contract/v6 稳定化基线**，用户可见名称 `小序-校园智序结果卡`
> （不再携带 R504 等研发版本号）。
> 只改 Widget 资产；不动 4 个 Prompt、不动 13 个工具绑定、不动转移关系。

## 变更范围（本仓库侧，已就绪）

| 资产 | 变更 |
|---|---|
| `widget/native/campus-result-unified-v1/contract.json` | 契约升级 `fosuclass-adp-widget-contract/v6`；登记用户可见 `name=小序-校园智序结果卡`；description 文档化稳定化策略（version 系统注入 / 空日过滤 SSOT / tieGroupCount 0 合法 / sys.chat-only / 最终变体收口） |
| `schema.json` | `displayMeta.tieGroupCount` 允许 0（minimum 0，无并列合法）；week-board 分支保持 `days`/`blocks` minItems=1（空日由确定性投影过滤，Widget 不接收空日） |
| `template.txt` / `default.json` / `samples/` | 不变（双布局渲染与 12 样例沿用 v5）；如控制台要求重传资产，请一并覆盖保持同源 |
| `adapter.py` | V6 适配器：`version` 缺省时确定性注入 `"1.0"`（模型生成的任何研发版本号 fail closed）；空日统一过滤；tieGroupCount 0 透传；动作仅 `sys.chat` |
| `payload-validator.js` | 新增统一校验器：所有 Agent 最终输出先过同一 schema；fail-closed 输出可读中文文本 fallback（不输出原始 JSON） |
| `r50.2/widget/envelope.js` + `campus-result-envelope.schema.json` | Agent-facing Envelope 移除 `version` 必填（模型不生成版本号）；`tieGroupCount` minimum 0 |
| `r50.2/widget/view-model.js` | 新增 `projectMissionFinalViewModel`：组合 Mission 最终 Widget 收口在最终完成能力的变体（课表→风险收口 risk 卡） |

## 控制台操作（约 5 分钟）

1. **替换 Widget 资产**：在 Agent Output Widget 编辑中，用本包新文件替换
   `template.txt` + `schema.json` + `default.json`（`widget/` 目录同源副本）；
   如控制台无独立 schema 编辑，则覆盖 template 与 default 即可。
2. **样例核对**：用 `widget/native/campus-result-unified-v1/samples/schedule-week.json`
   与 `risk.json` 分别预览 week-board 与 result-card 两种形态；
   用 `samples/ranking.json` 预览无并列（tieGroupCount=0 或缺省）形态。
3. **不动项**（保持 R51 现状）：
   - 4 个 Prompt：`# 小序 · 主协调` / `# 小序 · 课程空间` / `# 小序 · 风险规划` / `# 小序 · 校园洞察`，不重写；
   - 输出模式：三个 child 均为 `Widget → campus-result-unified-v1`；
   - Tool Direct Result：OFF；
   - Main 0 个 CampusTools、Main → Child / Child → Main 转移关系不变；
   - 13 个自定义操作绑定不重新导入。
4. **验证**：
   - 整周课表 → 周视图（空日不出现）；单日 / 风险 / 空教室 / 态势 / TopN / 调课模拟 / 空 / 错误 → 结果卡；
   - 课表→风险组合任务：最终展示风险结果卡（不是第一张课表卡）；
   - 无并列排名正常展示（不报 schema 错误）；
   - 卡内按钮点击后以自然语言续接（sys.chat），不携带内部标识；
   - 输出异常时以可读中文文本兜底，不出现原始 JSON。

## 回滚

- Widget 资产回 v5 版本（git 历史 / 本仓库 `widget/native` 旧文件）。
- Prompt / 工具绑定 / 转移关系零变更，无需回滚。

## 纪律

- 卡内动作仅官方 `sys.chat`，payload 只含 `{ query }`；禁止把内部标识塞入按钮载荷。
- `version` 由系统注入，模型 / Prompt / 用户界面均不得生成或展示研发版本号。
- widgetId 保持 `null` + `FAIL_CLOSED_REAL_TENCENT_EXPORT_ONLY`。
- 本包只做控制台配置切换与验收；不发布应用、不部署云端。
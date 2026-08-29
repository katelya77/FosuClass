# CSF — Campus Steward Foundation 计划（2026-08-19）

TDD：先写失败测试，再实现。批次内 RED→GREEN；批次间全量回归。

## T1 Widget Output Contract Stabilization（batch A 测试：`r49-ma/tests/test-csf-widget-stabilization.js`）

1. envelope（agent-facing）移除 version 必填；widget schema `tieGroupCount` minimum 0；week-board 空日 SSOT=投影过滤（文档化于 contract.json description + schema）。
2. `r51/mission/widget-actions.js` payload → `{query}`（与 action-builder 契约一致）；同步 `runtime-e2e-cases.json` sysChat payload。
3. `view-model.js` 增 `projectMissionFinalViewModel`（以最终完成能力定 variant，如课表→风险收口 risk card）。
4. `widget/native/campus-result-unified-v1/payload-validator.js`：校验 15 键 Widget payload；fail-closed 可读文本 fallback；regression fixtures `r49-ma/tests/fixtures/widget-payload-regressions.json`（version 模型生成 / 空日冲突 / tieGroupCount=0 / open_widget 透传 / 中间能力 variant / payload 形状）。
5. 重新生成统一 Widget 导入资产（contract v6 + 用户可见名 `小序-校园智序结果卡`）+ `widget/native/CSF-WIDGET-CONSOLE-UPDATE.md`；同步 `r50.2/console-bundle/widget/`。

## T2 Runtime Prompt Hygiene（batch A 测试：`r49-ma/tests/test-csf-prompt-hygiene.js`）

- 4 个 `r51/prompts/*.r51.md` 标题唯一化 + 删除 Rxx/Runtime/R504 字样；`r51/prompts/README.md` 与 `R51-CONSOLE-CUTOVER.md` 的 Widget 名更新为 `小序-校园智序结果卡`。
- hygiene gate：no Rxx / no competition-demo-vX / no test entity/date / no fixed query string / no internal widget version。

## T3 Knowledge Base 2.0（batch B 测试：`test-kb2-stale-gate.js`、`test-kb2-dynamic-boundary.js`、`test-kb2-recall-matrix.js`）

- `knowledge/current/` 10 节 + README + taxonomy 简述 + recall matrix；`knowledge/legacy/LEGACY.md` 标记旧 8 文档。

## T4 个人课表桥 + T5 Authority（batch C 测试：`test-csf-authority.js`、`test-csf-personal-bridge.js`）

- `r51/mission/authority.js`（L0-L3 映射 + 确认门禁 + MissionState.authorityLevel）；`personal-bridge/`（意图识别 / 状态诚实 / 导航动作 / 凭据零接触）+ `PERSONAL-SYNC-BRIDGE-AUDIT.md` 设计审计。

## T6 Evaluation Dual Track（batch D 测试：`test-csf-judge.js`）

- `evaluation/dual-track/rubric.md` + `judge.js`（A/B 双轨，解析序列化 JSON；Widget 无法展示不计业务 0 分）+ widget contract test set + `baseline-report.md`。

## T7 Legacy Workflow（batch D 收尾）

- Git tag `adp-workflows-backup-2026-08-19`（指向当前 HEAD）；`workflows/LEGACY-WORKFLOWS.md`（备份/引用/状态/回滚证据）。

## T8 多模态预留（batch D 测试：`test-csf-multimodal-boundary.js`）

- goalSpec.visionAssets 接口 + 视觉不得覆盖工具事实 gate；`multimodal/MM-RESERVE.md`。

## T9 全量验证

- focused（CSF 全部新测试 + 受影响旧测试更新：test-r51-widget-actions / test-r51-e2e-mission-matrix / test-r51-prompt-architecture / test-r50-2b-envelope / test-r50-2b-widget-contract / test-r50-4-view-model 等）→ r49-ma 全量 → compiler --check + prompt-candidate-gate → adp-kit npm 全链 → root 四门禁 → git diff --check。
- 提交（合理粒度）→ push `feat/campusflow-adp-integration` → PR #49 OPEN/UNMERGED 验证 → 报告。

完成判据：所有批次 GREEN、全量回归无新增失败、PR #49 保持 OPEN/UNMERGED、无 CloudBase 部署、用户可见面零 Rxx/测试标识。
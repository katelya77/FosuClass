# CSF — Campus Steward Foundation 交付报告（2026-08-19）

依据 `docs/superpowers/plans/2026-08-19-csf-campus-steward-foundation.md` 与
`docs/superpowers/specs/2026-08-19-csf-campus-steward-foundation-design.md` 交付。
分支：`feat/campusflow-adp-integration`（不合并、不发布、不部署）。

## 1. HEAD 与提交

- Starting HEAD：`f0f12e1`（R51 基线，PR #49 OPEN/UNMERGED）
- Final HEAD：`cb81522`
- 提交（按时间序）：
  1. `3fdf2ff` feat(adp): CSF T1 widget output contract stabilization（contract v6 + 小序-校园智序结果卡 + payload-validator + final view-model）— 18 files
  2. `972966c` feat(adp): CSF T2 runtime prompt hygiene（4 标题唯一化，零 Rxx/R504 泄漏）— 8 files
  3. `b17502c` feat(adp): CSF T3 knowledge base 2.0（current 10 节 + legacy 归档 + stale/dynamic 门禁）— 29 files
  4. `9925a58` feat(adp): CSF T4+T5 personal schedule sync bridge + authority model L0-L3（写确认门禁）— 5 files
  5. `2e4a2c8` feat(adp): CSF T6 evaluation dual track + T8 multimodal reserve（visionAssets gate）— 10 files
  6. `ee23939` docs(adp): CSF T7 legacy workflow archive + CSF design/plan docs — 3 files
  7. `cb81522` chore(adp): regenerate asset manifest + submission SHA256SUMS（303 files）— 2 files

## 2. Widget 输出契约修复（T1）

- envelope（agent-facing）移除 `version` 必填；Widget schema `tieGroupCount` minimum 0（缺失合法）。
- week-board 空日 SSOT = 确定性投影过滤（Widget 永不收到空日；schema 保持 days/blocks minItems 1）。
- `r51/mission/widget-actions.js` payload → `{query}`（与 action-builder 契约一致）。
- `view-model.js` 新增 `projectMissionFinalViewModel`（最终完成能力定 variant，如课表→风险收口 risk card）。
- `widget/native/campus-result-unified-v1/payload-validator.js`：15 键 Widget payload 校验、fail-closed 可读中文文本回退、regression fixtures `r49-ma/tests/fixtures/widget-payload-regressions.json`（version 模型生成 / 空日冲突 / tieGroupCount=0 / open_widget 透传 / 中间能力 variant / payload 形状）。
- 统一 Widget 导入资产：**contract v6**，用户可见名 **`小序-校园智序结果卡`**（无 Rxx）；
  `widget/native/CSF-WIDGET-CONSOLE-UPDATE.md`（控制台导入指南）；`r50.2/console-bundle/widget/` 已同步
  （schema.json / contract.json / adapter.py / campus-result-envelope.schema.json / view-model.js）。

## 3. 新 Widget 导入路径

- 源码契约：`competition/adp-kit/widget/native/campus-result-unified-v1/contract.json`（schema `fosuclass-adp-widget-contract/v6`）
- 控制台安装包：`competition/adp-kit/r50.2/console-bundle/widget/`
- 编译器产物：`output/competition-adp/final/CampusFlow-ADP-Import-Bundle.zip`
  SHA256 `f0b08573a6ac8997b6c9c1e3875984fe41122ba9c146a955ca61de827c6b15e9`（`adp:compile` PASS，71 checks，含 R51-P9 paste-pack 字节一致性）
- 其他既有 ADP Widget（02-Classroom / 03-Conflict / 04-DayPlan / 6 个真实 WidgetID）为冻结逻辑资产，未改动。

## 4. Runtime Prompt Hygiene 状态（T2）

- 4 个 prompt 标题唯一化：`# 小序 · 主协调` / `# 小序 · 课程空间` / `# 小序 · 风险规划` / `# 小序 · 校园洞察`（`r51/prompts/*.r51.md`）。
- 正文与 `r51/prompts/README.md`、`r51/R51-CONSOLE-CUTOVER.md`、`reports/current-adp-checkpoint.md` 中 Widget 名统一为 `小序-校园智序结果卡`。
- Hygiene gate（`test-csf-prompt-hygiene.js`）：no Rxx / no competition-demo-vX / no test entity/date / no fixed query string / no internal widget version — 全过。
- 残留 `R50.4` 仅存在于历史工程文档（`r51/README.md`、`r51/R51-CONSOLE-CUTOVER.md`、`r51/2026-08-19-r51-final-report.md`、`reports/current-adp-checkpoint.md`）——用户可见面为零。

## 5. 知识库路径（T3，KB 2.0）

- 现行库：`competition/adp-kit/knowledge/current/` — 10 节（01 定位与能力边界 … 10 常见问题）+ `README.md` + `recall-matrix.md`（12 个 md 文件）。
- 旧库归档：`competition/adp-kit/knowledge/legacy/LEGACY.md`（competition-demo-v1/v2、教师001、固定日期、dataHash 等旧污染源仅保留在 legacy 标记内）。
- 门禁：`test-kb2-stale-gate.js`（K1–K4）、`test-kb2-dynamic-boundary.js`（D1–D3）、`test-kb2-recall-matrix.js`（M1–M3）— 10/10 GREEN。
- 提交包镜像：`competition/submission-package/knowledge/current/` + `knowledge/legacy/`（build-submission-package 生成）。

## 6. 个人课表同步桥（T4）

- `competition/adp-kit/personal-bridge/bridge.js`：`classifyPersonalScheduleIntent`（import / bind / resync / change_source / status / null）+ `buildBridgeMessage`（状态诚实、不伪造导入、凭据零接触、不含内部路径）。
- 设计审计 `personal-bridge/PERSONAL-SYNC-BRIDGE-AUDIT.md`：引用 `miniprogram/pages/personal-sync/`、`server/src/routes/fosuApaasImport.js`（public-key/preview/start/status/recent/confirm/cancel）、`fosuStudentImportCrypto.js`（SM2/RSA）、`fosuApaasImportSessionStore.js`。
- 修复：`换个来源导入` 关键词识别；删除 `密码` 字样。

## 7. Authority 模型（T5）

- `r51/mission/authority.js`：L0/L1/L2 自动；L3 写操作（import/bind/resync/change_source/modify/reserve/submit）确认门禁；
  `attachAuthority` / `isAuthorized` / `assertNoL3AutoRun`；MissionState.authorityLevel。
- 测试：`test-csf-personal-bridge.js` + `test-csf-authority-model.js` — 15/15 GREEN。

## 8. Evaluation 双轨（T6）

- `evaluation/dual-track/`：`rubric.md`（A/B 双轨评分细则）、`judge.js`（解析序列化 JSON；
  Widget 无法展示不计业务 0 分；safety/no_contradiction 零容忍 hard gate；renderOnlyFail 不清零业务分）、
  `widget-contract-testset.json`（dt-01..dt-06）、`baseline-report.md`。
- 测试：`test-csf-evaluation-dual-track.js` — 8/8 GREEN。

## 9. 多模态预留（T8）

- `r51/mission/model.js` `validateGoalSpec` visionAssets（array of string|{id,type,role}，fail closed）+ baseState passthrough；
  `r51/mission/planner.js` planMission 透传；视觉素材不得覆盖工具事实。
- `multimodal/MM-RESERVE.md`；测试 `test-csf-multimodal-reserve.js` M1–M4 — 4/4 GREEN。

## 10. Legacy Workflow（T7）

- Git tag `adp-workflows-backup-2026-08-19` → `f0f12e1`（备份点；**仅本地**，未推送远端——远程改动需用户明确要求，推 tag 留待用户决定）。
- `workflows/LEGACY-WORKFLOWS.md`：引用面核对（application-config.json roleInstruction、evaluation-dataset workflow 字段、
  real-adp-export-catalog、runtime-e2e-cases、action-contract、campus-overview-v1）→ 保持活动 + legacy-pending，删除推迟。
- `widget/native/runtime-e2e-cases.json` 保持原样（legacy ADP manifest fixture，被 test-runtime-e2e-cases.js 断言）。

## 11. 门禁结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| Focused（CSF 全部新测试 + 受影响旧测试更新） | node --test r49-ma/tests/test-csf-*.js + test-r50-2b-envelope + test-r51-widget-actions + test-r51-e2e-mission-matrix | 全 GREEN（batch A 60 + r50.2b 40 + KB 10 + bridge/authority 15 + dual-track 8 + multimodal 4） |
| r49-ma 全量回归 | `node --test r49-ma/tests/*.js` | **477/477 GREEN** |
| compiler --check + prompt-candidate-gate | r49-ma 内 R50-P2 compiler --check / R51-P9 paste-pack；`node r50.2/prompt-candidate-gate.js` | 全 PASS（快照字节一致、不变量与泄漏面通过） |
| adp-kit npm 全链 | `npm test`（adp-kit） | 全 PASS（含 MCP 52/52、eval:golden 33/33、adp:compile 71 checks、runtime closure、submission scan findings=0 credentialCandidates=0；manifest 重新生成 303 files 后 `validate:submission` + `sync-assets-manifest.js --check` PASS） |
| root 四门禁 | test:agent-foundation / test:agent-regression / test:ai-competition / test:agent-final-convergence | 42/42、197/197、PASS、all passed（无改动面回归） |
| 其他 | `git diff --check` | 0（仅 LF→CRLF 提示） |
| 其他 | widget/test-widget-adapter.js、test:widget-contract、py_compile（两份 adapter.py） | 全 PASS |

## 12. CloudBase 部署

- **否**。未执行任何 CloudBase / 生产部署；HTTP Function 仅本地冒烟（`cloudfunctions/test-http-function.js` 属既有全链检查）。

## 13. PR #49 状态

- OPEN / UNMERGED / 非 draft，base `main` ← head `feat/campusflow-adp-integration`。
- 已推送 `f0f12e1..cb81522`。CI 5 项（admin-checks、agent-release-gate、public-security×2、widget-contract）在报告时 running（pending）；最终状态以 GitHub Actions 为准，本分支不允许合并。

## 14. ADP 手动动作（交付方）

1. 在 ADP 控制台使用 `r50.2/console-bundle/widget/` 安装 Widget：用户可见名为 **小序-校园智序结果卡**（契约 v6，schema `fosuclass-adp-widget-contract/v6`）；参见 `widget/native/CSF-WIDGET-CONSOLE-UPDATE.md`。
2. Widget 动作仅 `sys.chat`，payload `{ query }`；无 open_widget/内嵌表单。
3. 全量导入包：`output/competition-adp/final/CampusFlow-ADP-Import-Bundle.zip`（SHA256 `f0b08573…b15e9`）；01-Schedule-Final.zip 71/71 checks。
4. 知识库：以 `knowledge/current/` 为现行事实（10 节 + recall matrix），`knowledge/legacy/LEGACY.md` 仅作回滚证据。
5. 个人课表桥：仅呈现状态与导航（`personal-bridge/`），不伪造导入结果；写操作须 Authority L3 确认。
6. 回滚路径：`git revert` 或 checkout `f0f12e1`（本地 tag `adp-workflows-backup-2026-08-19`）恢复 R51 基线。

## 15. 剩余事项 / Blockers

- 无 blocker。遗留两项（均按计划推迟，非失败）：
  1. Legacy workflows 删除（推迟至后续里程碑，见 LEGACY-WORKFLOWS.md legacy-pending）。
  2. 多模态视觉素材仅预留接口（visionAssets gate），未启用视觉输入路径（MM-RESERVE.md）。
- CI 5 项 pending 需在 Actions 完成后复核；若任一失败需在交付报告补充证据，不得合并。
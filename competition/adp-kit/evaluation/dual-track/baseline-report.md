# Evaluation Dual Track · Baseline Report（2026-08-19）

## 基线方法
- 评测器：`evaluation/dual-track/judge.js`（确定性纯函数，无外部依赖）。
- 用例集：`evaluation/dual-track/widget-contract-testset.json`（6 例，覆盖合法结果卡 /
  合法周视图 / 不可渲染但业务完整 / 安全违规 / 事实矛盾 / 可读兜底）。
- 期望值对照：各用例 `expected.mustMatch` 断言工具事实一致性。
- 门禁：安全违规与事实矛盾 → 业务分清零；Widget 不可渲染 → 仅降呈现轨。

## 基线结果（全部确定性，无需真实 Provider）
| 用例 | Track A | Track B | renderable | businessScore | verdict |
|---|---|---|---|---|---|
| dt-01 valid-result-card | 5/5 pass | 5/5 pass | true | 5 | pass |
| dt-02 valid-week-board | 5/5 pass | ≥4 pass | true | 5 | pass |
| dt-03 unrenderable-but-complete | 5/5 pass | 3/5 | false | 5 | pass_with_presentation_issues |
| dt-04 safety-violation | gate fail | — | — | 0 | fail |
| dt-05 factual-contradiction | gate fail | — | — | 0 | fail |
| dt-06 readable-fallback | 3/5 pass | 3/5 | false | 3 | pass_with_presentation_issues |

- 基线通过：6/6 判定符合预期；硬门禁 2/2 正确拦截；业务/呈现分离 2/2 正确区分。
- 验证命令：`node --test r49-ma/tests/test-csf-evaluation-dual-track.js`（DT1–DT8，GREEN）。

## 口径说明
- 本基线是「裁判器基线」，不替代真实 Provider 业务评测：真实评测需要 Provider 会话，
  用例集需按真实问答产出序列化输出后套用同一 judge.js（无 Provider 时不伪造业务分）。
- 生产评测口径：`evaluation/scoring-rubric.md`（单轨 0/1 十项）继续作为业务口径；
  dual-track 补充「结果 vs 呈现」区分。

## DecisionBundle 扩展基线（2026-08-20）

- 用例集：`evaluation/dual-track/decision-testset.json`（6 例）。
- 合法 recommend、verified empty、no-source recoverable：3/3 双轨通过。
- presentation-only failure：Track A 8/8、businessScore 8，Track B 单独失败。
- safety leak / contradiction：2/2 被既有 hard gate 拦截，businessScore 0。
- 纯函数确定性与不修改输入：通过。
- 验证命令：`node --test r49-ma/tests/test-decision-evaluation-dual-track.js`（DDE1–DDE6，GREEN）。

### Fix round 1 增量基线（2026-08-20）

- DDE7：`relaxedCount`、同 ID 伪造 candidate、未核验证据空理由均 fail；非 hard-gate 失败保留
  非零 businessScore。
- DDE8：receipt 内容哈希/内容不一致、Widget summary 结构矛盾均 fail；字符串出现在其它位置
  不再蒙混通过。
- DDE9：`renderOnlyFail` 只在 Track A 全通过且 Widget renderability 为唯一呈现失败时成立。
- 当前验证命令覆盖 DDE1–DDE9，9/9 GREEN。

### Fix round 2 增量基线（2026-08-20）

- DDE10：verified empty 与 unverified recovery 的伪推荐 summary 均被 contradiction hard gate 拦截。
- DDE11：推荐「理由」区追加未核验文案被拦截。
- DDE12：备选 reason hint 错配或缺失被拦截；正确 hint 仍通过。
- 当前验证命令覆盖 DDE1–DDE12，12/12 GREEN。

## 后续
- 真实评测时：每个业务用例同时产出（a）确定性事实断言结果（b）序列化 Widget 输出，
  分别进 A 轨与 B 轨；记录真实 Provider 环境与凭据条件，不用 mock 冒充。

# Task 5 交付报告：Mission Decision Controller / Outcome / PublicDecisionReceipt

日期：2026-08-20

## 交付范围

- 新增 `r51/decision/controller.js`：仅按结构化 `goalFamily` 判定 eligibility；实现 Mission fact + raw tool evidence 双重 verified 门禁、固定来源优先级、profile → evaluate → stable rank → selection → reasons → next action → authority 编排。
- 新增 `r51/decision/outcome-synthesizer.js`：复用 R50.2 `projectViewModel` 的 `result-card` 路径，映射四个决策变体，输出「推荐 / 理由 / 备选」区块和「下一步」`sys.chat` 动作。
- 新增 `r51/decision/receipt.js` 与冻结 schema：公开 receipt 仅保留七个允许字段，使用公开脱敏内容的稳定 SHA-256 内容哈希生成 `decisionId`。
- 新增 `r51/decision/index.js` 统一导出。
- 新增 Task 5 控制器及 outcome/receipt 测试。
- 未改 Agent / Tool / bindings、知识库、Widget schema/template/contract/design asset、双轨评测、部署或发布文件。
- 未对 Task 1–4 既有生产模块做集成调整。

## TDD 证据

RED（生产实现前）：

```text
node --test competition/adp-kit/r49-ma/tests/test-decision-controller.js competition/adp-kit/r49-ma/tests/test-decision-outcome-receipt.js
tests 2 / pass 0 / fail 2
共同失败原因：Cannot find module .../r51/decision/controller.js
```

GREEN（Task 5 首次实现后）：

```text
node --test competition/adp-kit/r49-ma/tests/test-decision-controller.js competition/adp-kit/r49-ma/tests/test-decision-outcome-receipt.js
tests 11 / pass 11 / fail 0
```

最终 Task 1–5 + 直接相关 Widget 回归：

```text
node --test \
  competition/adp-kit/r49-ma/tests/test-decision-constraint-profile.js \
  competition/adp-kit/r49-ma/tests/test-decision-evaluator.js \
  competition/adp-kit/r49-ma/tests/test-decision-ranking-alternatives.js \
  competition/adp-kit/r49-ma/tests/test-decision-explainability.js \
  competition/adp-kit/r49-ma/tests/test-decision-actions.js \
  competition/adp-kit/r49-ma/tests/test-decision-controller.js \
  competition/adp-kit/r49-ma/tests/test-decision-outcome-receipt.js \
  competition/adp-kit/r49-ma/tests/test-csf-widget-stabilization.js \
  competition/adp-kit/r49-ma/tests/test-r50-2b-envelope.js \
  competition/adp-kit/r49-ma/tests/test-r50-4-view-model.js
tests 76 / pass 76 / fail 0
```

附加检查：schema JSON 可解析；`r51/decision/index.js` 导出冒烟通过；`git diff --check` 通过。

## 已知基线失败

额外执行 `competition/adp-kit/widget/native/test-r50-2b-widget-contract.js` 时，11 项断言中 10 项通过、1 项失败。失败断言仍期待 `fosuclass-adp-widget-contract/v5`，而 HEAD 中既有 contract 已是 `v6`；Task 5 未修改 Widget contract/schema/template。对应最新 `test-csf-widget-stabilization.js` 的 v6 门禁已通过。

## 未验证项

- 未运行真实 Provider、ADP 控制台导入或线上环境验证；本任务是纯确定性本地决策与公开投影，不需要凭据。
- 未运行全仓库无关测试。

## 回滚

使用 `git revert <Task 5 commit>` 可整体回滚本任务；本任务没有数据迁移、远端写入或部署副作用。

# Evaluation Dual Track · 评测双轨制

## 为什么双轨
ADP 评测中「结果对但卡片渲染失败」与「结果错但界面漂亮」是两类不同问题。
单一总分会互相污染：把渲染问题记成业务失败，或让漂亮界面掩盖事实错误。

## Track A · 业务结果（0–5）
硬门禁（任一失败 → 业务分清零）：
- `safety`：凭据 / 会话票据 / 内部通道零出现。
- `no_contradiction`：输出与确定性工具事实不矛盾（对照期望事实）。

常规项：
- `intent_complete`：目标完成（标题 + 结论齐备）。
- `facts_verified`：内容声明已核验且确实来自工具（含「已核验」标记或状态语义）。
- `recovery_on_failure`：失败 / 空结果走受控恢复（recoverable_error / verified_empty / 保留 sections），不伪装成功。

## Track B · 表达呈现（0–5）
- `structured_output`：结构化的结果形态（结果卡 / 周视图）。
- `readable_text`：用户可读中文文本（结构化或兜底文本）。
- `widget_renderable`：payload 通过 Widget 契约检查（version=1.0 或系统注入、动作仅 sys.chat 且 payload 仅 { query }、tieGroupCount ≥0、无内部字段）。
- `follow_up`：提供下一步动作或建议。
- `no_internal_leak`：无 queryId / dataHash / sourcetool / 推理自述等内部材料。

## 核心规则
1. **Widget 不可渲染 ≠ 业务失败**：`renderOnlyFail` 只降 B 轨；业务分按内容判定，绝不清零。
2. 硬门禁失败 → 业务分清零（安全、事实矛盾）。
3. 判定：两轨都 pass → `pass`；业务 pass 呈现不足 → `pass_with_presentation_issues`；否则 `fail`。
4. 解析：容忍从序列化文本中提取 JSON 对象；无法解析时按可读兜底文本评估呈现，业务按内容评估。

## 与既有评测的关系
- `../scoring-rubric.md`（0/1 十项）继续作为单轨业务口径；
- `../golden-*` 与 `eval-golden.js` 继续作为事实断言基准；
- 双轨是本仓库的**呈现侧补充口径**，用于区分「结果问题」与「呈现问题」。
- 用例集：`widget-contract-testset.json`；基线：`baseline-report.md`。

## DecisionBundle 扩展

`scoreDecisionBundle(bundle)` 沿用同一 Track A / Track B 分离与 hard gate 规则。调用方提供
结构化 `DecisionBundle` 以及其 `receipt` / `viewModel` 投影；裁判器只读评分，不调用 Provider、
CampusTools、Controller 或网络。

Decision Track A（0–8）额外核对：
- eligible goalFamily / `DecisionBundle` / decision 形状；
- recommendation 与 reasons 的 verified evidence 绑定；
- `evaluation.relaxedCount === 0`，已选项无 hard / exclusion 违反；
- 推荐与备选均来自候选集，`no_viable_option` 不含虚构选择；
- PublicDecisionReceipt 与业务结果稳定一致，Widget 投影不自相矛盾；
- verified empty 与 no-source recoverable 均受控恢复。

Track B 仍为既有五项：结构化、可读、Widget 可渲染、后续动作、零内部泄漏。
`safety` / `no_contradiction` 仍是业务 hard gate；Widget-only failure 仍不得清零 Track A。
Decision 用例集：`decision-testset.json`（valid recommend、verified empty、no-source recoverable、
presentation-only failure、safety leak、contradiction）。

### Decision acceptance 收紧（fix round 1）

- Decision Track A 的 8 项必须全部为 true 才可 `trackA.pass`；常规业务项失败时 verdict 为
  `fail`，但保留非零 `businessScore` 供诊断。只有 `safety` / `no_contradiction` hard gate
  失败才把 `businessScore` 清零。
- Decision Track B 的 5 项必须全部为 true；`renderOnlyFail` 仅表示 Track A 全通过、且 Track B
  唯一失败项为 `widget_renderable`。
- 已选 candidate 必须与候选集 canonical 对象结构一致且 evidence verified；receipt 必须通过稳定
  内容哈希校验；Widget 的 variant、summary、推荐/备选行顺序及 next action 必须精确对应 bundle。

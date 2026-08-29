# Final Fail-safe Presentation Contract（结果展示降级契约）

状态：REPO_FINAL · 应用于「小序-校园智序结果卡」统一 Widget 与全部最终输出。

## 1. 目标

真实 ADP 评测中大量出现「Widget无法正常展示 + 正确 JSON」「Widget 暂时无法展示」等失败模式。
本契约把 Widget 展示失败从「占位句 + 裸数据」收敛为**同一已核验结果投影的可读语义文本**，
同时保留正常环境下的 Widget 展示，不删除 Widget、不新增独立 Widget。

## 2. 展示层级（单一判定入口）

`r51/presentation/final-presentation-policy.js` 是唯一判定入口：

| responseClass | mode | 输出 |
|---|---|---|
| dynamic_result + 合法 result-card | widget | 返回同一 verified result-card projection |
| dynamic_result + 非法/不可渲染 result-card | text | 从**同一** projection 确定性派生可读中文文本 |
| clarification / confirmation | clarify | 中文澄清/确认，不进 Widget |
| static_knowledge | message | 简洁消息 |
| chat 等其余 | text | 普通文本 |

## 3. Fallback 生成规则（禁止编造）

- fallback 文本由 `payload-validator.buildTextFallback(card)` 从同一 verified result projection 确定性派生：标题 → 副标题 → 已核验标记 → 摘要 → 上下文 → 模拟标记 → 区块行。
- **禁止语言模型重新编造事实**；禁止模型把 projection 之外的内容写进 fallback。
- 派生结果为空或含内部协议词（queryId / dataHash / dataVersion / authorization / token /
  sourceTool / rankContext / `{}`）时，才回退到受控占位句。

## 4. 对普通用户的禁止输出

- 禁止仅输出「Widget无法正常展示 / Widget 暂时无法展示」占位句；
- 禁止输出裸 JSON、schema、version、内部协议字段；
- 禁止输出 `DecisionBundle / MissionState / GoalSpec / resultCard` 等内部类型名与字段名；
- 禁止把工具原始返回（lessonId、sourceLessonId、queryId、dataHash）透传给用户。

## 5. 提示词要求（四 Agent 同步）

- Main / Schedule / Risk / Insight 的 Final 提示词必须声明：始终以可读中文文本呈现业务结论
  与必要事实；结果卡只是辅助；结果卡无法渲染时文本必须承载同一来源的已核验结论；
  不得输出占位句、裸 JSON 或内部协议。
- 调课结果必须声明「What-if 模拟，未修改真实课表」；fallback 文本同样保留该声明
  （displayMeta.simulated → buildTextFallback 自动附加「（模拟结果，未执行任何修改）」）。

## 6. 验证（门禁）

- `final/acceptance/test-final-presentation.js`（PP1~PP6）验证判定入口与 fallback 派生；
- `r49-ma/tests/test-csf-widget-stabilization.js`（W6~W8）验证 payload 校验 fail-closed 可读文本；
- `r49-ma/tests/test-csf-evaluation-dual-track.js`（DT3/DT6）验证业务分不清零、兜底文本可读；
- Final Hero Stability Matrix 中每个用例都必须满足「Widget failure always has semantic fallback」。

## 7. 边界

- 本契约不改变 Widget 结构（仍为唯一「小序-校园智序结果卡」，v8 契约）。
- 不删除 Widget；正常 Widget 支持环境仍优先展示 Widget。
- fallback 永远来自同一 projection，与模型输出解耦：模型只输出业务内容，展示层负责投影与降级。

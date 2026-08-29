# 多模态预留（Multimodal Reserve）

> `visionAssets` 的历史预留边界。真实图片理解现已使用独立 `VisionObservation`，本字段仍不得复用。

## 当前状态：display-only reserve
- `visionAssets` **不参与**当前任务路由与事实判定；图片理解结果进入独立 `visionObservations`。
- 课表事实的唯一来源仍是确定性工具；**任何视觉输入都不能覆盖或改写工具返回的课表事实**。
- 语音转写若启用，只把转写文本当作自然语言输入进入既有 Intent 路由，不改变任何能力。

## 接口预留：goalSpec.visionAssets（只透传）
- `goalSpec.visionAssets`：可选数组，元素为字符串或 `{ id, type, role }`。
- 语义：**展示资产引用**（如用户提供的演示素材、结果配图引用），随 `goal.goalState` 透传，
  供表达层消费；**绝不作事实来源、绝不进入任何工具参数、不参与完成度判定**。
- 校验：非数组或非法元素 → GoalSpec 校验失败（fail closed）。
- 透传边界：`planMission().goal.visionAssets` 与 `newMissionState().goal.visionAssets`
  保留快照；`steps[].tools/params` 永不携带。

## 铁律
1. 视觉内容不得改写确定性课表事实；冲突时以工具返回为准，并如实说明。
2. visionAssets 永远只是「展示引用」，不是「事实」。
3. 平台图片理解工具只绑定 Main，输出必须先规范为 `unverified_visual_observation`；不得复用本预留字段承载观察或事实。

## 验证
- `node --test r49-ma/tests/test-csf-multimodal-reserve.js`（M1–M4，GREEN）。

# 多模态预留（Multimodal Reserve）

> CSF Phase 8：为「图片 / 截图 / 语音转写 / 演示素材」类输入预留位置，不引入实现依赖。

## 当前状态：reserve（预留，不实现）
- 多模态输入（图片课表截图、语音、视频素材）**不参与**当前任务路由与事实判定。
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
3. 未来若接入真实多模态，需专项评审 + 新增能力与工具契约，不得复用本预留字段承载事实。

## 验证
- `node --test r49-ma/tests/test-csf-multimodal-reserve.js`（M1–M4，GREEN）。
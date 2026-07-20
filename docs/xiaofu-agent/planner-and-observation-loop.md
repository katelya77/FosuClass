# Planner 与 Observation Loop

## 模块

| 文件 | 职责 |
|------|------|
| `server/src/services/ai/planner/planSchema.js` | 严格计划结构与 reasonCode 枚举 |
| `planValidator.js` | Tool/Skill 白名单、步数上限、禁止危险 args |
| `plannerPolicy.js` | public/trial/dev 策略与预算 |
| `deterministicPlanner.js` | public 确定性规划 + 回退 + replan |
| `modelPlanner.js` | trial/dev 受约束模型规划（失败回退确定性） |
| `observationLoop.js` | Plan → Tool → Observe → Verify → Replan(≤1) |

## 接口

```js
Planner.plan({
  message, runtimeMode, intent, slots,
  conversationState, availableSkills, availableTools,
  previousObservations, skill, context, modelGenerate
})
```

返回：

```js
{
  goal, intent, confidence, slots,
  needsClarification, clarification,
  steps: [{ id, skillId, toolName, args, reasonCode, dependsOn, stopOnFailure }],
  stopCondition, replanCount, plannerType
}
```

禁止返回隐藏推理文字。

## Runtime

- **public**：仅 `deterministicPlanner`，零外部模型。
- **trial/dev**：可启用 `modelPlanner`；JSON 无效 / 未允许 Tool / 超限时回退确定性。
- 最大 Tool Step：5；最大 Replan：1。

## Replan 策略

仅在多步骤任务或空教室空结果时触发：

- 无个人课表 → 导入帮助 / 结构化追问
- 空教室为空 → 缩短连续节次或扩大楼栋（一次）

单工具「今日课表无数据」不 replan，沿用确定性导入引导。

## Clarification

缺教师/班级/课程/教室等关键槽位时返回：

```js
{ slot, prompt, suggestions }
```

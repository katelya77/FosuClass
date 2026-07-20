# Agent Run Events

## 事件类型

- `run.accepted`
- `request.sanitized`
- `intent.resolved`
- `skill.selected`
- `tool.started` / `tool.completed` / `tool.failed`
- `provider.selected` / `provider.started` / `provider.completed` / `provider.failed`
- `response.composing`
- `result.verifying`
- `run.completed` / `run.degraded` / `run.failed` / `run.cancelled`

## 客户端 Loading 规则

| 场景 | 期望 |
|------|------|
| public “你好” | 理解 → 准备回答 → 完成（不得出现课表） |
| trial/dev 且模型真实调用 | 理解 → Thinking · 增强理解 → 组织回答 |
| 今日课表 | 理解 → tool.started → tool.completed → 核验 |
| 天气 | 只能天气相关文案 |
| Provider 失败 | provider.failed → 已切换到本地能力 |

`Thinking` 只能在 `provider.started` 之后出现。

## 实现

- 服务：`server/src/services/ai/agentRunEventService.js`
- 目录：`server/src/services/ai/runEventCatalog.js`
- 客户端：`miniprogram/services/agentRunClient.js`
- UI：`miniprogram/components/xiaofu-live-run/`

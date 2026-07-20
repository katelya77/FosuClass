# 小佛助手 UI V2（Campus Copilot）

## 设计方向

校园任务助手，不是通用聊天页。品牌红仅用于关键动作；主体为纸张白与温暖浅灰。

## 可见变化

- 顶部：真实连接状态、运行模式、记忆状态
- 空状态：任务卡（今天安排 / 连续空教室 / 班级课表 / 自习规划）
- 文案：对话 / 新建对话 / 处理中 / 发送
- 执行过程：`xiaofu-agent-run` 消费 V2 `steps`，兼容 `taskSteps`
- Evidence 按任务类型区分
- Fallback 友好条，非全屏错误
- 记忆设置面板：local_only / session_state / cloud_sync
- 助手消息轻量反馈

## 组件

```text
miniprogram/components/xiaofu-agent-run/
miniprogram/components/xiaofu-memory-sheet/
miniprogram/components/xiaofu-conversation-sheet/
```

## 不展示

Provider 名、内部 Tool 名、competition、Mock、OpenID、Trace ID、隐藏思维链。

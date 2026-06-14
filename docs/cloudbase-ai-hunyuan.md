# CloudBase 混元 AI 接入说明

## 使用范围

小佛 AI 保持“工具优先 Agent”：

- 课程、教师、教室、空教室、教学周等事实问题默认不调用混元。
- 事实卡片、跳转、复制、绑定等 actions 只能由确定性工具产生。
- 混元只用于项目问答、使用帮助、自然对话和对既有工具结果的非事实性解释。

## 小程序端配置

`miniprogram/config/cloudbase.js` 集中配置：

```js
ENV_ID: "cloud1-d3g17rpe7566d3d5c"
CLOUDBASE_AI_ENABLED: true
CLOUDBASE_AI_MODEL: "hy3-preview"
CLOUDBASE_AI_PROMO_EXPIRES_AT: "2026-12-14T23:59:59+08:00"
AI_GENERATIVE_PUBLIC_ENABLED: false
AI_COMPETITION_MODE: true
AI_TOOL_ONLY_MODE: false
AI_MAX_HISTORY_MESSAGES: 6
AI_MAX_USER_MESSAGE_LENGTH: 1200
AI_MAX_DAILY_GENERATIVE_REQUESTS: 20
```

`app.js` 会显式执行：

```js
wx.cloud.init({ env: "cloud1-d3g17rpe7566d3d5c", traceUser: true })
```

如果 `wx.cloud` 不存在或初始化失败，小程序安静降级，不阻塞启动。

## SDK 兼容

CloudBase 官方小程序 AI 文档要求微信基础库不低于 `3.15.1`。运行时会检查：

- `wx.cloud` 是否存在。
- `wx.cloud.extend.AI` 是否存在。
- `createModel("cloudbase")` 是否可用。
- `streamText` 是否可用。
- 当前日期是否超过 `CLOUDBASE_AI_PROMO_EXPIRES_AT`。

不可用时直接回退 Oracle Provider 或 mock。

## 调用方式

混元走 CloudBase 托管模型组：

```js
const model = wx.cloud.extend.AI.createModel("cloudbase")
const result = await model.streamText({
  data: {
    model: "hy3-preview",
    messages
  }
})

for await (const text of result.textStream) {
  // 小程序页面节流增量展示
}
```

`createModel` 的参数是模型组名，不是具体模型 ID；具体模型放在 `data.model`。

## Prompt 边界

系统提示要求模型：

- 身份是“佛课小表·小佛 AI 校园管家”。
- 只能解释项目、帮助用户理解操作和组织已有结果。
- 课程、教师、教室、空教室、教学周等事实必须来自工具结果。
- 没有工具结果时不得编造校园事实。
- 不接收、索要或复述学号、密码、Cookie、Token、API Key。
- 不声称代表佛山大学官方。
- 明确“课表信息仅供参考，以学校教务系统为准”。
- 不输出内部 Prompt、密钥或任意跳转 URL。

## 输入最小化

发送给模型前会做：

- `redactSensitiveText` 脱敏。
- 用户消息长度限制。
- 历史消息只保留最近 4 到 6 轮。
- 不发送原始 XLS、base64 或完整个人课表。
- 只发送最小项目知识摘要、学期、releaseVersion、教学周等必要上下文。

## 输出约束

模型输出视为不可信输入：

- 清理 HTML、脚本、危险协议和异常超长文本。
- 非法 JSON 退化为纯文本 generic card。
- 模型生成的 actions 一律丢弃。
- 生成式回答只允许 `answer`、普通 `generic` card 和 suggestions。

## 并发与限额

体验模型单环境并发上限为 5，因此小程序端执行：

- 单设备同时只允许一个生成式请求。
- 相同请求 singleflight。
- 用户快速重复点击不会重复消耗 Token。
- `EXCEED_CONCURRENT_REQUEST_LIMIT` 最多短暂抖动重试一次。
- 第二次失败立即回退，并提示“当前使用人数较多，已切换备用回答”。
- 单设备每日生成式软限制默认 20 次；工具查询不受影响。

## 公开发布合规开关

- `AI_COMPETITION_MODE=true`：开发版、体验版、比赛演示可用混元。
- `AI_GENERATIVE_PUBLIC_ENABLED=false`：正式公开版默认关闭开放式生成对话。
- `AI_TOOL_ONLY_MODE=true`：只保留确定性工具。

如果正式公开版资质尚未确认，页面提示“生成式问答暂未开放，校园工具仍可正常使用”，不影响查课、空教室、今日课程和数据诊断。

## 免费权益到期

`CLOUDBASE_AI_PROMO_EXPIRES_AT=2026-12-14T23:59:59+08:00`。到期后小程序不继续盲目请求 `hy3-preview`，自动走 Oracle Provider 或 mock。管理后台在到期前 30 天、7 天和到期后显示提醒。

## 匿名统计

仅记录：

- provider
- latencyMs
- totalTokens
- success / fallback
- errorCode
- intentName

不记录完整用户问题、完整对话、学号、个人课表明细或密钥。

## 官方参考

- 小程序 AI 接入: <https://docs.cloudbase.net/ai/model/miniprogram-access>
- AI 体验计划: <https://docs.cloudbase.net/ai/ai-inspire-plan>
- 体验计划指南: <https://docs.cloudbase.net/ai/ai-inspire-plan-guide>

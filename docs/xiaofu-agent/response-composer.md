# Response Composer

统一决定用户可见内容，位于 Provider / mock 渲染之后。

## 模块

`server/src/services/ai/responseComposer/index.js`

## presentationMode

| 模式 | 场景 | 展示 |
|------|------|------|
| `plain` | 寒暄、一般问答 | 仅正文 + ≤3 建议 + 紧凑反馈 |
| `single_card` | 单事实任务 | 短结论 + 1 卡 + 可展开 Evidence |
| `multi_card` | 多工具 | 综合结论 + ≤2 主卡 |
| `clarification` | 追问 | 结构化追问文案 |
| `recovery` | 失败 | 单张恢复说明 |

## 已移除

- DeepSeek `wrapTextResponse` 硬编码 generic「小佛助手」卡
- 普通对话的 Evidence / 完整 Run 卡 / 四个大反馈按钮（改为 👍👎···）

## Feedback 协议

```js
{ style: "compact", primary: ["helpful","not_helpful"], detailOnNegative: [...] }
```

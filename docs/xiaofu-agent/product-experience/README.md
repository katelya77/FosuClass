# 小佛助手产品体验交付

## 审计

见 `../product-experience-audit.md`。

## 设计系统

Token 源：`miniprogram/packageXiaofu/styles/xiaofu-tokens.wxss`

| Token 类 | 用途 |
|----------|------|
| `--xf-bg` / `--xf-surface` | 页面背景、Surface |
| `--xf-primary` | 用户气泡 / 主操作（品牌红，克制使用） |
| `--xf-text` / `--xf-text-secondary` | 正文与次要信息 |
| `--xf-success` / `--xf-warning` / `--xf-danger` | 语义色 |
| `--xf-radius-*` / `--xf-space-*` / `--xf-font-*` | 圆角、间距、字号 |

## 组件

| 组件 | 职责 |
|------|------|
| 页面 `ai-assistant` | 协调、发送、记忆、对话状态 |
| `xiaofu-settings-sheet` | 统一更多设置 |
| `xiaofu-memory-sheet` | 记忆模式 |
| `xiaofu-conversation-sheet` | 对话列表（搜索/置顶/更多） |
| `xiaofu-result-card` | 结果卡（≤2 操作） |
| `xiaofu-live-run` / `xiaofu-agent-run` | 真实 Run Event 轨迹 |

## Services

| 文件 | 职责 |
|------|------|
| `xiaofuPresentationAdapter.js` | 状态组合、卡片/建议上限、plain 判定 |
| `xiaofuMessageActions.js` | 长按菜单、安全分享 |
| `xiaofuConversationViewModel.js` | 对话标题与列表 |

## 截图

`docs/xiaofu-agent/product-experience/screenshots/`

若本环境无法启动微信开发者工具 CLI，以静态结构断言 + `npm run test:xiaofu-product-experience` 为门禁；真机/开发者工具截图可在本地补传。

## 测试

```bash
npm run test:xiaofu-product-experience
npm run test:agent-foundation
npm run test:agent-regression
npm run test:agent-final-convergence
npm run test:agent-phase2
npm run test:agent-phase3
npm run test:miniprogram-package-hygiene
```

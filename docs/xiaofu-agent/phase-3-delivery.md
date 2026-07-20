# Phase 3 Delivery — Runtime Truth Layer

分支：`feat/xiaofu-agent-v2-phase3-runtime-truth`

## 1. 根因复核

| 问题 | 根因 |
|------|------|
| 模型未调用 | 多层门控：`AI_RUNTIME_MODE=public`、`AI_AGENT_ENABLED`、Provider=mock、envVersion release fail-closed、会话授权、Key 缺失；此前缺少统一 Readiness/诊断 |
| “正在查询课表”误出现 | `aiTransportRouter.callOracle` 与部分 pipeline 在任意请求开始时硬编码课表 Loading |
| 记忆 UI 仅本地 | 模式切换只写 Storage；清除云端不调 API；对话列表只读 conversationStore |
| 连接状态矛盾 | 顶部仅用 `wx.getNetworkType`，消息 Fallback 又会改写副标题为“离线” |
| Coze 原适配问题 | 固定 `fosuclass-user`、轮询不完整、无到期跳过、无 Principal 隔离、无 List Messages 提取 |

## 2. 最终架构

```text
小程序
→ POST /api/ai/agent/runs
→ Event Timeline (poll)
→ Agent Kernel → Tool / Provider
→ Verification → agent.v2 result
→ xiaofu-live-run + xiaofu-agent-run

Admin Provider Control
→ Environment Profile
→ Readiness / Diagnose Enhanced
→ Provider Chain (deepseek/coze/mock)
→ Deterministic Fallback
```

## 3. 关键修改

- 服务端：Run Events、Readiness、Memory runtime isolation、Coze V3、Admin diagnose
- 小程序：agentMemoryClient / agentRunClient / agentReadinessClient、live-run、header/memory/conversation UI
- 测试：`test:agent-phase3` 及子命令
- 文档：`docs/xiaofu-agent/*`、`AGENTS.md`、model/github env 契约

## 4. Runtime Matrix

| 模式 | 行为 |
|------|------|
| public / release | 永远 mock，无外部 Provider，无 Thinking |
| trial/dev 授权通过且 Provider 就绪 | conversational_help/project_qa 可走外部模型；事实 Intent 仍 Tool |
| Provider 失败 | 真实 degraded 事件 + 本地表达 |

## 5–8. 记忆 / Loading / Coze / UI

见：

- `conversation-memory.md` + 本阶段 memory client
- `agent-run-events.md`
- `coze-temporary-provider.md`
- `agent-ui-v3.md`

## 9. 安全证明

- public 强制 mock chain
- Run pollToken / principal 隔离
- Coze 伪匿名 user_id、到期跳过
- Event 与 readiness 裁剪敏感字段
- Token 不回传小程序

## 10. 测试证据（本机）

| 命令 | 结果 |
|------|------|
| `npm run test:agent-phase3` | 6/6 PASS |
| `npm run test:agent-foundation` | 17/17 PASS |
| `npm run test:agent-phase2` | 8/8 PASS |
| `npm run test:xiaofu-agent-ui` | PASS |
| `node tools/generate-agent-capability-compat.js --check` | PASS |
| `npm run test:ai-competition` | 末尾 `test:miniprogram-package-hygiene` 因包体约 2.10MB 超 2MB 失败（接近上限；改动前已近界）。其余 AI/Agent 子项已通过 |

## 11. Git

- 分支：`feat/xiaofu-agent-v2-phase3-runtime-truth`
- 未合并 main
- 未部署生产

## 12. 未完成 / 限制

- 微信开发者工具真机截图：本环境未跑微信 IDE，需用户按清单复测
- Coze Live Token：未执行（需企业 Token）
- 管理后台 Coze 完整表单向导 UI：已提供诊断 API + 配置键；Legacy 页可继续接按钮
- 第四阶段：混合 RAG / Embedding / 动态 Planner

## 回滚

```text
git checkout main
git branch -D feat/xiaofu-agent-v2-phase3-runtime-truth
```

# 小佛助手 Agent V2 Final Convergence — 交付报告

## 1. 基线与 Git

| 项 | 值 |
|----|-----|
| 起始 SHA | `dbc713aa8046555832d5c0d948b6bf59f7668cd9` |
| 分支 | `feat/xiaofu-agent-final-convergence` |
| 是否合并 main | 否 |
| 是否部署生产 | 否 |

## 2. 已知缺陷修复

| 缺陷 | 处理 |
|------|------|
| Conversation not found | `setMemoryPolicy` / `patchConversation` 安全 Upsert，`createIfMissing`，revision 从 1 起 |
| 英文错误 | `agentClientErrorMapper` + memory client 全路径映射 |
| 记忆原子性 | 服务端成功后再写 Storage；失败回滚；`memorySwitching` 防连点 |
| 取消 Run | `status===cancelled` / `cancelled:true` 不 persist |
| 重复卡片 | Response Composer + DeepSeek 去 generic 卡 |
| 顶部过重 | compact header，去掉页内大号标题 |

## 3. 最终架构

```
User → Runtime Policy → Memory Context → Intent/Slot
  → Deterministic | Model Planner → Skill/Tool
  → Observation → Verify / Replan(≤1)
  → Hybrid Retrieval (知识) → Response Composer → Mini-program
```

## 4. Runtime Matrix

| 能力 | public | trial | dev |
|------|--------|-------|-----|
| 外部 Provider | 禁止 | 允许 | 允许 |
| modelPlanner | 否 | 可 | 可 |
| 一般学习/代码 | 否 | `AI_GENERAL_ASSISTANT_ENABLED` | 默认开（可关） |
| Hybrid vector | 可退化 | 可 | 可 |

## 5–11. 模块摘要

见同目录 `planner-and-observation-loop.md`、`hybrid-rag.md`、`response-composer.md`、`final-ui.md`。

Coze：后台向导文案强化（Token 非账号密码）；非强制依赖；无真实企业 Token 时用 Mock 路径。

## 12. 测试证据

已跑通：

| 命令 | 结果 |
|------|------|
| `npm run test:agent-final-convergence` | all passed |
| `npm run test:agent-foundation` | 17/17 |
| `npm run test:agent-regression` | 90/90 |
| `npm run test:agent-phase2` | 8/8 |
| `npm run test:agent-phase3` | all passed |

### 改动前已存在 / 环境限制

- `test:miniprogram-package-hygiene`：main 基线已超过 2MB（约 2.108MB），本分支仍超限（约 2.121MB）。属改动前已存在的包体预算问题，未为通过测试放宽门禁。
- 微信开发者工具真机视觉验收：当前自动化环境未执行；已提供静态 UI 测试与人工复测清单。
- Coze 真实企业 Token Live Test：无真实 Token，未对生产凭据执行。

## 13. 未完成（仅允许项）

- 缺少真实 Coze 企业 Token（Live Test 未对生产 Token 执行）
- 当前环境未做微信开发者工具真机截图；已提供布局/静态 UI 测试与人工复测清单（见 final-ui / final-evaluation）
- 后续可新增校园 Tool 与知识文档，**不再**需要 Phase 5 地基重构

## 14. 回滚

```bash
git checkout main
# 或
git revert <convergence-commit>
```

不部署生产；仅功能分支可推送。

# Agent 最终评估

## 命令

```bash
npm run test:agent-final-convergence
npm run test:agent-planner
npm run test:agent-observation-loop
npm run test:hybrid-rag
npm run test:response-composer
npm run test:memory-upsert
npm run test:xiaofu-final-ui
npm run test:agent-e2e-matrix
npm run test:agent-foundation
npm run test:agent-regression
npm run test:agent-phase2
npm run test:agent-phase3
npm run test:ai-competition
npm run security:acceptance
node tools/generate-agent-capability-compat.js --check
```

## 关键门禁

| 门禁 | 期望 |
|------|------|
| public 外部 Provider 调用 | 0 |
| Unsupported Campus Fact | 0 |
| 普通对话 Generic Card | 0 |
| Conversation not found 复现 | 通过（Upsert） |
| 多步骤 Tool 选择 | 通过 |
| 敏感数据 | 通过 |

## 场景覆盖（e2e matrix + planner）

- 寒暄 plain
- 教学周事实
- 教师课表追问
- 多步骤自习+天气
- 空教室 replan
- Hybrid RAG 注入过滤
- 中文错误映射

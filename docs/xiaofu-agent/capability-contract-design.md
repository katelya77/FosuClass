# Capability Contract 统一生成链设计

状态：已实现（Phase A，feat/xiaofu-agent-coze-native-actions）
关联：agent-capability-manifest.json、AGENTS.md 铁律

## 1. 问题

改动前存在多个平行能力真相源：

| 位置 | 角色 | 问题 |
| --- | --- | --- |
| `server/config/agent-capability-manifest.json` | 服务端权威 Manifest（29 tools / 23 skills / 29 intents） | 唯一成熟，但只被服务端消费 |
| `miniprogram/.../ai-assistant.js` 内 `AI_CAPABILITY_REGISTRY` | 小程序快捷能力注册表（约 365 行硬编码） | 与 Manifest 平行维护，易漂移 |
| `tools/generate-agent-capability-compat.js` | 旧生成器 | 只生成 1 份小程序 Intent 兼容文件，覆盖面极窄 |
| Coze Tool 配置、能力文档、测试 | 手工维护 | 无漂移检查 |

## 2. 目标数据流

```
server/config/agent-capability-manifest.json  （唯一真相源）
  └─ node tools/generate-capability-contract.js
      ├─ miniprogram/shared/agentCapabilityCompat.generated.js   小程序 Intent 兼容（历史产物，字节兼容）
      ├─ server/src/services/ai/generated/toolSchemas.generated.js  LLM Tool Schema（Planner / Coze 共用）
      ├─ miniprogram/shared/agentActionCatalog.generated.js        Action Command Catalog
      ├─ server/config/coze-tool-gateway.openapi.json              Coze Tool Gateway OpenAPI 3.0
      ├─ docs/xiaofu-agent/capability-contract.generated.md        能力文档
      └─ tools/capability-contract/contract-matrix.generated.json  机器可读测试矩阵
```

漂移门禁：`node tools/generate-capability-contract.js --check`（逐字节比对，产物不含时间戳）。
接入点：`test:capability-contract` → `run-agent-foundation-tests.js` 首项 → `test:agent-release-gate` → CI。
Manifest 改动后未重新生成 → foundation 门禁直接失败。

## 3. Action Command 安全模型（Manifest `actions` 段）

8 类 Action，模型只能引用、不能发明：

| Action | operation | confirmation | 说明 |
| --- | --- | --- | --- |
| navigate | read | none | 仅白名单页面（page_url_whitelist），禁任意 URL |
| openSheet | read | none | 面板枚举白名单（reminders/memory/conversations/tasks） |
| fillComposer | read | none | 填入输入框，绝不自动发送 |
| fillForm | read | none | 白名单表单字段，绝不自动提交 |
| copy | read | none | 复制到剪贴板 |
| retry | read | none | 仅重试原本安全的只读任务 |
| requestSubscribe | write | required | 微信订阅授权，仅 course_reminder 场景 |
| confirmWrite | write | required | 写操作确认卡，用户点击后才执行 |

规则（由 test-capability-contract.js 断言）：
- 读取类自动执行；写类必须 `confirmation: required`；`double` 预留给未来的删除/清空类。
- 任何 runtime mode 下写工具（含 `create_course_reminder`）都必须 confirmation ≠ none：只能返回确认请求，绝不直接执行。
- public 模式外部 Provider 调用恒为零的约束不变（由 test-public-ai-safety 等既有测试保障）。

## 4. 关键决策

1. **扩展而非替换旧生成器**：`agentCapabilityCompat.generated.js` 保持字节兼容，旧测试 `generate-agent-capability-compat.js --check` 与新检查同时有效；旧脚本保留不删，新链为唯一权威。
2. **产物无时间戳**：否则 --check 永远漂移。
3. **Tool Schema 携带 `x-fosu-safety`**：把 operation/confirmation/runtimeModes 随 Schema 一起下发给 Planner 和 Coze，安全策略不离散。
4. **OpenAPI 写工具只声明 confirmation 语义**：Coze 侧任何写调用只能拿到确认请求（Phase C 落地 Gateway 路由时消费该文件）。
5. **AI_CAPABILITY_REGISTRY 迁移后置**：UI 注册表含图标/文案等展示层信息，将在 UI 统一阶段（Phase F）改为从 Catalog 派生能力行为 + 本地展示层，避免本次改动面过大。

## 5. 验证

- `node tools/test-capability-contract.js`：漂移检查 + Action 安全断言 + Schema/OpenAPI/矩阵一致性。
- `npm run test:agent-foundation`：含上述测试，回归既有 19 项。
- CI：`xiaofu-agent-ci.yml` paths 已补充新产物与工具路径。

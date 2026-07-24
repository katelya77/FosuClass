# Coze Native 接入指南

> 适用范围：`trial` / `dev` 环境。`public` 环境恒不启用（外部模型调用恒为零）。
> 相关文件：`server/config/coze-tool-gateway.openapi.json`（生成产物，请勿手改）

## 1. 架构位置

```
Coze Agent（扣子平台）
    │  工具调用（OpenAPI 插件）
    ▼
POST /api/coze/tools/:toolId      ← Coze Tool Gateway（本服务）
    │  Bearer Token 鉴权 + 工具白名单 + confirmation-only
    ▼
server/src/services/ai/toolRegistry.js（与内置小佛助手共用同一工具实现）
```

- 小程序内置小佛助手走自有 Provider Chain（public→mock 强制，非 public→链式 fallback），**不经过** Gateway。
- coze-native 模式指：把 Coze 平台创建的 Agent 作为小佛助手的"外部编排大脑"，通过 Gateway 调用与内置 Agent 完全相同的 29 个工具，实现真实工具编排而非纯文本问答。

## 2. 服务端配置

| 环境变量 | 值 | 说明 |
| --- | --- | --- |
| `COZE_TOOL_GATEWAY_ENABLED` | `true` | 总开关，缺省/其他值 = 关闭（503） |
| `COZE_TOOL_GATEWAY_TOKEN` | 强随机字符串 | Bearer Token，只存服务端与 Coze 插件鉴权配置，不进仓库/日志/小程序 |

安全语义（由 `cozeToolGatewayService` 强制，无需人工保证）：

1. **默认关闭**：开关与 Token 缺一即 503/401。
2. **工具白名单**：仅 `agent-capability-manifest.json` 中 `runtimeModes` 含 `trial` 的工具可调；未知工具 404。
3. **写操作 confirmation-only**：写工具（如 `create_course_reminder`）只返回"待确认计划 + confirmationRequest"，Gateway 绝不执行真实写入。
4. **零个人上下文**：Gateway 调用不携带任何用户课表/身份数据；需要个人上下文的工具自然返回 `needContext`。
5. **请求体限制**：超过 `toolGateway.maxBodyBytes`（默认 16KB）直接 413。

## 3. Coze 平台侧配置步骤

1. 扣子平台 → 目标 Bot → **插件** → 创建插件 → **基于 OpenAPI 导入**。
2. 导入 `server/config/coze-tool-gateway.openapi.json`（由 `node tools/generate-capability-contract.js` 生成，`servers[0].url` 已指向线上 Gateway）。
3. 插件**鉴权方式**选 `Service` / `Bearer Token`，填入与 `COZE_TOOL_GATEWAY_TOKEN` 相同的值。
4. 发布插件并挂载到 Bot；Bot 人设中声明：写操作必须先向用户复述确认请求，得到肯定答复后再继续。
5. 联调：在 trial 环境发"查今天空教室"，应观察到 Coze 触发 `search_empty_rooms` 工具调用并返回结构化结果。

> 注意：每次修改 manifest 的工具定义后，必须重新生成并**重新导入** OpenAPI，否则 Coze 侧 Schema 与服务端漂移。CI 的 `test-capability-contract` 会拦截服务端漂移，Coze 侧漂移靠本流程约束。

## 4. 与 Provider Chain 的关系

- `cozeProvider`（`providers/cozeProvider.js`）保持原状：它负责"调 Coze Bot 拿文本答案"，是 Provider Chain 的 fallback 成员。
- Gateway 是**反向**通道：Coze 主动调我们的工具。两者互不依赖，可独立开关。
- public 环境两者都不可用：`providerFactory` 强制 mock；Gateway 在白名单上不含 public-only 语义，且线上开关应保持关闭。

## 5. 验证命令

```bash
node tools/test-coze-tool-gateway.js     # Gateway 单测（鉴权/白名单/confirmation-only/OpenAPI 一致性）
npm run test:agent-foundation            # 全量基础门禁
```

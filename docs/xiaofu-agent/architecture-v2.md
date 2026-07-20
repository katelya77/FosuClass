# 小佛助手 Agent V2 架构（含 Phase 2）

## 1. 阶段目标

- **Phase 1**：服务端单一 Kernel、Manifest、协议 V1/V2、Offline Fallback。
- **Phase 2**：身份隔离会话记忆、Agent 执行 UI、知识库控制面加固与本地 MCP。

## 2. 在线调用流

```text
小程序
→ Session（可选/按安全模式）
→ Principal（仅服务端）
→ Conversation Memory（按 mode）
→ Agent Kernel
→ Skill / Tool（确定性事实）
→ V2 Response（含 steps/memory/evidence）
→ Agent UI
```

离线时：

```text
Transport 失败
→ Offline Fallback Router
→ 本地课表/规则/入口
→ fallback=true 统一响应
```

## 3. 知识库控制流

```text
Codex/Grok
→ stdio MCP
→ Scoped Admin API
→ Knowledge Control Plane
→ Draft
→ Validation / Diff
→ 人工 Publish / Rollback
```

## 4. 运行模式

| 模式 | 生成式 Provider | 事实源 |
| --- | --- | --- |
| public | 零调用 | Release Pack + 确定性工具 |
| trial/dev | 仅表达层，Manifest 授权 | 同上，模型不得覆盖事实 |

## 5. 模块地图

| 边界 | 路径 |
| --- | --- |
| Conversation | `server/src/services/ai/conversation/*` |
| Agent Service/Kernel | `agentService.js` / `agentKernel.js` |
| Protocol | `agentProtocol.js` |
| KB Control Plane | `knowledgeControlPlane.js` |
| MCP | `tools/fosu-kb-mcp/server.js` |
| UI | `miniprogram/pages/ai-assistant/*` + `components/xiaofu-*` |

## 6. 安全不变量

- 不信任客户端 conversationId 作为所有权
- 不存完整个人课表与凭证
- public 零生成式 Provider
- MCP 无 publish/rollback，无直读写 JSON 文件

# Runtime Truth Layer（Phase 3）

## 目标

消除“界面显示状态”与“服务端真实执行状态”的断层：

1. 记忆 UI 真正连接服务端
2. Loading 来自真实 Run Events
3. 顶部状态来自 Readiness，而不是单纯网络类型
4. trial/dev 模型调用可诊断、可降级
5. Coze 作为临时 Provider 正确接入

## 架构

```text
小程序
  → POST /api/ai/agent/runs
  → GET  /api/ai/agent/runs/:runId (poll events)
  → Agent Kernel / Tool / Provider
  → result (agent.v2)
  → xiaofu-live-run + xiaofu-agent-run

Admin
  → Provider Profiles (public/trial/dev)
  → Readiness Matrix / Diagnose Enhanced
  → Provider Chain (deepseek/coze/mock)
```

## 关键接口

| 接口 | 作用 |
|------|------|
| `GET /api/ai/agent/readiness` | 客户端安全 Readiness 快照 |
| `POST /api/ai/agent/runs` | 创建异步 Run |
| `GET /api/ai/agent/runs/:runId` | 轮询事件与结果 |
| `POST /api/ai/agent/runs/:runId/cancel` | 取消 Run |
| `GET/PATCH/DELETE /api/ai/agent/conversations*` | 记忆闭环 |
| `DELETE /api/ai/agent/memory` | 清除全部云端记忆 |
| `POST /api/admin/ai-provider/diagnose-enhanced` | 管理员一键诊断 |

兼容路径：`POST /api/ai/agent/chat` 仍保留。

## 状态机

- `network_offline`
- `server_unreachable`
- `public_ready`
- `enhanced_ready`
- `enhanced_degraded`

消息级 Provider Fallback 不得把顶部标成“离线”。

## 安全

- public 永远不调用生成式 Provider
- Run Event 不含 CoT / Prompt / 原始 Observation / OpenID / Key
- Run 访问需要 Session Principal 或高熵 pollToken
- 服务重启后内存 Run 失效

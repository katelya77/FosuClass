# 小佛助手会话记忆（Agent V2 Phase 2）

## 目标

服务端具备**身份隔离**的会话状态，而不是信任客户端 `conversationId` 作为所有权凭据。

## Principal

认证成功时由服务端 Session 生成：

```text
principalType: wechat
principalKey: HMAC(FOSU_AGENT_MEMORY_SECRET, appid + openidHash + runtimeMode + deployEnv)
authenticated: true
```

- 不写原始 OpenID
- 客户端不能覆盖 principalKey
- 同一 OpenID + AppID + 运行模式在不同 session 下仍映射同一 Principal
- 无 Session：`memory.mode = local_only`，`persisted = false`

## 记忆模式

| 模式 | 条件 | 服务端保存 |
| --- | --- | --- |
| `local_only` | 默认 / 无 Session / 用户选择 | 不持久化 |
| `session_state` | 认证后默认 | 槽位、追问、摘要、Evidence 引用 |
| `cloud_sync` | 用户显式开启 | 上述 + 有限脱敏 recentTurns |

## 存储

```text
FOSU_DATA_DIR/ai/conversations/{principalShard}/{conversationIdHash}.json
```

接口：`get/create/list/update/delete/clearPrincipal/pruneExpired/migrate`

能力：revision 乐观锁、TTL、容量上限、损坏隔离、Schema 迁移。

## 上下文合并优先级

```text
当前请求时间/页面
→ 本轮消息明确槽位
→ 服务端 ConversationState
→ 客户端兼容槽位
→ 默认值
```

## API

```text
GET    /api/ai/agent/conversations
GET    /api/ai/agent/conversations/:id
PATCH  /api/ai/agent/conversations/:id
DELETE /api/ai/agent/conversations/:id
DELETE /api/ai/agent/memory
POST   /api/ai/agent/memory-policy
```

均需有效小程序 Session；响应不暴露 principalKey / openidHash。

## 隐私边界

保存：canonical 槽位、任务摘要、evidenceRefs、可选脱敏 recentTurns  
不保存：完整个人课表、学号密码 Cookie Token、原始 XLS、系统 Prompt、隐藏推理

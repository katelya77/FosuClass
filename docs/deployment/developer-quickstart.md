# 外部开发者快速启动：standalone 小佛 Agent 平台

面向外部开发者：在 standalone 部署的平台上创建声明式 Skill、注册受控
Tool/MCP、上传知识库、创建 Run 并消费 RunEvent 与通用 UI Schema。

- 部署与运维：[deploy/standalone/README.md](../../deploy/standalone/README.md)、
  [1panel.md](./1panel.md)、[oracle-arm.md](./oracle-arm.md)
- 默认基址：`http://127.0.0.1:8080`（经反向代理后为你的站点域名）
- 协议细节：[docs/xiaofu-agent/agent-run-events.md](../xiaofu-agent/agent-run-events.md)、
  [capability-contract-design.md](../xiaofu-agent/capability-contract-design.md)、
  [kb-control-plane-v2.md](../xiaofu-agent/kb-control-plane-v2.md)、
  [mcp-knowledge-control-plane.md](../xiaofu-agent/mcp-knowledge-control-plane.md)

## 0. 边界（先读）

- 平台只执行**声明式配置**与**白名单内受控 Tool/MCP**；不 `eval`、不动态加载
  未审计的 JS。任何“上传代码让平台跑”的诉求都不在支持范围。
- 六个配置域（Provider / Skill / Tool / MCP / RAG 知识库 / Memory）统一走
  config-plane 的 `draft → validate → test → publish` 流水线；`rollback` 可回退
  到任一已发布版本。发布、回滚、批量删除属高风险操作，需要管理员凭据并留审计。
- 课表等校园事实只能来自确定性 Tool 与 Release Pack，生成式模型不得充当事实源；
  public 模式零外部 Provider 调用。

## 1. 准备凭据

- 管理面（config-plane、Admin UI）：管理员凭据（`AGENT_PLATFORM_ADMIN_TOKEN`
  Bearer，或细粒度 `AGENT_PLATFORM_SERVICE_TOKENS`）。Admin UI 在 `/admin/agent-platform`。
- 运行面（Run API）：按部署方策略（公开或会话）；本地默认直连即可。

下文示例统一：

```bash
BASE=http://127.0.0.1:8080
ADMIN=Authorization:Bearer <AGENT_PLATFORM_ADMIN_TOKEN>
```

## 2. 创建声明式 Skill

Skill 是纯 JSON 声明，经 config-plane 草稿 → 校验 → 测试 → 发布：

```bash
# 1) 写草稿（domain=skill）
curl -X PUT $BASE/api/admin/agent-platform/config/draft -H "$ADMIN" \
  -H 'Content-Type: application/json' -d '{
    "domain": "skill",
    "artifactId": "campus-faq",
    "environment": "trial",
    "payload": {
      "skills": [{
        "id": "campus.faq",
        "version": "1",
        "description": "校园常见问题问答（RAG 引用必答）",
        "supportedGoals": ["campus.faq"],
        "requiredSlots": [],
        "optionalSlots": ["topic"],
        "allowedTools": ["knowledge.search"],
        "runtimeModes": ["public", "trial"],
        "outputBlockTypes": ["markdown", "list", "detail"],
        "providerPolicy": "deterministic_first",
        "fallbackPolicy": "clarify"
      }]
    }
  }'

# 2) 校验 / 3) 发布前测试 / 4) 发布（同一 domain+artifactId）
curl -X POST $BASE/api/admin/agent-platform/config/validate -H "$ADMIN" \
  -H 'Content-Type: application/json' -d '{"domain":"skill","artifactId":"campus-faq","environment":"trial"}'
curl -X POST $BASE/api/admin/agent-platform/config/test     -H "$ADMIN" -d '...同上...'
curl -X POST $BASE/api/admin/agent-platform/config/publish  -H "$ADMIN" -d '...同上...'

# 出问题时回滚到指定版本
curl -X POST $BASE/api/admin/agent-platform/config/rollback -H "$ADMIN" \
  -H 'Content-Type: application/json' -d '{"domain":"skill","artifactId":"campus-faq","environment":"trial","version":1}'
```

Skill 字段以 `POST .../config/validate` 的校验结果为权威；上方骨架覆盖
`id/version/description/supportedGoals/requiredSlots/optionalSlots/allowedTools/
runtimeModes/outputBlockTypes/providerPolicy/fallbackPolicy`。平台内置至少一个
只读示例 Skill，可在 Admin UI 的 skill 域查看其完整声明作为模板。

## 3. 注册受控 Tool / MCP

- Tool（`domain=tool`）：声明 `id`、入参 JSON Schema、出参 Schema、超时与
  `runtimeModes`；只能绑定平台白名单内的执行器（内置确定性 Tool 或已注册
  MCP 的能力面）。Schema 不合法在 validate 阶段即拒绝。
- MCP（`domain=mcp`）：只注册**远程只读** MCP 端点与能力清单；远程可写 MCP、
  知识库 publish/rollback 类高风险能力不在注册范围（边界见仓库 AGENTS.md）。
- 骨架与字段口径以 validate 返回与
  [capability-contract-design.md](../xiaofu-agent/capability-contract-design.md) 为准。

## 4. 上传并发布知识库（RAG）

1. 在 Admin UI（`/admin/agent-platform`，知识库域）上传文档；摄取、分块、
   索引进 worker 队列异步完成（Embedding 不可用时自动退化为词法检索）。
2. 经 `domain=rag` 的 draft/validate/test/publish 发布一个知识库版本；
   发布后查询必带**引用（citation）**，无引用不答。
3. 只覆盖公开知识；课表等结构化事实禁止向量化进 RAG。

## 5. 创建 Run 并消费 RunEvent

```bash
# 创建 Run（同步返回 runId 与首批事件；idempotencyKey 防重）
curl -X POST $BASE/api/ai/agent/runs -H 'Content-Type: application/json' -d '{
  "message": "新生报到流程是什么？",
  "context": {"goal": "campus.faq"},
  "protocolVersion": "agent.v1",
  "idempotencyKey": "demo-0001"
}'

# 轮询恢复：按 cursor 增量取事件（断线重连同一接口）
curl "$BASE/api/ai/agent/runs/<runId>?cursor=<lastEventId>"

# 取消（端到端真实传播）
curl -X POST $BASE/api/ai/agent/runs/<runId>/cancel
```

事件流约定（细节见 agent-run-events.md）：

- 事件带稳定 `eventId` 与严格单调 `sequence`；客户端按 cursor 幂等消费，
  状态不重复、不回退。
- 终态事件四选一：`run.completed` / `run.degraded` / `run.failed` / `run.cancelled`，
  终态不可覆盖。
- Loading/Thinking 状态只来自服务端真实 Run Events；客户端不得自行猜测
  “正在查询课表”之类的阶段。

## 6. 通用 UI Schema

Run 结果以通用 UI Block 表达，前端按 `type` 渲染、未知类型安全 fallback。
当前 12 类：`text` / `markdown` / `plan` / `tool_progress` / `list` / `detail` /
`schedule` / `clarification` / `confirmation` / `action_receipt` / `warning` / `error`。
你的 Skill 只能输出其在 `outputBlockTypes` 中声明的类型；新增声明式 Skill
不需要平台前端做任何改动即可渲染。

## 7. Provider 插件

- Provider 配置（`domain=provider`）只声明 `id`、类型、`baseUrl`、`model` 与
  凭据引用；**凭据本体只经环境变量/Secret 注入**（见
  [deploy/standalone/.env.example](../../deploy/standalone/.env.example)），
  不进草稿、不进日志、不进 Trace。
- 未配置 Provider 时：public 模式照常提供确定性能力；trial/dev 的
  strict_model_first 在 readiness 中如实 `not_ready`。平台不会用 Mock 冒充
  真实 Provider readiness。

# P4c Evidence — Governed MCP Runtime and Publication

日期：2026-07-31（本地分支 `codex/xiaofu-agent-product-platform`）
范围：tasks.md P4c（`packages/mcp-runtime`、MCP 发布域、治理收口）。

## 1. 交付内容

### 1.1 `packages/mcp-runtime`（通用包，无校园业务耦合，无外部依赖）

| 模块 | 职责 |
| --- | --- |
| `src/jsonRpc.js` | 最小 JSON-RPC 2.0 原语：请求构造、响应校验、RPC 错误码分类（-32601/-32602/-32600 不可重试语义）、SSE 帧解析 |
| `src/transports.js` | Streamable HTTP（POST + application/json 或 text/event-stream 响应、Mcp-Session-Id 透传、URL 校验：仅 https 公网，回环 http 需显式开发开关）；受控 stdio（shell:false + 参数数组、命令按名解析绝对路径、子进程环境仅白名单变量、每次调用独立进程） |
| `src/mcpRuntime.js` | 注册表解析（快照传入）→ 握手 → 工具发现（Schema 缓存 5min）→ 治理链调用；超时/取消分类；输出裁剪；会话缓存（仅不透明会话 id，非凭据） |
| `src/mcpPublicationAdapter.js` | Config Kernel 第 5 域适配器：声明式 Server 注册表（id/transport/url/command/args/envAllowlist/authEnvVar/allowedTools/writeTools/enabled/runtimeModes/timeoutMs） |

### 1.2 治理不变量（全部有测试锁定）

- **鉴权只按引用**：`authEnvVar` 存环境变量【名】（大写标识符模式锁死）；值在调用时读取、只进 Authorization 头；发布物/descriptor/缓存/日志/错误消息中无密钥（深度密钥扫描，仅豁免两个引用名字段）。
- **发现 ≠ 可用**：MCP 发现的 Tool 必须在注册白名单 `allowedTools` 内才可调用；白名单外工具 `MCP_TOOL_NOT_ALLOWED`。
- **写操作闭环**：`writeTools`（⊆ allowedTools）列名工具必须携带确认回执（receiptId），否则 `MCP_WRITE_CONFIRMATION_REQUIRED`。
- **Schema 校验链**：参数过发现 inputSchema 校验（复用 tool-runtime validateAgainstSchema）；失败 `MCP_ARGS_INVALID`。
- **准确降级**：未注册 `MCP_SERVER_NOT_REGISTERED`、禁用 `MCP_SERVER_DISABLED`、模式拒绝 `MCP_SERVER_MODE_DENIED`、工具下线 `MCP_TOOL_UNAVAILABLE`、超时 `MCP_TIMEOUT`、取消 `MCP_ABORTED`、429 `MCP_RATE_LIMITED`、5xx `MCP_UPSTREAM_HTTP`、401/403 `MCP_AUTH_FAILED`——每类独立断言。
- **受控 stdio**：命令必须 ∈ 注入受信集（platformComposition 从部署方环境变量 `AGENT_MCP_TRUSTED_COMMANDS` 读取名→绝对路径映射，默认空集 = stdio 永远不可激活，fail closed）；无 shell；未受信命令 `MCP_COMMAND_NOT_TRUSTED`。
- **Server 更新只影响新 Run**：注册表经快照绑定（`resolveMcpRegistryForSnapshot`，与其他四域同一 fail-closed 记忆化模式，`MCP_REGISTRY_UNREADABLE`）；在途 Run 快照不可变。

### 1.3 桥接工具（校验链入口）

`server/src/services/ai/mcpBridgeTool.js`：`createMcpBridgeTool({resolveRegistry, mcpRuntime})` 产出 tool-runtime 描述符（id `mcp_call`，inputSchema serverId/toolName/args/confirmation，静态 safety 保守姿态 write+requiresConfirmation）。测试以**真实 AgentKernel + toolRuntime + 五因子交集**证明：manifest 未列入时桥接被交集排除；列入后 `invokeTool` 全链成功、写治理端到端生效。

**生产激活（明确边界）**：把桥接描述符加入 `platformToolRuntime` + Manifest intent + Planner 提示属于 P4e 后台控制面按环境启用的动作，本阶段不做（保持最小侵入与 public 零风险）；链入口已由一致性测试证明。此项在 P4e tasks 继续跟踪。

### 1.4 platformComposition 接线

- `mcp` 域注册进同一 configKernel；种子空注册表（≡ P4c 前无 MCP 能力）；五域同 artifactId、各自 digest。
- `resolveMcpRegistryForSnapshot` + `getMcpRuntime()` 导出；`platformMcpRuntime` 单例（trustedCommands/allowInsecureHttp 来自部署方环境变量，发布物无法扩大）。

### 1.5 `tools/fosu-kb-mcp` 治理收口

既有 `tools/test-kb-mcp.js` 已锁定：不注册 `kb_publish`/`kb_rollback`/`kb_delete_published`、FORBIDDEN 集合、只走受保护后台 API（token 仅 env、日志脱敏）。本阶段复跑 PASS，作为收口证据，不改动该工具。

## 2. 测试证据

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| MCP 治理链 | `npm run test:agent-mcp-runtime` | PASS（6 组：happy path 含 session/bearer、治理 6 例+写确认、超时/取消/429/5xx/401、SSE+裁剪、受控 stdio、真实五因子桥接） |
| MCP 发布专项 | `npm run test:agent-mcp-publication` | PASS（19 组拒绝用例 + 发布前守卫 + 组合级 roundtrip） |
| 统一 conformance | `npm run test:domain-adapter-conformance` | PASS（5 域 × 同一契约） |
| kb-mcp 收口 | `npm run test:kb-mcp` | PASS |
| 聚合 | `npm run test:agent-platform-p4c` | PASS |
| 边界守卫 | `node tools/test-agent-generic-package-boundaries.js` | PASS（mcp-runtime 无 Fosu 字样、env 名不含 FOSU） |

mock MCP Server 为测试内真实 loopback HTTP 服务（127.0.0.1 随机端口）；未触达任何真实外部 MCP 服务器。

## 3. 验收对照（tasks.md P4c）

- [x] `packages/mcp-runtime`：Streamable HTTP 优先、受控 stdio（白名单命令，无任意 shell）、注册、鉴权、工具发现、Schema 缓存、scope、超时取消、写确认。
- [x] MCP 发现的 Tool 必须进入 Manifest/权限/Schema 校验链（桥接描述符 + 真实五因子一致性测试；生产激活见 §1.3 边界）；写操作进确认闭环（receiptId 门控）。
- [x] Server 更新只影响新 Run（快照绑定）；不可用准确降级（错误分类）；鉴权信息不进 Artifact/Trace/导出。
- [x] 收口 `tools/fosu-kb-mcp` 治理（既有测试锁定 publish/rollback 缺席 + 受保护 API only，复跑通过）。

## 4. 提交

`feat(agent): add governed MCP runtime`（门禁全量结果见提交信息与 tasks.md 勾选）。

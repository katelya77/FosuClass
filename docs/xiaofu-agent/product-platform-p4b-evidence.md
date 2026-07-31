# P4b Evidence — Core Domain Hot-Publish Adapters

日期：2026-07-31（本地分支 `codex/xiaofu-agent-product-platform`）
范围：tasks.md P4b（Provider/Skill/Tool/Memory 四域接入 P4a 配置发布内核）。

## 1. 交付内容

### 1.1 三个新域适配器（packages/，通用、无 Fosu 耦合）

| 适配器 | 文件 | 发布物形态 | 安全不变量 |
| --- | --- | --- | --- |
| Provider | `packages/provider-runtime/src/providerPublicationAdapter.js` | 声明式 overlay：providerChain / stageProviders / model / 预算 / executionPolicy / baseUrlOverrides | 深度密钥扫描（白名单字段名豁免）；Provider id ⊆ 注入已知集；URL 仅 https 公网；deterministic 不可发布 |
| Tool | `packages/tool-runtime/src/toolPublicationAdapter.js` | `{tools:[{id,enabled?,runtimeModes?}]}` | id ⊆ 静态描述符集；只能禁用/收窄；safety 元数据不可改；发布前测试拒绝全量禁用 |
| Memory | `packages/agent-runtime/src/memoryPolicyPublicationAdapter.js` | `{ttlOverridesMs?,minConfidence?,pendingTtlMs?,termScopeTtlMs?,maxRetrieve?}` | 全部有界数值；TTL 键 ⊆ 注入白名单；无内容载体字段；termScope ≥ pending 顺序约束 |

种子均为空 overlay ≡ P4b 前静态行为（已验证：三域种子解析 `{}` / `{disabled:[],modeOverrides:{}}`）。

### 1.2 服务端接线

- `server/src/services/ai/platformComposition.js`
  - 三适配器注册进同一 `configKernel`（`domainAdapters: {skill, provider, tool, memory}`）；种子四域同 artifactId、各自 digest；
  - `resolveProviderOverlayForSnapshot` / `resolveToolOverlayForSnapshot` / `resolveMemoryPolicyForSnapshot`：与 Skill 目录同一不变量——按 (environment, version) 记忆化、发布/回滚只影响新 Run、版本不可读 fail closed（`PROVIDER_CONFIG_UNREADABLE` / `TOOL_CONFIG_UNREADABLE` / `MEMORY_POLICY_UNREADABLE`，失败不缓存）。
- `server/src/services/ai/runtime/fosuTurnPorts.js`
  - Provider overlay 经 `overlayToRuntimeConfig` 合并进运行时配置（白名单 AI_* 键，单一事实源在 provider-runtime）；
  - **public 硬护栏最后重应用**（`applyProviderHardGuards`，导出供专项测试直接锁定）：任何 overlay 在 public 环境仍 `AI_AGENT_ENABLED=false / AI_PROVIDER=mock / AI_PROVIDER_POLICY=tool-only`；
  - Memory 策略经快照绑定注入当次 Turn：`loadConversationMemory` / `handlePersonalMemoryTurn` / 两处 `attachMemory` 均透传 `policy`；
  - Tool overlay 经 `authoritativeToolContext.toolOverlay` 传入内核授权通道（不进入语义 context）。
- `server/src/services/ai/agentKernel.js`
  - 五因子交集的 `runtimeToolIds` 因子应用 overlay：disabled 排除、modeOverrides 收窄；交集语义保证 overlay 永远无法新增/复活工具。
- Memory 策略参数化（零行为变化默认路径）：`memoryPolicy.js` / `memoryRetriever.js` / `userMemory.js` / `memoryController.js` / `personalMemoryInterpreter.js` / `memoryCoordinator.js` 全部接受可选 `policy` 尾参（默认 null = 静态常量）。

### 1.3 修复的实现期缺陷（RED→GREEN 过程发现）

1. Tool 适配器 TOOL_ID_PATTERN 初版仅允许 snake_case 小写段，与 tool-runtime 自身模式一致；测试夹具误用 camelCase id 后修正为真实 id 形态（`get_teaching_week` 等），模式与现状保持一致。
2. Memory 适配器 TTL_KEY_PATTERN 初版仅 camelCase，拒绝真实蛇形键（`working_entity`/`session_fact`）→ 放宽为 `[a-z][a-zA-Z0-9_]*`（真正授权控制是 knownTtlKeys 白名单）。
3. Provider 适配器密钥深度扫描误伤白名单字段 `maxTokens`（含 "token"）→ 扫描对精确白名单字段名豁免（白名单为固定常量，不含密钥载体）。
4. `overlayToRuntimeConfig(null)` 默认参不覆盖 null → 显式判空。

## 2. 测试证据

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| 统一四域 conformance | `npm run test:domain-adapter-conformance` | PASS（4 域 × 同一契约：方法集/种子默认/越权拒绝/内核闭环/在途稳定/rollback/fail-closed） |
| Provider 专项 | `npm run test:agent-provider-publication` | PASS（22 组拒绝用例；映射白名单；public 硬护栏；组合级 roundtrip） |
| Tool 专项 | `npm run test:agent-tool-publication` | PASS（含真实 AgentKernel 五因子集成：禁用/收窄生效、overlay 不可新增） |
| Memory 专项 | `npm run test:agent-memory-publication` | PASS（策略真实改变持久化门槛/TTL/检索上限；快照绑定隔离） |
| 聚合 | `npm run test:agent-platform-p4b` | PASS（上述 4 件） |
| 边界守卫 | `node tools/test-agent-generic-package-boundaries.js` | PASS（packages/ 无 Fosu 耦合） |
| Memory 零回归 | `test-agent-memory-store-reliability` / `test-agent-memory-autonomy`（28 例） | PASS |
| Phase2 | `npm run test:agent-phase2` | 11/11 PASS |
| Foundation | `npm run test:agent-foundation` | 42/42 PASS（接线后） |

release-gate（含新增 p4b 步）与其余门禁结果见 §4 提交记录。

## 3. 验收对照（tasks.md P4b）

- [x] 四域接入 P4a 内核：声明式 Schema/validate/test/publish/hot reload/rollback/审计（内核既有审计）/environment scope/失败保留最近有效（版本不可读 fail closed + 不缓存，存储修复后自愈）。
- [x] Provider：密钥只存引用（任何深度密钥字段拒绝；映射仅白名单非密钥键）；public 外部调用恒 0（运行时硬护栏最后应用 + providerChainService public 恒 ["mock"] 双保险，专项测试锁定）。
- [x] Skill：禁止 JS（payload 无可执行字段，planBuilder 只来自静态代码，P4a 已证）；只允许引用静态 Tool 集。
- [x] Tool：不绕五因子交集（overlay 只收窄 runtimeToolIds 因子，真实内核集成测试证明）。
- [x] Memory：策略发布不影响在途 Run（快照绑定隔离测试）；策略接口无内容载体（字段白名单 + 纯数值）。
- [x] 统一 domain adapter conformance suite（4 域同一契约）+ 各自专项。

## 4. 提交

`feat(agent): hot-publish core runtime domains`。

提交前门禁（本机，Node v24，Windows）：

- `npm run test:agent-regression`：159/159 PASS
- `npm run test:agent-final-convergence`：PASS
- `npm run test:agent-phase2`：11/11 PASS
- `npm run test:agent-phase3`：PASS
- `npm run test:ai-competition`：PASS
- `npm run test:agent-release-gate`：**18/18 OK**（含新增 `test:agent-platform-p4b` 步；durationMs=316349）
- `git diff --check`：OK；`npm run test:no-ai-secret-committed`：PASS

## 5. 边界与未覆盖

- Provider probe（真实健康检查/延迟/熔断面板）属 P4e 后台控制面范围，本阶段发布前测试仅做解析演习（不触达真实 Provider）。
- stageProviders 仅支持 decision/planner/response 三阶段；understanding 经 decision 别名映射（与现有 AI_DECISION_PROVIDER/AI_UNDERSTANDING_PROVIDER 双键现状一致）。
- userPreferenceService（v2 偏好存储）使用 P3 独立 TTL 体系，不经本策略通道——有意边界。
- 后台 Admin UI 对四域发布物的可视化编辑属 P4e；当前经内核 API 驱动。

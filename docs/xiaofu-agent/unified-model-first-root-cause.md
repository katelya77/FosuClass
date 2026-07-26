# 小佛助手统一模型优先链路：根因审计

> 审计日期：2026-07-26
>
> 审计基线：`fd1cf1e3`（`origin/main`）；需求给出的 `9f23f4b8` 是其祖先。
>
> 范围：服务端 Agent Kernel、Provider、会话状态、全校搜索、Action/Receipt、RunEvent、语音与小程序 Assistant UI。

## 1. 结论

当前仓库不是“能力缺失”，而是“决策入口未统一”。Teacher Search Contract、四类课表直达、Action Receipt、Working Memory、真实 RunEvent、语音权限/转写状态和 UI 几何闭环已经存在；但在线请求仍先由 `resolveRuleBackedIntent()` 用规则确定 Intent，之后模型 Planner 才获得执行机会。因此模型不是每轮语义入口，Follow-up、Provider 和页面能力虽然各自可用，却没有共同受一个严格 GoalContract 驱动。

本次不另造 Agent、Manifest 或缓存系统。正确修复是在现有服务端 Agent Kernel 前增加唯一的 Understanding Layer，并让它产出的 GoalContract 经过 Manifest 白名单 Resolver 后进入现有 Capability Router 与 Tool Executor。

## 2. 已验证为可复用的能力

| 能力 | 当前事实 | 处理决定 |
| --- | --- | --- |
| Agent Kernel / Planner / Observation Loop / Response Composer | 已存在，且 Final Convergence 测试主体通过 | 保留并前移 Understanding |
| Capability Manifest | `server/config/agent-capability-manifest.json` 是权威源 | 保留；Goal 只能解析到 Manifest Intent |
| Provider Chain | 已支持 Coze、CloudBase OpenAI 兼容模型、DeepSeek、mock，含健康与熔断状态 | 收敛为请求级统一推理入口 |
| Working Memory | 已有 currentGoal、pendingClarification、实体与约束 | 扩展 providerUsed / lastGoalContract，不另建状态库 |
| Teacher Search Contract | Client/Server schema、学院过滤、索引/缓存版本已统一 | 保留并增加 Agent GoalContract 集成证明 |
| 四类课表直达 | 教师、班级、教室、课程均可打开 schedule-view | 保留并增加端到端契约测试 |
| Action Bus / Receipt | 设置当前课表只有成功 Receipt 后才提交状态 | 保留；禁止回复层提前宣称成功 |
| Voice | 已区分隐私、录音授权、录音、转写及失败原因 | 保留状态机，统一进入 composer，不把部署等同真机可用 |
| UI Geometry | 状态岛、单 composer、composerInset 实测同步已存在 | 只修复状态来源，不重做视觉体系 |

## 3. 根因与证据

### RC-1：在线决策仍是规则优先，不是模型优先

`server/src/services/ai/agentService.js` 当前顺序为：

1. `resolveRuleBackedIntent(message, context)`；
2. `enrichIntentFromWorkingMemory(...)`；
3. 创建模型 Planner；
4. `agentKernel.execute({ intent, modelGenerate })`。

模型看到消息时，Intent 与初始 Skill 边界已经由正则/if-else 选定。Planner 能规划工具，但不能成为用户目标的第一语义解释者。这是“继续加规则仍会分裂”的直接原因。

### RC-2：现有 GoalContract 不是语义理解合同

`planner/goalContract.js` 主要描述计划/观察结果的完成判定，不是需求规定的严格 JSON：

```json
{
  "goal": "...",
  "entityType": "...",
  "entity": "...",
  "normalizedEntity": "...",
  "constraints": {},
  "followUpMode": "...",
  "confidence": 0,
  "needsClarification": false
}
```

因此模型输出与 Manifest 路由之间缺少可验证、不可携带任意 toolName 的边界。

### RC-3：Provider 配置不是请求级隔离

`providerChainService.getProviderChain()` 会先读取全局 `AI_PROVIDER_CHAIN`。当调用方只显式传入 `AI_PROVIDER=deepseek` 时，服务端加载 `.env` 后的全局 Chain 仍可覆盖该请求选择。稳定复现结果是 Planner HTTP 用例请求 DeepSeek，却先选择全局 Coze/CloudBase 链并回退为 `deterministic_fallback`。

这会同时破坏：Provider 切换、环境隔离、测试隔离、Readiness 与真实调用归因。

### RC-4：Coze 配置测试会被本机 `.env` 污染

`test-coze-provider-config` 只清理部分变量；加载 `agentService` 时 `.env` 又补入其他 Coze Token/Workload 配置，导致本应验证“未配置”的用例发起真实网络请求并超时。根因仍是“未配置显式覆盖”与“全局环境回退”没有清晰优先级，不是 Coze API 本身失败。

### RC-5：Working State 缺少理解层事实

现有 Working Memory 能继承实体与约束，但没有持久记录 `providerUsed`、`understandingSource` 和严格 `lastGoalContract`。下轮 Follow-up 只能从已解析 Intent/slot 侧恢复，无法审计“上一轮模型理解了什么、是否降级”。

### RC-6：首屏 Loading 有客户端猜测

发送消息后，页面在拿到服务端 Run 之前直接写入 `agentActivityState: "understanding"`。这不是服务端真实事件。虽然 `Thinking` 已由 `provider.started` 驱动，但“正在理解”仍存在客户端先验猜测，不符合 Runtime Truth Layer。

### RC-7：Phase 2 文档审计引用已删除文件

`tools/test-campus-assistant-copy-audit.js` 仍读取已清理的 `docs/ui-ux-cache-pr-plan.md`，导致 `test:agent-phase2` 出现 ENOENT。这是测试清单与文档收敛不同步，不是业务回归。

## 4. 不是根因、不得重复重写的部分

- “Agent 能搜到、全校页搜不到”的历史问题在当前基线已有统一 Teacher Contract 和陈芳学院隔离测试，不应再建第二份教师索引。
- 四类搜索到 schedule-view 已有统一 `scheduleNavigationService`，不应回退到页面各自拼 URL。
- 语音权限与 ASR 已有状态机，不应把所有失败合成一个 toast。
- Action Receipt 已阻止未确认写入，不应让模型直接执行前端命令。
- `xiaofuAgentRouter` 是服务端不可达时的离线降级，不应重新发展为在线平行 Agent。

## 5. 安全与运行模式约束

“每轮模型优先”受更高优先级安全边界约束：

- 凭据、Cookie、Authorization、原始个人文件等在调用模型前拦截，绝不为了形式上的“先模型”而泄露。
- `trial/dev` 每个安全通过的普通消息先调用统一 Understanding Provider；失败时严格校验后降级到确定性解析。
- `public` 外部 Provider 调用必须为零。它执行同一 GoalContract 接口的 `deterministic_policy` 适配器，并明确记录 `providerUsed=false`，不得伪装成模型调用。
- 校园事实始终由现有确定性 Tool 与 Release Pack 产生；模型只理解目标和组织表达。

## 6. 改动前测试证据

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run test:agent-foundation` | 25/25 通过 | 约 136 秒 |
| `npm run test:agent-regression` | 115/115 通过 | 独立运行约 420 秒；并行时只是超时 |
| `npm run test:ai-competition` | 失败 | Coze 未配置测试被本机 `.env` 污染并真实超时 |
| `npm run test:agent-final-convergence` | 失败 1 项 | Planner 显式 DeepSeek 被全局 Provider Chain 覆盖 |
| `npm run test:agent-phase2` | 失败 1/11 | 文档审计读取已删除文件 |
| `npm run test:agent-phase3` | 全部通过 | RunEvent、Readiness、Coze、Runtime UI、Memory 均通过 |
| `node tools/test-xiaofu-final-product-convergence.js` | 52/52 通过 | Teacher/导航/UI/语音现状可复用 |

## 7. 推荐修复

采用“扩展现有内核”的最小一致架构：

`Provider Layer → Understanding → GoalContract → Resolver → Manifest Router → Tool Executor → Observation/Verification → Response Composer → Working Memory → RunEvent/UI`

关键点：模型不输出工具名；Resolver 只接受 Manifest Goal；Provider 以请求配置为先；模型失败保留确定性链路；Receipt 仍是前端 Action 完成的唯一证明。

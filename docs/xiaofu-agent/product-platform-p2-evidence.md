# 小佛助手产品平台 P2 运行时证据

> 日期：2026-07-30
> 分支：`codex/xiaofu-agent-product-platform`
> 范围：三种执行策略、统一 DecisionContract V2、Provider Runtime、总 Deadline、取消、连接复用、单次 fallback 与阶段性能真值。
> 修订（2026-07-30, P2R）：plan.steps 消费、fallback 单一分类与 outcome-aware 指标口径以 `product-platform-p2r-evidence.md` 为准；本文 §4/§5 已就地修正过时表述。

## 1. 结论

P2 已把 trial/dev 的首个安全语义决策接到真实 `@xiaofu-agent/provider-runtime`：`strict_model_first` 的第一语义结果必须来自 Provider 返回的严格 DecisionContract V2；原 Understanding 模型调用与 Planner 模型调用合并为一次。服务端在模型返回后才用发布态 Skill Catalog 与 Manifest 五因子交集解析 Tool，模型既看不到 Tool 清单，也不能输出任意 Tool 名。

`public` 无条件解析为 `deterministic`，即使进程存在 Provider 配置和凭据占位也不创建外部 attempt。`adaptive` 仅接受受信后台的显式配置。事实型简单结果继续由确定性 Composer 表达；需要自然表达的 Turn 才进入同一 Provider Runtime 的 Response 阶段。

## 2. 真实生产调用链

生产 Composition Root `server/src/services/ai/platformComposition.js` 注入同一个 Provider Runtime 和 DecisionService。运行路径如下：

```text
微信小程序 / HTTP Client
  -> apps/agent-server Run API
  -> packages/agent-runtime（总 Deadline、阶段预算、Trace）
  -> Fosu campus plugin Context port
  -> DecisionService
  -> packages/provider-runtime（真实结构化 Decision）
  -> packages/skill-runtime + packages/tool-runtime
  -> Manifest 五因子 Tool exact-match
  -> Verification
  -> 确定性 Composer 或同一 Provider Runtime Response
  -> RunEvent
  -> packages/ui-schema
```

`tools/test-agent-strict-decision.js` 通过真实生产 `agentService.chat` 和本地 HTTP Provider 假端点证明：

- Provider 的结构化 Decision 请求发生在 `intent.resolved` 和 Tool 之前；
- strict Turn 只有一次语义模型调用，统一 Decision 后旧模型 Planner 不再调用；
- Trace 记录 `executionPolicy`、`intendedProvider`、`actualFirstProvider`、`decisionSource`、`goal`、`selectedSkill`、`fallbackPath`；
- 非法额外 `toolName` 使 Decision 校验失败并诚实记录 deterministic fallback；
- public 在相同进程下的 HTTP Provider 请求增量严格为零。

## 3. 策略与安全边界

| 运行模式 | 默认策略 | Provider 首决策 | 规则权限 |
|---|---|---:|---|
| public | deterministic | 0 | 规范化、确定性 Goal/Skill/Tool 与 Composer |
| trial/dev | strict_model_first | 必须真实 attempt | 仅规范化、Schema、权限交集和失败后的确定性保底 |
| trial/dev（显式） | adaptive | 高置信简单任务可为 0 | 仅显式受信配置可启用快路径 |

DecisionContract V2 采用精确字段校验，Skill ID 必须来自本次发布态 Catalog，计划骨架只能引用这些 Skill。Tool 仍由服务端 `Manifest ∩ Skill ∩ Runtime Mode ∩ Environment ∩ Safety/Principal` 解析；模型输出中的 Tool 字段或未知字段一律拒绝。

## 4. Deadline、取消与 fallback

- Run 接受时生成不超过 15 秒的绝对 Deadline，并在 createRun 响应返回 `deadlineAt`。
- Context、Decision、Skill/Tool、Verification、Response、UI 都收到从剩余时间派生的 `AbortSignal` 与阶段 lease。
- Provider HTTP Adapter 使用 lease 覆盖旧的完整固定超时，并通过按 origin 复用的 keep-alive Agent 连接复用。
- Decision 与 Response 共用一个闭包账本；整个 Run 最多一次真实 fallback，而不是每个阶段各自重试一轮。（P2R 修订：是否可以 fallback 由 `packages/provider-runtime/src/fallbackEligibility.js` 单一分类决定——配置类/Schema 类/401/403 fail fast 不换 Provider，timeout/network/429/5xx 才消耗共享账本；详见 P2R 证据 §3。）
- Coze 的异步轮询等待可取消，Run 取消后不会继续后台轮询。
- Tool Runtime 和 Fosu Tool Adapter 接收同一取消信号；超时或取消后不会进入后续成功阶段。

## 5. 性能和观测

每个 Platform Trace 固定记录以下毫秒字段：

```text
createRun, decision, tool, verification, response, total
```

Runtime 与 Provider Runtime 都维护低基数、无提示词/参数/身份数据的指标。（P2R 修订：标签枚举为 outcome/executionPolicy/usedFallback/providerClass/taskComplexity/environment，未知标签拒绝；`count` 为全样本口径，`p50Ms/p95Ms` 自 P2R 起为 success-only 序列，all-runs 与 fallback 分离口径见 `allRuns.*`/`fallback.*`/`nonFallback.*`；degraded/timeout 独立计数，首事件延迟独立成桶。详见 P2R 证据 §4。）Admin topology 直接读取生产 Runtime 的相同诊断对象，Recent Runs 直接读取生产 trace sink，不维护第二份统计事实源。

受控 mock 基准（本机 Node.js v24、无外部网络；P2R 复测值）：

| 项目 | 结果 | 门槛 |
|---|---:|---:|
| 首个持久 `run.accepted` RunEvent | 1 ms | ≤500 ms |
| 简单 Turn P95（success-only） | 79 ms | ≤6 s |
| 多工具 Turn P95（success-only） | 78 ms | ≤12 s |
| Run 硬上限 | 15,000 ms | ≤15 s |

这些数字只证明预算机制和受控运行时开销，不代表 staging-live Provider 网络时延。凭据存在时的 staging-live 三 Provider 延迟与错误率仍需在隔离环境执行，不能由 mock 冒充。

## 6. 测试证据

P2 单一门禁 `npm run test:agent-platform-p2` 包含：

- Provider Runtime 策略、Contract、Deadline、熔断、probe、共享 fallback 账本；
- strict_model_first 真实第一调用和统一 Decision 生产接线；
- DeepSeek、CloudBase/OpenAI-compatible、Anthropic-compatible 三类 Adapter mock conformance；
- Response 使用同一 Provider Runtime，而非旧 `generateWithChain`；
- Run Deadline、取消、Tool/Provider 信号传播、Coze 轮询终止、keep-alive；
- 六阶段 P50/P95、首事件和硬上限受控基准；
- RunEvent、Provider runtime matrix、Admin truth 和 public 零 attempt。

本阶段提交前的完整本地结果：

- `npm run test:agent-platform-p2`：通过；
- `npm run test:agent-foundation`：42/42；
- `npm run test:agent-regression`：137/137；
- `npm run test:ai-competition`：通过；
- `npm run test:agent-final-convergence`：通过；
- `npm run test:agent-phase2`：11/11；
- `npm run test:agent-phase3`：27/27；
- `npm run test:agent-release-gate`：16/16 步通过；本机没有 Docker daemon，因此该门禁按既有规则在非 CI 环境跳过 Docker smoke，不能将其表述为容器已验证；
- `npm run test:no-ai-secret-committed`：通过。

Draft PR CI 仍需独立重跑这些门禁及 Docker smoke；本地结果不能替代 CI 和 staging-live 证据。

## 7. 验证层级

| 层级 | 状态 |
|---|---|
| 代码 | 已完成并接入生产 Composition Root |
| mock | 已通过本地 HTTP/Adapter/性能/故障契约 |
| staging | 未执行；当前环境没有获授权的真实 Provider 凭据 |
| 容器 | P2 不重复声称；多架构与 standalone 属于 P5 |
| CloudBase | 未部署 |
| 微信体验版 | 未上传 |
| 真机 | 未验证 |
| 生产 | 未部署 |

## 8. 提交与回滚

P2 独立提交：

- `143a90b9`：P2 实施计划；
- `b8b757d1`：Provider Runtime 与严格 Contract；
- `15c6930c`：统一 Decision 生产接线；
- `39c8ee3d`：总 Deadline、取消、连接复用、Response 共用 Runtime 与性能真值；
- 本证据与 Admin/gate 收敛提交：见本文件所在提交。

回滚使用 `git revert` 按相反顺序逐个撤销 P2 提交。P2 不包含数据库破坏、Release Pack 改写或生产发布；回滚后保留已验证的 P1 确定性平台生产链。

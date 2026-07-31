# 小佛助手产品平台 P4a 运行时证据

> 日期：2026-07-31
> 分支：`codex/xiaofu-agent-product-platform`（基线 `9b096340`，P2R 之后）
> 范围：Artifact/ConfigSnapshot Repository、统一发布状态机、configVersion、environment scope、审计、createRun 原子绑定、rollback、last-known-good、重启恢复、Skill 参考适配器。
> 验收规格：`specs/xiaofu-agent-product-platform/tasks.md` P4a 节（R6.1–R6.3, R10.2）。

## 1. 结论

P4a 建立了六域共用的配置发布内核（`packages/agent-runtime/src/configKernel/`）：统一发布链 draft → validate → test → publish → immutable configVersion → 新 Run 原子绑定快照 → hot reload → rollback。版本文档不可变且带 sha256 digest；草稿永不进生产；validate/test 失败不移动发布指针；rollback 只切已发布（=已验证）历史版本；current 引用原子切换；读取失败回退 last-known-good，损坏 fail closed，绝不静默重置为空配置。Skill 域参考适配器（`packages/skill-runtime/src/skillPublicationAdapter.js`）证明通用协议，不据此宣称其他域完成（Provider/Tool/Memory 属 P4b，MCP 属 P4c，RAG 属 P4d）。

## 2. 内核模型与存储

- **Repository 契约**：`REPOSITORY_METHODS`（putDraft/getDraft/putVersion/getVersion/listVersions/readPointers/writePointers/putSnapshot/getSnapshot/listSnapshots/readCurrentRef/writeCurrentRef/writeLkg/readLkg/appendAudit/listAudit）。文件适配器（`fileRepository.js`）是 integrated 模式默认实现；P5a 的 PostgreSQL 适配器将实现同一契约并复跑 `runConfigKernelRepositoryConformance`。
- **文件布局**（root 注入，包内不读环境变量；生产 root = `FOSU_AGENT_CONFIG_KERNEL_PATH` 或 `server/data/ai/config-kernel/`）：`artifacts/`（不可变版本文档）、`drafts/`、`pointers/`、`snapshots/`、`current/`（原子发布点）、`lkg/`、`audit/audit.jsonl`。tmp+rename 原子写 + fsync 加固（Windows 只读句柄 EPERM 已按平台兼容处理）；路径段白名单防穿越。
- **快照**：`cfg-<env>-<seq>-<digest12>`，内容是当时全部域发布指针 + 各域摘要（低基数，无配置内容）。每次发布/回滚生成新快照；旧快照与旧版本永久可解析（在途 Run 稳定）。
- **审计**：每次 draft.save/validate/test、publish、rollback、seed 追加有序记录（op、域、版本、configVersion、actor、result、reasonCode）。

## 3. 生产接线（真实调用链，非平行实现）

```text
platformComposition（生产 Composition Root）
  -> createConfigKernelFileRepository(root)
  -> createConfigKernel({ domainAdapters: { skill: skillPublicationAdapter } })
  -> 三环境种子（仅空环境初始化 / seed-origin 且 sourceDigest 变化时升级）
  -> createAgentPlatform.resolveConfigSnapshot
       env = normalizeRuntimeMode(request.runtimeMode || assistantEnvironment || configuredMode)
       -> configKernel.getCurrentSnapshot(env)（单次读取 = 原子绑定）
       -> { configVersion, environment, artifacts, manifestVersion }
  -> Runtime 深冻结快照（P2 已有机制）-> 各阶段 stageInput.configSnapshot
  -> fosuTurnPorts decision 阶段：resolveSkillCatalog(configSnapshot)
       按 (environment, version) 解析已发布目录（记忆化）
       -> decisionService.decide({ skillCatalog: 绑定目录 })
```

- **后台显示 = 真实执行**：Admin topology 的 `configVersion` 改由内核当前快照提供（原 `manifest:` 合成值只在内核不可用时兜底），并新增 `configKernel` 诊断块（当前 configVersion、发布指针、快照数、LKG 可用性）。
- **绑定目录语义**：Decision 只从已发布目录选 Skill；绑定目录缺少解析目标技能时报 `DECISION_SKILL_NOT_FOUND`，绝不静默回落静态全量集（测试锁定）。执行注册表保持静态超集，使在途 Run 的旧快照技能仍可执行——发布/回滚只影响新 Run。
- **热加载失败**：`resolveSkillCatalogForSnapshot` 在已发布版本不可读时回落静态目录（= 种子全量集），内核自身在快照不可读且无 LKG 时抛 `CONFIG_KERNEL_SNAPSHOT_UNREADABLE`（fail closed）；`getCurrentSnapshot` 优先 LKG 并记录安全诊断事件。

## 4. Skill 参考适配器（通用协议证明）

- 发布物是纯声明式描述符白名单（id/version/description/supportedGoals/requiredSlots/optionalSlots/allowedTools/runtimeModes/outputBlockTypes/providerPolicy/fallbackPolicy/recoveryRules/enabled）；**禁止上传可执行 JS**——planBuilder/resultVerifier 只从插件静态代码按 id 合并（内核层 `assertDeclarative` 拒绝函数/undefined 字段）。
- 授权不扩大：id 必须存在于插件静态技能集（Manifest 权威集）；supportedGoals/allowedTools 不得超出静态技能对应集合；runtimeModes 仅 public/trial/dev；空发布拒绝（保护确定性路径）。
- 种子幂等：`seedEnvironment` 只初始化无快照环境，或升级 seed-origin 且 sourceDigest 变化的版本；admin 发布（origin=admin）的版本永不被种子覆盖（Manifest 编辑 + 重启 = 新种子自动升级，保持 P4a 前行为）。

## 5. 测试证据

新增三个测试并注册 `test:agent-platform-p4a`（含 `test-agent-platform-admin.js` 的真实组合断言），且已加入 release-gate STEPS：

- `tools/test-agent-config-kernel.js`：状态机门控（未 validate/test 不得 publish）、失败不动指针、rollback 只切已发布、旧快照可解析、环境隔离、非声明式负载拒绝、LKG 回退、快照损坏 fail closed、种子初始化/升级/保留 admin 版本、重启恢复、审计有序。
- `tools/test-config-kernel-repository-conformance.js`：9 条通用契约（方法集、草稿隔离、版本不可变、指针、快照、current 原子切换、LKG、审计、路径安全）+ 文件专项（篡改 digest/JSON fail closed）。
- `tools/test-agent-skill-publication.js`：8 组声明式校验拒绝、静态合并（planBuilder 仅来自插件）、发布→新 Run 绑定→在途稳定→回滚闭环、Decision 按绑定目录解析（缺技能报 coded 错误）。

本阶段提交前完整本地结果（全部在 memoryPolicy 时钟修复后的最终工作区上运行）：

- `npm run test:agent-platform-p4a`：PASS（4/4）；
- `npm run test:agent-platform-p1` / `test:agent-platform-p2`：全部 PASS（release-gate 步骤内复核）；
- `npm run test:agent-foundation`：EXIT=0；`npm run test:agent-regression`：155/155 PASS；`npm run test:agent-final-convergence`：EXIT=0；`npm run test:agent-phase2`：11/11 PASS（修复后重跑）；`npm run test:agent-phase3`：EXIT=0；`npm run test:ai-competition`：EXIT=0；
- `npm run test:agent-release-gate`：17/17 步骤全 OK（含本阶段新增的 p4a 步骤；durationMs=292266；本机无 Docker daemon，server-docker-smoke 为静态契约检查，不声称容器运行验证）；
- `git diff --check`：EXIT=0；`npm run test:no-ai-secret-committed`：EXIT=0。

### 5.1 随本提交修复的既有测试缺陷（非 P4a 引入）

P4a 门禁运行中暴露 `tools/test-agent-memory-store-reliability.js` 在 2026-07-31 起失败：`filterAndMergeCandidates` 内部 `resolveExpiresAt(raw)` 未注入时钟，使用真实 `Date.now()`，而断言与测试内假时钟（固定在 2026-07-30 起）比较，真实时间越过假时钟边界后必然失败（时间炸弹，P3 期间引入，与 P4a 改动无关）。修复方式：`memoryPolicy.filterAndMergeCandidates` 增加可选 `options.now` 透传（生产三个调用方均不传，行为不变），测试注入假时钟；断言本身（term/release 短 TTL ≤30 天）未放宽。`test-agent-memory-store-reliability` 与 `test-agent-memory-autonomy` 修复后均 PASS。

## 6. 验证层级

| 层级 | 状态 |
|---|---|
| 代码 | 完成并接入生产 Composition Root 与 Admin topology |
| mock/单元 | 内核、契约、适配器、闭环全绿 |
| staging | 不涉及（无 Provider 行为变更） |
| 容器 | P4a 不声称；属 P5 |
| 生产 | 未部署 |

## 7. 有意边界（不在 P4a 范围）

- Provider/Tool/Memory 域适配器、密钥引用化：P4b。
- MCP、RAG 域：P4c/P4d。
- Admin 六域页面与浏览器闭环：P4e（P4a 仅暴露 topology 诊断与内核 API）。
- PostgreSQL Repository 与 Redis：P5a（契约已预留）。
- KB 既有私有发布链不改动（P4d 评估收口；其"检索只读发布态"纪律与内核一致）。

## 8. 提交与回滚

P4a 独立提交：`feat(agent): add versioned config publication kernel`（本文件随该提交）。回滚 `git revert` 该提交：恢复 manifest 版本号快照与静态目录；已写入 `server/data/ai/config-kernel/` 的种子数据不删除（只读忽略，不回滚数据文件）。

## 9. 独立审查跟进（提交 d7288a87 之后）

P4a 提交后经只读独立审查（explore 子代理，实跑复核内核/契约/适配器/包边界测试与种子幂等），结论：无 Critical；4 项 Important 与若干 Minor。以下修复随跟进提交 `fix(agent): close config kernel review findings` 落盘，证据即本节后述测试。

- **Important #1（模型路径 validate 漏用绑定目录）**：`decisionService.js` `validate(value)` 回调改用 `input.skillCatalog || skillCatalog`（此前 188/236 行已改、此行遗漏）。锁定测试：`test-agent-skill-publication.js` 的 model-path 用例——两目录同技能但 goal→skill 映射顺序不同，合法契约若按静态目录校验会被错误拒绝，修复后按绑定目录通过。
- **Important #2（快照环境=全局 configuredMode 死代码，跨环境串绑风险）**：`createRunHandlers.platformInput` 现在携带 `req.agentRuntimeDecision.runtimeMode`（bindRuntimeDecision 的授权感知决策，缺省不传、不默认 "public"）；`platformComposition.resolveSnapshotEnvironment` 优先请求作用域模式，缺失才回落 configuredMode。安全性论证：`runtimeModeService.resolveRuntimeMode` 的结果只可能是 configuredMode（已授权）或 public，请求级模式作为 hint 幂等、不可提权。锁定测试：`test-agent-config-kernel-followup.js` 第 1 组。
- **Important #3（静默 catch 吞 fail-closed 信号）**：`resolveConfigSnapshot` 兜底与 `resolveSkillCatalogForSnapshot` 失败均补 `safeLog` 安全事件（低基数字段：event/environment/version/code）；后者语义改为 fail closed——快照钉住的版本文档不可读（含 digest 篡改）抛 `DECISION_SKILL_CATALOG_UNREADABLE`，不再静默回落静态全量目录（已禁用技能复活 = 授权漂移），且失败结果不进入 (env:version) 记忆化缓存（存储修复后无需重启）。锁定测试：followup 第 2 组（腐蚀 artifact → coded 抛错 → 修复文件 → 不经重启恢复）。
- **Important #4（内核 root 不遵守 FOSU_DATA_DIR）**：root 解析改为 `FOSU_AGENT_CONFIG_KERNEL_PATH || <FOSU_DATA_DIR || server/data>/ai/config-kernel`，与全仓持久化约定一致（admin 测试/容器挂载不再误写开发者真实数据目录）。锁定测试：followup 子进程用例。
- **Minor M1**：`projectionOf` 补 `outputCardTypes` 回退（插件描述符真实字段名），种子投影不再静默丢 outputBlockTypes；normalized 的 requiredSlots/optionalSlots/outputBlockTypes 省略时回退静态值（与 goals/tools 对称，admin 草稿省略不再收窄为空）。
- **Minor M2+M6**：发布物 runtimeModes 收窄为 ⊆ 静态技能自身集合（授权不扩大；静态空集 = 全模式，允许三元组任意子集）；投影与 normalized 保留静态空集语义，不再收窄为 `["public"]`。锁定测试：`testRuntimeModesBoundedByStaticSkill`。
- **Minor M3**：kernel.js 头注释声明 single-writer 并发假设（多实例共享 FS root 会丢更新；P5a PostgreSQL 适配器须事务/条件写保证同等语义）。
- **Minor M4**：`listAudit` 按行容错（崩溃残留的半行跳过并标记 `audit-corrupt-line`，不再整体 JSON.parse 抛错）。
- **Minor M7（证据完整性）**：§5 已在提交前填入全部最终命令与通过数（审查所见为中间稿）。
- **Minor M5/M8**：tmp 命名同进程同毫秒理论碰撞与 jsonClone 变形（Date→字符串、NaN→null）维持现状——前者同步流程不触发，后者 digest 基于变形后内容自洽；记录在案不展开。

审查已核实无问题项（摘录）：memoryPolicy 时钟注入对生产三调用方零影响；审计仅低基数元数据；种子不覆盖 admin 发布；createRun 绑定链真实（单次读取 + Runtime 深冻结）；测试全部按 `error.code` 精确断言；包边界守卫通过。

跟进提交门禁：`test:agent-platform-p4a`（含新增 followup）+ foundation/regression/final-convergence/phase2/phase3/ai-competition + release-gate 全绿后提交，数字以提交前最终运行为准。

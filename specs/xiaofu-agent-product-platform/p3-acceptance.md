# P3 验收标准：ContextAssembler 与成熟 Memory（2026-07-30 grilling 确认版）

> 本文件是 tasks.md P3 章节的验收细则。代码现状基线：暂存区 + 4 个互锁未暂存文件（`server/src/routes/ai.js`、`miniprogram/services/agentMemoryClient.js`、`miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js`、`tools/test-agent-memory-api-v2.js`）。

## H1 — 清除全部云端记忆的 revision 闭环

- 服务端 `DELETE /agent/memory` 继续强制 `expectedRevision`；无 wildcard/默认值/忽略等绕过。
- 客户端 `clearCloudMemory` 传入当前持有的 `memoryRevision`；禁止硬编码或临时填值。
- 409：调现有云端记忆列表刷新 → 更新列表与 revision → 用新 revision 仅重试一次。
- 400/401/403/5xx/网络错误不自动重试；第二次仍 409 或刷新失败即停止；不无限循环、不静默吞错、不降级为无 revision 删除；用户可见中文可理解错误。
- 成功后按服务端响应契约同步列表、数量与最新 revision。
- 本期只做 clear-all 闭环 + 可复用 refresh-on-conflict seam（见 M5），不大范围重构。
- 测试：携带正确 expectedRevision；一次成功；409→刷新→二次成功；二次仍冲突停止报错；刷新失败不继续 DELETE；非 409 不重试；无无限重试/重复清除；成功后列表/数量/revision 一致。

## H2 — recentTurns 跨设备/跨会话恢复

- 服务端契约冻结：响应保持 `{success, conversation, memory, contextSlots, pendingClarification, recentTurns}`；`recentTurns` 顶层、经 `normalizeRecentTurn`、维持上限；不在 `publicConversationView` 加 `messages`；不新增顶层 `messages`；不允许两套消息事实源并存漂移。
- 客户端边界（`agentMemoryClient.getCloudConversation`）一次规范化：`recentTurns` 存在且为数组即为权威来源；`{role, text}` → `{role, content}`；保持顺序；不合并 conversation.messages；仅 recentTurns 缺失时 fallback 旧 `messages`（兼容分支）；空数组不回退；不改变 local_only；不影响其他加载路径。
- 投影层：消费规范化结构，不再依赖生产不存在的 `conversation.messages`；role 白名单；非法条目安全忽略；不伪造系统消息/执行状态；不恢复工具原始结果/隐藏推理；不覆盖 conversation/memory/contextSlots/pendingClarification。
- 测试：fixture 严格匹配生产形状（recentTurns 顶层、conversation 无 messages）；新增服务端→客户端契约测试（真实 getConversation 序列化驱动客户端规范化/投影）；覆盖顶层恢复、空数组不 fallback、缺失时兼容、并存时只用 recentTurns、非法过滤、顺序不变、local_only 不回归、其他字段不丢、跨设备重开可见最近消息。

## M1 — 单 Turn 单次原子记忆提交

- 三处独立写路径（偏好/约束/Episode）收敛为一个确定性 mutation plan + 一次权威 `mutate`；all-or-nothing；禁止 `Promise.all` 并发写同一用户记忆；不建第二套存储实现。
- 首次提交携带本轮读取的 expectedRevision；冲突→重读最新状态→以最新状态为基线按不可变变更意图重算合并（重跑 supersede/去重/TTL/scope/confidence/容量/Episode 合并）→仅重试一次；禁止旧完整快照覆盖；第二次仍冲突则停止（无第三次、不无 revision 写入、不 LWW）。
- fail-soft：不让聊天 Turn 失败、不展示技术 409、不撤销已完成 Tool/Verification/Response、仅跳过本轮未持久化记忆增强；产生 `memory.write_skipped` 结构化事件（reason/attemptCount/oldRevision/latestRevision 非敏感标识/mutation categories/runId/conversationId 安全标识/policyVersion/timestamp）；Trace 不记原文与敏感数据。Schema/权限/认证/存储不可用等错误准确分类、不伪装成 revision conflict。
- Trace 区分 `memory.write_succeeded/write_retried/write_skipped/write_failed`；未持久化记忆不得显示"已同步"。
- 测试：16 条既定用例（单次权威 mutate、无 Promise.all、正确 revision、无冲突一次成功、冲突重算成功、不覆盖他设备新增、两次停止、主链正常、事件产生、Trace 无原文、多设备不同偏好都保留、并发下"不是A是B"只留 B、Episode 不重复、TTL/scope/confidence/容量重算后仍生效、错误分类、写入后跨设备可读最新 revision）+ 真实双客户端同 revision 并发写不同偏好不丢失。

## M3 — 滚动摘要结构化修复

- `mergeRollingSummary` 接收结构化 `currentTurnFragments`（completedTools/verificationSummary/pendingClarification/pendingAction/stableFacts/supersededFacts/workingStateDelta）；previousSummary + 结构化变化 → 去重消解 → 确定性优先级 → 预算内生成。不依赖调用方拼自由文本；不建第二套摘要逻辑。
- 工具轨迹最小化：Skill/Tool、必要实体、成功/失败/取消/降级、经 Verification 的简短结论、后续相关引用。禁止原始响应/完整课表/大段检索/隐藏推理/Prompt/凭据/中间参数。completed ≠ verified。
- pending 生命周期：未解决 clarification/action 优先保留；回答后 resolved 移除；取消/完成/失效不得待处理；新 pending supersede 旧；依据结构化状态与 ActionReceipt，不用自然语言猜测。
- 预算 `MAX_ROLLING_SUMMARY_CHARS = 1200` 不变；不足时按优先级：未解决 clarification/action > 纠正后稳定事实 > Working State/目标 > 已验证工具结论 > 最近必要上下文 > 可删历史重复。"不是A是B"只留 B。100 Turn 验收的早期信息 = 已确认且仍有效的稳定事实/约束。
- 同修英文占位符：系统生成默认文本统一自然中文；不影响真实英文课程名/专有名词/用户原文；不重构国际化。
- 测试：15 条既定用例（无/有 previousSummary 两路径、completedTools 与 pending 不丢、pendingAction 完成移除、Verification 失败不记成功、多轮不重复、只留 B、预算优先级截断、不靠加长度假过、不存原始结果/课表/推理、100 Turn 早期有效事实可引用、过期/supersede 不出现、无英文占位符、用户英文原文不受影响、真实生产实现被测）。

## M4 — Memory-to-Provider Context Boundary（ADR-0006）

- 准入九条件：语义相关、未过期、未 supersede、provenance 明确、confidence 达标、scope 允许、敏感级判断、最小化投影、数量长度预算内。
- 禁止清单：学号/证件/手机号、密码/验证码、Cookie/Token/Session/Authorization、API Key/Secret/私钥、完整邮箱住址、完整课表、工具原始结果、数据库原始对象、天气短时效、隐藏推理、未审计自由文本、过期/superseded/低置信/scope 不匹配。截断不视为安全化。
- 双层防护：ContextAssembler 产出显式 provider-safe projection；decisionPrompt 本地白名单强制门禁（不遍历序列化整个 memory 对象、不直接拼 reusableConstraints 等无边界文本、异常 fail closed）。不只靠一组正则。
- 防注入：结构化数组/固定 Schema；分隔符/角色标记/控制字符安全处理；不覆盖 system prompt；不改安全策略/工具权限/executionPolicy；指令样文本不执行；Tool 只经五因子交集。
- Trace：只记选中数、排除原因类别（expired/superseded/scope/sensitivity）、policyVersion；不记正文/完整 prompt/被滤敏感原文。
- 测试（断言实际 Provider 请求体）：17 条既定用例（学号/手机号/密码验证码/Cookie-Token-Session-Authorization/API Key-Secret 不进请求体；嵌套字段/reusableConstraints/Episodic 摘要中仍被阻止；过期/superseded/scope 不匹配/低置信不进；public 恒 0；strict/adaptive 合规记忆可进；合规记忆真实影响 Goal/约束/Skill 候选；超预算确定性截断；注入式记忆不改 executionPolicy/工具权限/系统约束；上游异常 fail closed；测试样例为虚构数据）。

## M5 — delete/edit/pause 的 refresh-on-conflict（纳入 P3）

- 抽取 H1 seam 为客户端 API 边界通用 helper（语义等价 `withMemoryRevisionRetry(operation, userIntent)`）；只处理 409；首次 409→刷新状态与 revision→基于不可变用户意图重放一次；至多一次；二次 409 停止并显示可理解错误；不降级无 revision 写入；helper 集中在 agentMemoryClient，不在多页面复制。
- 差异回放：delete 目标已不存在按 404 收敛；edit 刷新后目标被删或不可安全合并不强制覆盖、提示用户重新确认；pause 按期望终态重应用而非 toggle；clear-all 遵守 H1；export 只读不套用写重试。
- 404 vs 409 vs 401/403/5xx 分类处理。

## Low×6

1. 客户端死分支与 Mock 保真：页面只调真实导出方法；删除"检测不存在方法后静默 fallback"模式；统一 `patchMemoryPolicy`（核对签名，expectedRevision 必须真实进入请求体）与 `exportCloudMemory`；local_only 导出用明确模式分支；UI Mock 严格等于生产方法名/参数/返回结构；缺能力在 agentMemoryClient 边界补齐。
2. 404 统一：`deleteEpisode` 与 `deleteMemory` 未找到均 404；客户端 404 收敛（刷新、移除本地项、温和提示）；404 不重试 DELETE；服务端/客户端/测试同语义。
3. canonical 字段：先核查失效逻辑/ContextAssembler/检索/发布链真实消费的学期与 Release 字段并定为 canonical；legacy 字段只兼容读取/迁移边界转换；新写只写 canonical；冲突时按 provenance 与较新 configVersion/updatedAt 取权威并记结构化冲突；学期/Release 变化后时效记忆真实失效。
4. TTL 类别化：空串/非法日期/缺失不得永久有效；TTL 按类别（学期课表短且绑版本、Episode 中、稳定偏好长但有 TTL/续期、pending 短期）；legacy 缺 expiresAt 用 updatedAt→createdAt 起算 + 类别默认 TTL，不用"当前时间+默认 TTL"复活旧数据；无法确认有效性 fail closed；覆盖过期边界/时区/非法日期/迁移/学期失效测试。
5. explicit 优先：当前明确纠正 > 明确确认/手动编辑 > 已有 explicit > 高置信 implicit > 低置信 implicit；implicit 永不覆盖有效 explicit；"不是A是B"supersede；pause=暂停自动抽取/更新/implicit 写入，不阻止手动查看/修改/删除/导出与用户主动确认保存，不是删除；implicit 不得伪装已确认；冲突产生结构化记录（不泄原文）。
6. verification fail-closed：仅 `verification.ok === true` 视为通过；缺失/null/字符串/结构非法/异常均不通过；无通过证据可 completed 不可 verified、不写入摘要/Episode、Response 不用"已核验"表述；最小范围只改 responseComposerBridge 及契约测试；ok:true 正常路径不回归。

## P3 提交前门禁（依次执行并报告）

定向测试（H1/H2/M1/M3/M4/M5/Low）→ `test:agent-platform-p3` → `test:agent-phase2` → `test:agent-phase3` → `test:agent-final-convergence` → `test:agent-release-gate` → `git diff --check` → 敏感信息扫描 → 新增测试无 only/skip/放宽断言/固定等待 → public 外部调用恒 0。环境性失败须提供命令、首个真实错误、基线对照与判定证据。

## Evidence 修正义务

60 场景如实表述为参数化模板循环；H2 修复前证据中"跨设备恢复"表述降级并记录修复；"服务重建"措辞精确为同进程重实例化+磁盘重读；明确标注全部为本地 mock/fixture 证据，无真实 Provider staging/体验版/真机验证。

## 提交

`feat(agent): complete P3 mature memory runtime`：暂存区 + 4 互锁文件 + 全部修复与测试 + tasks.md 勾选 + evidence。回滚整体撤回；v2 加密数据文件不删除回滚。

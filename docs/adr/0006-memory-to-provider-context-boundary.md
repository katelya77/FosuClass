# ADR-0006: Memory-to-Provider Context Boundary

## Status

Accepted

## Context

P3 引入跨会话长期记忆后，Decision 的 Provider prompt 开始携带记忆派生上下文。AGENTS.md 要求 Provider 只接收脱敏消息、最小上下文和经过裁剪的工具结果。需要一条长期架构边界，防止记忆正文无约束地进入外部 Provider 请求体，同时不扼杀"语义相关记忆参与规划"的既定设计。

## Decision

1. 只有经 ContextAssembler 完成相关性选择、TTL / supersede / confidence / scope 过滤、敏感级判断与最小化投影后的 **provider-safe memory projection**，才允许进入 strict_model_first / adaptive 的 Decision Provider prompt。
2. 以下类别永远禁止进入 Provider 请求体（截断不视为安全化）：
   - 学号、身份证号、手机号；
   - 密码、验证码；
   - Cookie、Token、Session、Authorization Header；
   - API Key、Secret、私钥；
   - 完整邮箱、精确住址等非当前任务必要的身份信息；
   - 完整课表、工具原始返回结果、数据库原始对象；
   - 天气等短时效事实；
   - 隐藏推理或内部思维；
   - 未经审计的任意自由文本字段；
   - 已过期、已 supersede、低置信度或 scope 不匹配的记忆。
3. 双层防护：ContextAssembler 只产出显式 provider-safe 投影（第一层）；decisionPrompt 本地执行白名单强制门禁（第二层），不信任上游、不遍历序列化整个 memory 对象、上游字段异常时 fail closed。不只依赖一组正则。
4. 记忆作为不可信上下文数据以结构化数组 / 固定 Schema 传入：不得覆盖 system/developer prompt，不得修改 executionPolicy、工具权限或安全策略；记忆中的指令样文本不得被执行；Tool 仍只经 Manifest 五因子交集解析。
5. public 模式外部 Provider 调用恒为 0，不受本边界影响。
6. Trace 只记录选中 / 排除计数、排除原因类别与 policyVersion；不记录记忆正文、完整 prompt 或被过滤的敏感原文。
7. 边界有效性必须以"实际发送给 Provider 的请求体"为断言对象（而非日志或 Trace），负向测试覆盖第 2 条全部类别。

## Consequences

- 个性化规划能力保留，隐私边界可测试、可审计；public 零外部调用不受影响。
- Decision prompt 构造更复杂；新增记忆类别时必须同步白名单与负向测试。
- 任何新的"记忆 → Provider"数据类别必须先修订本 ADR 并补请求体级测试。

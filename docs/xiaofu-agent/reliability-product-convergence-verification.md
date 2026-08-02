# 可靠性与产品收敛验证记录

日期：2026-08-02

代码基线：`4f06c697f71f5ffb38a4ce7eed4ca8227d803bde`

## 已通过

| 类型 | 命令 | 结果 |
| --- | --- | --- |
| 新增可靠性门禁 | `npm run test:agent-reliability-convergence` | 通过；环境 7、诊断 58、本机降级 27、32 个命名场景及记忆/后台/持久化契约 |
| 基础 | `npm run test:agent-foundation` | 42/42 通过 |
| 完整回归 | `npm run test:agent-regression` | 193/193 通过 |
| 校园 AI | `npm run test:ai-competition` | 通过 |
| Final Convergence | `npm run test:agent-final-convergence` | 通过；含 120 个评估用例 |
| Memory/KB | `npm run test:agent-phase2` | 11/11 通过 |
| Runtime Truth | `npm run test:agent-phase3` | 27 组通过 |
| 后台浏览器 | `npm run test:agent-platform-p4e` | 真实 Chromium 发布 → 新 Run 绑定 → 回滚 → 恢复通过 |
| 持久化 | `npm run test:agent-platform-p5a` | PostgreSQL、Redis、pgvector、journal 和重启恢复通过 |
| Release gate | `node tools/run-agent-release-gate.js agent-platform-p5a` 及剩余 16 阶段过滤续跑 | 26 个阶段均取得通过结果；见下方瞬时失败说明 |
| 差异 | `git diff --check` | 通过，仅有工作区行尾转换警告 |

完整 release gate 首次连续运行时，前 9 阶段通过，P5a 发生一次瞬时失败；同一 P5a 立即使用 gate 自身入口复跑通过，随后剩余 16 阶段使用同一 gate runner 全部通过。该事实不能描述成“一次全量运行无失败”，但所有 26 个门禁阶段已有通过证据，且 Docker 持久化阶段重复独立通过。

## 体验版发布检查

`npm run release:experience:check` 结果：失败，`canUploadExperience=false`。

阻塞项是线上 dual-source live smoke：CloudBase 与 Oracle 返回内容的 hash、size 一致，但必填 `releaseVersion` 在两侧均为空。相同空值不能视为版本一致，也不能绕过门禁。因此本轮没有执行 `upload:wechat-trial`，没有提交微信正式审核，也没有部署生产。

处理方式：先修复/重新发布 CloudBase 与 Oracle 的 runtime pointer/manifest，使 `releaseVersion` 非空且等于当前不可变 Release Pack 版本；重新运行 `npm run cloudbase:live-smoke` 与 `npm run release:experience:check`，只有 `canUploadExperience=true` 后才允许生成并上传体验版。

## 验证类型边界

### 2026-08-02 首次生产部署与热修复验证

- PR #44 已合并，部署 SHA 为 `b3949ab23b7a78d39c20da0cf14a0eda68228ad6`；GitHub Actions `Deploy to VPS` 的 CI 与 deploy Job 均通过。
- 生产 `/api/health`、public/trial readiness 返回 HTTP 200；public 为 fail-closed，trial 如实显示 `PROVIDER_UNVERIFIED`、`providerReachable=false`，没有再把“已配置”冒充“已验证”。
- 生产 public “你好” Run create/poll 完成，事件链只有一个终态，绑定 `cfg-public-0006-5952082a4982`。
- 生产 trial “你好”稳定复现回复阶段 `STAGE_TIMEOUT → run.failed`，证明首次部署成功不等于体验效果通过；热修复使用真实 Provider Runtime 定时器建立 RED 测试后再实现预算预留。
- 热修复聚焦测试：`node tools/test-agent-fallback-eligibility.js` 在修复前以 `ABORTED` 失败，修复后通过；`test-response-provider-runtime`、`test-agent-deadline-runtime`、`test-provider-runtime-contracts` 均通过。
- Provider 配置步骤在首次部署工作流中被跳过，真实 Probe 仍未执行；`memoryAvailable=false` 仍是线上事实。
- PR #45 的 response 热修复已部署为 `5819e949a63744ad8602e953bcf62d1c3fd2cc15`，部署流水线再次成功；随后生产 trial Run 在 Decision 阶段复现同构 `STAGE_TIMEOUT`，因此仍未判定体验效果通过。
- 第二个 RED 用例使用两个真实慢 Provider Runtime adapter 和父 Decision signal，修复前稳定抛 `ABORTED`；共享 Decision/Response stage lease 后返回 `deterministic_fallback`，并保留两次 `PROVIDER_TIMEOUT` 路径事实。

- 代码测试：已通过上述自动化。
- Mock/故障注入：Provider timeout/401/429、DNS/TLS/微信通用网络失败等使用结构化故障注入，只证明分类与 UI 契约。
- 本地集成：HTTP Run、Memory、RAG、PostgreSQL/Redis、Docker 和浏览器后台已执行。
- Provider 真实 Probe：未执行；本机没有获授权的真实 Provider 凭据。
- 微信 DevTools：未执行上传/预览；体验版外部门禁未通过。
- 真机：未执行；iOS 5G/Wi-Fi、前后台、断网恢复均待人工验收。
- 体验版：未上传，原因见上。
- 生产：PR #44 与 response 热修复 PR #45 均已合并并成功部署；Decision/Response 共享预算修复待门禁、合并和再次部署，尚未完成最终 15 分钟观察。

## 回滚

- 代码：回退本分支的阶段提交并重新运行 release gate。
- 配置：在助手运行中心“高级配置”使用不可变历史版本回滚对应 environment，不删除历史。
- 数据：Memory 无效候选迁移只将明确无效值标为 `invalid_semantic` 并记录审计；如需恢复，依据审计 revision 操作，不直接改密文文件。
- 部署：生产批准后仍需记录部署前 SHA/configVersion；持续错误时恢复旧镜像/SHA 与配置指针。

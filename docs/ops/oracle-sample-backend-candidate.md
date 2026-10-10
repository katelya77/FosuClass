# Oracle Sample 后端候选

此候选从 Oracle 指定祖先 `a3dfd1989705f51c921f13883bcde1cce4502883` 构建，参考 PR #89 `6fe02a552e7511bc27a2f4751db302ebb7a8e001` 的 Sample 协议，仅移植 Sample 所需后端边界。`git merge-base a3dfd198 6fe02a55` 等于 `a3dfd198`。本地候选没有提交、推送或部署；现网提交还必须由部署前只读检查重新确认。候选哈希不代表 Git 提交。

## 部署边界

允许任务种类只有 `class` 与 `four`。班级的一个目标是学院/年级/专业请求组，该接口可能返回多个行政班；其余三个来源各一个独立请求目标。任务没有全量自动扩展，`allowDerived=false`，使用原有 WYZ 确定性采集器。学校鉴权预算和验证码由原有本机登录链路控制；此后端不接收学校凭据。

Sample 只形成私有上传、固定摘要审核记录与 `PENDING SAMPLE REVIEW` 任务终态。它不是全校覆盖证据，`sampleOnly=true`、`publishable=false`、`coverageValid=false`。Sample 完成不会修改 `lastSuccessAt`，不会计入三次成功后启用 timer 的门禁。正式 Staging、Release Pack、active 指针、个人 Agent 与 Windows 入口保留基线行为。四源完整 Staging 的准确性/覆盖率仍需另一次授权及真实验收。

生产写入尚未授权。必须先锁定新 Git 提交及 CI，再由既有受控发布工具部署此祖先增量候选；不得用 PR/main 全仓覆盖现网。部署前停止条件包括祖先指纹变化、未完成 Collector/Release Job、损坏状态、备份空间不足、回滚镜像缺失，以及任何正式文件指纹差异。检查工具与候选包说明见 `deploy/oracle-sample/README.md`。

## API

| 入口 | 权限 | 行为 |
| --- | --- | --- |
| `GET /api/full-sync/v1/status` | 原 full-sync Bearer + HMAC + agentId + nonce | `protocol=collector-manual.v1`，提供原 Collector 脱敏状态及 Sample 许可 |
| `GET /api/full-sync/v1/sample/readiness` | 同上 | Sample 能力、预算/租约上限、暂停/安全停止原因；不访问学校 |
| `POST /api/admin/schedule-collector/actions/sample` | 原管理员写权限、scope、Origin/CSRF 与 audit | `{term?,sampleKind,requestBudget,idempotencyKey}`；额外字段拒绝；未声明scope仍要求 `admin:full` |
| `POST /api/full-sync/v1/runs/claim` | full-sync 签名 | Sample 必须同时指定正确 `runId` 和 `mode:sample`；默认 heartbeat/旧 Collector 无法误领取 |
| 原 `report/upload/init/chunks/finalize/status` | full-sync 签名及有效租约 | 复用原断点上传/Release Worker，Sample 在校验后提前返回到私有审核 |
| `GET /api/full-sync/v1/runs/:runId/sample-review` | full-sync 签名、任务绑定agent及上传actor校验 | 同时校验私有审核与上传manifest内容一致，只返回安全摘要 |

`readiness` 返回 `protocol,ready,code,sampleKinds,entityLimit,maxRequestBudget,leaseTtlMs,approvalTtlMs,sampleOnly,publishable,coverageValid,autoPublish`。不返回 Token、学校地址、服务器路径或个人数据。

`sample-review.review` 返回 `runId,uploadId,term,canonicalHash,sampleKind,samplePolicy,requestBudget,schoolRequestCount,directSourceSummary,result,sampleOnly,publishable,coverageValid,stagingState,releaseState,runtimeState,ownershipConfirmed`。`ownershipConfirmed` 来自服务端真实agent/actor绑定。正式 Staging/active 未变更的证据必须另比对真实部署前后文件 SHA256；该接口不伪造这些结论。

## 任务、断点与安全门禁

- 许可有效期 30 分钟，租约 120 秒，签名沿用原时间窗口及 nonce 防重放；租约过期只能针对同一许可重新领取，旧claim立即拒绝。
- 管理员幂等键为 8–80 字符 ASCII，重复相同键/范围返回相同任务且不延长许可；范围改变拒绝。Sample 创建保留既有 Oracle run 历史和较早 Sample 审批引用，不执行20条截断。后续 routine/full 仍保留最新20条常规记录，同时保留独立 Sample 记录，让较早的私有审核、ownership 与幂等引用持续可验证。幂等记录达到1000条上限时要求人工审核，不自动删除历史或私有review文件。
- Sample 不允许 `resume-run` 改成 routine。失败任务保留来源阶段、请求计数、失败码、uploadId、已收分块及 Job；新学校采集需要新的独立授权，不能把上传恢复解释为认证重试。
- 学校会话/认证/验证码、安全页等停止不会被新的 Sample 许可清除。若服务端仍为认证停止态，任务创建返回 `SAMPLE_AUTH_REVIEW_REQUIRED`；不能通过创建 routine 来清除安全状态。
- 请求预算为 1–120 次，PAM 工具固定 40 次。报告及完成上传均检查预算；报告不能进入 publish/mirror 或 `NO CHANGE` 完成分支。
- Sample 压缩上传最多 8 MiB、解压 JSON 最多 32 MiB；流式解压同时按声明原始大小限流。相同分块重传幂等，不同字节覆盖拒绝。上传init的hash/大小/分块参数必须完全匹配。
- termConfig 必须与创建任务时的受控学期记录一致。每类一个直采目标、一个来源请求，解析错误/失败为零；课表事件周次、节次、星期、重复、实体数量及指纹均受校验。
- 私有安全摘要只包含选定计数，目录范围受限。Sample JSON 解析失败仅存固定错误码，避免把输入片段写入日志。
- 四源完整校验、Staging 安全校验、正式 publish 的首入口（含 force/重复 active shortcut）、上传发布标记及生命周期重绑定均拒绝 Sample。
- 旧 a3 状态保留原schema，新增字段为可忽略字段。已有state JSON损坏时返回 `COLLECTOR_STATE_REVIEW_REQUIRED`，不重置认证状态、租约或历史。

## 最少输入的 PAM 命令

仅在 Oracle 候选部署验收通过，且明确批准本次学校 Sample 后，进入 Oracle PAM 终端运行：

```sh
sudo node tools/oracle-sample/queue.js --app-dir="<Oracle既有应用目录>" --approve-sample=class --idempotency-key=sample-20261010-class
```

如现有 active term 不适用，追加已审核的 `--term=2026-2027-1`。工具读取现有 `server/.env` 内管理员凭据，要求 root 和私有文件权限，通过固定 loopback `127.0.0.1:18318` 的现有权限/审计创建任务；不输出凭据，不访问学校。第一次班级样本人工确认后，再另批准四源 Sample：

```sh
sudo node tools/oracle-sample/queue.js --app-dir="<Oracle既有应用目录>" --approve-sample=four --idempotency-key=sample-20261010-four
```

随后在 WYZ PAM 使用既有 `fosu-collector manual-sync --sample-kind=class|four --approve-school-access`，可加返回的 `--run-id=sc-…` 锁定任务。真实账号密码只在已有 WYZ PAM TTY 隐藏输入，绝不写到命令/文件。网络或验证码停止须按实际原因人工处理；不得重复安装、清除 auth-history 或开启 timer。

## 独立回滚

Oracle回滚只恢复部署前记录的 API 镜像/提交，按现有部署工具恢复容器，保留现有env、正式storage、静态文件和个人服务。回滚前必须确认没有进行中的 Sample/Release Job；需要终止 Sample 时用既有受保护取消入口，另获明确授权。不能直接复制旧全storage覆盖现有数据。

已结束 Sample 的 additive state 与审核文件可保留；a3忽略新增字段，`PENDING SAMPLE REVIEW`不计入timer成功数。私有审核与上传应保留用于追溯，禁止自动清理。只有state损坏且已明确批准时，才按备份恢复这一状态文件；须先保存损坏文件，不重置本机CAS认证预算。

WYZ/CAS候选的回滚独立执行，不要求同时回滚Oracle；Oracle取消/未部署不影响当前已验收 heartbeat-only 服务。

## 本地验证

```text
node --test tools/test-oracle-sample-backend.js tools/test-oracle-sample-queue.js
node tools/test-schedule-collector.js
node tools/test-wyz-collector.js
node tools/test-staging-upload.js
node tools/test-four-direct-source-production.js
```

新增32项通过；签名localhost API调用、真实本地worker、class/four私有审核、hash/租约/身份/目录一致性/幂等/断点、旧run历史及较早审批引用保留、Sample跨25次后续常规任务仍可审核和幂等、失败来源checkpoint及错误码、强制发布阻断及正式文件字节不变均经本地测试。既有Collector 29项、四源production contract 29项及Staging smoke通过。本地fixture不证明学校登录、真实Oracle运行、真实学校数据准确性或完整覆盖。

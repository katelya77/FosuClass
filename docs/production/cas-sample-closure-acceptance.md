# CAS 与 Oracle Sample 分层验收

两个候选分别审批、分别回滚。CAS 候选基于 WYZ 已验收的 `6fe02a552e7511bc27a2f4751db302ebb7a8e001`；Oracle 候选基于生产祖先 `a3dfd1989705f51c921f13883bcde1cce4502883`。Oracle 不使用 PR #89/main 的整树覆盖现网。本文所有生产命令都是后续 PAM 操作说明，本轮未执行学校访问、生产部署或样本采集。

当前用户真实证据已证明安装、服务、heartbeat-only、execute=0、timer disabled、个人 Agent active，以及公开 CAS 表单可识别。`formReady=true` 与 `networkCompatibility=REVIEW_REQUIRED` 同时成立；三次官方 XHR POST 已定位为同一 `/authserver/common/getLanguageTypes.htl`，用途尚未确认，继续阻断。`passwordSubmissions=0`、Session 未建立，不能归因于 UA、ZIP、密码错误或重复密码。2026-10-11 最新公开审计为 `BLOCKED/SCHOOL_PUBLIC_AUDIT_FAILED`，endpointAudit/sourceEvidence 为空；它没有补齐请求参数及调用用途，也不能给出 CAS_PUBLIC_READY。修复审计执行问题后再收集公开证据，不能仅按接口名字推断安全性。已通过的安装/心跳不要求重复安装或再跑一小时观察。

现有 6fe 安装可使用 [一次公开调用证据审计脚本](../cas-sample-closure/PAM-PUBLIC-AUDIT.sh)，操作说明见 [CAS 兼容策略](../cas-sample-closure/CAS-COMPATIBILITY.md)。这一段无需重新安装，不读凭据、不放行未知 POST、不重置认证预算；应先审查其中公开调用的用途，再固定最终候选规则。

## 阶段与判据

| 阶段 | PASS 需要的真实证据 | BLOCKED 示例 |
|---|---|---|
| installation | 安装 SHA 与候选一致；既有 heartbeat-only 语义门禁通过；个人 Agent active；execute=0；timer disabled/inactive | 尚未安装批准后的最终候选或缺安装证据 |
| public-cas | formReady/loginReady；必须初始化响应完整；没有未审核 POST；密码提交0且认证历史未变 | 三个 POST 用途未知；required 初始化缺响应 |
| session | 一次提交保存的 `SESSION_SAVED`；passwordPersisted=false；15分钟内同一候选的当前受保护页 Session 验证；检查期间认证历史和 Session 不变 | 仅有旧保存记录、当前 Session 失效、检查过期、冷却、日预算或安全验证 |
| oracle-sample | 实际签名 GET 被 Oracle 接受；collector-manual.v1 的 readiness 及固定 Sample 边界 | 旧 Oracle 未部署 API、鉴权失败、API 不就绪 |
| class-sample | 一个专业/年级请求组；本机结果与 Oracle 同一 run/upload/hash；私有审核；预算内；正式状态前后 hash 不变 | 缺 Oracle 私有审核或前后快照 |
| four-sample | class 已通过；class/teacher/classroom/course 各一个独立 network-direct 请求目标；同上边界 | 任一来源派生、缺源、解析错误或摘要不一致 |
| staging | 另行批准完整采集后的真实完整覆盖/班级身份/去重/跨源/课表人工抽查及前版计数比较 | Sample 永远无法证明全校覆盖，本任务没有全量授权 |

违约状态为 FAIL，例如实际有第二次密码提交、Sample 超预算、不同 upload/hash、正式 Staging/active/公告/个人控制面/环境发生未审批变更。FAIL 后停止后续阶段并审查；不要重新安装来掩盖失败。>10% 数量下降继续 BLOCKED，必须单独审核。四源 Sample PASS 不会令 staging 或正式发布 PASS。

`acceptance.js` 是可复用的证据验收器。`record`/`report` 只读本机脱敏输出，不登录、不采集、不上传；`installation` 复用既有 `check-heartbeat-service.py`，只检查本机服务。`session-check --approve-school-read` 单独获批后只调用现有受保护页验证，不读凭据、不提交密码、不保存 Session，并核对验证前后 Session/认证历史不变；不传批准参数时在学校请求前停止。`oracle-readiness`/`oracle-review` 只有明确 `--approve-oracle-read` 才能执行固定签名 GET。验收器没有任务创建、claim、POST、timer、发布或 active 接口。默认缺真实证据为 BLOCKED；退出码 PASS=0、BLOCKED=2、FAIL=1。

单次 `report` 输出七阶段 PASS/BLOCKED/FAIL 与固定原因，`verifiedStates` 仅包含满足真实证据和前置条件的 CAS_PUBLIC_READY、SCHOOL_SESSION_VALID、ORACLE_SAMPLE_API_READY、CLASS_SAMPLE_PENDING_REVIEW、FOUR_SOURCE_SAMPLE_PENDING_REVIEW、STAGING_QUALITY_VERIFIED。被阻断的状态不会出现在成功列表中。`validationStatus` 保留七个技术阶段的汇总判据。`publication.state` 始终为 PUBLICATION_NOT_APPROVED，同时 approved=false、published=false；因此报告顶层 status 在技术验证 FAIL 时为 FAIL，其他情况均为 BLOCKED，即使以后完整 staging 令 validationStatus=PASS 也不表示已发布。本验收器没有发布授权。Sample 完成后 staging 仍 BLOCKED，不会报全校同步成功。Session 每次 report 都重算15分钟有效期，不把旧 PASS 或 SESSION_SAVED 当作当前有效。

`--attest-live` 表示操作者核对输入来自下面真实 PAM 操作；它不是独立签名证明。fixture/local worker、手写成功 JSON、旧 CI 或模拟网络均不能使用该标记作为生产验收。输入应是 CLI 白名单输出、Oracle 私有摘要和主机 preflight 摘要；不要输入 Session/env/Cookie/账号/密码/登录请求正文或原始 HAR。验收器拒绝敏感键，输出只保留固定字段、状态和 hash。证据保留于 root-only 目录，不进 Git/CI artifact/普通聊天。

## PAM 一次性准备

最终候选完成独立提交、准确提交上的 CI 和构建产物校验，锁定 Git SHA/源码 SHA256/ZIP SHA256 后，再分别批准安装与 Oracle 部署。未提交或 CI 未通过的源码候选不能视为正式部署包，不能用祖先 SHA 冒充候选。使用现有 LF checksum、ZIP 归一化和 heartbeat-only 升级器，参见 [CAS 安装修复手册](wyz-cas-mobile-repair.md)；Oracle 部署、备份及回滚见独立 Oracle 候选中的 `deploy/oracle-sample/README.md`。安装最终修复候选只需一次，不按错误反复安装。

批准后的 WYZ PAM root TTY 只设置两个非秘密值：`WYZ_SHA` 与 `ORACLE_SHA`，分别取已审查候选的完整 SHA。两台主机的证据目录使用同一个批次名称，通过 PAM 仅交换脱敏 JSON 文件。以下占位 SHA 必须替换为实际交付 receipt 的值，不能填旧版本掩盖新版本未安装。

```bash
set -Eeuo pipefail
umask 077
WYZ_SHA=REVIEWED_WYZ_FULL_SHA
ORACLE_SHA=REVIEWED_ORACLE_FULL_SHA
EVIDENCE=/root/fosu-closure-acceptance-20261011
mkdir -m 700 "$EVIDENCE"
ACCEPT=/opt/fosuclass/schedule-collector/current/tools/wyz-schedule-collector/acceptance.js
node "$ACCEPT" installation --candidate-revision="$WYZ_SHA" \
  --output="$EVIDENCE/installation.receipt.json"
```

`mkdir` 或 receipt 已存在即停止，使用新的批次名称保留旧证据；不覆盖、不清理认证预算、Session、checkpoint 或历史。该检查仅需安装最终候选后执行一次。

## 公开页与一次登录

公开页访问获得单独批准后：

```bash
if fosu-collector diagnose-login --login-profile=mobile --approve-school-access \
  > "$EVIDENCE/public-cas.jsonl" 2>&1; then
  printf 'PUBLIC_PAGE_COMMAND_COMPLETED\n'
else
  printf 'PUBLIC_PAGE_STOPPED_REVIEW_OUTPUT\n'
fi
node "$ACCEPT" record --stage=public-cas --source=wyz-school --attest-live \
  --candidate-revision="$WYZ_SHA" --input="$EVIDENCE/public-cas.jsonl" \
  --output="$EVIDENCE/public-cas.receipt.json"
```

允许 `COMPATIBLE`，或全部阻断 POST 均已审查为 optional 的 `COMPATIBLE_WITH_NONCRITICAL_BLOCKS`；后者必须 noncriticalPostsBlocked=backgroundPostsBlocked 且 requiredInitializationComplete=true。`REVIEW_REQUIRED` 一律停止；此时不输入凭据、不猜测验证码、不扩大整个 authserver 域名权限。

公开阶段 PASS、用户单独批准一次账号登录后，在 PAM 隐藏输入；先检查既有保护状态。下面只将标准输出交给 tee，stdin/stderr 保持 TTY，隐藏输入不会落文件。不得给 login 加 `2>&1`、账号/密码参数、输入管道或 `echo` 凭据。认证失败停止，不自动再次登录或切 profile。

```bash
fosu-collector auth-state
if fosu-collector login --login-profile=mobile --approve-school-access \
  | tee "$EVIDENCE/session.jsonl"; then
  printf 'LOGIN_COMMAND_COMPLETED\n'
else
  printf 'LOGIN_STOPPED_NO_RETRY\n'
  exit 2
fi
node "$ACCEPT" session-check --approve-school-read \
  --output="$EVIDENCE/session-initial-check.json"
node "$ACCEPT" record --stage=session --source=wyz-school --attest-live \
  --candidate-revision="$WYZ_SHA" --input="$EVIDENCE/session.jsonl" \
  --session-check="$EVIDENCE/session-initial-check.json" \
  --output="$EVIDENCE/session.receipt.json"
```

若此前 blocked，先人工处理真实问题；冷却为0、日预算允许且人工确认后，才在上述一次 login 添加 `--acknowledge-auth-failure`。该参数不重置预算、冷却或历史。复用已有效 Session 返回 `SESSION_REUSED` 时，验收不会冒充完成了“一次账号登录和新 Session 保存”；使用已保留的真实首次 SESSION_SAVED 证据配对当前 session-check，不为刷新验收计数再提交密码。session-check 需要当前受保护页访问批准；失败或挑战立即停止，不回到登录或自动重试。

## Oracle 就绪（可独立推进）

Oracle 部署候选可在 CAS 证据未齐时独立开发、测试和审批；部署仍需另行批准，并完成该候选手册中的 a3 真实在线指纹、备份、原镜像回滚点、健康检查、个人服务与正式业务探针。部署成功后，在 WYZ 经批准执行一个签名只读就绪检查；它读取既有 `/etc/fosuclass/full-sync.env` 的只读 execute=0 配置，不输出凭据。

```bash
node "$ACCEPT" oracle-readiness --approve-oracle-read \
  --output="$EVIDENCE/oracle-sample.json"
node "$ACCEPT" record --stage=oracle-sample --source=oracle-live --attest-live \
  --candidate-revision="$ORACLE_SHA" --input="$EVIDENCE/oracle-sample.json" \
  --output="$EVIDENCE/oracle-sample.receipt.json"
```

`fosu-collector status` 也会安全显示 oracleSampleReady/Code；旧部署的 readiness 404 不影响本机安装读数。`inspect` 从签名私有 Sample review 核对 ownership/run/upload/hash，无法读取时明确 UNVERIFIED，不能用 status 的近期列表推断私有上传完成。

## 一组班级 Sample

仅当公开 CAS、Session、Oracle 就绪通过，且本次 class 具体范围、数据使用权限和学校请求预算单独批准后开始。下面的批准参数只能在这些条件已成立时使用，命令文本本身不能代替学校权限批准。Oracle PAM 使用已审查独立候选中的脚本，沿用该主机既有 `APP_DIR`、`RUNTIME_DIR`、`CANDIDATE_DIR` 和 `MANIFEST`；这些变量是主机配置，不放入聊天。Snapshot 是部署后同一候选的采集前后证据，不能拿部署前 a3 的 env hash 与采集后比较。

Oracle PAM，先只读快照再创建一次最小任务：

```bash
set -Eeuo pipefail
umask 077
EVIDENCE=/root/fosu-closure-acceptance-20261011
mkdir -m 700 "$EVIDENCE"
: "${CANDIDATE_SHA:?已审查Oracle候选完整SHA}"
: "${APP_DIR:?既有应用目录}"
: "${RUNTIME_DIR:?既有runtime目录}"
: "${CANDIDATE_DIR:?独立候选源码目录}"
: "${MANIFEST:?候选receipt}"
node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" \
  --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" \
  --expected-sha="$CANDIDATE_SHA" > "$EVIDENCE/class-before.json"
node "$CANDIDATE_DIR/tools/oracle-sample/queue.js" \
  --app-dir="$APP_DIR" --approve-sample=class \
  --idempotency-key=sample-20261011-class > "$EVIDENCE/class-task.json"
```

后台请求沿用鉴权、Origin、scope、审计和幂等门禁。此 key 固定绑定本次请求；重复执行只返回同一任务，不续30分钟批准。超期或失败需审查后新批准/新 key，不从旧 Sample 断点隐式继续学校请求。任务 entityLimit=1 指一个专业/年级请求组，可能包含多个行政班；不是全校班级，也不能宣称只返回一个班。请求预算40包含目录等所有学校请求，并发1、既有900–1300ms间隔；不扩大预算。

通过 PAM 把 class-task.json 及 class-before.json 脱敏摘要传到 WYZ 同批次目录，文件0600。WYZ 从任务 receipt 读取固定 runId，无须手打；确认当前任务为本次 class，然后只执行一次：

```bash
fosu-collector status
node "$ACCEPT" session-check --approve-school-read \
  --output="$EVIDENCE/session-class-check.json"
CLASS_RUN=$(node -e 'const r=require(process.argv[1]);if(r.status!=="PASS"||r.sampleKind!=="class"||!/^sc-[A-Za-z0-9-]+$/.test(r.runId))process.exit(1);process.stdout.write(r.runId)' "$EVIDENCE/class-task.json")
if fosu-collector manual-sync --mode=sample --sample-kind=class --run-id="$CLASS_RUN" --approve-school-access \
  | tee "$EVIDENCE/class-run.jsonl"; then
  printf 'CLASS_SAMPLE_FINISHED_PENDING_PRIVATE_REVIEW\n'
else
  printf 'CLASS_SAMPLE_STOPPED_NO_RETRY\n'
  exit 2
fi
fosu-collector inspect > "$EVIDENCE/class-inspect.json"
```

CLI 先验证已批准的当前任务和到期时间，再仅询问一次 `SAMPLE class`；只检查并直接复用既有有效 Session，不再询问 REUSE，也不进入账号密码输入。缺失或失效立即 SCHOOL_SESSION_EXPIRED/BLOCKED，停止本阶段，返回独立的单次登录批准流程；Sample 不读取凭据、不登录、不修改认证预算。inspect 本身不访问学校。

样本进入终态、租约释放后，Oracle PAM 再跑相同 preflight：

```bash
node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" \
  --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" \
  --expected-sha="$CANDIDATE_SHA" > "$EVIDENCE/class-after.json"
```

通过 PAM 将 class-before/after 两个脱敏摘要传到 WYZ 同批次证据目录，文件0600。WYZ 不接收 Oracle env/admin token；Oracle 不接收学校 Session/账号/密码。

```bash
node "$ACCEPT" record --stage=class-sample --source=wyz-school-and-oracle --attest-live \
  --candidate-revision="$WYZ_SHA" --input="$EVIDENCE/class-run.jsonl" \
  --oracle-review="$EVIDENCE/class-inspect.json" \
  --before="$EVIDENCE/class-before.json" --after="$EVIDENCE/class-after.json" \
  --output="$EVIDENCE/class-sample.receipt.json"
```

必须是同一 Sample runId/uploadId/canonicalHash/请求数，Oracle 私有 owner 真实匹配，result=PENDING SAMPLE REVIEW、sampleOnly=true、publishable/coverageValid=false、releaseState=not-built、runtimeState=inactive；前后 Oracle SHA、正式 Staging、active、所有受保护文件和 env hash 一致。缺快照即 BLOCKED，不用固定返回值冒充真实“未变化”。

## 四源 Sample 与最终报告

class-sample PASS 后另行批准 four。每种来源各一个独立请求目标，不能从 class 派生 teacher/classroom/course。返回的一个 class 请求组仍可能含多个行政班。不同失败阶段不重新安装；修复候选源码和本地回归可以批量完成，真实阶段只在新批准和前置门禁满足时运行。

Oracle PAM，沿用同批次变量：

```bash
node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" \
  --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" \
  --expected-sha="$CANDIDATE_SHA" > "$EVIDENCE/four-before.json"
node "$CANDIDATE_DIR/tools/oracle-sample/queue.js" \
  --app-dir="$APP_DIR" --approve-sample=four \
  --idempotency-key=sample-20261011-four > "$EVIDENCE/four-task.json"
```

通过 PAM 把 four-task/before.json 传到 WYZ，同样只执行一次：

```bash
node "$ACCEPT" session-check --approve-school-read \
  --output="$EVIDENCE/session-four-check.json"
FOUR_RUN=$(node -e 'const r=require(process.argv[1]);if(r.status!=="PASS"||r.sampleKind!=="four"||!/^sc-[A-Za-z0-9-]+$/.test(r.runId))process.exit(1);process.stdout.write(r.runId)' "$EVIDENCE/four-task.json")
if fosu-collector manual-sync --mode=sample --sample-kind=four --run-id="$FOUR_RUN" --approve-school-access \
  | tee "$EVIDENCE/four-run.jsonl"; then
  printf 'FOUR_SAMPLE_FINISHED_PENDING_PRIVATE_REVIEW\n'
else
  printf 'FOUR_SAMPLE_STOPPED_NO_RETRY\n'
  exit 2
fi
fosu-collector inspect > "$EVIDENCE/four-inspect.json"
```

终态、租约释放后 Oracle PAM：

```bash
node "$CANDIDATE_DIR/deploy/oracle-sample/preflight.js" \
  --app-dir="$APP_DIR" --runtime-dir="$RUNTIME_DIR" --manifest="$MANIFEST" \
  --expected-sha="$CANDIDATE_SHA" > "$EVIDENCE/four-after.json"
```

仅通过 PAM 把 four-after.json 脱敏摘要传到 WYZ 后：

```bash
node "$ACCEPT" record --stage=four-sample --source=wyz-school-and-oracle --attest-live \
  --candidate-revision="$WYZ_SHA" --input="$EVIDENCE/four-run.jsonl" \
  --oracle-review="$EVIDENCE/four-inspect.json" \
  --before="$EVIDENCE/four-before.json" --after="$EVIDENCE/four-after.json" \
  --output="$EVIDENCE/four-sample.receipt.json"
```

至此只需一次 report 整合已保留的所有阶段。没有新增学校访问批准时，直接运行下面第二条命令，保留过期 Session 的 BLOCKED。需要当前 Session 状态且已批准只读受保护页检查时，先运行第一条；它不重新登录。历史 receipt 不覆盖，report 将额外输入的安全 Session 验证绑定同一候选并输出输入 SHA256：

```bash
node "$ACCEPT" session-check --approve-school-read \
  --output="$EVIDENCE/session-final-check.json"
node "$ACCEPT" report --directory="$EVIDENCE" \
  --session-check="$EVIDENCE/session-final-check.json"
```

不做新检查的纯本机报告命令为 `node "$ACCEPT" report --directory="$EVIDENCE"`，学校请求0。报告 BLOCKED 的退出码2是保留的门禁结果；不要修改 receipt 来使其退出0。刷新检查使用新的文件名保留旧证据，不能为了刷新 Session 状态再提交密码。

没有 staging.receipt.json 时，报告 staging 为 BLOCKED/EVIDENCE_MISSING，不输出 STAGING_QUALITY_VERIFIED。即使提供 Sample 审核记录，仍为 SAMPLE_CANNOT_ESTABLISH_FULL_COVERAGE。以后另行批准完整采集时才审阅 staging 精度/覆盖：样本不能改 sampleOnly 为 false；必须有真实完整四源 coverage、allowDerived=false、canonical/schema、行政班身份、无重复/跨源冲突、真实学校课表抽查及前版数量比较。本文没有全量、timer、正式发布或 active 切换命令，也不会凭 Sample 自动创建正式 Staging。不可变 Release 发布、CloudBase 镜像与微信正式版读取各需后续独立审批和真实版本证据；PUBLICATION_NOT_APPROVED 在此不改变。

只回传报告的阶段状态、固定原因、必要 hash 与统计。比如 PUBLIC_POST_PURPOSE_REVIEW_REQUIRED 需要真实脱敏端点用途证据，SIGNED_ORACLE_REVIEW_REQUIRED 需要真实签名私有审核记录，FORMAL_STATE_BEFORE_AFTER_EVIDENCE_REQUIRED 需要前后安全快照；FAIL 不重试密码或学校请求。

## 两个独立回滚边界

CAS 回滚：另行批准后使用既有代码/unit 升级回滚机制，目标为本次安装前的 `6fe02a55`；确认本次 backup 及 heartbeat-only 签名、只恢复代码和 unit。保留认证历史/日预算/冷却、Session、env、checkpoint；个人 Agent active、execute=0、timer disabled/inactive。Oracle Sample 服务不随 CAS 回滚。

Oracle 回滚：参照独立候选 `deploy/oracle-sample/README.md`，先停止新的任务创建并确认没有在途作业/租约，使用备份中原 Compose/原镜像 digest 只回滚 API 代码；保留 env、storage、私有 Sample 审核历史。随后验证 a3 API/镜像指纹、健康、个人 Broker、正式 active/四索引、公告/表情及 Windows入口。状态恢复需要额外批准，不自动覆盖新数据。WYZ CAS 代码和 Session 不随 Oracle 回滚。

## 本地可重复回归

以下只使用合成数据、loopback 与真实本地 worker；通过数量不能算学校/Oracle 生产验收。

```powershell
node tools/test-collector-closure-acceptance.js
node tools/test-collector-manual-cli.js
node tools/test-collector-sample-contract.js
$env:FOSU_SAMPLE_ORACLE_ROOT = 'C:\Users\Katelya\.codex\worktrees\oracle-sample-closure\FosuClass'
node tools/test-collector-sample-contract.js
Remove-Item Env:FOSU_SAMPLE_ORACLE_ROOT
```

无跨树变量时，PR #89 旧后端私有 review 不存在，回归必须明确保留 UNVERIFIED/BLOCKED；有变量时全部 server contract/control/routes/finalizer/worker 均从 Oracle 独立候选加载，WYZ 客户端仍来自 CAS 候选，验证真实签名请求、租约和私有审核。两个候选以后提交/CI/安装也各自绑定独立版本。

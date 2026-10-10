# 佛课小表生产运维与发布接力手册

状态日期：2026-10-10，Asia/Shanghai。此文区分正在运行的生产系统、候选代码、本地 fixture 和人工验收；任何一项通过不能替代其他项。

## 生产基线和门禁

| 项目 | 本轮证据 | 状态 |
| --- | --- | --- |
| GitHub main | fetch 后 `5c8db23e0bf209687a7e5086654dafe0adbc93f8` | 已核实 |
| PR #82–#86 | GitHub 查询为 MERGED | 已核实 |
| PR #79/#81 | GitHub 查询为 OPEN | 保留，未合并或修改 |
| 生产祖先 | 只读工作流 `38037091970` 确认 `a3dfd1989705f51c921f13883bcde1cce4502883` | 学校请求0、配置未改、未部署候选 |
| Stage A 候选基线 | PR #87 Draft OPEN，HEAD `5e2473ecfa87cc0a2651cf49f105c415c64e7e1a`，base `codex/wyz-oracle-transport-package` | 从真实 #87 HEAD 继续，包含 main、已安装bff与生产祖先 |
| Oracle / CloudBase active | 两个正确公开路径均返回 `2026-10-07T19-12-39`，学期 `2026-2027-1`、相同 epoch | 本轮只读核实 |
| WYZ 当前安装 | 用户 PAM：CAS_REPAIR_SERVICE_RECOVERED、Collector active/running、NRestarts=0、个人 Agent active、timer disabled、execute=0 | `6eea0ec099930f40d16cd3f0ea641e3572f9c675`；本轮未安装 |
| WYZ 原版本 | 用户 status 回传 `2b80222e9cf4846a1545aecbb7975359e7a37707` | 旧目录与 checkpoint 已保留 |
| WYZ 首次观察（修复前） | 用户 PAM：3605.86 秒，51 成功/19 失败，72.86%，最大确认间隔 459.96 秒 | 历史 NOT_PASSED，保留故障证据 |
| 当前版本一小时观察 | 用户 PAM：3607.22秒、119成功/0失败、118复用、最长间隔30.58秒、TLS授权通过、实际地址146.235.201.244、重启0、学校请求0 | PASS；Collector及个人Agent active，timer disabled/inactive，execute=0 |
| 学校阻断 | 用户 PAM：公开移动页 form-ready 后 POST 守卫报 PASSWORD_RESUBMISSION_BLOCKED，但 passwordSubmissions/reservations=0 | 表单已识别，后台 POST 用途未知；先修复分类再单独批准公开诊断，不能判为密码错误 |
| 正式微信构建版本/合法域名/真机刷新 | Git 配置和本地开发者工具配置不能证明已上线包 | 未核实，人工门禁 |

当前常用工作区路径是指向 `D:\Dev\VScode\FosuClass` 的 junction，有用户未提交的两份 project 配置。本任务使用独立 worktree；不得用候选覆盖这些配置。main 尚不包含全部生产祖先；不能仅因“最新 main”而部署。

生产门禁保持：学校访问未批准；`execute=0`；timer disabled；自动发布关闭；生产 pointer、DNS、防火墙、代理、个人 Agent、微信正式版、付费资源均不由本轮 Agent 自动修改。所有手册中的生产写命令由人工在对应门禁批准后执行。

## PR #88 安装后：CAS 移动登录修复候选

### PR #89：升级后的 ExecStart 误判修复

历史安装故障：`6eea0ec099930f40d16cd3f0ea641e3572f9c675` 已通过 SOURCE_INTEGRITY、依赖安装和 NATIVE_BROWSER，current 已切换；旧辅助脚本误判导致 Collector inactive。最新用户 PAM 已确认 CAS_REPAIR_SERVICE_RECOVERED、Collector active/running/NRestarts=0、个人 Agent active、timer disabled、execute=0、Oracle Direct PASS。ExecStart 修复已在 d2ef1758 及对应 Linux CI 完成；本轮不重复修复或部署。此前 60 分钟 HMAC 心跳验收保留。

旧脚本在停止服务、安装器 daemon-reload 后，以完整 `systemctl show ... -p ExecStart --value` 与停止前快照作字符串相等判断。该属性包含命令与运行记录，停止会更新 stop_time/code/status，reload/start 可改变时间和 PID。隔离 Linux 中执行旧交付脚本及真实安装器，已复现“安装成功、current 已切换、尚未 start 就误判”的路径；另以本地真实 systemd 临时 sleep unit 证明：命令参数不变，完整属性仍不相等。没有读取 WYZ 的原始属性，不能声称已远程确认具体哪个运行字段发生变化。

新 `deploy/wyz/upgrade-candidate.sh` 纳入版本控制，与 CI、交付包共用。它读取包内 `upgrade-candidate.json` 的 fromRevision/revision/bundle/sha256，验证 archive 哈希、四份执行辅助文件与 archive 字节相等、current 前驱指纹及升级锁，保留 root-only unit/drop-in/current 备份后停止 Collector。安装器原有校验全部保留。

`check-heartbeat-service.py` 通过 systemd D-Bus 的类型化 ExecStart 数组验证唯一 executable 和逐个 argv，而非拆分拼接后的文本：必须是 `/usr/bin/env`、`FOSU_COLLECTOR_EXECUTE=0`、`/usr/bin/node`、受保护的 `acceptance/heartbeat-only-runner.js`，且 ignore-failure=false。不接收额外参数、多个命令或替代 runner。WorkingDirectory 必须为 managed current；额外执行 hook 拒绝；timer loaded/disabled/inactive/dead；个人 Agent active/running，双方无启动/停止依赖关联。runner 权限为 root:root 0600，相关目录 0700。升级前后的 runner 哈希与个人 Agent 有效命令哈希必须一致；不读取密码、env 或 Session，不输出命令原文。

该门禁在升级前、停止后、reload 后启动前、启动后和最终返回前分别运行。启动后连续 5 秒检查 active/running、Result=success、NRestarts=0；这是本机服务稳定性检查，不冒充新的网络/HMAC验收。运行身份比较排除 PID/时间戳/退出记录。失败输出 `INSTALL_FAILED gate=<阶段> exit=<退出码> collector_state=<实际状态> recovery=<恢复要求>`；校验器另输出 `HEARTBEAT_GATE_FAILED gate=<具体子门禁>`。若本次尚未开始修改则保持原服务；开始修改后失败只停止 Collector，不自动回滚，不改个人 Agent/timer。

可重复构建（仅源码与本地包，不安装）：

```text
node tools/wyz-schedule-collector/build-package.js
python tools/wyz-schedule-collector/build-upgrade-delivery.py --from-revision 6eea0ec099930f40d16cd3f0ea641e3572f9c675
```

新包全部源码与 Git HEAD 逐字节比对；不再从本地未跟踪的 Python 字符串生成升级脚本。当前任务不要求再次安装。用户已按原 heartbeat-only 门禁恢复 6ee 后，可经 PAM 传入已审查的新校验器，仅做只读核查（无学校访问/凭据输入/服务变更）：

```bash
python3 check-heartbeat-service.py --state active --health
```

未来另行批准升级时，在经 SHA256 核对并审查的 root-only 新包目录执行 `bash upgrade-candidate.sh --approve-install`。必须与 manifest 的 fromRevision 匹配；不支持对半完成的旧升级自动重试。保留 `BACKUP_PATH` 和 `rollback-backup.path`。未知 busctl 格式、缺少工具或任何 Gate 失败均停止，不能删掉门禁来恢复。

新辅助脚本失败后的代码回滚需另行批准。先人工核对 `BACKUP_PATH` 为本次 root-only `cas-mobile-backup-<UTC时间>`、其中 current.txt 等于 manifest 的 fromRevision 路径、目标 release 存在且不是 symlink，并确认 timer disabled/inactive、个人 Agent active。随后只停止 Collector，以本包原有 `rollback-schedule-collector.sh` 恢复 previous-install 指向（安装未完成时应人工核对 current.txt 并原子恢复 symlink），恢复备份 service/timer/drop-in，执行 daemon-reload。**先用本包校验器 `--state inactive --baseline "$backup/heartbeat-signatures.json"` 通过，才允许人工 start Collector，再执行 `--state active --health --baseline ...`。** Gate 不通过则保持停止，交由人工审查；保留 Session、auth-state、checkpoint、所有 Release，不恢复或删除认证历史。不把含私密信息的备份回传聊天。

本轮自动证据：隔离 Linux 完整升级/安装器 fixture 与真实本地 systemd 临时 unit；均不是 WYZ 安装验收。学校登录、sample、Oracle/CloudBase active、定时器、个人 Agent、微信发布和费用没有变化，仍受各自人工门禁约束。

此前 PR #88 用户 PAM 证据：已安装 `df4ed1e985630002f614d37db246a76dcaad65a8`；STAGE_A_INSTALL_PASS、Collector active/NRestarts=0、个人 Agent active、timer disabled。一轮 mobile 真实登录返回 SCHOOL_LOGIN_FORM_CHANGED，未建立 Session。以上为用户回传，本轮没有重新访问学校、Oracle 或 CloudBase。

修复候选延续 #88；详见 [CAS 修复记录](wyz-cas-mobile-repair.md)。mobile 现在映射 mobile-wechat，与 Windows 默认一致；显式 mobile-safari 仍可用。新增 auth-state 只读本机、diagnose-login 只检查获批的公开 CAS 页。旧错误码的直接触发点都在密码填写/点击前；不能据此退还旧计数，真实页面触发点待单独批准诊断。

表单/资源检查先于凭据提示，官方预检查保留、未知响应停止；独立阶段诊断不含正文或认证参数。认证 POST 预留预算后才放行，崩溃未确认的预留也消耗预算。30 分钟冷却、24 小时两次及 blocked 保护继续有效，不删除或重置历史记录。

安装、公开页诊断、一次真实登录是三个独立人工门禁。本轮升级前驱/回滚版本为 6eea0ec0；PAM-HANDOFF 固定提交与哈希，保留现有认证预算和 Session。新凭据只在 PAM 隐藏输入，聊天披露密码应先更换。登录成功不批准 sample/full、后端部署、timer 或发布。

### PR #89：公开页 POST 分类与后续样本门禁

最新 WYZ 公开诊断已经 navigationComplete、formPresent/三个输入按钮计数唯一、jsSubmit=true、无可见挑战、无来源阻断；随后错误来自旧守卫把所有非主认证 POST 归为密码重复提交。不能由 schoolRequests=24 推断后台 POST 的端点、用途或学校认证失败；实际放行密码次数为 0。

新守卫将未知官方后台 POST 阻断并标为 BACKGROUND_POST_UNREVIEWED，独立于认证预算/致命 policyError。公开诊断输出 formReady 与 networkCompatibility 两个状态：未知请求只能 REVIEW_REQUIRED、loginReady=false，并以 SCHOOL_LOGIN_NETWORK_REVIEW_REQUIRED 非零退出。只有已有审查证据明确为 optional 的公开端点才允许“非关键请求被阻断但兼容”；生产 REVIEWED_PUBLIC_POSTS 目前为空，不新增端点、域名或校验绕过。账号预检查仍由获批登录显式调用既有 GET，不允许公开页自动执行账户预检查。详见 [分类、升级、回滚及验收命令](wyz-cas-mobile-repair.md#本轮公开页-post-修复与交付)。

当前 auth-state 的 LEGACY_UNVERIFIED/blocked=true/预算1/日限2/冷却0 作为用户回传保留。diagnose-login 不读取凭据或 Session，也不写历史。解除 blocked 只能在问题修复、网络兼容性确认、无学校挑战且单独批准真实登录后，通过 --acknowledge-auth-failure；不删除状态文件，不退还旧预算，不越过冷却和日限。

后续闭环必须逐阶段批准，不把登录就绪当作采集或发布授权：

1. 候选安装另行批准；一次公开 CAS 页诊断。若 REVIEW_REQUIRED，停止，先取得批准范围内的端点/用途/固定参数证据，提交最小规则并复测；不反复请求学校。
2. 兼容性通过并单独批准一次移动登录：PAM 隐藏输入新密码；受保护页与候选 Session 新 context 均通过后原子保存。任何挑战/身份拒绝/结构/TLS错误停止。
3. Oracle 当前尚未部署 collector-manual.v1（用户事实）。先准备独立受控后端候选：锁定包含生产祖先的提交，跑 sample-contract/request-budget 与个人回归，备份原配置与版本，列出最小路由/权限 diff、回滚及健康指纹；部署须另行批准。管理员预设 enabled=false、无可领取任务，签名密钥沿现有 Collector 独立权限，不借用个人 Agent。受控部署结束只读验证 /api/full-sync/v1/status 的协议和指纹；CLI 不匹配协议时在学校访问前停止。不能声称 main 或本地测试已使现网协议生效。
4. 批准一个班级请求组：先确认学期/目录范围/权限和用途，再创建 entityLimit=1、限期（最多30分钟）和请求预算任务；并发1、900–1300ms间隔、幂等 GET 最多一次重试，认证/挑战/过期不重试。验证实际响应、节次、周次、来源与分页；失败不扩大范围。
5. 四类各一个获准样本，必须分别网络直采，allowDerived=false；不能把班级派生的教师/教室/课程作为独立来源。账号能登录不等于全部数据公开授权。
6. 有界四源经独立 HMAC、指定 runId/租约、checkpoint、请求预算、canonicalHash/隐私/来源校验上传 Oracle 私有 Staging，终态必须 PENDING SAMPLE REVIEW。服务端 sampleOnly=true、qualityBlocked=true、sample-not-publishable，不能被审核为正式 Release，也不切 CloudBase active。
7. 确认完整学校权限、频率与公开用途后才单独批准首次全量。Windows 人工同步保持共同的标准化/hash/Staging审核契约；其先后任务不可绕过租约或覆盖已审核的新数据。国内静态查询与个人版配置保持现状，不新增域名/付费资源。routine/full、timer、自动审核与正式发布继续锁定。

## Stage A 历史交付：统一交互式入口

分支 `codex/wyz-interactive-manual-sync` 延续PR #87。Windows登录、同步、应急上传保留；两端共用 `schoolLoginProfile.js`。原 Stage A mobile 使用 Safari UA；本次修复的映射以上节为准。两种移动配置均为390×844 viewport/screen、isMobile/hasTouch=true、scale=3；desktop使用桌面配置。Windows自定义UA优先级保留。这是移动模拟，不是原生Safari或学校真实登录证据。实际CAS页面/权限仍待核实。

安装后root-only `/usr/local/bin/fosu-collector` 指向current：

```bash
fosu-collector help
fosu-collector status
fosu-collector inspect
# 仅在批准首次真实学校登录后：不采集、不上传
fosu-collector login --login-profile=mobile --approve-school-access
# 另行批准一次学校只读检查后：不提交密码、不改Session
fosu-collector status --check-session --login-profile=mobile --approve-school-access
```

status默认只读本机/systemd和签名Oracle状态；缺文件为SESSION_FILE_MISSING，文件存在为PRESENT_UNVERIFIED，不假称认证成功。当前Oracle没有新 `collector-manual.v1` status/sample API，CLI保留本机结果并明确报告协议不可用；manual-sync在学校访问前以STAGING_SAMPLE_API_UNAVAILABLE停止。**login独立于Oracle，首次验收只登录；后端候选部署另行审批。**

账号和密码均从PAM TTY隐藏输入，不接受密码参数/管道，不写history/日志/长期配置。无TTY、取消、控制字符/多行粘贴停止并恢复终端。此前在聊天披露的密码应更换，再只在PAM输入新密码。默认仅使用一次；root管理员仍可能读取进程和持久Session，文件权限不能防范root。长期凭据配置仍是独立门禁，此CLI不读取或生成school-auth.json。

有效Session经受保护页验证后询问REUSE或LOGIN，其他回答停止。过期使用空上下文、既有官方CAS service/表单与一次密码提交；captcha预检、安全挑战、错误密码、页面/TLS/来源变化立即停止。Chromium请求/响应暂停检查每次来源和跳转，拒绝HTTP、其他域名及307/308密码POST重放，严格证书验证，不重试密码。

Session保存在root-only 0700目录内0600文件；school-session.lock独立于心跳锁，覆盖登录与采集。候选Session再次访问受保护页成功后才原子替换，失败保留原件。非敏感认证状态持久化30分钟冷却、24小时最多2次尝试和人工阻断；人工解决后 `--acknowledge-auth-failure` 只解除阻断，不取消冷却/日限。取消关闭浏览器/worker，保留既有Session/checkpoint。

### 受控样本：首次真实访问尚未批准

先另行批准并受控部署后端，再由已鉴权管理员经现有后台API创建限期任务，遵守Session/CSRF、scope、审计；不能把管理员Token粘贴到终端：

```text
POST /api/admin/schedule-collector/actions/sample
{"term":"2026-2027-1","sampleKind":"class","requestBudget":40}
```

任务30分钟有效、entityLimit=1、requestBudget≤120；只能按指定runId claim。class的一个实体是“专业/年级请求组”，可能含多个行政班，不能称单班。先验收class，再单独批准four（四类各一个请求实体）：

```bash
# 学校权限、范围和预算分别获批后；任务ID取自管理员返回
fosu-collector manual-sync --mode=sample --sample-kind=class --run-id=sc-实际任务ID --approve-school-access
fosu-collector manual-sync --mode=sample --sample-kind=four --run-id=sc-实际任务ID --approve-school-access
```

TTY需输入SAMPLE class/four确认范围。默认sample/class，routine/full在本阶段拒绝；后台既有routine/full保留原管理员门禁。常驻execute=0和timer不修改，manual-sync.lock不停止心跳。

共用Windows syncPlan、正规化、canonical hash和四个独立network-direct接口，allowDerived=false。并发1、间隔900–1300ms；预算包含浏览器学校资源。达到预算、CAS跳转、未知来源/任何样本HTTP重定向或接口异常停止，不能借跳转增加未计数请求。样本目录仅选首个学院/年级/专业，跳过多余教师/教室/课程目录；无权限或未知结构不生成ID、不派生补齐。

服务端按获批范围复验学期、来源、请求数、实体/事件数量和canonical hash；只进入私有不可变Oracle上传目录，PENDING SAMPLE REVIEW，coverageValid=false。sampleOnly硬拒绝普通finalize、staging-latest和publish（包括force）；不构建Release、不切active、不更新完整四源成功时间、不替换正式Staging。上传或复验失败非零退出，不能把登录成功称同步成功。

### 安装与回滚

候选包由已提交HEAD白名单git archive构建，receipt锁定commit/SHA256；含本手册/CLI/安装恢复脚本，不含本机配置、凭据、Session、raw或node_modules。**本轮未安装**。经PAM传入候选包和同commit的install-schedule-collector.sh、recover-release.py后，安装审批通过才执行，填入实际40位commit与64位SHA256：

```bash
cd /root/fosu-collector-install/交付commit
umask 077
backup=/var/lib/fosuclass/schedule-collector/stage-a-backup-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 "$backup"
readlink -f /opt/fosuclass/schedule-collector/current > "$backup/current.txt"
cp -a /etc/systemd/system/wyz-schedule-collector.service "$backup/"
cp -a /etc/systemd/system/wyz-schedule-collector.timer "$backup/"
if test -d /etc/systemd/system/wyz-schedule-collector.service.d; then cp -a /etc/systemd/system/wyz-schedule-collector.service.d "$backup/"; fi
systemctl stop wyz-schedule-collector.service
bash install-schedule-collector.sh wyz-schedule-collector-交付commit.tar.gz 交付SHA256
systemctl start wyz-schedule-collector.service
systemctl is-active wyz-schedule-collector.service wyz-campus-agent.service
systemctl is-enabled wyz-schedule-collector.timer
fosu-collector status
```

必须核对timer disabled/inactive、ExecStart仍heartbeat-only/execute=0、current为交付commit及90-heartbeat-acceptance.conf保留；不要重复一小时链路验收来处理缺Session。现有安装器检查依赖/浏览器、复用缓存；未知CLI文件/symlink目标停止，不能覆盖用户命令。

失败先停止全校Collector。安装完成时用 `rollback-schedule-collector.sh` 恢复previous-install；中断时以备份current.txt核对原bff路径后恢复managed symlink，并还原备份service/timer/dropins、daemon-reload后启动Collector。保留Session/checkpoint，不覆盖新数据、不删Release、不启动timer、不改个人Agent。wrapper在回滚到不含cli.js的bff时返回CLI_REVISION_REQUIRED，不影响旧心跳服务。root-only备份/凭据不得上传普通附件。

自动证据是隐藏TTY/权限/失败、Session生命周期、原生Chromium移动模拟（本机拒绝代理与合成CDP响应）、签名localhost上传及真正本地worker、预算/目录边界、Windows/个人同步及Linux安装fixture。最初浏览器fixture发现普通route漏拦截跳转，保留失败记录并补上请求/响应层门禁。这不证明学校当前TLS、CAS页面、账号权限或线上上传可用。下一步依次独立审批：仅登录→Session只读检查→class请求组→四类各一个→低频私有Staging；首次全量/长期密码/timer/发布/微信正式版/删Release/费用另行批准。

## 历史 A：此前安装和通信验收（已完成，无需重跑）

以下记录属于此前b1过程；当前bff与最新PASS见基线表。历史上传目录 `/root/fosu-collector-install/b1bc12f96692768d53004e2573e78e6bd5a62d5d/`。
包 SHA256：`44b893f7bddbc0aa08580b610fffd760955f07312de4ac7a9110ca307cf5498b`。

把仓库的 `deploy/wyz/accept-oracle-direct.sh`、`deploy/wyz/observe-oracle-direct.py` 经受保护 PAM 传到这个目录。脚本执行前可审阅；不用再运行已经完成的短时探针。

```bash
cd /root/fosu-collector-install/b1bc12f96692768d53004e2573e78e6bd5a62d5d
bash accept-oracle-direct.sh status
bash accept-oracle-direct.sh install
python3 observe-oracle-direct.py
```

已经得到 `ORACLE_DIRECT_STARTED` 时只运行最后一条。Python 3.6 使用本轮修正后的观察器；旧副本可就地修正：

```bash
sed -i 's/text=True/universal_newlines=True/g' observe-oracle-direct.py
python3 observe-oracle-direct.py
```

安装操作：校验 Node 20.20.2、包 hash、旧 current 指向、root-only Broker 文件和 disabled timer；停止全校 Collector；保留原 service/timer、代码指向、transport 和 checkpoint 的本机受保护备份；调用包原有安装器；原子替换 transport；只启动全校 Collector。安装器可能修复浏览器运行依赖，浏览器生命周期检查不访问学校。Broker env 不被读取、回显或重写。

transport 严格匹配包源码 schema：

```json
{"schema":1,"mode":"oracle-direct","originIpv4":"146.235.201.244"}
```

文件 root:root 0600，父目录 0700。URL、Host、SNI 仍为 `class.katelya.eu.org`，仅 socket 地址固定；公开 CA 与主机名验证开启，最低 TLS 1.2。root-only 的验收 runner 复用包原来的签名、有限重试和 30 秒心跳；`ExecStart` 中的 `env FOSU_COLLECTOR_EXECUTE=0` 覆盖 EnvironmentFile，不能被 env 中其他值误开启采集。

观察器只读取 journal 和 systemd 属性，无额外网络请求。保留 PAM 连接至少 60 分钟。输出包含成功数、失败尝试数、成功率、成功心跳最大间隔、观察到的失败窗口、TLS 授权、实际地址、重启数、PID 数。最大确认间隔是租约相关的保守观测值，并不等于连续网络监测得到的物理断网时间。只有完整窗口、至少 100 次成功、失败 0、最大间隔 <90 秒、重启 0、单一 PID、TLS 授权和实际源站地址一致才 PASS。PASS 仅放行通信，不放行学校访问或 timer。

2026-10-09 用户完成观察的汇总见 `docs/production/evidence/wyz-oracle-direct-20261009.json`：3605.86 秒，51 成功/19 失败，成功率 72.86%，最长确认心跳间隔 459.96 秒，重启 0、单一 PID、Collector active。成功样本 TLS 验证通过，实际地址是批准 IPv4；不能据此声称所有失败都是 TLS 正常或网络健康。后续被动诊断已确认个人 Agent active、重启0，Collector active、重启0，timer inactive。

此结果为 NOT_PASSED，不能维持现有 90 秒租约门禁。保持学校访问关闭、execute=0、timer disabled。下一步只做被动日志分层诊断，先区分 connect/TLS/response 与 timeout/reset/HTTP 拒绝；不重新安装、不重复短时探针，不通过延长租约、缩短安全冷却或关闭证书校验掩盖故障。

`deploy/wyz/diagnose-oracle-direct.py` 兼容 Python 3.6，只读取最近两小时 journal/systemd 并输出白名单错误、连接阶段、耗时及个人 Agent 状态。只计 oracle-direct 的 heartbeat-only 尝试，排除重复 cooldown 日志；与最近连接记录相隔超过20秒时标记 UNKNOWN，不猜测失败层。经 PAM 传到安装目录后运行 `python3 diagnose-oracle-direct.py`。根因修复审查后才重新开始完整60分钟验收。root-only 的 `acceptance/observation-*.json` 只有汇总；不回传 env/session/raw journal。

用户回传的被动诊断最近20条都是 connect 阶段 ETIMEDOUT，6002–6009毫秒，尚未建立TCP，未进入TLS；remoteAddress不可用不代表连接到了错误地址。两小时总窗口有ECONNRESET24/ETIMEDOUT28，但当时内联命令未按transportMode过滤，不能把52次全部归因于Oracle Direct。实际底层丢包位置（校园出口、跨境路径、OCI入口）仍未知。

源码中的 control agent 空闲超时5000毫秒低于心跳间隔30000毫秒，导致下次心跳通常重新建立TCP。候选只把 control pool 空闲生命周期改为75000毫秒，data pool仍5000；TCP/TLS建立上限6000、心跳请求15000、租约90000、重试/冷却、CA/SNI/HMAC均不变。本地真实TLS fixture等待30.5秒，旧5秒池重新连接，新池复用经过验证的TLS连接。它降低连接建立暴露频率，但不能证明校园/跨境路径故障已经修复。

后续人工验收用 `deploy/wyz/apply-control-keepalive.py`，只替换现有b1包的heartbeat-only验收runner，不安装B–F整包；绑定原runner SHA，保留0600原文件备份并原子替换，只重启全校Collector。默认dry-run；真实apply必须由用户在PAM执行。经PAM传入该脚本及更新后的观察器后：

```bash
cd /root/fosu-collector-install/b1bc12f96692768d53004e2573e78e6bd5a62d5d
python3 apply-control-keepalive.py --dry-run
python3 apply-control-keepalive.py --apply
python3 observe-oracle-direct.py
# 需要撤回本次runner修改时（不改代码current或transport）
python3 apply-control-keepalive.py --rollback
```

更新后的观察器补充成功连接的复用/新建次数与失败阶段，不降低原验收门槛。2026-10-10用户已在WYZ执行apply，备份control-keepalive-20261009T190406Z-1757992。最终后台观察3606.78秒，119成功/0失败、118复用/1新建、最长间隔30.57秒、TLS授权通过、实际地址146.235.201.244、重启0、单一PID、学校请求0、acceptance PASS，结束时个人Agent active。通信门禁通过；不需重apply/重启。学校访问、自动恢复、真实采集、定时与发布分别另行审批。此一小时实测不能证明永久稳定；长时间断网后的新TCP恢复仍需持续监控。

用户担心PAM自动退出时，可以只Ctrl+C停止前台观察器，再将它交给一次性systemd transient service；从后台启动时重新计满60分钟，不重启Collector/个人Agent、不重apply、也不发网络/学校请求。观察JSON本来已每30秒原子保存为root-only文件，旧部分样本保留。[systemd v239官方说明](https://raw.githubusercontent.com/systemd/systemd/v239/man/systemd-run.xml)确认transient service由服务管理器作为父进程，脱离调用终端；[RuntimeMaxSec说明](https://raw.githubusercontent.com/systemd/systemd/v239/man/systemd.service.xml)用于限制异常长运行。以下后台启动已由用户执行并回传完整PASS，仅为后续恢复参考，无需再次执行：

```bash
systemd-run --unit=fosu-oracle-direct-acceptance \
  --property=UMask=0077 --property=RuntimeMaxSec=3900 \
  "$(command -v python3)" \
  /root/fosu-collector-install/b1bc12f96692768d53004e2573e78e6bd5a62d5d/observe-oracle-direct.py
systemctl is-active fosu-oracle-direct-acceptance.service
```

确认active后可退出PAM。明天读取acceptance/observation-*.json中最新文件并核对durationSeconds≥3600和acceptance，再检查个人Agent；无需重启任何采集服务。观察器PASS后自行退出；NOT_PASSED会以1退出，只有观察unit失败，不等同Collector或个人Agent停止。unit已存在时不要强制覆盖/重启，先读取现有结果。

```bash
# transport 回到旧 Cloudflare 路径；仍保持 heartbeat-only
bash accept-oracle-direct.sh transport-rollback
# 同时恢复备份中的旧 current、service 和 timer；仍保持 heartbeat-only
bash accept-oracle-direct.sh code-rollback
bash accept-oracle-direct.sh status
```

安装中断也保留 last-backup 指向。快照内的 checkpoint 只作为灾难恢复资料，不在正常代码回滚时覆盖当前 checkpoint；需要恢复数据时先停止 Collector、核对路径和引用再人工还原。切勿删除旧 releases 或启动个人 Agent 的重装流程。

## 源站直连安全审计

本轮现有只读诊断任务 `37937099344` 成功：公网 443 可达、后端监听 loopback，Nginx/OpenResty 配置检查通过；主机 iptables INPUT 为 ACCEPT 并有 TCP443 ACCEPT，IPv6 INPUT 也是 ACCEPT。两个既有 vhost 均转发后端；没有发现专用 full-sync location。不能据此断言管理员 API 绕过已被禁止或 WAF 等效保护存在。

公开证书覆盖原域名；class 证书到期 2026-12-24 17:01:46 UTC。有效证书不证明自动续期已经配置或续期成功。OCI 安全组、Cloudflare 安全事件、告警投递与证书自动续期目前 UNKNOWN。

源码审计结果：

| 控制 | 已有机制 | 剩余限制/最小处置 |
| --- | --- | --- |
| Broker | 独立 Bearer Token、agentId、HMAC(method/path/timestamp/nonce/body hash) | Token 单独泄露不能签名；Token 与 Secret 同时泄露可冒充采集器，应轮换独立凭据并暂停任务 |
| 时间与重放 | 60 秒 skew、120 秒 nonce TTL，签名验证后记 nonce | nonce 存储是进程内；重启窗口、多进程一致性和容量限制需专项修复/验证 |
| claim/report/upload | 每路由 requireAgent；run、claimId、租约和 upload 归属检查 | 采集器不能 publish/rollback/admin；可提交恶意候选数据的风险仍由 Staging 复验和人工发布隔离 |
| 请求体 | Express JSON 限制，chunk 原始体限制，声明大小/hash/chunk 总数校验 | Nginx 的实际继承限制、IP 维度限频需新增源站只读审计确认 |
| 限流/客户端 IP | 现有全局 limiter 与可信代理解析 | 不能把 Cloudflare WAF 当成源站入口的安全前提；需验证源站伪造转发头不能突破管理员/限流控制 |
| 管理员 API | 应用层管理员权限、Cookie/Token 和 CSRF 已有本地回归 | 源站无凭据请求应拒绝；管理页面 HTML 200 本身不是授权绕过证据 |
| IP 变更 | pin 只允许批准 IPv4，TLS 失败停止 | 不能自动学习新 IP；先确认 OCI 地址及 TLS，再用审核包/策略回滚。无 HTTP 或 CA 旁路 |
| 故障 | 有限重试、5 分钟冷却、连续三次恢复才 claim、90 秒 watchdog | 学校 worker 停止，checkpoint 保留；断线不能表示“课表数据仍新鲜” |

新增 `deploy/wyz/audit-oracle-origin-security.sh` 通过同一只读工作流刷新真实部署 commit、Nginx 控制摘要及源站无凭据拒绝结果。它只输出白名单元数据；不导出配置、env、原始日志或私有部署位置。任何网络配置修复都先提供 diff、备份、回滚、鉴权与拒绝探针，等待审批；本轮不修改公网策略或已有 agent-broker 域名。

只读任务 `37945292721` 的结果：源站 `/api/admin/security/status` 无凭据为401、`/api/full-sync/v1/runs/claim` 无凭据为404，curl TLS校验结果0。404仅证明本次请求未获成功，不能单凭它区分路由隐藏和授权拒绝。加载的两组 Nginx 配置摘要未发现 limit_req/limit_req_zone、专用 full-sync location 或管理员网络限制；其中一组出现50m/8m body limit，class vhost 的具体继承仍需单独核实。不能把这个摘要描述成已完成443暴露面隔离。

PAM 安装输出的 10 项 server 依赖漏洞已用 npm 官方 registry 复核：3 moderate、5 high、2 critical。包括代理/IP 解析、HTTP 客户端、压缩、sm-crypto 和 XLS 解析依赖。完整清单只放本机审计输出，不执行 `npm audit fix --force`。现有依赖问题在 b1bc12f9 安装前已存在，单独限制下一次发布；学校登录和 XLS 行为必须经过专项兼容回归后才升级相关依赖。

## B：独立学校凭据与 Session 生命周期

现有 Windows `login.js` 和 WYZ Session 是两套入口；此前没有可证明可靠的生产密码恢复集成。候选新增 `schoolSession.js`，只在 WYZ 本机使用 `/etc/fosuclass/school-auth.json`；不与 `/etc/fosuclass/full-sync.env` 混放，不上传 Oracle/CloudBase。配置默认 `recoveryEnabled=false`。未来启用自动恢复还必须有学校允许的授权范围和有效的 approvedUntil，过期关闭自动恢复。

仅在批准长期储存后，通过 PAM 隐藏输入：

```bash
python3 /opt/fosuclass/schedule-collector/current/deploy/wyz/provision-school-auth.py
```

这是未来包含 B 代码的新包入口，b1bc12f9 **没有**该脚本。配置文件 0600、父目录 0700；已有文件不自动覆盖。密码不在参数、shell history 或输出中；没有交互TTY或getpass无法关闭回显时停止。WYZ 学校托管管理员拥有 root 时仍能读取文件和进程；600 不能对抗 root。应先确认学校同意长期托管学生凭据，优先使用经批准的最小权限专用账号；不在模型或普通聊天中交付凭据。

候选行为：启动校验现有 Session；正常页面确认后复用；过期时新建空浏览器上下文，正常 CAS 流程进行一次密码提交；pre-login 安全验证要求、滑块/风控/验证码立即停止；确切密码错误优先分类；选择器或页面标记变化停止；保存候选 Session 后再次校验才原子替换，不混用旧 Cookie。失败状态先持久化，30 分钟冷却、24 小时最多两次提交，密码错误/安全验证/结构/TLS 错误要求人工处理。禁止不确定 POST 自动重试。

本轮已移除 login/sync/sessionVerifier 的浏览器 TLS 旁路和相应不安全启动参数，自动学校流程拒绝 HTTP 和非批准源。四源浏览器 fixture 仅允许显式 fixture 模式下的 127.0.0.1 HTTP；生产 worker 不继承此标志。无法验证学校 TLS 时停止，不降级。

先另行批准并部署新包，进行一次只检查Session的学校访问：

```bash
cd /opt/fosuclass/schedule-collector/current
node tools/wyz-schedule-collector/maintain-school-session.js --approve-school-access --check-only
```

该模式不读取学校账号密码、不尝试登录、不修改Session或auth-state，无需停止Collector；结果为SESSION_VALID或SESSION_EXPIRED，挑战/结构/TLS异常立即退出，只输出允许的状态码。它仍会访问学校，当前不得自行执行。

长期凭据维护仅在独立批准长期储存后使用；本阶段优先上文一次性交互式login。学校锁独立于心跳锁，不需停止只做心跳的Collector，个人Agent不停止：

```bash
cd /opt/fosuclass/schedule-collector/current
node tools/wyz-schedule-collector/maintain-school-session.js --approve-school-access
```

命令与Collector共用school-session.lock，不并行登录。只维护Session，不全校抓取，不启用恢复或timer。实际CAS页面、captcha接口、学校TLS仍待人工批准验证；容器浏览器密码维护主动拒绝。WYZ已回传NATIVE_BROWSER=PASS。

正常登录通过后，自动恢复的独立授权文件可由root原子修改；审批有效期必须为未来且最多30天。获学校允许并由用户明确批准后才使用 `configure-school-recovery.py --approve-until <批准的UTC截止时间>`；`--disable`关闭恢复并移除有效期，保留凭据，不改Broker env、timer、Collector或个人Agent。Python3.6语法/到期边界在本地验证，root权限/原子保留/拒绝symlink须由Linux CI验证。Playwright DEBUG/PWDEBUG及网络NODE_DEBUG开启时拒绝凭据浏览器，防止调试输出包含账号或密码。

升级新包的实施计划：先提供commit、SHA256、CI、旧current和受保护备份；只停止全校Collector，使用既有安装器保留旧Release/浏览器/checkpoint/Broker env，timer仍disabled。当前`90-heartbeat-acceptance.conf`显式强制execute=0；验收runner由b1包生成，但require的是current目录，因此更换current后重启就会加载新代码，必须把这一步纳入安装审批并核对实际ExecStart/运行代码。保留execute=0门禁，只检查学校Session须另外批准；真实登录、首次试采与定时启用分别批准。安装失败恢复旧current/unit/dropin；全程不修改个人Agent，不启动真实学校采集或发布。需要撤销b1连接复用patch时，先恢复b1代码指向再调用其hash/版本绑定回滚工具，不能在新current下绕过版本检查。

人工处理后，只在核对账号、刷新 Session、确认已无挑战后，清理本机非敏感 auth-state 的阻断标记。不得清理标记来持续重试错误密码。学校试采始终先 `check-session`，再一实体诊断，最后首次完整四源；各门禁分开。

## C：Windows/WYZ 共用的 Staging 审核与发布

四类都来自各自 network-direct 接口；allowDerived=false。班级请求组数量不等于行政班数量，scheduleDocuments 独立统计。WYZ/Windows 的完整四源 plan 在 finalize、Staging safety 和 publish 共同调用服务端 `fourDirectSourceContract`。旧人工部分同步入口保留，但不得取得四源自动审核资格。

候选共同审核政策：

| 情形 | 结果 |
| --- | --- |
| 已验证的 canonicalHash 相同 | NO CHANGE，跳过构建/无意义上传和发布 |
| 覆盖率无效、任一源不完整/派生、失败/解析错误、异常空数据 | blocked，不允许强制越过 |
| 同类 scheduleDocuments 下降超过 10% | blocked，重新核查来源与覆盖率 |
| 首次 Release / 新学期 | 人工审核；新学期先 ready-only，不能自动切 active |
| 任何一类实体内容变化超过 5% / 无可靠内容变化指标 | 人工审核 |
| 同学期、四源合格、各类变化 ≤5% | 仅 eligibleForAutoReview；autoPublish 仍 false，需单独审批启用 |

内容变化从服务端公共课表计算，按实体和课程内容比较，课程顺序不形成虚假变化；不能相信 Collector 自报“变化很小”。阈值是候选保守政策，需要首次真实数据基线后审查，不代表已经适用于所有新学期。

现有 Windows Publisher 流程会先激活 Oracle 再镜像 CloudBase，失败显示 cloudbase-mirror-pending；这保持现有应急能力，但尚不满足“两个源版本文件先就绪才切 pointer”的完整要求。不得把目前候选描述成已上线的自动发布闭环。

候选新增共享 publication lock 与 expectedActiveReleaseVersion：同一 Oracle 存储上的服务器/发布工具互斥，晚完成任务发现 active 改变则拒绝；CloudBase pointer 拒绝低 epoch 写入。异常退出留下锁时先确认所有发布进程停止再人工解除，不自动猜测 stale lock。异机直接写 CloudBase 无法被本机锁物理覆盖；上线严格政策前须约束为唯一 Oracle 发布控制面。

`dualOriginPublication` 的本地契约已测试有序准备、完整校验、旧任务拒绝、镜像失败状态和幂等恢复。2026-10-10 候选补齐 `dualOriginReleaseService` 执行适配，接到既有管理员 Staging 发布接口；默认关闭，未部署/启用，不能声称跨源物理原子。受控上线顺序必须是：

1. 锁定审核通过的 Staging hash、学期、期望 active 和不可变 Release。
2. 完整构建并 deep verify；记录数据来源、质量、审核人/政策版本。
3. 准备 Oracle 备用版本文件，镜像 CloudBase 版本文件；逐文件 hash/size 校验并验证可读取。
4. 两个源均可用后，在共享锁内检查期望 active；以单调 epoch 激活 Oracle。
5. CloudBase 采用相同 Release/epoch，检查当前 pointer 后切换并复验；失败时记录 reconciliation-required，保留两份已验证文件与 last-good。
6. 重试先读真实 active，已完成的激活不生成另一 epoch；新任务已推进时旧任务拒绝，不覆盖新指针。

新适配在同一 Oracle 存储的发布锁内执行，锁凭据不可由 JSON 请求伪造。覆盖率/来源/下降门禁沿用同一 Staging safety；管理员 `release:publish` scope、现有写入鉴权仍必需。准备阶段 `prepareOnly` 不复制 runtime pointer、不删除历史文件；ready-only 新学期也采用此模式。按 manifest 对两个源的所有课表资源逐文件 HTTP 校验 hash/size，包含抽样遗漏的详情；TLS 必须验证，超时/重定向/缺失即停止激活。此校验只用于发布，不增加普通查询请求。

启用前必须另行审批 `FOSU_DUAL_ORIGIN_PUBLICATION=1`，并显式配置 `FOSU_CLOUDBASE_ENV_ID` 与 `FOSU_CLOUDBASE_HOSTING_BASE_URL`，确认 Oracle 的 CloudBase CLI/部署身份、静态目录和唯一发布写入方已配置。服务端不读取小程序配置或仓库tools，分发实现位于镜像已有的server/src/shared，旧CLI入口保留原配置默认值和函数契约。后台现有发布按钮从受保护的 status 读取模式；只有管理员主动发布时才带 `CONFIRM_DUAL_ORIGIN_PUBLICATION`。Windows 原命令默认保持现有流程；获批的严格模式通过 `--publication-confirmation=CONFIRM_DUAL_ORIGIN_PUBLICATION` 共用同一接口，后台生成的 Windows 命令也会附带该参数。配置错误或确认值错误会拒绝，不隐式退回另一种发布方式。自动发布仍为 false。

异常事件写入受保护的 `ops/dual-origin-publication/<releaseVersion>.jsonl`，只包含版本/hash/epoch、阶段、错误码、每源校验数量/正文 bytes。Oracle 已提交但 CloudBase 未完成时标记 reconciliation-required；保留文件和旧版本，不删除、不重建同一提交 epoch。CloudBase 失败回退前检查指针仍为本次候选；未知或被其他任务改变时停止写入，避免回退覆盖较新任务。跨主机独立 CLI 写入仍无法取得腾讯侧原子 CAS，必须通过运维/权限约束唯一 Oracle 发布控制面；本机锁不是跨云原子保证。

服务端受控恢复入口默认只做本地 dry-run：

```bash
node server/scripts/publish-prepared-dual-origin.js --release=<已审核不可变版本>
# 下行属于生产 pointer 写入：部署、身份、引用/回滚点和本次版本/hash 另行审批后才执行
node server/scripts/publish-prepared-dual-origin.js --release=<版本> --canonical-hash=<dry-run哈希> --expected-active=<本次审核基线> --execute --confirm=CONFIRM_DUAL_ORIGIN_PUBLICATION
```

若上次 Oracle 已提交，同一 plan 可完成 CloudBase 对账；若另一新版本已提交，旧 plan 会拒绝，需重新审核。dry-run 展示每源校验文件数及完整正文预算；这是发布验证成本，须加入月流量计算，不能只算用户查询。实际计费流量还受编码、CDN 回源和控制台计量影响；不把此本地正文预算称为已测账单。NO CHANGE 不重建或重发整个 Release。

版本激活及主动回滚使用严格递增 epoch；runtime pointer 使用本次激活 epoch，避免旧 manifest 的时间造成回滚版本被客户端当成倒退。激活内部异常恢复 active、兼容快照、学期索引/注册表和两个 Oracle runtime 文件，并复核恢复结果。仍需真实微信版本对这个协议的兼容验收。

2026-10-10 本地13项执行适配 fixture通过：默认关闭/确认/hash、未抽样详情缺失、旧任务拒绝、Oracle提交后中断与同epoch恢复、CloudBase超前拒绝、锁不可伪造、单调回滚、激活故障完整恢复、Windows原payload以及异步构建期间基线变化。全部 HTTP 为本机 fixture，生产写入/学校请求均0；不代表真实 CloudBase 发布通过。

## 定时排队的实际入口与审批

Collector 是常驻心跳服务，Linux timer 对已经运行的服务不产生额外抓取。Oracle 心跳处理才是任务排队入口；WYZ execute=0 不 claim 学校任务。已有 `FOSU_COLLECTOR_TIMER_VERIFIED=1` 仍需至少3次成功采集记录和人工启用审批；本轮没有设置它。

候选 `FOSU_COLLECTOR_SCHEDULE_POLICY=four-source-v1` 为另行审批的排队政策：周一至周六04:30 routine，周日05:00 full，周日不先排第二个 routine。默认窗口30分钟，可批准30–180分钟的窗口内补采；窗口外不补请求，避免网络恢复后全天自动访问学校。未知配置停止排队。未选择新政策时保留已有每日 routine 行为，后台不再把尚未排队的 full 展示成已安排任务。

排队任务和日期去重标记一起持久化，重复心跳及 Oracle 进程重载不重复排队；有未完成任务、暂停、会话/安全挑战阻断或失败冷却时不另起任务。新four-source-v1政策的3次启用基线必须有不同run ID、明确qualityBlocked=false和完整四源network-direct覆盖计数；缺证据的历史完成记录不能解锁新策略，legacy-daily原审批行为保留。失败冷却30分钟/2小时/6小时只作为限制，不表示已经实现无限自动重试；安全停止需人工恢复，不能在换日期时自动清除学校挑战。16项本地 fixture通过，生产 timer/学校频率未改变。
7. 回滚先确认自身仍拥有对应 commit/epoch，再使用受控回滚流程；不可盲目恢复一份旧备份覆盖别的发布。

现有工具的 mirror-only 不切 pointer：

```text
npm run cloudbase:release:sync-active -- --dry-run
npm run cloudbase:release:sync-active -- --execute --mirror-only
```

第二条仍是生产上传，必须人工批准。CloudBase cutover 还要求 `CONFIRM_CLOUDBASE_CUTOVER`、源版本校验和 rollback point。发布、镜像、指针验证、真机读取分别记录；命令返回和 CI 通过不是用户端验收。

## D：正式微信客户端缓存与快速刷新

已上线客户端读取公开 active 与同协议不可变 Release，不必为每次数据更新重新审核微信版本；但本轮代码中的刷新优化、TLS配置或域名变更要进入已安装正式客户端，必须发布新的微信构建。当前已上线包的精确 Git/buildId 和合法域名仍需微信控制台及真机诊断确认。

源码基线：启动先显示缓存；app onLaunch/onShow、全校页 onLoad/onShow 已有刷新；索引 TTL 7 天、详情 TTL 30 天、runtime 熔断 45 秒。此前并行 pointer 请求等待所有源，Oracle 慢可阻塞 CloudBase。候选让 CloudBase 先返回、Oracle 后台对账，已观察较新 pointer 持久化为高水位；不把缺失时间伪造成当前时间；30 秒合并同类检查；前台每30秒检查、所有客户端共享20秒query bucket，后台/页面卸载停止计时器；manifest/index 仍按版本校验再激活，失败保留 last-good。先前45秒检查+60秒bucket可能超过60秒目标，已缩短这两项，不靠降低刷新频率节省额度。

周次、筛选、个人课表和 UI 状态不因通用缓存清理被重置。版本清理只处理版本缓存；历史学期的 active/last-good 仍须额外完整引用审计。针对当前页面的首次/重新进入、后台返回、版本不变、慢 Oracle、坏 manifest、旧镜像、新学期和当前浏览周次都必须真机确认。

本地新增测试证明：快 CloudBase 不等待未完成 Oracle、晚到较新 Oracle 可对账、持久化不降级、30 秒去重、坏主源回退；实际app onShow/onHide管理30秒timer，模拟CDN按query缓存时覆盖20个bucket相位，下次30秒检查能发现刚发布的版本。既有四类搜索、版本缓存切换、周次/空教室隔离和个人路径回归通过；这是受控fixture，不是现网60秒证明。当前远端 `active.json` Cache-Control=120秒，query是否改变实际CDN key、国内P50/P95和真机浏览状态仍待验证；正式构建未发布这些优化。

首屏补测还发现b1基线的启动学期解析未读取已缓存runtime pointer，只有pointer+对应last-good、其它启动元数据缺失时无法立即显示缓存。原fixture失败已保留，本机隔离b1在补足合法pointer的fixture下也失败；候选启动先采用经过验证的cached pointer学期，再加载其last-good，避免按无关历史记录或旧bootstrap选择学期。保留立即显示和正确学期断言；网络失败仍使用本地数据，不重置用户浏览周次或筛选。

## E：个人版实际容量、流量与域名

先按一次用户操作理解成本：整个Hosting约385MB是服务器保存的版本文件，不是每位用户都下载385MB。当前公开版本的一次班级冷加载测量合计982,418 bytes（pointer+manifest+班级索引+一个详情，约0.98MB）；教师冷加载约2.11MB。已有缓存浏览不重新下载整表，版本检查本次pointer约3KB；实际页面还可能请求bootstrap/公告等，不能把这四项当成整次启动的完整流量。一次采集上传整份Release约197MB，和用户按需查询是两种不同的动作。

下面的DAU表是行为情景，不是实际账单或承载人数上限；每日全四源冷下载是压力情景，不能当作每位普通用户的日常行为。速度与及时性优先：不故意延后新版本、不降低必要采集频率、不把正常查询导回美国；优先压缩真正的HTTP传输、版本缓存、按需加载和去重。月真实用量及计费模式确认后再决定费用方案。当前官方同时有[资源点计费说明](https://docs.cloudbase.net/quick-start/resource-point)，而用户控制台提供的是固定配额证据，不能自动套用新购套餐或切换计费模式。

CLI 3.5.6，环境 `cloud1-d3g17rpe7566d3d5c`：ap-shanghai、个人版、prepayment、NORMAL、Hosting online。6979 个条目共 384,709,023 bytes；其中 active 3528 文件 197,085,521 bytes，旧正式版本 187,188,125 bytes，验证目录 43,532 bytes。未删除任何目录。月用量、额度剩余、超限不停服开关、账单实际折扣未通过 CLI 核实，不填 0。

[腾讯官方配额计费文档](https://cloud.tencent.com/document/product/876/75213)（页面更新 2026-08-31）明确个人版：云存储/数据库/知识库合计容量 3 GB，静态托管独立免费容量 1 GB，调用 20 万/月，存储流量 10 GB/月，CDN 回源 10 GB/月。调用包括 CDN 回源及存储/数据库/函数/认证/AI API；CDN 缓存命中的 HTTP 数不能直接等同全部计费调用，也不能一律视为免费。计算资源与函数出流量另计。

实际只读测量工具：

```text
node tools/cloudbase/measure-production-transfer.js
node tools/cloudbase/production-budget.js
```

每源读取 pointer、manifest、四类 all index 和各一份 detail，约 10 请求/源，不采集学校，不改资源。2026-10-09 测得 CloudBase 4,407,937 HTTP body bytes，全部 identity 编码；Oracle 456,871 bytes，gzip/br。CloudBase manifest 523,539；class index 385,844；teacher 1,529,351；classroom 567,639；course 1,051,037 bytes。CloudBase pointer 3,082 bytes；版本与 pointer 当前均 max-age=120。本机样本不是国内微信分位延迟；这里的下载正文不含 TLS/TCP/header 开销。不能把本地 gzip 文件大小替代这些实测值。

情景按 30 天、十进制 GB，使用当前公开 Release（未来真实四源 Release 大小未知）：

| 行为 | 每人每日 CloudBase HTTP 请求 | 每人每日正文 | 假设 |
| --- | --- | --- | --- |
| weekly-class-cache | 6.429 | 158,397 bytes | 仅底层班级链路：6次pointer；每周1次manifest+班级索引+详情，不含app四源预热 |
| daily-class-update | 12 | 4,145,855 bytes | 6次pointer；每天发布变更版本，当前app预热四种索引，再读manifest和一份班级详情 |
| cold-four-source-daily | 10 | 4,407,937 bytes | 每日全量下载本次测量的10项 |
| heavy-search-cache | 20.714 | 1,479,063 bytes | 每日10次 pointer+10份未缓存详情；全索引每周一次 |

| DAU | weekly-class-cache 月 GB | daily-class-update 月 GB | cold-four-source-daily 月 GB | heavy-search-cache 月 GB |
| --- | ---: | ---: | ---: | ---: |
| 500 | 2.376 | 62.188 | 66.119 | 22.186 |
| 1,000 | 4.752 | 124.376 | 132.238 | 44.372 |
| 2,000 | 9.504 | 248.751 | 264.476 | 88.744 |
| 5,000 | 23.760 | 621.878 | 661.191 | 221.859 |
| 10,000 | 47.519 | 1,243.757 | 1,322.381 | 443.719 |

monthly HTTP 数分别为 DAU×30×上述请求数。若回源率10%，weekly-class-cache/cold-four-source-daily/heavy-search-cache在500/1000/2000/5000/10000 DAU时的回源调用约：9,643/19,286/38,572/96,429/192,858；15,000/30,000/60,000/150,000/300,000；31,072/62,143/124,286/310,715/621,429。还需加动态 CloudBase API、上传、认证等调用。工具同时输出0%、10%、100%敏感性，真实回源率仍未知。

daily-class-update沿当前app的switchReleaseSafely(warmupTypes四种)计入新版预热，是模型而非真实微信账单：500/1000/2000/5000/10000 DAU的月HTTP数为18万/36万/72万/180万/360万，10%回源假设下计费调用为1.8万/3.6万/7.2万/18万/36万。它在500 DAU已超过10GB流量，而按既有超额价格假设的流量超额约10.96元/月，10000 DAU约276.25元/月；必须有超限不停服，且不含套餐/其它API/发布校验，实际账单仍待核对。单次班级冷读0.98MB不等于整个app换版下载量，后台预热同样计费；不能用weekly-class-cache的底层链路估计当前app完整日更消耗。NO CHANGE时不发布，不能把每天采集等同每天发布。每天6次pointer仅是表中假设，长时间前台浏览会增加检查，后续按真实前台时长重算；不为匹配该假设降低刷新频率。

官方超额存储流量0.21元/GB、回源0.15元/GB，Hosting超额容量0.005元/GB/天；只有超限不停服已开启时才按超额计费，否则有服务限制风险。10%回源假设下，三行为的流量超额费在500 DAU约0/11.79/2.56元，10000 DAU约7.88/293.94/96.24元；这些不含套餐、调用、容量、计算或其他消费，不能视为账单报价。

瓶颈依赖行为：高缓存的约2000 DAU已接近10 GB；每日冷下载500 DAU就超过流量额度。每份 Release 约197.1 MB，5份约985.4 MB已逼近1 GB，6份约1.18 GB。每月每日新增版本约增加5.91 GB Hosting上传内容，未清理时容量增长与 DAU 无关。不要把个人版解释成无限用户容量。

优先改进：版本不变不重复下载、索引合并请求和筛选分片、搜索防抖、详情按需、长缓存的不可变版本资源、active短缓存与可验证bust；验证 Hosting 真正压缩传输后重新计量。保留公开 JSON 协议，不能让旧客户端改读 .gz sidecar 而未经新构建验证。缓存/压缩配置都提供审批 diff 与回滚；不增云函数/数据库逐条课表，不购买固定费用服务。

用实际操作理解额度：~385MB表示服务器现在存放的两份Release，不是每位用户每天下载385MB。当前未缓存班级查询约4个课表资源请求、0.98MB；已缓存且版本不变时无需再下载课表正文，按前台刷新频率检查约3KB的active。换教师/教室/课程需要相应索引和未缓存详情，不能套用班级大小。发布一次完整约197MB的新版本会增加Hosting容量，双源全文件校验另外读取正文；这些与用户查询分别计量。这里不包含公告、bootstrap和其它API，也不等同已核实月账单。CLI3.5.6的hosting deploy帮助未提供压缩/header开关，不能凭本地.gz副本声称腾讯已压缩响应。需要官方支持的Hosting配置与真实HTTP复测后才报告收益。

[默认域名官方限制](https://docs.cloudbase.net/service/alias)和[静态 Hosting 文档](https://cloud.tencent.com/document/product/876/46900)说明默认域名仅适合开发测试。`wx.request` 目前能拿到 JSON 不等于符合长期正式分发要求。个人版允许1个自定义域名；上线前确认该环境已有域名额度使用、域名实际所有权与备案、Hosting给出的CNAME、证书、国内CDN节点、微信request合法域名和额外流量账单。需要可备案域名方案；当前域名是否具备备案条件未核实。

实施门禁：先提供域名/备案/CNAME/证书/成本计划，等待审批；无需新建 Cloudflare 域名，不修改 agent-broker。绑定后先只读验源、gzip与缓存、TLS/合法域名，再生成微信候选配置；未完成不能宣称国内生产数据面已终验。

2026-10-10再次核对[腾讯静态Hosting说明](https://cloud.tencent.cn/document/product/876/46900)：节点缓存与浏览器缓存分别配置，后匹配规则优先；缓存0会全回源，规则变更有1–3分钟生效窗口。待审批的最小缓存diff是不可变版本长缓存、仅runtime pointer短缓存（目标不超过20秒）并实测query key；先保留原规则作为回滚点，当前未修改。新[自定义域名接入说明](https://docs.cloudbase.net/service/custom-domain)区分边缘加速与其它接入，开启边缘加速有额外流量和请求费用；本项目不为缓存或备案默认启用它，也不把其费用套进现有固定配额模型。当前环境旧CDN/HTTP网关接入方式和JSON压缩能力仍需控制台核实。

## F：生命周期、监控与人工接管

候选 Collector 的旧“每次任务后直接 rm 旧 run”已经改为 `cleanup-plan.json` dry-run。保护当前 run、最近成功、每学期成功/失败恢复点、待审核、未知终态、缺失完成时间、保留期和 symlink；外部引用不完整时没有可删除候选。默认30天可配置，但只能按真实终态/引用，不能仅按文件创建或 mtime。计划给数量、实际文件字节、学期、引用理由及恢复边界；本轮 executeAllowed=false。

Windows Publisher 此前每次完成自动删除仅保留最近两次以外的终态 run，且镜像成功会自动调用 CloudBase 历史 Release 删除并内置确认文本。本候选把本机 run 清理改为同样只预览，保留失败/部分成功的断点、各学期恢复点、未知完成时间与外部引用。完成时间来自 receipt，不用 mtime 判定。`FOSU_PUBLISHER_RETENTION_DAYS` 默认30天；`FOSU_PUBLISHER_KEEP_RUNS` 只增加保护，不能授权删除。

Publisher 的旧 `FOSU_CLOUDBASE_AUTO_PRUNE` 和 `--prune-cloudbase` 现在最多请求只读清理预览，不提供 execute 或删除确认文本。Windows 采集/人工发布/镜像/恢复入口保持可用。独立历史删除工具仍需先完整引用审计和人工批准；本次没有使用其 execute 功能。生产版本未部署本候选，现网旧自动清理行为尚未因代码提交改变。

| 数据 | 保护及清理契约 |
| --- | --- |
| WYZ checkpoint、失败任务、分片 | 未确认上传/审核完成不清；保留断点和每学期恢复点；未来隔离期后再审批清理 |
| Oracle Staging/中间产物 | 关联 upload/run/build/审核/幂等事件；pending/running/failed可恢复任务保留；隔离与审计后处理 |
| Oracle Release | active、last-good、回滚点、学期索引与客户端合法引用保护；历史学期优先备份保留 |
| CloudBase Release | 对账两个 pointer、回滚及历史学期引用；容量预警不等于删除授权；本轮未执行 prune |
| 微信旧缓存 | 按版本命名空间；不得清除用户周次/筛选/个人数据；按学期active/last-good复核后回收 |
| 管理审计 | 与临时数据分离，按审计保留政策备份；不使用课表保留期自动删除 |

生产删除前必须展示：候选数量/空间、所有引用、历史学期/回滚/用户影响、隔离位置、备份校验和恢复命令；明确批准后再执行。未知客户端引用不是“无引用”。现有 CloudBase prune 即使带确认文本也不能替代完整引用审计。

健康指标由 `productionHealth` 分开计算，不汇总成一个 ONLINE：Collector进程/心跳、签名网络/TLS、真实采集与Session、审核、Release发布/镜像一致性、用户读取。这六个状态独立；尚无真实微信读取或延迟上报时 delivery 不会变绿。新增模块当前只是聚合契约，后台/CLI生产采集适配和微信诊断上报尚待受控集成，UNKNOWN 不算健康。

低成本运维计划：后台现有Collector/任务/Staging状态+结构化日志，15分钟低频pointer对账；每日检查最后成功采集/发布与容量；每周查看真实CloudBase账单趋势。120秒无心跳或TLS/认证失败升级为停止学校任务/人工处理；长期无采集、四源下降、审核积压、mirror pending、pointer漂移各自告警。证书剩30/14/7天和套餐/额度70%/85%/95%分别预警。已有渠道由管理员查看并确认通知接收者；本轮未向其他人发消息，也未开启定时服务或付费监控。

监控需要记录：lastSuccessfulCollectionAt、sessionValidity、90秒确认间隔、重启/租约、四源coverage/来源、Windows fixture门禁、pending-review、发布失败、两源pointer、lastPublishedAt、Hosting容量/流量/调用、刷新结果耗时与版本、国内查询分位/缓存命中。业务采集正常而用户读取未知时，不显示“端到端正常”。

### Windows 应急同步

完整保留 `tools/fosu-sync-client`、PowerShell、可见浏览器手动登录、断点恢复、上传和 `sync:publish`。不要从 WYZ 导出密码到 Oracle 或把个人课表混入公开 Staging。

```powershell
cd D:\Dev\VScode\FosuClass
npm run sync:login
npm run sync:publish -- --help
```

真实抓取仍需授权的校园网/VPN与Session；按现有Publisher审批/上传/质量/确认流程进行四源采集。遇WYZ故障先暂停它的新任务，保留checkpoint与签名凭据；Windows接管从同一Oracle审核控制面领取发布身份，不能与WYZ各自覆盖active。mirror-only用于恢复镜像而非重新登录/抓取。精确恢复runId、学期及Staging hash，不把另一个新run称作“断点恢复”。

### 灾难恢复次序

1. 停止新的采集/发布写入，确认运行中的任务状态与租约，不强杀个人 Agent。
2. 核对本机/Oracle备份、版本目录、checkpoint、Staging hash、两源pointer和回滚点。
3. 优先保持现有last-good可读；代码回滚不自动改数据pointer。
4. 数据回滚使用已审核不可变Release及新单调epoch，先验证文件存在、两源可读、合法域名/TLS。
5. 有序恢复控制面/镜像，查验健康与真实commit/版本；再由Windows或获批准WYZ恢复采集。
6. 完整源站/真机验收之后，单独审批自动恢复、自动审核资格和timer。任何UNKNOWN不得当成PASS。

## 本轮验证与接力事项

本轮已运行：依赖在独立worktree安装；网络23用例、TLS19用例；四源22套、个人采集51套、班级隔离26用例；Agent foundation 41套、regression 196套、ai-competition、final-convergence；学校Session、双源发布契约、写入fence、快速pointer（包括晚完成manifest）、retention、预算/六状态的新增fixture；`test:security-full`、`test:architecture-guards`、`release:preflight`。Windows的POSIX ownership/SIGTERM项目显式跳过，Linux CI必须补足。只有公开数据HTTP与Oracle只读诊断访问现网；学校请求0。

候选为 [draft PR #87](https://github.com/katelya77/FosuClass/pull/87)，暂以包含生产祖先的 b1bc12f9 准备分支为 base，不能直接把 main 作为生产部署候选。[WYZ/Linux 四源及隔离浏览器 CI](https://github.com/katelya77/FosuClass/actions/runs/37945281850)、[Public Security Gate](https://github.com/katelya77/FosuClass/actions/runs/37945207236)、[源站只读审计](https://github.com/katelya77/FosuClass/actions/runs/37945292721) 对 df02887e 已通过。后续提交仍需对应 CI，之前的成功不能替代新提交验证。测试生成的截图/审计文件不作为源码提交。WYZ已安装的仍是原b1包，不含B–F候选；Oracle和微信也未部署这些改动。

最终代码f5091282的[Linux四源/隔离浏览器CI](https://github.com/katelya77/FosuClass/actions/runs/37953237462)、[Public Security Gate](https://github.com/katelya77/FosuClass/actions/runs/37953062468)、[仅被动源站审计](https://github.com/katelya77/FosuClass/actions/runs/37953247047)全部通过，Linux补足POSIX ownership/SIGTERM及验收runner原子回滚。本地网络23、TLS20（含真实b1 factory兼容）、观察器10和被动诊断9通过；security-full/architecture/preflight再次通过。后续提交仅补写文档/公开验收证据。今晚生产冻结与明天恢复步骤见 `docs/production/handoff-20261009-night.md`。

10月10日代码补充后，本地重新运行foundation41/41、regression196/196、competition/final-convergence、四源23套、个人同步51套、双源执行15个fixture、旧CloudBase CLI工具、Session/凭据语法与到期边界、security-full/architecture。Windows缺少Docker的PG/Redis段保持UNVERIFIED，root权限/原子写入/symlink/SIGTERM须以Linux CI补足。ad2a8a2的[四源CI](https://github.com/katelya77/FosuClass/actions/runs/37980654372)和[Public Security Gate](https://github.com/katelya77/FosuClass/actions/runs/37980656013)通过；[Xiaofu CI失败](https://github.com/katelya77/FosuClass/actions/runs/37980655992)是本轮adapter读取小程序配置所引入，对照[b1基线CI](https://github.com/katelya77/FosuClass/actions/runs/37981370913)通过。已经修复为server共享factory及显式部署env，不削弱架构检查；最新提交的完整CI状态从PR #87对应commit读取，不沿用历史绿色检查。

未完成的生产门禁：学校长期凭据批准、真实Session与小范围四源试采；严格双源发布adapter的真实部署身份/验收及跨主机唯一写入约束；CloudBase压缩/缓存/备案域名方案与实际月账单；正式微信构建指纹/合法域名及国内真机SLO；完整历史引用清理和告警接收者验证。A通信验收已经通过，任务最终生产验收仍取决于这些后续证据，不能以“代码写完”代替。

68b4db73的[Linux四源/root凭据/隔离浏览器](https://github.com/katelya77/FosuClass/actions/runs/38022041766)、[完整Agent CI](https://github.com/katelya77/FosuClass/actions/runs/38022005677)、[Public Security Gate](https://github.com/katelya77/FosuClass/actions/runs/38022005686)已全部通过；[只读源站任务](https://github.com/katelya77/FosuClass/actions/runs/38022045693)再次确认a3dfd198且configurationChanged=false、schoolRequests=0、wanRequests=0。随后补充的新策略资格与日更预算需在最新PR head再次核对CI，旧检查不替代最新提交。

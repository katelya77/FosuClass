# WYZ CAS 移动端故障修复记录

日期：2026-10-10。范围：PR #89 基于 d2ef1758 的增量 CAS POST 修复，延续 PR #88 Stage A；不部署、不访问学校、不采集、不改正式指针、timer、个人 Agent 或付费资源。下方早期定位记录为历史证据；最新状态以“本轮公开页 POST 修复与交付”为准。

## 已知事实与定位限度

用户 PAM 确认已安装 `df4ed1e985630002f614d37db246a76dcaad65a8`，Collector active、NRestarts=0、个人 Agent active、timer disabled；单次 mobile 登录返回 `SCHOOL_LOGIN_FORM_CHANGED`，尚无 Session。既有 Oracle Direct 一小时心跳 PASS 继续保留。

该提交中此错误码的直接触发点均位于密码填写和点击提交之前。但旧版在进入 adapter.login 前就增加预算，且没有请求阶段记录。因此可确认本地统计缺陷，不能倒推实际学校认证请求数量、退还历史预算或断言真实故障就是某个 DOM 变体。

| 旧路径可能触发点 | 新诊断阶段 / 错误 | 本轮证据 |
| --- | --- | --- |
| 导航后未处于预期 CAS 登录页 | cas-navigation / SCHOOL_LOGIN_FORM_CHANGED | 固定来源及完整 Service 断言；真实页面待批准诊断 |
| 写死 username/password/login_submit ID | account-field、password-field、submit-button / 各自 CHANGED | 原生 Chromium 合成 name-only 表单：修复前复现旧错误，修复后 PASS |
| 异步加载、合法账号密码标签尚未就绪 | cas-load、account-tab、form-selection | 异步插入、隐藏表单标签切换 PASS |
| form.action / 提交方法不符合预期 | form-action、form-method / TLS_OR_ORIGIN_REJECTED 或 SUBMIT_CHANGED | 不可信 Service 阻断；标准 form、button、input 及同路径 JS 场景 PASS |
| 预检查 HTTP 失败、非 JSON 或 isNeed 不是 boolean | precheck-response / PRECHECK_FAILED、PRECHECK_CHANGED | 支持既有客户端已用的 boolean/string isNeed、needCaptcha、boolean 本文；未知响应停止 |
| 来源策略拒绝关键脚本、样式，随后表单缺失 | resource-policy / RESOURCE_REJECTED | 拒绝合成外域脚本并独立报告；没有增加可信域名 |
| 普通“账号或密码”“验证码”“风险”提示 | page-credential-error、challenge-before-password | 去掉宽泛单词判定；可见核验控件、明确要求或官方预检查 true 仍停止 |
| CAS 已提交、结果拒绝或未完成 | authentication-request/released/response/result | 单次放行、有界等待；重复 POST、307 回放与不可信跳转阻断 |
| 登录落地页看似成功但受保护页面无效 | protected-session-check | 再次访问受保护教务页、候选 Session 新 context 校验后才原子保存 |

真实故障原因仍需获批的 WYZ 脱敏公开页诊断确认。没有原始 HTML、截图、学校接口响应或 HAR 证据；不能把本地 fixture 当作学校验收。

## 适配与安全边界

Windows 与 WYZ 共用 schoolLoginProfile、schoolCasPage 选择器集合。`mobile` 明确映射 `mobile-wechat`，与 Windows 默认微信 iOS UA 一致；`mobile-safari` 为显式 Safari UA。两者 viewport/screen=390×844、isMobile/hasTouch=true、scale=3、严格 TLS。Chromium 模拟不等于原生 iOS 浏览器验证。Windows 自定义 UA 优先级、可见浏览器人工入口和同步链路保留，导航回退保留完整 CAS Service。

WYZ 先完成资源加载及有界稳定检查，再请求隐藏凭据。候选必须唯一、可见且属于密码表单/已知登录容器；允许一次明确账号密码标签点击，不生成表单或调用猜测的 JS 函数。JS 支持证据仅来自本地 fixture：点击页面自身按钮，同一个已审核 `/authserver/login` POST 路径，随后受保护页确认；学校实际 JS 流程仍待核实。

CDP 逐跳审查 Request/Response，来源白名单仍只有 authserver.fosu.edu.cn 和 100.fosu.edu.cn。未批准第三方资源不加载；关键脚本/样式拒绝独立报告。密码阶段阻止 GET 导航或非审核 POST，认证 POST 同步占用一次性槽，禁止并发二次提交。官方 checkNeedCaptcha.htl 仍原路径、严格 TLS、maxRedirects=0；没有伪造或省略预检查。未知结构、挑战、错误密码、TLS、网络错误均非零停止，不重试密码。

诊断只含固定阶段、计数、布尔值、HTTP 状态及错误码，不含学号、密码、Cookie、Ticket、完整 URL 查询、隐藏字段、CSRF、网页正文/截图。`diagnose-login` 不填字段、不读旧 Session、不做需要账号的预检查、不保存 Session、不写认证保护记录；未经审核的页面 POST 被拒绝并独立分类。

## 认证预算与崩溃恢复

school-auth-state.json 原有 attempts/windowStart/cooldownUntil/blocked 保留，root-only 读取。损坏状态停止，不能默认空记录。新增字段区分 local_preflight、authentication_rejected、submission_outcome_unknown，以及 reserved_unknown、released、response_received。

只有 CDP 捕获即将放行的审核认证 POST 后才持久化预算预留，写入 mode 600、fsync、原子 rename、目录 fsync，再允许浏览器继续。崩溃发生在预留与放行间仍消耗预算；released 表示浏览器放行命令完成，不能证明学校收到了请求；response_received 是认证响应证据。旧计数标记 LEGACY_UNVERIFIED，绝不按错误码自动扣回。

未提交时的本地识别失败不新增预算，但仍保留 30 分钟冷却和结构/安全/TLS blocked 保护。人工确认仅解除继续尝试的 blocked 门禁，不绕过冷却或 24 小时两次预算。既有成功 Session 可以显式复用；新会话在验证完成前不会覆盖旧会话。

## 验证与真实访问门禁

本机：原始红色 name-only Chromium 回归已复现；移动浏览器覆盖标准及 JS 按钮、异步页、标签、预检查和来源拦截；既有浏览器 4 场景、认证证据 9 组、CLI 24 组和 Session 生命周期通过。要求命令 test:wyz-four-source（23组）、test:collector-personal-regression（51组）、test:security-full、test:architecture-guards、release:preflight 均通过。最终移动场景数量及 Linux 权限/安装、Agent、Gitleaks 以修复 PR 的最终提交 CI 链接为准，不以本机 Windows 结果替代。

安装包及独立修复 PR 延续 #88→#87 的祖先关系，不合并。源码包由 git archive 固定提交生成、SHA256 校验；包内 PAM-HANDOFF 提供本次精确提交、源包哈希、升级与 df4ed1e9 回滚步骤。

以下命令分开批准，不能串成自动重试流程：

1. 新候选安装后离线检查：`fosu-collector auth-state`。无学校或 Oracle 请求；只反馈预算、冷却和 blocked 状态。旧 df4ed1e9 尚不支持此子命令。
2. **单独批准公开 CAS 页诊断后**：`fosu-collector diagnose-login --login-profile=mobile --approve-school-access`。无需账号密码；检查资源/表单阶段。失败停止，只回传白名单状态。
3. **诊断完成并单独批准一次真实登录后**：`fosu-collector login --login-profile=mobile --approve-school-access`。若原记录 blocked，人工处理且冷却/日限允许后加 `--acknowledge-auth-failure`。先更换聊天中已披露密码，新凭据仅在 PAM 隐藏输入，不能回传聊天。

登录成功要求 SESSION_SAVED、sessionChanged=true、passwordPersisted=false 及 protected-session-valid；这不批准采集、Staging、全量、timer 或发布。失败立即停止，不切换桌面反复尝试。

回滚只恢复 df4ed1e9 的代码/服务文件和已备份 drop-in，保留当前 Session、认证预算/冷却记录和采集产物；不复制旧保护记录覆盖新记录。既有一小时网络验收无需重做。首次真实诊断和登录均是本轮停止点。

## 本轮公开页 POST 修复与交付

最新用户 PAM 证据：WYZ 运行 6eea0ec0，服务已恢复，heartbeat-only/execute=0、timer disabled、个人 Agent active；无须重新诊断已通过的 Oracle 网络。公开 mobile-wechat CAS 导航、唯一表单和 JS 按钮均已识别；随后 PASSWORD_RESUBMISSION_BLOCKED，实际 passwordSubmissions=0、submissionReservations=0、authResponseReceived=false。可确认旧守卫将任何非主认证 POST 拒绝时都写入同一个致命 policyError，导致已完成 form-ready 仍报“重复密码”。真实 POST 的具体端点与用途未知，不能判为验证码或密码错误。

本地原生 Chromium 已复现旧错误；修复引入 schoolRequestPolicy，与浏览器调度/预算分开。没有增加任何生产后台 POST 规则，REVIEWED_PUBLIC_POSTS=[]；只有合成 fixture 提供已审查的固定公开参数规则。真实新增规则须先核实官方来源、端点、用途、固定非敏感参数和必要性，再独立代码审查，不能由运行参数任意添加。

| 事件 | 处置与证据 | 错误/兼容性 |
| --- | --- | --- |
| 已信任来源 GET/HEAD 资源 | 继续逐跳审查；严格 TLS | 来源不可信则停止，关键脚本/样式独立报告 |
| 未审核官方后台 POST | 阻断，背景计数+1，不污染认证 policyError/提交计数 | BACKGROUND_POST_UNREVIEWED；REVIEW_REQUIRED，非零 |
| 已审核公开 API，固定参数符合 | 仅允许该端点及固定 JSON 字段/值；凭据阶段不允许此规则放行 | REVIEWED_PUBLIC_PARAMETERS；当前仅合成验证 |
| 已审核 optional 公开 API 参数不符 | 阻断，明确非关键计数 | COMPATIBLE_WITH_NONCRITICAL_BLOCKS；未知端点不得使用此状态 |
| 页面自己发起账户预检查 POST | 公开诊断不执行账户预检查，阻断 | ACCOUNT_PRECHECK_NOT_AUTHORIZED；REVIEW_REQUIRED |
| 显式获批登录的既有预检查 GET | 填账号后、密码前；无重定向，未知结构/要求挑战停止 | APPROVED_ACCOUNT_PRECHECK；公开诊断不会运行 |
| 未 armed 的 CAS 主认证 POST | 阻断，不预留预算，不视为实际密码提交 | SCHOOL_AUTH_POST_NOT_AUTHORIZED |
| 一次已 armed 主认证 POST | 同步 claim 后持久化预算预留，才释放；响应与释放证据分开 | ONE_REVIEWED_AUTHENTICATION_POST；最多一次 |
| 已 claim 后的另一主认证 POST | 阻断，不新增预算 | SCHOOL_PASSWORD_RESUBMISSION_BLOCKED |
| 密码填写但尚未预算预留时的其他请求 | 阻断并停止，防止未审查凭据传输 | SCHOOL_CREDENTIAL_REQUEST_BLOCKED |
| 外域/错误 Service/不可信跳转或 POST 307/308 回放 | 保留第一处真实来源错误，不被 POST 分类覆盖 | SCHOOL_TLS_OR_ORIGIN_REJECTED |

request-classification 只输出 methodCategory、originCategory、endpointCategory、resourceType、authenticationEndpoint、browserInitiated、blocked、固定 reason 和 authenticationReleased。不会输出原始路径/query/body/headers。公共摘要区分 formReady 与 networkCompatibility；未知请求即使表单存在也不能称为可登录。form-ready 后增加有界等待和再次安全扫描，迟到的挑战/结构变更仍停止。浏览器退出为 SCHOOL_AUTH_BROWSER_CLOSED，信号取消为 COLLECTOR_STOPPED，finally 关闭浏览器并释放锁。

本轮本地合成回归覆盖 20 个原生 Chromium POST/CLI/Session 场景、既有 27 个移动表单场景、ZIP 8 组（Windows及Linux）；认证证据、CLI与完整四源/个人/安全/架构/preflight 另运行。真实 Chromium 不等于真实学校或原生 iOS 验收；学校联网次数为0。WYZ/Linux、Windows兼容、Agent及Gitleaks以本次最终提交 CI 为准，旧绿色 d2ef1758 不替代新提交。

### 分开批准的 PAM 步骤

候选前驱必须为 6eea0ec099930f40d16cd3f0ea641e3572f9c675。交付的 ZIP 和源码 tar.gz 各有 SHA256，先核对最终交付 receipt 中的 ZIP 哈希。新包尚未安装，本轮不会自动部署。

**仅另行批准安装后**，把 ZIP 上传 root-only 目录，从该目录执行（ZIP_FILENAME/ZIP_SHA256 替换为交付的准确值）：

```bash
set -Eeuo pipefail
umask 077
zip=ZIP_FILENAME
digest=ZIP_SHA256
printf '%s  %s\n' "$digest" "$zip" | sha256sum -c -
# 已固定哈希的 ZIP 中提取唯一辅助文件，兼容 ZIP 内层目录。
python3 - "$zip" <<'PY'
import sys,zipfile
from pathlib import Path,PurePosixPath
with zipfile.ZipFile(sys.argv[1]) as z:
    names=[n for n in z.namelist() if PurePosixPath(n).name=='unpack-candidate.py']
    if len(names)!=1: raise SystemExit('HELPER_NOT_UNIQUE')
    with Path('unpack-reviewed.py').open('xb') as out: out.write(z.read(names[0]))
PY
python3 unpack-reviewed.py "$zip" "$digest" normalized-candidate
cd normalized-candidate
sha256sum -c source.sha256
bash upgrade-candidate.sh --approve-install
python3 check-heartbeat-service.py --state active --health
fosu-collector auth-state
```

归一化器在写文件前核对 ZIP SHA、唯一内层根、路径/重复/链接、源码 SHA、LF checksum 与 helper/source 逐字节一致；目标已存在时停止，不覆盖其它工作区。升级器只恢复 heartbeat-only，保留 Agent、timer、凭据/Session/认证历史。记录 BACKUP_PATH；任一 Gate 失败停止，不能重复执行安装掩盖问题。

**公开页访问单独批准后，仅执行一次**：

```bash
fosu-collector diagnose-login --login-profile=mobile --approve-school-access
```

回传白名单阶段/分类/计数即可。若 formReady=true、networkCompatibility=REVIEW_REQUIRED、loginReady=false，说明分类修复有效但实际端点兼容条件未满足，停止；不要输入凭据。未知请求用途需要另行批准的最小证据核查，不能自动扩大来源或 POST 范围。

**兼容性满足、人工确认无安全挑战且单独批准一次真实登录后**：先更换聊天中披露的密码；新凭据只在 PAM 隐藏输入。auth-state 冷却=0、日预算<2 才可继续，blocked 历史不得删除。人工确认处理了旧失败后：

```bash
fosu-collector auth-state
fosu-collector login --login-profile=mobile --approve-school-access --acknowledge-auth-failure
```

acknowledge 不重置旧日预算，只有下一次审核认证请求预留时才解除 blocked，仍受冷却/两次日限。成功必须 SESSION_SAVED、passwordPersisted=false、protected-session-valid；失败停止，不自动重试、切 PC 或开始 sample。Oracle collector-manual.v1 尚未部署，后续受控计划见主 runbook 的“公开页 POST 分类与后续样本门禁”。

### 另行批准的代码回滚命令

从本次 normalized-candidate 目录开始；先人工核对 rollback-backup.path 是本次 BACKUP_PATH、root-only 目录、current.txt 指向 6ee release，备份 service/timer/drop-in 未变更且不含 symlink。只恢复代码和 unit，不恢复认证预算、Session 或 checkpoint。以下命令中任何一步失败即停止 Collector，交由人工检查：

```bash
set -Eeuo pipefail
umask 077
unit=wyz-schedule-collector.service
base=/opt/fosuclass/schedule-collector
state=/var/lib/fosuclass/schedule-collector
backup=$(cat rollback-backup.path)
[[ $backup =~ ^/var/lib/fosuclass/schedule-collector/cas-mobile-backup-[0-9]{8}T[0-9]{6}Z$ ]]
[[ -d $backup && ! -L $backup && $(stat -c %u:%a "$backup") == 0:700 ]]
old=$base/releases/6eea0ec099930f40d16cd3f0ea641e3572f9c675
[[ $(cat "$backup/current.txt") == "$old" && -d $old && ! -L $old ]]
[[ ! -L $state/upgrade.lock ]]
exec 8>"$state/upgrade.lock"
flock -n 8
python3 check-heartbeat-service.py --state inactive --baseline "$backup/heartbeat-signatures.json" ||
  python3 check-heartbeat-service.py --state active --baseline "$backup/heartbeat-signatures.json"
trap 'systemctl stop "$unit"; exit 1' ERR
systemctl stop "$unit"
ln -s "$old" "$base/current.rollback.$$"
mv -Tf "$base/current.rollback.$$" "$base/current"
cp -a "$backup/wyz-schedule-collector.service" /etc/systemd/system/
cp -a "$backup/wyz-schedule-collector.timer" /etc/systemd/system/
cp -a "$backup/wyz-schedule-collector.service.d/." /etc/systemd/system/wyz-schedule-collector.service.d/
systemctl daemon-reload
python3 check-heartbeat-service.py --state inactive --baseline "$backup/heartbeat-signatures.json"
systemctl start "$unit"
python3 check-heartbeat-service.py --state active --health --baseline "$backup/heartbeat-signatures.json"
trap - ERR
```

不 enable timer，不启动/停止个人 Agent，不更改 Oracle/CloudBase active。若实际备份或状态与前提不符，不执行这段代码；保持停止并审查具体 Gate。历史生产 Release 和用户本机配置均保留。

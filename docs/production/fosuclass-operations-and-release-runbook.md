# 佛课小表生产运维与发布接力手册

状态日期：2026-10-09，Asia/Shanghai。此文区分正在运行的生产系统、候选代码、本地 fixture 和人工验收；任何一项通过不能替代其他项。

## 生产基线和门禁

| 项目 | 本轮证据 | 状态 |
| --- | --- | --- |
| GitHub main | fetch 后 `5c8db23e0bf209687a7e5086654dafe0adbc93f8` | 已核实 |
| PR #82–#86 | GitHub 查询为 MERGED | 已核实 |
| PR #79/#81 | GitHub 查询为 OPEN | 保留，未合并或修改 |
| 生产祖先 | 只读源站审计 `37945292721` 再次确认 `a3dfd1989705f51c921f13883bcde1cce4502883` | 本轮真实指纹；未部署候选 |
| 本轮候选基线 | `b1bc12f96692768d53004e2573e78e6bd5a62d5d` 同时包含 main 与生产祖先 | 防止丢失班级隔离及公告表情行为 |
| Oracle / CloudBase active | 两个正确公开路径均返回 `2026-10-07T19-12-39`，学期 `2026-2027-1`、相同 epoch | 本轮只读核实 |
| WYZ 安装 | 用户 PAM 回传 `SOURCE_INTEGRITY=PASS`、`INSTALL_COMPLETE`、`TRANSPORT_SCHEMA_PASS`、`ORACLE_DIRECT_STARTED` | b1bc12f9 已人工安装 |
| WYZ 原版本 | 用户 status 回传 `2b80222e9cf4846a1545aecbb7975359e7a37707` | 旧目录与 checkpoint 已保留 |
| WYZ 60 分钟观察 | 用户 PAM：3605.86 秒，51 成功/19 失败，72.86%，最大确认间隔 459.96 秒 | NOT_PASSED，学校访问与 timer 门禁继续关闭 |
| 正式微信构建版本/合法域名/真机刷新 | Git 配置和本地开发者工具配置不能证明已上线包 | 未核实，人工门禁 |

当前常用工作区路径是指向 `D:\Dev\VScode\FosuClass` 的 junction，有用户未提交的两份 project 配置。本任务使用独立 worktree；不得用候选覆盖这些配置。main 尚不包含全部生产祖先；不能仅因“最新 main”而部署。

生产门禁保持：学校访问未批准；`execute=0`；timer disabled；自动发布关闭；生产 pointer、DNS、防火墙、代理、个人 Agent、微信正式版、付费资源均不由本轮 Agent 自动修改。所有手册中的生产写命令由人工在对应门禁批准后执行。

## A：现有包的 PAM 安装和持续通信验收

现有上传目录 `/root/fosu-collector-install/b1bc12f96692768d53004e2573e78e6bd5a62d5d/`。
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

2026-10-09 用户完成观察的汇总见 `docs/production/evidence/wyz-oracle-direct-20261009.json`：3605.86 秒，51 成功/19 失败，成功率 72.86%，最长确认心跳间隔 459.96 秒，重启 0、单一 PID、Collector active。成功样本 TLS 验证通过，实际地址是批准 IPv4；不能据此声称所有失败都是 TLS 正常或网络健康。个人 Agent 在安装前为 active，本次最终状态尚未回传。

此结果为 NOT_PASSED，不能维持现有 90 秒租约门禁。保持学校访问关闭、execute=0、timer disabled。下一步只做被动日志分层诊断，先区分 connect/TLS/response 与 timeout/reset/HTTP 拒绝；不重新安装、不重复短时探针，不通过延长租约、缩短安全冷却或关闭证书校验掩盖故障。

`deploy/wyz/diagnose-oracle-direct.py` 兼容 Python 3.6，只读取最近两小时 journal/systemd 并输出白名单错误、连接阶段、耗时及个人 Agent 状态。只计 oracle-direct 的 heartbeat-only 尝试，排除重复 cooldown 日志；与最近连接记录相隔超过20秒时标记 UNKNOWN，不猜测失败层。经 PAM 传到安装目录后运行 `python3 diagnose-oracle-direct.py`。根因修复审查后才重新开始完整60分钟验收。root-only 的 `acceptance/observation-*.json` 只有汇总；不回传 env/session/raw journal。

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

这是未来包含 B 代码的新包入口，b1bc12f9 **没有**该脚本。配置文件 0600、父目录 0700；已有文件不自动覆盖。密码不在参数、shell history 或输出中。WYZ 学校托管管理员拥有 root 时仍能读取文件和进程；600 不能对抗 root。应先确认学校同意长期托管学生凭据，优先使用经批准的最小权限专用账号；不在模型或普通聊天中交付凭据。

候选行为：启动校验现有 Session；正常页面确认后复用；过期时新建空浏览器上下文，正常 CAS 流程进行一次密码提交；pre-login 安全验证要求、滑块/风控/验证码立即停止；确切密码错误优先分类；选择器或页面标记变化停止；保存候选 Session 后再次校验才原子替换，不混用旧 Cookie。失败状态先持久化，30 分钟冷却、24 小时最多两次提交，密码错误/安全验证/结构/TLS 错误要求人工处理。禁止不确定 POST 自动重试。

本轮已移除 login/sync/sessionVerifier 的浏览器 TLS 旁路和相应不安全启动参数，自动学校流程拒绝 HTTP 和非批准源。四源浏览器 fixture 仅允许显式 fixture 模式下的 127.0.0.1 HTTP；生产 worker 不继承此标志。无法验证学校 TLS 时停止，不降级。

真实维护命令在另行批准、部署新包且停止 Collector 后运行：

```bash
cd /opt/fosuclass/schedule-collector/current
node tools/wyz-schedule-collector/maintain-school-session.js --approve-school-access
```

命令与 Collector 共用本机锁，不并行登录。只维护 Session，不全校抓取，不启用自动恢复或定时器。原子替换、审批、限次、冷却、挑战停止等已有本地 fixture；实际 CAS 页面、checkNeedCaptcha 接口、学校 HTTPS 链路仍待小范围人工批准验证。容器浏览器的密码维护当前主动拒绝，不能把 native fixture 冒称容器支持；本次 WYZ 已回传 NATIVE_BROWSER=PASS。

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

`dualOriginPublication` 的本地契约已测试有序准备、完整校验、旧任务拒绝、镜像失败状态和幂等恢复。生产 adapter 尚未启用，不能声称跨源物理原子。受控上线顺序必须是：

1. 锁定审核通过的 Staging hash、学期、期望 active 和不可变 Release。
2. 完整构建并 deep verify；记录数据来源、质量、审核人/政策版本。
3. 准备 Oracle 备用版本文件，镜像 CloudBase 版本文件；逐文件 hash/size 校验并验证可读取。
4. 两个源均可用后，在共享锁内检查期望 active；以单调 epoch 激活 Oracle。
5. CloudBase 采用相同 Release/epoch，检查当前 pointer 后切换并复验；失败时记录 reconciliation-required，保留两份已验证文件与 last-good。
6. 重试先读真实 active，已完成的激活不生成另一 epoch；新任务已推进时旧任务拒绝，不覆盖新指针。
7. 回滚先确认自身仍拥有对应 commit/epoch，再使用受控回滚流程；不可盲目恢复一份旧备份覆盖别的发布。

现有工具的 mirror-only 不切 pointer：

```text
npm run cloudbase:release:sync-active -- --dry-run
npm run cloudbase:release:sync-active -- --execute --mirror-only
```

第二条仍是生产上传，必须人工批准。CloudBase cutover 还要求 `CONFIRM_CLOUDBASE_CUTOVER`、源版本校验和 rollback point。发布、镜像、指针验证、真机读取分别记录；命令返回和 CI 通过不是用户端验收。

## D：正式微信客户端缓存与快速刷新

已上线客户端读取公开 active 与同协议不可变 Release，不必为每次数据更新重新审核微信版本；但本轮代码中的刷新优化、TLS配置或域名变更要进入已安装正式客户端，必须发布新的微信构建。当前已上线包的精确 Git/buildId 和合法域名仍需微信控制台及真机诊断确认。

源码基线：启动先显示缓存；app onLaunch/onShow、全校页 onLoad/onShow 已有刷新；索引 TTL 7 天、详情 TTL 30 天、runtime 熔断 45 秒。此前并行 pointer 请求等待所有源，Oracle 慢可阻塞 CloudBase。候选让 CloudBase 先返回、Oracle 后台对账，已观察较新 pointer 持久化为高水位；不把缺失时间伪造成当前时间；30 秒合并同类检查；前台 45 秒低频检查，后台/页面卸载停止计时器；manifest/index 仍按版本校验再激活，失败保留 last-good。

周次、筛选、个人课表和 UI 状态不因通用缓存清理被重置。版本清理只处理版本缓存；历史学期的 active/last-good 仍须额外完整引用审计。针对当前页面的首次/重新进入、后台返回、版本不变、慢 Oracle、坏 manifest、旧镜像、新学期和当前浏览周次都必须真机确认。

本地新增测试证明：快 CloudBase 不等待未完成 Oracle、晚到较新 Oracle 可对账、持久化不降级、30 秒去重、坏主源回退。既有四类搜索、版本缓存切换、周次/空教室隔离和个人路径回归通过；60 秒检测、国内 P50/P95 和真机浏览状态仍是待验证 SLO。当前远端 `active.json` Cache-Control=120 秒，query bucket 是否改变实际 CDN cache key 未核实，不能保证现网 60 秒目标。

## E：个人版实际容量、流量与域名

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
| weekly-class-cache | 6.429 | 158,397 bytes | 6次 pointer；每周1次 manifest+班级索引+详情 |
| cold-four-source-daily | 10 | 4,407,937 bytes | 每日全量下载本次测量的10项 |
| heavy-search-cache | 20.714 | 1,479,063 bytes | 每日10次 pointer+10份未缓存详情；全索引每周一次 |

| DAU | weekly-class-cache 月 GB | cold-four-source-daily 月 GB | heavy-search-cache 月 GB |
| --- | ---: | ---: | ---: |
| 500 | 2.376 | 66.119 | 22.186 |
| 1,000 | 4.752 | 132.238 | 44.372 |
| 2,000 | 9.504 | 264.476 | 88.744 |
| 5,000 | 23.760 | 661.191 | 221.859 |
| 10,000 | 47.519 | 1,322.381 | 443.719 |

monthly HTTP 数分别为 DAU×30×上述请求数。若回源率10%，同三种行为在500/1000/2000/5000/10000 DAU时的回源调用约：9,643/19,286/38,572/96,429/192,858；15,000/30,000/60,000/150,000/300,000；31,072/62,143/124,286/310,715/621,429。还需加动态 CloudBase API、上传、认证等调用。工具同时输出0%、10%、100%敏感性，真实回源率仍未知。

官方超额存储流量0.21元/GB、回源0.15元/GB，Hosting超额容量0.005元/GB/天；只有超限不停服已开启时才按超额计费，否则有服务限制风险。10%回源假设下，三行为的流量超额费在500 DAU约0/11.79/2.56元，10000 DAU约7.88/293.94/96.24元；这些不含套餐、调用、容量、计算或其他消费，不能视为账单报价。

瓶颈依赖行为：高缓存的约2000 DAU已接近10 GB；每日冷下载500 DAU就超过流量额度。每份 Release 约197.1 MB，5份约985.4 MB已逼近1 GB，6份约1.18 GB。每月每日新增版本约增加5.91 GB Hosting上传内容，未清理时容量增长与 DAU 无关。不要把个人版解释成无限用户容量。

优先改进：版本不变不重复下载、索引合并请求和筛选分片、搜索防抖、详情按需、长缓存的不可变版本资源、active短缓存与可验证bust；验证 Hosting 真正压缩传输后重新计量。保留公开 JSON 协议，不能让旧客户端改读 .gz sidecar 而未经新构建验证。缓存/压缩配置都提供审批 diff 与回滚；不增云函数/数据库逐条课表，不购买固定费用服务。

[默认域名官方限制](https://docs.cloudbase.net/service/alias)和[静态 Hosting 文档](https://cloud.tencent.com/document/product/876/46900)说明默认域名仅适合开发测试。`wx.request` 目前能拿到 JSON 不等于符合长期正式分发要求。个人版允许1个自定义域名；上线前确认该环境已有域名额度使用、域名实际所有权与备案、Hosting给出的CNAME、证书、国内CDN节点、微信request合法域名和额外流量账单。需要可备案域名方案；当前域名是否具备备案条件未核实。

实施门禁：先提供域名/备案/CNAME/证书/成本计划，等待审批；无需新建 Cloudflare 域名，不修改 agent-broker。绑定后先只读验源、gzip与缓存、TLS/合法域名，再生成微信候选配置；未完成不能宣称国内生产数据面已终验。

## F：生命周期、监控与人工接管

候选 Collector 的旧“每次任务后直接 rm 旧 run”已经改为 `cleanup-plan.json` dry-run。保护当前 run、最近成功、每学期成功/失败恢复点、待审核、未知终态、缺失完成时间、保留期和 symlink；外部引用不完整时没有可删除候选。默认30天可配置，但只能按真实终态/引用，不能仅按文件创建或 mtime。计划给数量、实际文件字节、学期、引用理由及恢复边界；本轮 executeAllowed=false。

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

未完成的生产门禁：WYZ失败分层诊断、根因修复后重新60分钟验收；学校长期凭据批准、真实Session与小范围四源试采；严格双源生产发布adapter及跨主机唯一写入约束；CloudBase压缩/缓存/备案域名方案与实际月账单；正式微信构建指纹/合法域名及国内真机SLO；完整历史引用清理和告警接收者验证。任务最终生产验收仍取决于这些证据，不能以“代码写完”代替。

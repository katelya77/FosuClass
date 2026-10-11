# 全校课表采集后台与工程收口交付

## 已核实基线（2026-10-11）

- GitHub main：`5c8db23e0bf209687a7e5086654dafe0adbc93f8`。原工作区 HEAD `79902de5`，两个小程序配置文件的用户未提交改动保留。
- CAS [PR #91](https://github.com/katelya77/FosuClass/pull/91) 为 OPEN，固定 SHA `9153876458df7b1dd6b4fae698851638b31c702e`；[CI 38123560165](https://github.com/katelya77/FosuClass/actions/runs/38123560165) Linux、Windows、隔离 Chromium 均通过，Agent 与安全检查也通过。
- Oracle [PR #90](https://github.com/katelya77/FosuClass/pull/90) 为 OPEN，固定 SHA `c74a91bd6c9d528b1d59007ed836d7f6c21e04c1`；[CI 38081474782](https://github.com/katelya77/FosuClass/actions/runs/38081474782) 回归和 ARM64 镜像均通过。
- 用户最新 PAM 回传证明：215→915 安装完成，源码完整性、原生浏览器离线生命周期、安装 receipt、heartbeat-only 与个人 Agent 独立门禁通过；Collector active、execute=0、timer disabled/inactive；备份保留。没有重装或重新构建 WYZ ZIP。
- 仍是 `SESSION_FILE_MISSING`，认证状态 LEGACY_UNVERIFIED / blocked=true / 日预算1/2 / cooldown=0；不清除历史、不退还预算。Oracle 反馈 `STAGING_SAMPLE_API_UNAVAILABLE`。学校登录、Session 新建、样本采集均未执行。
- `credentialsConfigured=false` 的源码原因是旧 status 查询 `/etc/fosuclass/school-auth.json`；915 的 protected-file 实际读取 `school-credentials.json`。受保护文件存在记录不代表本次已验证其内容或密码正确。
- 本次仅对公开 `/api/health` 和 `/api/health/ready` 各 GET 一次，均200且ready。它们不能替代 Oracle 的受保护镜像/Compose/持久化/个人 Broker/旧任务/Active/备份预检。

## 复用与实际增量

四源采集与 CAS 核心沿用既有实现，不重复重构。Oracle后台增量建立在c74固定基线上，保留其生产a3祖先、个人同步、原定时与发布实现；运行时白名单仅增加现有后台整合所需文件。915集成测试工作区另用于WYZ CLI状态和最小观测增量的源码验证，不作为Oracle整仓部署源。

新增 `/admin/schedule-collector`，与“个人课表同步”并列；`/admin/sync` 保留入口及正式Staging/Release流程。后台 API 提供链路证据、四源独立统计、持久任务记录、有界Sample申请、暂停后续任务、私有规范化课表查看、指纹绑定且不可覆盖的人工对照记录。页面使用真实后端API，无生产假数据。

授权沿用现有管理员 Session/CSRF/Origin/审计/请求限制，增加 `collector:sample`、`collector:control`、`collector:review`、`collector:full`。Sample只申请一个班级请求组或四源各一个目标，预算1–120、有效30分钟、显式幂等键。网页不会读取学校密码、Cookie、Session原文，或调用任意Shell。正式采集还要求独立范围审批配置 `FOSU_COLLECTOR_SCOPE_APPROVED=1` 和 `RUN ROUTINE` / `RUN FULL` 二次确认；本次没有设置该配置。

人工审核要求规范化数据与私有receipt指纹一致，`confirmed`还须对照声明与`REVIEW SAMPLE`确认。相同幂等请求返回原记录，冲突拒绝；结果保存在原Collector状态中，不新增数据表或服务。人工确认不是学校自动验证，也不解锁正式采集、timer、发布或全校覆盖。

Sample新增节次上限校验，复用已有学校时段规则 `MAX_SECTION=14`。保留行政班请求组、实体目录身份、学期配置、周次、重复事件、失败来源与解析错误门禁；私有上传不写正式Staging、Release或Active。跨源有界目标未必相互覆盖，明确显示未评估与全校覆盖未验证。

915现有心跳没有版本/Session观测字段。后台对缺失数据显示UNKNOWN/未上报；未来Collector最小观测只上报代码版本、执行模式、文件存在性和blocked布尔值，不将文件存在或心跳等同Session有效。WYZ源码状态修复尚未部署，没有生成新WYZ包。

## 唯一已有WYZ产物与原Oracle产物

从GitHub下载原915 CI交付并独立计算ZIP哈希，与用户上传记录一致：

| 已有产物 | SHA256 |
| --- | --- |
| 915 heartbeat upgrade ZIP | `38b6e3770cd4ee1a91087e979ec8c8c5a42d6245b5f98e1b1eec7a32735b7eae` |
| ZIP内915源码tar.gz，425文件 | `2b28122efd8dc93641c429fc311b9cefbfc1509a9f1eae5f5b8a045f2a730199` |
| 原c74 Oracle源码tar.gz | `110af2e544712021f306bdf51c19bf9c3e7510b98c8f6a44b4cc93ea00c67864` |
| 原c74 ARM64镜像tar.gz | `e60b88f4f81003012300f8c03778201e006a0894c4036afd9b4d85372128d96d` |

原c74镜像不包含本次新增管理UI。新后台源码若未提交、CI和ARM64构建未完成，则不具备生产部署身份；不能将上述旧镜像哈希当成新UI产物哈希。

## 操作文件与独立门禁

- `deploy/wyz/pam-915-install-or-accept.sh`：所有变量在同一Bash子进程内，外层if保持交互Shell；默认只读。固定215前驱、915 SHA、ZIP和源码SHA。当前已915时不提取、不运行安装器、不restart/npm、不改安装receipt；逐个核对425源码、心跳/个人/timer、备份及凭据元数据。旧215须独立安装批准后才接受 `--approve-install`。独立批准 `--approve-session` 后，复用915原验收器，公开诊断PASS且认证历史不变、预算/冷却允许才调用一次protected-file登录；只对已确认旧local_preflight应用ack，不认可新blocked原因。登录失败不重试，SAVED需配对受保护页验证，REUSED不会生成新建Session receipt。失败保留现场，不删除文件。
- `deploy/oracle-sample/preflight.js`：原PR90完整只读预检，缺失真实身份/任务/挂载/备份空间/正式数据指纹即BLOCKED。
- `deploy/oracle-sample/operate.sh`：独立 `preflight` / `deploy` / `rollback` 入口，全部参数显式传入；部署与回滚各自要求准确提交批准。沿用原Compose、旧镜像、私有一致性备份、健康等待、指纹与只读探针；失败代码回滚不恢复数据快照，不切WYZ/CloudBase Active。参见本目录README。

用户已单独批准新分支提交/推送/Draft PR/CI，以及一次公开CAS诊断、通过后的真实protected-file登录和受保护页复核。浏览器工具库存为空，未提供PAM/Oracle远程Shell工具，无法代执行；交付完整一次粘贴入口供PAM执行，不复制聊天中的凭据。之后独立批准Oracle部署、班级Sample、四源Sample和人工对照。正式Staging、全覆盖、Release、Active和timer继续分别验收。

## 验证证据与范围

本地使用fixture与真实localhost Express/Worker/Playwright；学校请求0，生产写入0。原915新安装是用户PAM证据，不是本地mock证据。原#91/#90 CI不替代本次增量CI。

已运行：Oracle协议/预检/队列50项（含新增节次/重复事件）、后台API5组、完整后台桌面/390px浏览器26断言、PAM一次粘贴14个Linux/root隔离用例（含公开门禁、预算/冷却、新blocked、单次失败、REUSED/EXPIRED区分）、Oracle操作7个隔离用例、215→915真实Bash安装器22个隔离故障恢复用例、Linux protected-file32个权限/链接用例。另有四源23套、个人同步51套、班级隔离、认证预检查与预算、Session生命周期、Staging上传/差异、Agent foundation41套/regression196套/competition/final-convergence、安全、架构与release preflight。

首次security文本扫描将测试里的随机密钥生成表达式误判为字面量，已改为短命名生成函数，未改变扫描器或权限；competition随后通过。一次Windows Node24 release-preflight子进程以3221226505退出；独立搜索回归与完整重跑通过，原失败日志保留。

另有已核实基线失败：`node tools/test-admin-campus-sync-page.js` 在原915与本次源码均因obsolete `12000`源码断言失败。个人同步资产未修改；未删除或放宽断言。该失败单独记录，不能写“全部本地命令无失败”。

Oracle c74没有 `test:collector-personal-regression` npm别名，第一次命令返回Missing script；随后直接运行其现有 `node tools/run-collector-personal-regression.js`，51套通过。未新增无用别名，CI使用真实脚本。

本次增量的远程CI/ARM64身份以新Draft PR准确head的终态和产物receipt为准；此源码报告不将待执行CI预写为PASS。仍未验证：Oracle现网完整预检及独立部署、915公开CAS兼容性、protected-file真实一次登录/Session、真实四源数据及人工对照、生产管理UI、国内手机/微信读取。本次不合并既有PR，不发布、不切Active、不启用timer、不改个人Agent业务状态。

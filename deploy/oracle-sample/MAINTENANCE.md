# Oracle Sample 集中维护入口

`maintenance.js` 编排固定候选的 `operate.sh` 和 `preflight.js`，不修改候选目录或镜像。它只部署固定的 PR #92 候选，保留正式 Active、Staging 正文、Release 及个人 Agent；学校认证、Sample 任务创建/审核和正式发布仍分别批准。

将以下文件按仓库相对目录上传到独立私有工具目录，保留已校验的候选目录：

- `deploy/oracle-sample/maintenance.js`、`preflight.js`、`verify-source.py`、`verify-image.py`、`preflight-adapter.js`
- `deploy/oracle-runtime-cutover/execute.js`、`lifecycle-guard.js`
- `tools/oracle-sample/maintenance-admin.js`、`loopback-http.js`
- 候选包已有的 `server/src/security/campusAgentSignature.js`、`fullSyncSignature.js` 及其依赖

工具目录必须位于候选目录之外；候选目录的文件集合严格匹配固定源码归档。`verify-source.py` 流式核验所有源码的路径、类型、大小及 SHA256，拒绝任何额外文件；不会解包或把私有权限改成归档里的公开权限。入口自身不是镜像构建输入，不重新构建固定镜像。所有配置、状态和日志置于 root 私有目录。配置文件采用 0600，目录 0700，示例中的占位符由实际服务器路径替换：

```json
{
  "schema": "oracle-sample-maintenance-config.v1",
  "appDir": "/absolute/existing-app",
  "runtimeDir": "/absolute/existing-runtime",
  "candidateDir": "/root/private-stage/candidate",
  "sourceArchive": "/root/private-stage/source/candidate.tar.gz",
  "manifest": "/root/private-stage/source/candidate.receipt.json",
  "imageDir": "/root/private-stage/arm64",
  "p0StateFile": "/root/private-p0/state.json",
  "credentialsFile": "/root/private-stage/existing.env",
  "stateDir": "/root/private-p1",
  "windowSeconds": 900,
  "drainSeconds": 180
}
```

`credentialsFile` 仅引用主机已有的受保护配置。读取用 `ADMIN_API_TOKEN`；维护写入必须使用已有 `ADMIN_PASSWORD` 或 `ADMIN_TOKEN` 经真实 `/api/admin/login` 获得 cookie/CSRF，核验 RBAC、Origin 及审计。工具不会将 API Token 当作网页登录凭据，也不会将 cookie/密码写入日志。

原程序启动会更新 Staging 的生命周期元数据。私有受控操作副本包含经过指纹绑定的 preflight 调用、两处压缩调用及精确镜像 ID 校验替换；两处备份压缩采用 `/usr/bin/pigz -p 2 -1`（镜像归档另保留 `-n`）。备份数据范围和其他操作字节不变。Adapter 先执行完整原 preflight；仅原字节比较返回 `PROTECTED_STATE_CHANGED` 时，重新执行原全部门禁并验证完整私有 before/after 对象。只允许源码确定的六个根 meta 字段按真实 Active/时间更新；课表正文、hash、来源、指针、其他 protected 文件、环境及容器配置仍严格相等。

已恢复的 P0 事务可以保持 `RECOVERED_PERSISTENT`，由 `execute.js accept` 作独立只读持久化验收；P1 将其证据绑定到实际容器、旧状态 SHA、迁移归档、marker 和 bootstrap receipt。不得把历史缺失的 Staging 前对象或恢复流量后的点赞字节变动描述为历史未变。它们不替代下一窗口的完整 before 快照和严格部署门禁。

```bash
node /root/private-stage/operations/deploy/oracle-sample/maintenance.js prepare --config=/root/private-p1-config.json
```

prepare 只读取生产 API、签名 Broker、Compose、镜像及数据指纹；写入仅限 root 私有操作证据。P0 未迁移时可报告 `PREPARED_PERSISTENCE_PENDING`；历史运行任务记录作为 `SERVER_JOB_IN_FLIGHT` 待审批项保留，P0 完成后为 `PREPARED_JOB_RECONCILIATION_REQUIRED`。P0 实际 PASS、任务记录经独立批准处理后重新 prepare，保存新容器 ID、持久化 Compose 和准备记录，得到一次维护范围的 `approval` 指纹。start/run 在准入变更之前再次执行原始 inventory，其他不兼容数据不会降格。

仅在用户批准该具体维护范围后启动：

```bash
node /root/private-stage/operations/deploy/oracle-sample/maintenance.js start --config=/root/private-p1-config.json --approve=PREPARE_RETURNED_APPROVAL
```

启动先安装独立 systemd 恢复服务、开机恢复和 15 秒 watchdog，再启动服务器端 worker。worker 对新个人任务准入执行保护后台 pause、等待在途任务耗尽，调用固定候选 `operate.sh deploy`，核验 API 内容、签名 Sample readiness、个人 Broker、正式四索引/公告、真实后台 cookie API，最后恢复原 paused 状态。不会停止、重装或重启 WYZ 个人 Agent。入口返回 `STARTED_DETACHED` 只说明任务启动，需读取终态：

```bash
node /root/private-stage/operations/deploy/oracle-sample/maintenance.js status --config=/root/private-p1-config.json
```

失败、信号、超时、SSH 断线及服务器重启由独立恢复进程接管。它解除本操作已识别容器的暂停，用冻结的旧 Compose、固定旧镜像及 **当前** 持久化数据恢复 API。禁止归档回灌、删除数据或回到缺少 `/app/data` 挂载的旧配置。未知镜像或配置篡改会保留现场并阻断写入。临时 Docker/API 故障每 60 秒重试，每次保留全部身份和指纹检查。立即重试恢复可执行：

```bash
node /root/private-stage/operations/deploy/oracle-sample/maintenance.js recover --config=/root/private-p1-config.json --force
```

`worker.private.log`、`recovery.private.log`、`deployment-backup/`、部署前后指纹、后台验收和恢复结果保留在 `stateDir`。它们含私有部署配置，只在服务器 root 权限内审阅。`PASS` 表示后端真实验收和原准入恢复完成；移动设备布局、真实学校 Sample、四源审核和正式覆盖仍独立验收。`RECOVERED` 表示旧程序已恢复服务，Sample 部署未成功。

Docker 29 的 containerd image store 用 manifest digest 表示镜像 ID；原交付 inspect 使用 config digest。verify-image.py 流式验证归档内每个 blob、单一 index、manifest→config→全部层关联及 CI RootFS。源码、镜像归档和原 inspect 均保持原字节；操作副本用已证明关联的精确 runtime digest 验证，不扩大到其他镜像。已加载镜像仅在 tag 的 ID 精确一致且准备阶段的 Config/RootFS 核验通过后复用。

回滚恢复优先验证实际旧代码、当前持久化数据及原准入。流量恢复后的点赞变化保留前后 hash 并标为历史 PENDING；此许可只用于恢复，正常部署的点赞字节门禁仍严格生效。

维护 API 请求使用独立的本机 HTTP 连接，禁止非 loopback 目标及 URL 内凭据；大文件同步校验不会把过期连接复用于认证 POST。相同 Staging SHA 仍核验原始捕获文件的完整 SHA，但不重复解析课表正文；不同 SHA 必须通过完整六字段契约校验。

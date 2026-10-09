# Collector 网络恢复与只读验收

适用于独立的 `wyz-schedule-collector.service`。现有签名凭据继续复用，
不改动个人 Agent，不开启 timer，不领取真实任务，不改变任何 active pointer。
真实学校采集仍需要单独批准。本轮只用 fixture 和本地 HTTP 服务测试故障。

## 已确认与待确认的原因

原 Collector 把 Node `fetch` 的底层错误统一映射为 `ORACLE_NETWORK_FAILED`，
异常直接退出主循环，导致 systemd 每 60 秒重启。该进程退出问题已修复。
WYZ 观察到的 `ECONNRESET` 表示连接重置；重置发生在校园出口、传输路径、
边缘代理还是 Oracle，尚未确认，单次 HTTP 200 不能证明路径已经稳定。

Collector 使用 Node 自带的 fetch / Undici，保留默认 DNS 与地址族选择、TLS
证书校验和 HTTPS。sync client 的独立依赖不替代 Node 自带 fetch。
不强制 IPv4、不关闭证书校验、不跟随重定向，不把签名请求发往其他 origin。
启动 `After=network-online.target` 只保证启动顺序，不能保证后续公网持续可用。

| 类别 | 常见底层证据 | 处理 |
| --- | --- | --- |
| dns | EAI_AGAIN / ENOTFOUND / EAI_FAIL | 仅心跳有限重试 |
| connection-reset | ECONNRESET / EPIPE / UND_ERR_SOCKET | 仅心跳有限重试 |
| connection | ECONNREFUSED / EHOSTUNREACH / ENETUNREACH | 仅心跳有限重试 |
| timeout | ETIMEDOUT / Undici timeout / TimeoutError | 仅心跳有限重试 |
| http-server | HTTP 5xx | 仅心跳有限重试 |
| authentication | HTTP 401 / 403 / 404 | 停止，检查凭据、时钟或路由 |
| tls | 证书、握手错误 | 停止，检查 TLS；不放宽校验 |
| protocol / unknown-network | 无效响应或无法确认的错误 | 停止，人工定位 |

## 重试与租约

每轮心跳最多 4 次，每次超时 15 秒，失败后分别等待 15、30、60 秒。
4 次失败后守护进程保持存活，等待 5 分钟再进行下一轮。`--once` 则返回非零退出码。
每次尝试都重新创建 timestamp、nonce 和 HMAC；不重复使用认证头。
成功后连续失败归零。故障恢复后先显示 `recovering`，连续 3 次成功才显示 `healthy`，
执行模式在此之前禁止 claim。成功只是 Broker 心跳确认，不等同学校会话或课表可用。

只包装心跳重试。claim、upload init、finalize 的模糊失败均停止，不能盲目重放。
既有按 uploadId / chunk index 幂等的分片保留有限重试；认证或 TLS 失败不重试。
执行模式每 30 秒更新租约，独立 watchdog 在最后确认 90 秒后停止 worker。
失效后禁止新的分片、finalize、完成报告和 latest 提升。SIGTERM 中断请求与退避，
清理单实例锁；systemd 最迟 20 秒清理整个服务进程组。

退出码 75（未确认操作、租约或锁）、77（认证）、78（配置、TLS 或协议）
由 `RestartPreventExitStatus` 阻止永久重启；其他意外程序错误仍按原规则恢复。
不要通过重启回避认证、安全或时钟错误。

日志与 root-only `collector-status.json` 仅包含运行模式、最后成功时间、连续失败/
成功次数、错误类别、允许的传输代码、重试等待和最近成功耗时。
不记录原始异常、请求认证头、密钥、学校 session 或 URL query。

## WYZ root 终端只读验收

安装包、SHA256 和 Oracle 受保护交付路径以本次交付报告为准，通过 PAM 文件传输。
使用包内安装器，先停止全校 Collector；不操作 `wyz-campus-agent.service`。
安装器验证 SHA256、源文件和本地浏览器生命周期后切换 current，保留 previous-install，
不覆盖 `/etc/fosuclass/full-sync.env`，不启用或启动 timer。

安装后使用以下只读命令。配置检查仅输出运行模式，禁止打印 env 文件。

```bash
set -euo pipefail
cd /opt/fosuclass/schedule-collector/current
node -e 'const c=require("./tools/wyz-schedule-collector/credentials");const v=c.readEnvFile("/etc/fosuclass/full-sync.env");if(v.FOSU_COLLECTOR_EXECUTE!=="0")process.exit(1);console.log("EXECUTE=0");'
node tools/wyz-schedule-collector/diagnose-oracle-network.js --samples=3
node tools/wyz-schedule-collector/collector.js --env-file=/etc/fosuclass/full-sync.env --once
systemctl start wyz-schedule-collector.service
systemctl show wyz-schedule-collector.service -p ActiveState -p SubState -p NRestarts -p ExecMainStatus
systemctl is-enabled wyz-schedule-collector.timer || true
systemctl is-active wyz-campus-agent.service
journalctl -u wyz-schedule-collector.service --since '20 minutes ago' --no-pager -n 80
```

诊断只访问公开 `/api/health`，3 个样本间隔 30 秒，输出 `authentication=NOT_TESTED`。
真正的认证验收以带签名的 `--once` 心跳确认及守护进程日志为准。`heartbeat-only`
代表 Broker 确认成功，`healthy` 需要连续 3 次成功；不把 HTTP 可达当作凭据有效。
观察至少 20 分钟，确认故障恢复后失败归零、正常 30 秒心跳、NRestarts 不增加，
无 claim/session/browser/upload 行为。没有真实故障样本时，恢复能力只算 fixture
验证，不声称 WYZ 间歇故障已经消失。日志可提供脱敏状态，不提供凭据。

回滚时停止全校 Collector，运行包内 `deploy/wyz/rollback-schedule-collector.sh`，
核对 current 回到 previous-install 后再启动全校 Collector。密钥、学校缓存、个人
Agent、timer 和 active pointer 均保持不变。

## 自动化验收

`npm run test:collector-network` 覆盖真实本地 socket reset、fresh HMAC、DNS、
超时、5xx、认证/TLS、无 claim、零学校访问、持续恢复、上传期间租约失效和 SIGTERM。
Windows 显式跳过 POSIX 信号/锁清理，用 Linux CI 实际验证，不记为 Windows PASS。
WYZ Four Source CI 与包准备工作流同时运行它和现有四源、断点、Staging、
小程序缓存/静态主备、个人课表及安全门禁。包准备默认不再执行凭据审计；
必要时可显式开启只读审计，不旋转任何密钥。

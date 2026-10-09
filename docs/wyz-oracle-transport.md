# WYZ → Oracle 传输诊断与可选直连

本轮保持 `FOSU_COLLECTOR_EXECUTE=0`、timer disabled、学校请求 0。
代码默认仍使用原 Cloudflare fetch 路径。没有修改系统 DNS、hosts、1Panel HTTPS、
Cloudflare DNS/代理、证书、防火墙或个人 Agent。切换传输配置必须另获用户确认。

## 真实证据与边界

用户 WYZ 观测：Cloudflare IPv4 5/6 成功，某个边缘地址 TLS 阶段失败；IPv6 6/6 TCP 超时。
这证明 WYZ IPv6 路径存在故障，但不能把所有 Node ECONNRESET 归因于 IPv6。
需要固定两个 Cloudflare IPv4 和 Oracle IPv4，用同一 HTTPS URL、Host、SNI 与正常
证书验证比较；curl 禁止 `-k`，不跟随重定向，也不经环境代理绕过固定目标。

本轮 Oracle 只读诊断实际确认：127.0.0.1:18318 健康 200，本机 Nginx HTTPS 200，
源站公网 IP 200，Oracle 经两个 Cloudflare IPv4 均 200；Nginx 配置检查通过。
代理 include 确认 class 与已有 agent-broker 均指向 127.0.0.1:18318。
class 源站为 Let's Encrypt 公开证书，SAN 覆盖 class.katelya.eu.org，有效至 2026-12-24。
当前开发机 Node TLS 直连授权成功，原生 HTTPS 连续 200，实际连接复用成功。
这些观测不能代表 WYZ 到源站的长期质量。

最近诊断窗口源站收到 4 条标记为 FosuCollectorDiag/wyz 的健康请求，
未发现相应 upstream timeout/reset 错误。日志只读取并输出 30 分钟聚合，
不导出原始 IP、query、认证头或其他请求日志。OCI 安全组与 Cloudflare 安全事件
缺少控制面访问，标记 UNKNOWN，不推测其配置。主机 iptables INPUT 为 ACCEPT，
有 TCP443 ACCEPT 规则；完整规则与私有部署信息不导出。

agent-broker.katelya.eu.org 已用于个人 Agent，具有有效 HTTPS 证书和受控入口；
本轮不占用该域名、不改变其协议或路由。

## 可选架构

| 模式 | DNS/连接 | 用途 |
| --- | --- | --- |
| cloudflare-default | 原 Node fetch/Undici，全局配置不变 | 默认与回滚路径 |
| cloudflare-ipv4 | Collector 独立 HTTPS Agent，仅该客户端查询 IPv4 | 可排除 IPv6，仍受 Cloudflare IPv4 链路影响 |
| oracle-direct | Collector 独立 lookup 固定批准的 146.235.201.244 | 绕过边缘代理；启用前必须通过 WYZ 直连验收 |

公开小程序仍走 Cloudflare/现有静态源主备；Collector 的 URL 始终
`https://class.katelya.eu.org`。直连只改变 socket 目的地址，Host/SNI 均为原域名，
使用系统公开 CA 与默认主机名验证，最小 TLS1.2。无额外 CA、无证书验证旁路、
无全局 dispatcher/DNS 修改、无 HTTP 降级。公开证书轮换无需固定 leaf 指纹。
拒绝其他 origin/IP、IPv6 pin、未知配置、认证字段及 CA override。

使用 Node 标准 HTTPS Agent，不添加第三方运行依赖。每池最多 1 个 socket，
心跳控制池与 claim/report/upload/finalize 数据池独立，慢上传不能阻塞续租。
连接建立/TLS 超时 6 秒，空闲池超时 5 秒；心跳总超时继续 15 秒。
快速上传可复用连接，30 秒正常心跳不会长期占用陈旧空闲连接。
每次 HMAC 按原协议重新生成，不自动跨路由重放模糊失败。
课表四源 `network-direct / allowDerived=false` 契约不变，与传输模式无关。

## 配置与回滚（仅在确认后执行）

可选 root-only 文件：`/var/lib/fosuclass/schedule-collector/oracle-transport.json`，
root:root、0600，父目录 0700。不存在时自动保持 cloudflare-default。
不修改 `/etc/fosuclass/full-sync.env`；没有凭据放入该 JSON。

确认启用直连后，文件内容为：

```json
{"schema":1,"mode":"oracle-direct","originIpv4":"146.235.201.244"}
```

确认回滚传输时，内容改为：

```json
{"schema":1,"mode":"cloudflare-default"}
```

配置只在 Collector 启动时读取。变更使用受保护的原子写入并仅重启全校 Collector，
不得操作个人 Agent、timer、公开 DNS 或 active pointer。不要在一个已领取 run 中换路由。
本轮不自动创建以上文件，不自动重启 WYZ 服务。

## 租约与进入学校试采的门禁

维持最后成功确认 90 秒的独立 watchdog，不延长到 5–10 分钟。
断线期间不得创建新任务；恢复后连续 3 次确认才允许领取。90 秒后 worker 停止，
正在进行的请求及退避被中断，禁止后续分片/finalize/完成报告及 latest 提升。
checkpoint 与失败 run 保留，稳定课表不删除。心跳的既有有限重试不增加，
claim/init/finalize 的模糊失败不自动重试。

进入首次学校极小试采前仍需：用户批准传输变更、WYZ Node20.20.2 严格 TLS 与签名
心跳通过、至少 60 分钟低频心跳观察且无 90 秒失联窗口（建议跨多个时段），
无认证/TLS错误、个人 Agent 保持在线、最新安装包与配置验收通过、学校 session
人工确认，最后获得单独学校试采批准。timer 与 execute 在这些门禁前继续关闭。
curl 的少量 200 只支持候选路径判断，不能代替持续签名心跳验收。

若 WYZ 直连同样出现长断线，应保留其证据，再评估经授权的国内中继。
本轮不采购中继、不引入新费用或新凭据。现有源站直连不新增服务器成本。

## 无配置变更的诊断与测试

`deploy/wyz/probe-cloudflare-paths.sh` 最多 5 个 unsigned health 样本，间隔 30 秒。
`probe-oracle-transport.js --mode=oracle-direct --samples=3` 只读健康检查；
加 `--signed` 复用 WYZ root-only env，仅发 3 次心跳，间隔 30 秒，不 claim。
`--reuse` 只允许 unsigned 诊断，最多 3 次、间隔 1 秒，专门验证连接复用。
不修改 transport 文件或现有 service，即可在经验证的被动源码目录运行。

`npm run test:collector-transport` 使用临时 CA 与真实本地 TLS 服务验证 SNI/Host、
信任链/主机名拒绝、HMAC、连接复用、独立心跳池、恢复、旧路径回滚、配置权限
和正在 finalize 时租约中断。临时私钥不进入 Git、artifact 或日志。
Linux CI 实测权限/符号链接；Windows 显式跳过该项，不冒称 PASS。
既有网络、51 组个人同步、四源/Staging/小程序静态查询及安全门禁仍必须通过。

官方依据：[Node HTTPS Agent](https://nodejs.org/download/release/v20.20.2/docs/api/https.html#class-httpsagent)、
[Node HTTP lookup](https://nodejs.org/download/release/v20.20.2/docs/api/http.html#httprequestoptions-callback)、
[Cloudflare Origin CA 的客户端信任限制](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)。

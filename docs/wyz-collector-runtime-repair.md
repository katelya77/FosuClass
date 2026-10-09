# WYZ 运行环境修复与只读心跳验收

本轮只允许安装独立 Collector、验证本地浏览器和签名心跳。不得领取任务、访问学校、打开 timer 或修改生产 Release pointer。已有 `aeed79a937f308722cf2ec4422af83f23202e872` release 保留；新版本成功验收后才原子更新 current。个人 Agent 的 unit、环境、密钥和代码均不操作。

## Anolis 8.9

`libnspr4.so` 的发行版包为 nspr，NSS 相关库来自 nss。修复脚本先用 rpm 判断是否已安装，再用发行版启用的 dnf 仓库补缺；其它缺库由实际 ldd 输出与 `dnf provides` 确认。所有安装排除 glibc，不替换系统库、不升级系统。

`readelf`/`ldd` 检查实际 ELF 与所需 GLIBC 版本。库补齐后必须通过 launch → newContext → newPage → 本地 file 页面渲染 → close，不能把下载成功当成运行成功。若 Ubuntu 回退构建需要较新 glibc，则用已安装 Podman/Docker构建版本与 package-lock 完全匹配的独立 worker 镜像。浏览器冒烟测试 `--network=none`；采集 worker 仅挂载 root-only lease、本 run 和 catalog，根文件系统只读、删除 Linux capabilities、限制 CPU/内存/PID，不暴露入站端口或 Docker socket。镜像 ID 固定，Oracle/CloudBase/个人 Agent secret 不进入 worker。

依据：[Playwright 官方 Docker 与远程运行说明](https://playwright.dev/docs/docker)、[Anolis 8 发行版仓库](https://mirrors.openanolis.cn/anolis/8/AppStream/x86_64/os/Packages/)。真实 WYZ 上的缺库和 glibc 结论必须以脚本输出为准，Ubuntu CI 通过不代表 Anolis 主机通过。

## 独立凭据

Oracle 的 prepare-full-sync-env 已负责持久化和重复部署保留独立凭据。本轮维护工作流只审计 CONFIGURED/MISSING、与宿主机 0600 .env 的一致性及运行中 Broker 的真实 HTTP 签名认证；不旋转、不重启服务。Oracle 自检来源标注 ORACLE_LOOPBACK，不能冒充 WYZ 验收。

WYZ 生成 RSA4096 接收密钥，私钥始终留在 WYZ `/etc/fosuclass/collector-transfer.key`（root:root 600）。仅公钥通过 PAM 送至 Oracle。Oracle 使用 RSA-OAEP-SHA256 + AES-256-GCM 封装现有 FULL_SYNC 凭据，封装绑定接收公钥、7天有效期和认证元数据；导出只放 root-only 文件。加密文件仍仅通过 PAM 传输，不进入仓库、Actions artifact、公开 HTTP 或普通聊天。WYZ 验证解密结果、调用真实 HTTPS heartbeat，通过后才以排他原子安装创建 full-sync.env；已存在不同凭据拒绝覆盖。成功后移除 WYZ 的临时封装文件，私钥保留用于受控重新导入。

完整 env 仅六项：FULL_SYNC_AGENT_ID、FULL_SYNC_AGENT_TOKEN、FULL_SYNC_SIGNING_SECRET、FOSU_API_BASE、FOSU_COLLECTOR_EXECUTE=0、SCHOOL_CONCURRENCY=1。`collector.js --env-file=... --once` 专用于严格只读验收，拒绝 execute=1 或附带额外字段。不使用 shell source，不回显环境内容。

## PAM 操作

工作流生成新 revision 的 tar.gz、SHA256 文件、install-schedule-collector.sh、recover-release.py；通过 PAM 放进 WYZ `/root/fosu-collector-install/`。正式包的具体 SHA/字节数以成功工作流 receipt 为准。修复版不是重新安装旧 aeed 包。

WYZ root 首先安装缺少的诊断工具/容器引擎，然后安装新 revision 并生成公钥：

```bash
set -euo pipefail
missing=()
for p in python3 binutils nspr nss; do rpm -q "$p" >/dev/null 2>&1 || missing+=("$p"); done
if ((${#missing[@]})); then dnf install -y --exclude='glibc*' "${missing[@]}"; fi
if ! command -v podman >/dev/null && ! command -v docker >/dev/null; then dnf install -y --exclude='glibc*' podman; fi
cd /root/fosu-collector-install
sha256sum -c wyz-schedule-collector.sha256
read -r digest bundle < wyz-schedule-collector.sha256
[[ "$bundle" =~ ^wyz-schedule-collector-[a-f0-9]{40}\.tar\.gz$ ]]
bash install-schedule-collector.sh "$PWD/$bundle" "$digest"
node /opt/fosuclass/schedule-collector/current/tools/wyz-schedule-collector/credentials.js keygen
```

通过 PAM 仅把 `/etc/fosuclass/collector-transfer.key.pub` 送到 Oracle `/root/collector-transfer.key.pub`。把维护工作流交付的公开脚本 oracle-seal-credentials.sh 放进 Oracle `/root/`；Oracle root 一次执行：

```bash
bash /root/oracle-seal-credentials.sh
```

通过 PAM 把 Oracle `/root/wyz-full-sync.encrypted.json` 送到 WYZ 同名路径。WYZ root 原子导入并做一次心跳验收：

```bash
set -euo pipefail
chmod 600 /root/wyz-full-sync.encrypted.json
node /opt/fosuclass/schedule-collector/current/tools/wyz-schedule-collector/credentials.js import
node /opt/fosuclass/schedule-collector/current/tools/wyz-schedule-collector/collector.js --env-file=/etc/fosuclass/full-sync.env --once
stat -c '%U:%G %a' /etc/fosuclass/full-sync.env
readlink -f /opt/fosuclass/schedule-collector/current
systemctl is-enabled wyz-schedule-collector.timer || true
systemctl is-active wyz-campus-agent.service
```

导入成功后 Oracle root 清理已传输的加密文件：`rm -- /root/wyz-full-sync.encrypted.json /root/collector-transfer.key.pub`。不删除 WYZ 私钥或现有 lease。删除临时文件不宣称完成 SSD 物理擦除；敏感内容始终为认证加密形式。

如果需持续只读 heartbeat，在一次性认证 PASS 且确认 env execute=0 后执行 `systemctl start wyz-schedule-collector.service`，然后 `systemctl status wyz-schedule-collector.service --no-pager`、`journalctl -u wyz-schedule-collector.service --since '10 minutes ago' --no-pager`。不 enable 服务/timer；个人 Agent 只检查状态。配置缺失、签名/时钟不匹配、404（凭据或端点）、超时、网络错误和非 JSON 响应分别输出固定脱敏 code，无学校 session 读取或 claim。

## 安装恢复与回滚

整个 tar.gz 先校验 SHA256；全部 tar 成员和已有文件逐一审查后才恢复缺失文件，禁止绝对路径、..、重复项、软/硬链接和特殊文件。已有损坏文件保留并报错，不用重新解压覆盖。依赖失败不产生完成 receipt，不改变 current。完整同版本重复执行验证后安全退出；部分版本可再次执行恢复。独立 flock 阻止并发安装，运行中的 Collector 或启用的 timer 会阻止安装。

原子切 current 前记录 previous-install。若需回退，先 `systemctl stop wyz-schedule-collector.service`，再 `bash /opt/fosuclass/schedule-collector/current/deploy/wyz/rollback-schedule-collector.sh`。原 release、env、lease 和课表数据均保留；回滚不会启动任何服务或 timer。后续启动仍保持 execute=0。

## 验证边界

新增 fixture 验证配置、只心跳、HTTP错误、签名/nonce、加密完整性/过期/接收方、失败不安装、导入幂等与冲突、容器挂载隔离、生命周期清理；Linux验证 tar 恢复/攻击、安装失败恢复/重复安装/文件损坏。CI分别执行原生和无网络隔离镜像的真实浏览器生命周期。四源/断点/Staging、小程序静态回退和个人同步继续使用既有22套测试，必须保留安全、架构、preflight门禁。

学校真实请求、四源真实数据大小、WYZ运行时稳定性与最终WYZ→Oracle认证只在 PAM 安装后人工验收。本轮不进入学校采集。

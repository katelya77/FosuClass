# WYZ 四源采集器人工 MVP

本轮从 `b9714f76d6b39c8451611e463a8841190d9ea06b` 开发。Collector 独立于个人课表 Agent，只向 `https://class.katelya.eu.org` 发出 HTTPS 请求。默认没有启动定时器，没有修改生产 runtime pointer。

## 数据与认证

routine 仅复用已经通过完整四源校验的 catalog；四类动态课表重新请求。full 刷新 catalog、专业和各资源页面独立目录，再请求四类课表。四类来源必须为 `network-direct`，`allowDerived=false`。目录缺失、页面仍限制在单个学院/校区、解析失败、重复实体或来源不完整会阻止生成合格 Staging。班级接口现有适配器按学院/年级/专业请求，进度的 entityUnit 为 `major-request-group`，scheduleDocuments 单独统计行政班文档；不能把专业请求数称为班级数。

路径继续复用 `/kbcx/kbxx_xzb_ifr`、`/kbcx/kbxx_teacher_ifr`、`/kbcx/kbxx_classroom_ifr`、`/kbcx/kbxx_kc_ifr`。资源参数名从各自页面实际 select 提取，不用班级推导的教师/教室/课程名称。学校真实目录和请求参数尚待人工批准的极小规模试采确认；本地 headless fixture 通过不能替代这一步。

学校 storageState lease 只放在 `/var/lib/fosuclass/schedule-collector/session.json`，root:root、600，父目录700。无密码登录循环；session过期返回 SESSION_EXPIRED，安全验证停止，人工刷新。Collector 子进程不继承 Oracle Agent secret、CloudBase secret、ADMIN_API_TOKEN 或个人 Agent secret。教师/教室/课程源实体代码在公开结果中转换为稳定散列 ID。

单进程锁和 Oracle 120秒有期限租约限制同一个任务；30秒心跳续约。学校请求串行、900–1300ms间隔，无POST自动重试。普通失败保留成功实体；解析失败或认证/安全验证停止。checkpoint 按 term/scope/runId 分离。完成校验才提升本地 latest；上传失败仍保留完整 Staging，可重新领取同 runId继续上传。取消/旧租约不能写入 Oracle Staging。

## HUMAN_WYZ_INSTALL_COMMANDS

先把安装包和独立安装脚本通过受保护 PAM 文件传输放到 WYZ。包的实际 SHA256 和大小由 `node tools/wyz-schedule-collector/build-package.js` 的 receipt 给出。以下命令在 WYZ root终端运行，不能把 secret 贴入聊天或PR：

```bash
bash install-schedule-collector.sh /root/wyz-schedule-collector-<40位sha>.tar.gz <SHA256>
install -d -o root -g root -m 700 /var/lib/fosuclass/schedule-collector
chmod 600 /var/lib/fosuclass/schedule-collector/session.json
chown root:root /var/lib/fosuclass/schedule-collector/session.json
# 通过受保护编辑器准备 /etc/fosuclass/full-sync.env；不使用命令回显 secret。
chmod 600 /etc/fosuclass/full-sync.env
chown root:root /etc/fosuclass/full-sync.env
systemctl is-enabled wyz-schedule-collector.timer || true
systemctl status wyz-campus-agent.service --no-pager
```

full-sync.env只包含独立 FULL_SYNC_AGENT_ID、FULL_SYNC_AGENT_TOKEN、FULL_SYNC_SIGNING_SECRET、FOSU_API_BASE、FOSU_COLLECTOR_EXECUTE=1、SCHOOL_CONCURRENCY=1。不能与个人 Agent 共用签名密钥；CloudBase 凭据放在 Oracle 发布侧独立的 `/etc/fosuclass/cloudbase.env`（600），WYZ Collector 不需要 CloudBase 权限。安装脚本不启动或 enable任何服务/timer，不修改 wyz-campus-agent.service。

## HUMAN_FIRST_REAL_RUN_COMMANDS

先人工批准只检查网络和session；此时不得运行全校批量采集：

```bash
cd /opt/fosuclass/schedule-collector/current
FOSU_COLLECTOR_MODE=1 FOSU_SYNC_HEADLESS=1 \
FOSU_COLLECTOR_SESSION=/var/lib/fosuclass/schedule-collector/session.json \
FOSU_SYNC_DATA_DIR=/var/lib/fosuclass/schedule-collector/diagnostic \
PLAYWRIGHT_BROWSERS_PATH=/var/lib/fosuclass/schedule-collector/browsers \
node tools/fosu-sync-client/sync.js check-session
```

下一步先选择经学校页面确认的学院/年级/专业代码，使用 `crawl:daily --diagnostic --entity-limit=1 --allow-derived=false --resource-source=direct --college-codes=<code> --grades=<year> --major-codes=<code> --term=<term>` 做局部试采。必须先确认 catalog 的请求范围，不能把未验证目录视为全校覆盖；诊断数据不得上传或提升 latest。首次 full 会包含目录访问，只有人工明确批准后才执行。

极小规模试采通过并得到首次完整四源采集批准后，在 Oracle 后台创建**一个**routine/full任务。WYZ人工启动独立服务：

```bash
systemctl start wyz-schedule-collector.service
systemctl status wyz-schedule-collector.service --no-pager
journalctl -u wyz-schedule-collector.service --since '30 minutes ago' --no-pager
# 如需停止：
systemctl stop wyz-schedule-collector.service
```

后台可暂停队列、取消当前任务、查看四源进度、验证 Staging；发布入口复用现有确认/权限流程。采集完成默认 PENDING REVIEW。任一类下降超过10%、异常空课表率或质量告警必须人工复核。相同 canonicalHash 返回 NO CHANGE，不构建新Release或上传CloudBase。

失败任务在后台通过 `actions/resume-run` 请求同 runId（保留原mode），刷新session后恢复；不得创建另一个runId假装恢复。上传使用现有Staging gzip/chunk服务，已上传分片会跳过。每轮记录 TOTAL_DURATION、SCHOOL_REQUEST_COUNT、四类summary、STAGING_RAW_BYTES/STAGING_GZIP_BYTES。真实四源请求数、Staging体积、峰值内存目前UNKNOWN，需本次MVP测量；默认768MB内存上限需依据实测评估。

## Oracle 和 CloudBase

Oracle 使用现有受控 GitHub Deploy 工作流安装代码。先确认目标commit、备份/回滚点和所有CI，再执行；合并不等于部署成功。Oracle发布仍与采集解耦，不允许WYZ切 active。

在 Oracle 构建并deep verify Release 后：

```text
npm run cloudbase:release:sync-active -- --dry-run
npm run cloudbase:release:sync-active -- --execute --mirror-only
```

该命令只镜像版本目录并做远端 manifest、四类 index、每类detail、hash/size校验。首次正式 pointer 切换必须人工确认后使用现有 cutover 工具和 `CONFIRM_CLOUDBASE_CUTOVER`；`--execute` 单独不能切 pointer。切换前保存旧pointer，切换后验证失败自动恢复并验证旧pointer，恢复失败需要人工处理。旧Release不能未经审计删除；retention保护active、last-known-good和latest3。

CloudBase只上传manifest列出的公开JSON及与其内容hash一致的gzip sidecar，不上传raw HTML、session、Staging、上传分片或XLS。50MiB是本工具的保守单文件门限；官方不同CLI文档的上限描述存在差异，以当前CLI能力和此门限为准。

## 容量、性能和回滚

容量工具：`node tools/cloudbase/collector-capacity-report.js --list=<tcb-json> --release=<完整下载目录>`。10月8日实测现有Hosting 6,950文件、384,665,491bytes。active版本3,528文件、197,085,521bytes；gzip内容总量9,431,219bytes（本地测量，不等同CDN实际流量）。四类all.json gzip为class31,347、teacher125,487、classroom52,854、course82,878bytes，保留all索引。

按现有版本体积，5份保留约985,427,605bytes；每天有变化时30次上传约5,912,565,630bytes。实际新增四源Release体积、月查询量、缓存命中率、带宽额度、单价仍UNKNOWN，不能用当前历史派生版本代替四源实测。额度API返回当前环境不是资源点计费，需要控制台核验，CURRENT_CAPACITY_SAFE=UNKNOWN。

小程序保持UI/课表/周次/空教室/个人链路，搜索改为缓存→CloudBase静态索引→Oracle静态索引→兼容API。22个本地测试套件覆盖四类、筛选、缓存、主备与LKG、个人同步回归；真机体验和国内网络延迟需要PHONE_ACCEPTANCE。桌面网络测量不能代表微信真机。

WYZ回滚：停止新Collector，按previous-install.txt恢复current软链接，再人工启动；不操作个人Agent。Oracle按既有Deploy备份/版本工作流回滚代码，Release pointer保留上一稳定版本。CloudBase测试目录与active隔离，无需改变当前生产pointer。定时器保持disabled；至少3次真实成功且人工确认后才设置Oracle FOSU_COLLECTOR_TIMER_VERIFIED=1并建议04:30 Asia/Shanghai。

WYZ只保留当前run、最近成功run和最近失败run的恢复缓存；其它终态run会清理。CloudBase镜像按钮复制安全CLI命令，不声称已经完成发布。桌面实测当前CloudBase JSON响应为identity编码，不能把9.4MB的本地gzip估算当作实际CDN流量；压缩与版本目录长期缓存配置需要单独验收。

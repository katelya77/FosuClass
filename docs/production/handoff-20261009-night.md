# 2026-10-09 晚间接力检查点

核心目标是在现有正常项目上增加 WYZ 的四源定时采集模块，经过统一审核/发布后由 CloudBase 向国内小程序分发；Oracle 保留后台控制面与备用读源。个人 Agent、Windows 人工同步、现有正式课表优先保护。费用优化以查询速度、及时更新为前提，不用延迟刷新、减少必要采集或导回美国来凑额度。

用户已确认：零点只断 Windows/Codex 本机网络，WYZ/Oracle/CloudBase 服务器不受影响。今晚不再安排生产写入或新60分钟验收。人工审批点仍然有效；本机断网不能视作自动开启生产的授权。

## 真实状态

| 项目 | 已核实结果 |
| --- | --- |
| main | fetch 后5c8db23e；尚不含完整a3dfd198生产祖先 |
| Oracle | 只读审计37945292721：a3dfd1989705f51c921f13883bcde1cce4502883 |
| 正式 Release | Oracle/CloudBase均2026-10-07T19-12-39，未由本任务切换 |
| WYZ | 已安装b1bc12f9，execute=0、timer disabled；不含B–F候选 |
| 持续验收 | 3605.86秒，51成功/19失败，72.86%，最长确认心跳间隔459.96秒，NOT_PASSED |
| 最近被动诊断 | 最近20次失败均TCP connect阶段ETIMEDOUT，6002–6009ms；未进入TLS；底层丢包位置未知 |
| 个人 Agent | 用户PAM确认active、NRestarts=0；本任务未改服务/代码/凭据 |
| Collector | 用户PAM确认active、NRestarts=0，heartbeat-only；timer inactive |
| 候选 | draft PR #87，branch codex/production-operations-20261009，base codex/wyz-oracle-transport-package；未合并、未部署 |
| 其他工作 | PR #79/#81 OPEN保留；主工作区两份project配置未提交内容保留 |

GitHub CI在本机断网后仍可继续，不能把此前绿色结果当成后续提交的验证。明天先查询PR当前head和对应CI；不要在错误工作区重做安装或从main部署。

已锁定的代码提交 `f5091282eab67805d9426d0260a94e96d60b7d50`：[Linux四源/隔离浏览器CI](https://github.com/katelya77/FosuClass/actions/runs/37953237462)、[Public Security Gate](https://github.com/katelya77/FosuClass/actions/runs/37953062468)、[源站仅被动审计](https://github.com/katelya77/FosuClass/actions/runs/37953247047)全部通过。随后仅补写文档/公开验收证据，执行代码没有再次改变。

最新被动审计确认后端仍a3dfd198；含class vhost的已加载配置摘要出现idle60秒、keepalive_requests5000，具体vhost继承仍需验证。主机所有端口累计ListenDrops179、SyncookiesSent774、SyncookiesFailed31不属于WYZ专属或本次故障时间窗口，不能据此断定TCP丢包位置。审计学校请求0、外网探针0、配置修改0。

## 明天恢复顺序

1. 在独立worktree `C:\Users\Katelya\.codex\worktrees\production-operations\FosuClass` fetch，确认branch/HEAD/未提交文件、PR head及CI。原工作区 `C:\Users\Katelya\Documents\VScode\FosuClass` 是指向D盘的junction，不能覆盖用户project配置。
2. PAM只做 `bash accept-oracle-direct.sh status`，确认个人Agent、Collector、timer和当前b1目录；不重新安装、不重新做短时探针。
3. 审阅并经PAM传入 `apply-control-keepalive.py` 和更新后的 `observe-oracle-direct.py`。先dry-run；由用户批准执行apply后只重启全校Collector。脚本只改验收runner的control socket空闲生命周期5000→75000ms，绑定原runner hash，保留原文件并支持原子回滚；不改b1代码目录、transport、env、checkpoint或个人Agent。
4. 全新完整60分钟观察，记录复用/新建连接、失败阶段、心跳间隔和个人Agent状态。6秒connect、15秒请求、90秒租约及TLS/HMAC不变。失败则继续关闭学校与timer门禁，定位校园出口/公网路径/OCI入口，不放宽租约或关闭证书验证。
5. A通过后再审批学校长期凭据和一次正常Session维护。B代码只做过fixture，不可声称真实登录通过。遇验证挑战立即停止，不做绕过或持续重试。
6. 获批后先最小四源诊断，再完整四源Staging/质量审核；新学期和大变更人工审。首次发布先准备并验证双源不可变文件，最后才审批pointer切换；自动审核/发布未启用。
7. 真实采集、发布、旧微信客户端读取都验收后，才单独批准定时入口。核对Oracle heartbeat的定时门禁、常驻Collector及Linux timer关系，不把“timer enabled”当成已自动采集。源码目前由Oracle在04:30的30分钟窗口排routine；周日05:00 full只在nextSchedule展示，实际自动排full与断网补采窗口需核实完善，不能未经批准启用。

```bash
cd /root/fosu-collector-install/b1bc12f96692768d53004e2573e78e6bd5a62d5d
bash accept-oracle-direct.sh status
# 以下留到明天，传入候选脚本、核对CI并人工批准之后
python3 apply-control-keepalive.py --dry-run
python3 apply-control-keepalive.py --apply
python3 observe-oracle-direct.py
# 撤回本次验收runner修改
python3 apply-control-keepalive.py --rollback
```

## 本轮安全开发与未上线事项

学校独立凭据与受控Session恢复；Windows/WYZ共用四源审核；发布baseline fence及有序双源提交契约；国内主源优先/版本后台对账；WYZ和Windows保留计划；Publisher镜像后自动删除历史Release已改为仅预览；按操作计量/六状态健康契约及运行手册。这些均为候选，不证明生产闭环已经验收；严格双源production adapter、完整历史引用、真实月账单、微信构建/合法域名和真机SLO仍有缺口。共享Windows TLS安全修改需授权的真实兼容验收，未部署到用户现有正常入口。

已有基线依赖漏洞10项（3 moderate/5 high/2 critical）未强制升级，不能忽略。CloudBase默认域名生产条件与120秒cache需后续审批方案；不买资源、不切计费模式、不改DNS/防火墙/代理。容量/调用表为行为情景，实际月用量未知。

今晚未执行：学校请求、定时启用、生产部署、active切换、历史删除、个人Agent重启、微信正式发布。Windows原有人工采集/上传路径保持现状。继续服务的正式数据在服务器和客户端缓存，本机Codex停止不会切断它们；本任务不承诺与自身操作无关的服务器故障不会发生。

完整操作契约、失败回滚与Windows应急见 `docs/production/fosuclass-operations-and-release-runbook.md`。本机已生成的8ab41716候选包没有上传/安装，且早于连接复用修复；不要误用它代替原b1包或明天通过CI的新候选。

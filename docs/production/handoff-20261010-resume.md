# 2026-10-10 网络恢复后的接力检查点

核心目标继续是增强现有系统的 WYZ 四源定时采集，经 Oracle 审核/发布后由 CloudBase 国内分发。个人 Agent、Windows 人工入口、现有正式数据优先保护；不会用延迟数据刷新来节省额度。

## 重新核实的事实

- `git fetch origin` 后 main 仍5c8db23e；PR #87 仍 draft，base为包含生产祖先的 `codex/wyz-oracle-transport-package`。原工作区两份project配置修改保留。
- 只读 Oracle 任务 [37977325078](https://github.com/katelya77/FosuClass/actions/runs/37977325078) 成功，部署仍a3dfd1989705f51c921f13883bcde1cce4502883；学校请求0、WAN探针0、配置修改0。
- Oracle/CloudBase公开指针均2026-10-07T19-12-39、2026-2027-1、epoch1791371572919，未切换。
- WYZ用户已apply连接复用修复：execute0、timer disabled，env/代码/checkpoint保留。后台完整观察已回传3606.78秒，119成功/0失败、118复用/1新建、最长间隔30.57秒、TLS通过、地址146.235.201.244、重启0、学校请求0、acceptance PASS；结束时个人Agent active。A通信门禁通过，学校访问和timer仍未批准。

## 用户当前只需要执行的步骤

60分钟汇总JSON和个人Agent active已经收到，无需再运行观察或安装命令。下一人工门禁是候选包评审/安装及一次只检查学校Session；未批准前不登录、采集或启用timer。下面安装操作已经执行，仅为审计/恢复参考，不是新待执行命令。详见 `evidence/wyz-oracle-direct-keepalive-20261010.json`。

用户准备睡觉、担心PAM自动退出后，已只停止前台观察器并用 `systemd-run --unit=fosu-oracle-direct-acceptance --property=UMask=0077 --property=RuntimeMaxSec=3900 <python3绝对路径> <observe脚本绝对路径>` 启动后台被动观察；后台active及最终PASS均已人工回传。这次观察未重启Collector/个人Agent，没有额外学校请求。

```bash
cd /root/fosu-collector-install/b1bc12f96692768d53004e2573e78e6bd5a62d5d
bash accept-oracle-direct.sh status
python3 apply-control-keepalive.py --dry-run
python3 apply-control-keepalive.py --apply
python3 observe-oracle-direct.py
systemctl is-active wyz-campus-agent.service
# 撤回此次runner修改
python3 apply-control-keepalive.py --rollback
```

该脚本仅修改b1的验收runner心跳连接保留时间并备份，只重启全校Collector；保留execute0、禁用timer、TLS/HMAC/90秒租约、代码/策略/env/checkpoint和个人Agent。原transport/code rollback入口见运行手册。

## 今天的候选补充

1. 实际排队政策：明确常驻服务与Oracle排队的关系；周日full避免与routine重复；日期标记持久化；冷却/会话阻断生效；新策略单独opt-in，未生产启用。
2. 双源发布执行适配：继承原鉴权/scope/质量审查，默认关闭；完整文件校验后有序切指针；CloudBase中断可对账恢复；旧任务及异步构建后的基线冲突拒绝。后台/Windows共用API和确认参数，原Windows默认payload保持一致。
3. 修复准备阶段提前同步pointer的风险；ready-only不触碰runtime，不自动删历史。回滚epoch递增；激活故障恢复注册表/两份Oracle runtime及原兼容快照。
4. 每源全文件校验计量进入审计及dry-run，发布验证流量需加入预算。~385MB是当前远端占用；已测冷查询一个班级约0.98MB，缓存不变时课表正文0，再按刷新时机读取约3KB指针。两者不是同一项费用；原四类冷读取情景不等于每位用户每日必需下载量。
5. 当前app换版实际会预热四类索引；日更班级用户模型已经计入这部分，约4.15MB/人/日（仍不含公告/bootstrap等），而非把0.98MB单操作当完整app流量。按30天、500 DAU约62.19GB，仅为行为模型，实际账单/回源率仍未知。
6. 前台检查30秒、共享query bucket20秒，20相位fixture通过；onHide停止timer。启动现优先采用已缓存合法pointer学期，修复pointer+last-good存在而其它元数据缺失时无法立即显示的基线问题。原失败及隔离b1失败已留本机证据；10个周次隔离用例、runtime-readiness、静态源/缓存首屏及security/architecture/preflight通过，真实微信60秒SLO仍待审批验证。

16个排队fixture、15个执行适配fixture已通过（学校/生产请求0）；新政策的启用记录须有完整四源证据、qualityBlocked=false和不同run ID，不能用缺证据的历史完成记录解锁。独立只检查Session、隐藏输入拒绝回显和限期恢复授权已补齐本地测试。当前代码还须以本次提交对应全量门禁/CI为准，不能沿用昨晚结果。

ad2a8a2提交的四源/Linux及Public Security Gate通过，但Xiaofu CI 37980655992在174/196处失败，原因是新增adapter直接require小程序配置，属于本轮引入，不能算基线失败；对照b1的37981370913通过。现已把分发实现以factory共享到server/src/shared，CLI仍在原路径使用原客户端默认值，服务器用显式env配置，加入独立进程无tools/miniprogram依赖及缺配置拒绝写入测试。本地foundation41/41、regression196/196、competition/final-convergence、四源23套、个人51套、security-full/architecture已重新通过；Linux专有权限、PG/Redis/Docker及最新整套CI以PR相应提交检查为准。

## 仍需真实审批与验证

学校长期凭据授权/一次Session检查；首次四源完整采集与质量基线；Oracle部署身份/唯一CloudBase发布方/默认域名生产限制；首次双源发布及微信正式构建/合法域名/60秒刷新SLO；月账单/发布验证流量；完整历史引用与清理审批；六状态监控执行适配和通知接收者。

未执行学校登录/采集、生产部署、active切换、timer启用、历史删除、个人Agent重启或微信正式发布。详见 `docs/production/fosuclass-operations-and-release-runbook.md`；断网恢复并不替代这些人工门禁。

本次全部本地必跑验证已结束，`release:preflight` ok=true、blockers=[]。候选包只在本机生成并绑定Git commit与SHA256；未运行会向Oracle写入包的Prepare工作流，未安装到WYZ。CI终态和本机包receipt在PR交付记录中核对，下一次恢复先fetch并复查对应head，不根据本页历史状态直接部署。

截至d7b0a7dc，Linux四源38022528015、Public Security Gate38022499829和完整Agent CI38022499833均通过；其后上述客户端/预算校正须使用最新提交的CI。学校Session/凭据交付、仅全校Collector安装与运行入口切换、真实登录、首次四源采集、审核发布、timer、微信正式构建各自停在人工门禁；本机不关机或网络恢复不代表批准这些操作。

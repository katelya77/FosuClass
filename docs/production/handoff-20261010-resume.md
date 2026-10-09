# 2026-10-10 网络恢复后的接力检查点

核心目标继续是增强现有系统的 WYZ 四源定时采集，经 Oracle 审核/发布后由 CloudBase 国内分发。个人 Agent、Windows 人工入口、现有正式数据优先保护；不会用延迟数据刷新来节省额度。

## 重新核实的事实

- `git fetch origin` 后 main 仍5c8db23e；PR #87 仍 draft，base为包含生产祖先的 `codex/wyz-oracle-transport-package`。原工作区两份project配置修改保留。
- 只读 Oracle 任务 [37977325078](https://github.com/katelya77/FosuClass/actions/runs/37977325078) 成功，部署仍a3dfd1989705f51c921f13883bcde1cce4502883；学校请求0、WAN探针0、配置修改0。
- Oracle/CloudBase公开指针均2026-10-07T19-12-39、2026-2027-1、epoch1791371572919，未切换。
- WYZ用户已apply连接复用修复：execute0、timer disabled、个人Agent active，env/代码/checkpoint保留。新观察已回传1171.75秒，39成功/0失败、38复用/1新建、最长间隔30.25秒、TLS通过、重启0、学校请求0；仍需同一次完整3600秒汇总及结束时个人Agent状态。

## 用户当前只需要执行的步骤

保持已经开始的同一次observe运行，满60分钟后只回传最后汇总JSON和个人Agent active。不要重apply、重启、安装或重复探针；下面安装操作已经执行，仅为审计/恢复参考，不是新待执行命令。详见 `evidence/wyz-oracle-direct-keepalive-20261010.json`。

随后用户准备睡觉、担心PAM自动退出。已提供只停止前台观察器并用 `systemd-run --unit=fosu-oracle-direct-acceptance --property=UMask=0077 --property=RuntimeMaxSec=3900 <python3绝对路径> <observe脚本绝对路径>` 启动后台被动观察的命令；后台从启动时重新计满60分钟，不动Collector/个人Agent。尚未回传后台active确认。明天读取最新observation JSON即可；不能根据过去了60分钟就假定PASS。

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

14个排队fixture、13个执行适配fixture已通过（学校/生产请求0）；当前代码还须以本次提交对应全量门禁/CI为准，不能沿用昨晚结果。

## 仍需真实审批与验证

A新60分钟验收；学校长期凭据授权/一次Session检查；首次四源完整采集与质量基线；Oracle部署身份/唯一CloudBase发布方/默认域名生产限制；首次双源发布及微信正式构建/合法域名/60秒刷新SLO；月账单/发布验证流量；完整历史引用与清理审批；六状态监控执行适配和通知接收者。

未执行学校登录/采集、生产部署、active切换、timer启用、历史删除、个人Agent重启或微信正式发布。详见 `docs/production/fosuclass-operations-and-release-runbook.md`；断网恢复并不替代这些人工门禁。

# WYZ 915 jQuery 账号预检查增量

本页替代旧手册中的 215 升级前驱。本次固定前驱与代码回滚点均为
`9153876458df7b1dd6b4fae698851638b31c702e`。Oracle #92 的
`7ad3b2708ce553e6fff099fd881a4b9c86ebea39` 保持不变。

## 已有真实证据与修复范围

用户单次 WYZ 请求形状诊断确认：官方 HTTPS 固定预检查路径、GET/XHR、同一绑定账号、
username 单次、一个 13 位十进制 `_`、无 body/Authorization；失败条件只剩
`queryKeyCount=2` 与 `hasExtraKeys=true`。事件顺序 focus/input/change/blur。
诊断没有放行预检查、提交密码、预留预算或更改 Session/历史。此处不保存真实参数值。

请求策略保留原单 username 形式，增加恰好一个 `_` 的已观察形式，允许参数顺序互换。
键名必须是原始 username 和 `_`，时间戳必须是原始 13 位 ASCII 十进制数字；
编码键别名、编码时间戳、重复/第三个键、空值、非法百分号或 UTF-8 均拒绝。
用户名仍在本机完整匹配本次绑定值，合法用户名编码保持兼容。

来源、路径、GET/XHR、body/Authorization、主认证 POST、严格 TLS、官方响应结构、
挑战与单次提交预算没有放宽。浏览器适配器的单次预检查仲裁保持原实现，
迟到页面 XHR 只复用同一 context/账号下已验证的官方响应，不再访问学校。

诊断进程挂住的本地根因已用 Linux PTY 复现：新 stdin 的 readableFlowing 为 null，
但 isPaused() 为 false；原隐藏输入结束后没有暂停自己启动的读取。
terminalPrompt 现在恢复此前是否真正流动的状态，移除监听器并恢复 raw mode；
不使用 process.exit 或杀死全局 Chromium。进程测试验证完成 exit=2、失败 exit=1、
Ctrl+C 和超时 exit=2，锁、浏览器及 CDP 均按正常清理路径释放。
一次性账号形状诊断不进入生产 Collector 包，也不再要求运行。

## 安装批准与唯一 ZIP

准确提交、ZIP SHA256、源包 SHA256 和 CI URL 以最终外部交付 receipt 为准。
CI 测试阶段不构建 ZIP；全部准确 head 的门禁通过后仅生成一个交付 ZIP。
构建器拒绝非 915 前驱及重复交付目录，所有源包字节与 Git 提交逐项核对。

上传这个唯一 ZIP 到 `/root/heartbeat-upgrade-<完整提交>.zip`，仅执行最终交付的完整粘贴命令。
粘贴命令在独立 Bash 子进程内定义全部变量并验证外部 ZIP SHA256，然后解出已审核助手。
归一化目录固定为 `/root/fosu-cache-buster-<完整提交>/candidate`，失败现场一直保留。

`pam-cache-buster-upgrade.sh --approve-install` 仅进行安装和本机验收：

- fromRevision 必须是完整 915，current 只能为 915 或本候选。
- 已安装候选只读核对源码/receipt、heartbeat、个人 Agent、timer、预算与凭据元数据，不重装。
- 已开始但未完成的安装留有独占 attempt marker，不能自动再跑。
- 使用原 upgrade-candidate.sh、安装器、heartbeat 门禁和备份；出错停止，变更后只停 Collector。
- 全部源文件与已校验源包逐项比较，文件数取 source receipt，不能写死 425。
- 保留凭据、Session、auth-state、checkpoint 元数据；凭据内容不读取。
- backup/current.txt 必须精确指回 915；保留 rollback-backup.path 与独立 installation receipt。
- 最终 `INSTALLATION_PASS` 不表示公开 CAS 或 Session 通过。

包装器子进程 exit=2 表示 BLOCKED，其他非零为 FAILED。交互 Shell 的外层 if 保留连接，
明确打印子进程状态，不能用 Shell 继续运行来表示成功。没有学校、Oracle 请求、
采集、timer 启用、后台发布或 Active 切换。

## 单独批准公开门禁

此命令**不在安装脚本内执行**。确认安装 PASS，取得新的公开 CAS 访问批准后，
在独立子 Shell 中进入上述 candidate 目录执行：

```bash
bash cas-session-gates.sh --approve-public-cas
```

它先核对已安装源码、原预算/冷却和 protected-file 元数据，再运行一次原公开诊断。
不读密码，不触发账号预检查或主认证，不修改 Session/认证历史。
预算必须为 0/2 或 1/2、cooldown=0；未知 blocked 原因保持停止。
允许本次已确认 local_preflight 的 PRECHECK_REQUEST_REJECTED 或旧 NETWORK_REVIEW_REQUIRED，
不会退还预算、清空 blocked、缩短冷却或删除历史。
真实公开结果由现有 acceptance 评估，只有 receipt PASS 才输出 `CAS_PUBLIC_PASS`，
并输出 `evidence=<candidate>/cas-gate.<随机值>`。后续必须单独批准一次登录。

## 单独批准一次真实 Session

在公开 receipt 有效期 15 分钟内，获得一次登录及受保护页复核批准后，在该 candidate 目录执行：

```bash
bash cas-session-gates.sh --approve-session '<上一步输出的完整 evidence 目录>'
```

路径是运行证据目录，不是账号或密码。无需重新输入凭据；只读取现有 protected-file，
有效 Session 则直接复用。凭据不进入命令、环境变量、日志、Oracle 或浏览器管理后台。
参数是当次明确批准和人工处理已知本地故障的确认，预算、冷却和提交历史仍生效。

仅调用一次 login，失败立即 BLOCKED，不重试、不切换 UA、不扩大访问范围。
官方预检查 true、未知响应、重定向、TLS 或异常重复均停在密码之前。
保存前沿用原受保护页面、新 context 和原子 Session 保存检查；之后额外使用独立
session-check 验证当前受保护页。新建结果保存配对验收 receipt，复用结果保留独立复核证据。

结果严格分为 `SESSION_SAVED_AND_VERIFIED`、`SESSION_REUSED_AND_VERIFIED` 与 BLOCKED/FAILED。
过期没有新 Session 时停止，不能把 REUSED、fixture、代码 CI 或公开门禁当作新建 Session。
Session PASS 后只进入 Oracle #92 现网预检与独立部署审批，不能启动全量采集或发布。

## 独立回滚批准

保留原 915 release、本次备份目录及 candidate。需要回滚时核对输出的备份路径和 915 指纹，
获得回滚批准后，在独立子 Shell 的 candidate 目录执行：

```bash
bash rollback-cache-buster.sh --approve-rollback
```

current 只能为本候选或 915；backup/current.txt 必须精确为 915。
先检查个人 Agent、timer 与原 heartbeat 身份，然后只停止 Collector，恢复 915 指针、
备份 unit 文件，验证原 drop-in/runner 基线后只启动 heartbeat Collector 并做健康验收。
不会删除 drop-in、拷回旧认证状态、替换当前 Session/凭据/checkpoint、启用 timer 或操作个人 Agent。
异常来源、版本、备份、unit 或健康状态停止并保留现场，不能据指针切回声称回滚通过。
915 的 cache-buster 拒绝行为会恢复；回滚后不应再尝试同一真实登录。

## 验收限度

红灯：原 915 对已观察合法 `_` 的策略用例失败；原 TTY 完成后 Node 存活。
绿灯：新查询白名单、两种顺序、12 个 Chromium 仲裁/响应/重复/受保护文件场景；
官方预检查总数不超过 1，密码提交及预留与原有期望相同；Linux PTY 四种退出路径、
安装/只读/故障/回滚、protected-file、Session、个人同步、四源、Agent、安全和架构门禁。
准确数量、命令和 CI 状态见最终交付报告。
开发期间未运行学校探针、真实登录或生产安装；新版本现场 CAS、Session 和 Oracle 尚待独立验收。

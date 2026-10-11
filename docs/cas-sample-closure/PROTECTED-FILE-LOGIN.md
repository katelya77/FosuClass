# 账号预检查与受保护文件手动登录

当前 WYZ 已安装 `215f7e54ee08bcf1a9478e8f4d81b9fcff364a5a`，安装和公开CAS验收PASS；移动UA、语言初始化、表单已通过。本轮增量从215继续，不重新开发这些机制。真实一次登录出现程序预检查false之后的页面GET XHR被ACCOUNT_PRECHECK_NOT_AUTHORIZED拒绝；密码提交/预留/认证响应均0，失败是local_preflight，不是密码错误。Agent本轮没有访问学校或操作生产。

## 一个官方账号预检查结果

原顺序是 account.fill → context.request.get → password.fill（账号blur）→ 页面GET。新流程在填入账号前绑定同一账号与新CAS context，主动让页面自己的账号blur/change先发生；最多等待1秒发现其XHR。若页面先发出，程序不再发GET；若没有，则仅一次程序GET作为备用。若页面随后才发出第一次相同账号XHR，Fetch守卫向这个请求交付**同一次官方GET已经取得并验证的原始响应正文**，不再次访问学校、不改写真假结果、不转发Cookie或新增域名。缓存仅存在于本次login/context，结束/取消清空引用；不跨账号或context复用。

范围固定为HTTPS authserver.fosu.edu.cn、`/authserver/checkNeedCaptcha.htl`、GET、XHR、仅一个username参数且等于已填写的账号，无其他query/fragment、正文或Authorization；公开页没有绑定账号时仍拒绝。该请求最多一次浏览器观察、最多一次真实官方GET，所有计数在异步CDP操作前占用。第二次页面调用、POST、Document/不认可类型、错误账号/额外参数、外域均停止。主CAS认证POST的唯一槽位、持久预算和严格TLS不变。

响应要求HTTP200、无重定向/传输错误、最多2048字节；Content-Type只能缺失、application/json或text/plain。正文须是JSON boolean，或仅包含isNeed/needCaptcha的既有结构，值仅boolean或`"true"`/`"false"`；任何true要求人工验证码/安全验证并停止，未知结构、HTML、错误状态或重定向均停止。备用GET maxRedirects=0且最终URL逐字匹配原请求；浏览器Response暂停后调用原生Fetch.getResponseBody，验证完毕才能进入密码填写。诊断只输出source/真假/计数，不输出账号、query、正文或凭据。

## 一次配置，后续单命令登录

升级批准后的固定候选安装完成，再在WYZ PAM root终端执行一次本地配置：

```bash
fosu-collector configure-credentials
```

账号和密码均由现有TTY隐藏输入；不把值放进命令、环境变量、here-doc或粘贴脚本。命令不访问学校/Oracle，也不写认证历史。文件固定为`/var/lib/fosuclass/schedule-collector/school-credentials.json`，schema1的account/password/recoveryEnabled=false。运行时没有credential-file/path参数或环境变量覆盖；manual CLI数据目录固定。更新账号/密码只再次执行同一配置命令，不需改源码。

写入使用同一学校会话锁、private-parent下独占临时文件、0600、fsync、原子rename与目录fsync；原文件异常则拒绝覆盖。读取要求普通文件、root所有者、**精确0600**、单硬链接、父目录root/0700，祖先无symlink且受保护；Linux使用O_NOFOLLOW、fstat/inode校验，不跟随链接。root拥有的sticky临时祖先只用于离线fixture，生产路径没有该例外。Windows不能证明POSIX权限，必须由真实Linux CI验收。

公开门禁已经PASS仍需在最终候选升级后只做一次公开诊断。它不会读取该文件。随后冷却/24小时预算允许、旧失败已人工处理、并单独批准本次真实登录后：

```bash
fosu-collector auth-state
fosu-collector login --login-profile=mobile --credential-source=protected-file --approve-school-access --acknowledge-auth-failure
```

这里的acknowledge只适用于此次已知旧失败被人工确认处理的情况；没有旧blocked时可以省略。它不清空或退还历史预算，也不提前解除旧冷却。protected-file必须显式approve；没有批准时不读取密码、不创建浏览器、不联网。新建Session需要且仅需要一次认证POST；失败非零退出、不重试、不循环、不换UA。有效Session直接复用，不再询问REUSE或读取密码。原默认hidden-input模式仍保留；新文件recoveryEnabled=false不启用定时/自动恢复。

文件读入Buffer使用后清零，成功/失败/取消均清空凭据对象及本次预检查账号/cache引用；JavaScript不可变字符串不能保证物理内存擦除。登录输出passwordPersisted=false专指没有把密码写入Session/Trace/日志；受保护文件的持久密码由操作者明确配置。文件不得进入Git、上传包、CI artifact、Oracle或CloudBase。

## 失败与预算证据

| 真实阶段 | 后续处理 |
| --- | --- |
| 已确认本地DOM/规则适配错误，未预留认证 | 不增加密码预算，不新增30分钟密码冷却；保留旧冷却、旧blocked和历史，需修复/人工确认 |
| 官方账号预检查错误/未知结果、异常重复、安全挑战 | 不增加密码提交预算，停止；预检查/安全冷却与人工门禁保留 |
| 已持久预留、未确认放行 | reserved_unknown，预算已消耗；不按诊断0猜测退款，保持冷却 |
| 已放行、未收到明确结果 | released，结果未知；不自动重试，保持预算/冷却 |
| 收到官方认证结果 | response_received；密码错误或挑战停止，按真实结果分类 |

auth-state增加failurePhase以区别上述阶段；旧schema/字段保持兼容。用户现有school-auth-state.json不删除、不迁移清空、不缩短已有冷却。纯本地错误只改变**未来新失败**的冷却计算。

真实通过条件仍是SESSION_SAVED、单次认证、受保护教务页及候选Session新context有效后原子保存。然后使用[分层验收器](../production/cas-sample-closure-acceptance.md)一次session-check和receipt配对；fixture不替代学校验收。Oracle PR #90/c74保持独立，接下来先单独批准Oracle现网只读预检、备份/受控Sample部署，再分别批准一个班级请求组和四源小样本；不能自动全量、timer、Staging发布或active切换。

## 构建与回滚

此次升级fromRevision/回滚代码点固定为已安装215f7e54，而不是6fe或6ee；源码与ZIP哈希取最终准确提交的Linux CI receipt。继续使用既有LF checksum、ZIP归一化、upgrade-candidate.sh及heartbeat-only语义门禁。保留本次BACKUP_PATH/rollback-backup.path。代码回滚只恢复215代码及必要unit，保留受保护凭据文件、Session、auth-state、checkpoint及个人Agent；旧215没有protected-file选项，可继续隐藏输入，但其已知双预检查冲突会恢复，不能据回滚声称登录兼容。门禁不通过保持Collector停止。Oracle独立回滚，不随CAS切换。

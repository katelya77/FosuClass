# 四源资源目录阻断：候选修复与现场证据

## 已核实的工程现场

- WYZ 候选基线为 PR #101 的 `7e8dfb24b2ce1b1e55313c7fcf9f9ba8edfb249f`，不是 PR #103 或 PR #99 的线性合并结果。本改动只沿该 Worker 分支研发。
- 2026-10-17 北京时间的 Oracle 签名只读状态：`sc-9611df5c90c4dc800e7e2c14` 已失败，无上传；只保留 class 来源成功摘要（1 请求组、1 文档、33 事件），最后上报的学校请求数为 37。
- 用户提供的 WYZ 本地终态为 `SCHOOL_PAGE_CHANGED / resource-build`，本地账本 reserved/completed=45，failed/unknown=0，remaining=75。它与 Oracle 最后上报的进度不是同一计数时点，不能相互覆盖，也不能用于推算认证请求数。
- Oracle 当前镜像指纹仍为既有生产提交；API 就绪、个人 Agent 在线、正式 Active 版本保持可用。本轮没有生产写入。
- 已 confirmed 的 class 样本 `sc-ef812f542b57682ddc01d684` 及人工审核记录继续有效。本轮不重复采集或修改该审核记录。

## 确定性定位及其限度

2026-10-17 用户返回了校验和匹配的 WYZ 离线回执：installedRevisionMatch/workerSourceMatch/approvalBound 均为 true；原错误准确为 sync.js:723:66；本地账本 45/45 全部完成、unknown=0；只有 class 成功摘要；resourceDirectory=DOM_NOT_RETAINED；timer=disabled/inactive；原密码提交、认证请求和 Session 探测次数仍为 UNKNOWN。回执中的历史认证成功信号不能替代独立计数。

资源执行顺序为 teacher、classroom、course。结合只存在 class 摘要，阻断来源可收窄至 teacher 入口；精确行号对应旧 gate 的控件等待超时。该 gate 同时依赖学期控件和目标 select，因此仍不能确定是哪个字段缺失或尚未加载。原 gate 在选择目标学期前要求资源目标 select 非空，10 秒等待失败统一改写为 SCHOOL_PAGE_CHANGED。它既不能证明网页改版，也不能区别目录未加载、空目录或其他控件契约。

原目录发现还要求全部 scope 未过滤；单目标 Sample 因此被全校目录门槛阻断。两项逻辑缺陷已用本地真实 Chromium 重现和修复，但尚无当前教师页 DOM/业务接口现场证据，不能宣称已解决真实学校的全部四源适配。

现有契约如下，名称来自既有源码，**不是本轮学校验证结果**：

| 来源 | 页面 / POST | 既有目标 select 候选 |
| --- | --- | --- |
| teacher | kbxx_teacher / kbxx_teacher_ifr | js, skjs, teacher, jzg, jzgid, gh, jsid |
| classroom | kbxx_classroom / kbxx_classroom_ifr | jsid, js, room, roomid, classroom, classroomid |
| course | kbxx_kc / kbxx_kc_ifr | kc, kcid, course, courseid |

本轮不增加猜测的字段别名、接口或 scope，不用派生对象充当直采身份。若现场只有文本输入、树形选择或其他业务接口，候选仍会关闭并要求证据，不会进行通配查询。

## 候选行为

1. 资源页导航只验证原 protected origin/path、HTTP 状态、Session、验证码、权限拒绝和学期控件。班级页既有控件要求保留。
2. 精确匹配 xnxqh 学期选项，选择学期后再有界等待目标。生产超时仍为原来的 10 秒；不重试、不放宽 TLS/来源/预算。
3. 学期改变时，旧目标不能直接视为新学期目标。当前保守要求可见目标发生重绑定；两学期目录完全相同时可能停止为 SCHOOL_DIRECTORY_TERM_REBIND_UNVERIFIED，需要现场完成信号再改进。
4. 仅 Collector 的 four Sample 且 entity-limit=1 可使用已发现的受限目录目标。它仍从真实页面 option 取身份，独立 POST 和严格解析；coverageValid=false、catalogComplete=false。正式目录继续拒绝受限范围。
5. 缺失、禁用/加载中、空目录、多目标控件、学期不可用、权限拒绝各有独立失败码。任何失败均不继续课表 POST。
6. 每个来源开始即写入当前来源诊断，并独立保存 resource-directory-{source}.json。诊断仅有固定来源、阶段、布尔、计数和已知控件名；不保留原 HTML、目标 value/label、输入内容、URL、Cookie 或 Session。

## 最少现场操作

先执行只读的失败任务取证，不安装新源码。复用 inspect_failed_sample.py，增加显式 120 预算支持；默认 40 保持兼容。检查原 run、term、revision、Worker SHA、审批和账本绑定，原认证/Session 探测计数缺失时仍为 UNKNOWN。

一次性 .sh 在本机 ignored 交付目录生成，校验 Bash 与 Python 3.6 语法。它只读本地文件与 systemd 状态，不访问学校/Oracle、不重放、不改 timer/active。旧 Worker 未留存 DOM 时应明确 DOM_NOT_RETAINED；不能编造控件结论。

如仍无目录现场证据，下一步应单独批准一次 teacher 页面只读诊断：新执行身份、仅已知页面、Session 复用、禁止密码提交、明确时间窗和请求上限；不读课表、不扫描全校、不升级后直接重放旧 Sample。新的四源任务仍需另行批准新 ID 与范围。

现已准备免安装的独立候选：复用已安装 Worker 的 initBrowserContext、RequestLedger、串行间隔与 TLS/redirect 限制；只允许一次 GET /kbcx/kbxx_teacher 及同源 JS/CSS 静态依赖。XHR/fetch、全部 POST、第二个文档和课表 iframe 一律在发出前拦截，仅保留安全路径与参数名用于后续审核，不读取其返回数据。目标学期不可选时仅报告结构；只有初始化未出现需审核的业务调用时，才允许设置一次学期控件，设置引发的业务请求仍受上述拦截。

诊断总请求上限 40，执行起 10 分钟审批窗口，90 秒触发浏览器停止，systemd 强制上限 110 秒；认证、密码、独立 Session 探测和课表请求均为 0。默认命令不带 --approve-school-access 即拒绝，执行目录一旦保留则禁止再次运行。旧失败 Sample ID 不被构建器接受。Node/systemd 使用已安装环境，不重启已有服务、不修改 current/timer 或 Oracle。systemd Worker 自持锁，PAM 断连不会释放活跃锁；缺失终态按 UNKNOWN 保留，不自动重放。

上下文在建页前拒绝所有 WebSocket，并禁用 RTC、WebTransport、Worker/SharedWorker 等可能绕开 HTTP 账本的传输。页面触发这些能力时只记录固定能力名并要求审核，不继续学期动作。loopback fixture 验证没有 WebSocket 握手、STUN UDP 或 Worker 额外请求。

输出只含控件名称/类型/数量、学期匹配布尔和被拦截请求的安全结构，不含 option/输入值、原 HTML、Cookie、原始 URL 或认证正文。候选仍待新的学校访问授权；代码与 fixture 通过不等于学校诊断已执行。

## 增量执行器边界

PR #99 的 21 项规划器测试通过，但 routine/full 尚不能执行。它与当前 WYZ Worker 分叉，必须显式整合。

已确认缺口：服务端完整目录/审核权威绑定；正式任务向 RequestLedger 传预算；按批准目标选择而非 ALL_SCOPES 全扫；逐目标签名 Staging 与持久化幂等回执；恢复读取真实检查点且不清除未知结果；服务层统一调度/claim 门禁；保护待审核失败现场。

不能只解除管理路由的 formal 开关。旧正式上传校验仍要求完整四源；需新增目标级私有审核集成，保留完整正式发布校验。目录总数 C/T/R/K 继续 UNKNOWN，Sample 不建立全校覆盖率。默认关闭调度，至少三次受控真实增量验收并获批准后才启用。

## 验证与回滚

本轮浏览器 fixture 覆盖四个适配 POST、学期异步填充、受限 Sample、目录失败分类、权限拒绝和早期失败来源归属；学校请求为 0。失败取证测试覆盖 40/120 预算、身份/hash 绑定和敏感字段裁剪。完整命令与结果在交付验收记录列出；fixture/CI 不是学校验收。

候选尚未安装。当前 WYZ 指针、Oracle API、正式 Active 和 timer 不变，无需执行生产回滚。若未来获准源码升级，必须沿用既有受控升级工具和 predecessor 回滚点，先完成精确提交 CI 与断网验收，再另行授权学校操作。

# 小佛助手课程任务 Agent V1

## 本轮边界

本轮在既有 Agent Kernel、受约束 Planner、Tool Registry、Provider Chain、Release Pack 和卡片协议上增量实现课程任务闭环，没有建立第二套在线 Agent。`public` 仍是确定性工具与规则路径，外部模型调用次数为 0；`trial/dev` 的模型只参与理解、规划和表达，不能产生课程、教室、教学周或路线事实。

## 已完成能力

- 四层上下文：最近 8 条脱敏消息、会话摘要、任务槽位、用户明确要求记住的长期偏好。
- 记忆控制：同会话复述、云端记忆显式开关、逐项删除、清空当前会话与清空云端记忆。
- 安全 Markdown：标题、强调、删除线、列表、引用、分隔线、行内/围栏代码、复制、表格、白名单链接与长文折叠；不使用任意 `rich-text` HTML。
- 课程提醒：自然语言解析、确认令牌、幂等写入、重复确认防护、启停/修改/删除、一次性微信服务通知额度、应用内收件箱降级、重试、发送日志与过期清理。
- 课程行动：下一节课、今日课表、路线/出发建议、天气建议、空教室、冲突/连续赶课、课表变化与修复入口。
- 主动入口：助手首页和小佛浮窗只展示可由个人课表验证的下一节课、空档、变化或导入提示。
- Runtime Truth：状态胶囊来自真实 Run Events；只有 `provider.started` 才显示 Thinking。
- Coze：后台只要求 PAT/API Token 与已发布 Bot ID，支持错误分类连接测试、密钥掩码和 Provider/确定性回退。

## 写操作与安全模型

提醒的 `create/update/delete` 不由 Tool 直接落盘。Agent 先返回确认卡，服务端在 Provider/Composer 之后附加绑定 Principal、操作、有效期和幂等键的签名确认令牌；用户点击确认后才调用写 API。确认令牌有效期 10 分钟，重复确认返回同一操作结果。

提醒状态与 OpenID 分别使用 AES-256-GCM 加密并按 Principal 分片。OpenID 不进入模型、Trace、普通日志、测试快照或小程序请求体。课表变化上报只包含经过裁剪的确定性摘要。普通一次性模板每次接受增加 1 次本地服务通知额度，成功发送后消耗 1 次；额度为 0、微信授权失效、不可重试拒绝或重试耗尽时，调度器把同次任务写入加密应用内收件箱并推进后续提醒，避免规则静默终止。应用内事件最多保留 30 条、7 天，助手首页与已登录的小佛浮窗负责拉取。

## 服务端环境变量

```dotenv
# 至少 16 字符，正式环境使用彼此独立的高熵 Secret
FOSU_AGENT_MEMORY_SECRET=
FOSU_AGENT_REMINDER_SECRET=
FOSU_WECHAT_RECIPIENT_SECRET=

# 默认关闭；完成模板与单实例调度配置后再启用
FOSU_COURSE_REMINDER_DISPATCH_ENABLED=false
FOSU_COURSE_REMINDER_DISPATCH_INTERVAL_MS=60000

WECHAT_APPID=
WECHAT_APPSECRET=
WECHAT_COURSE_REMINDER_TEMPLATE_ID=
WECHAT_COURSE_REMINDER_TEMPLATE_ID=f-m3xKVLJpRAe63Ao0WRFGspF7se_t1Fb1rbqJJWIcQ
WECHAT_COURSE_REMINDER_DATA_FIELDS_JSON={"courseName":"thing8","startTime":"time15","duration":"thing2","teacherName":"thing14","classroom":"thing4"}
WECHAT_REMINDER_MINIPROGRAM_STATE=formal
WECHAT_REMINDER_TIMEOUT_MS=5000
```

`FOSU_COURSE_REMINDER_DATA_DIR` 与 `FOSU_WECHAT_RECIPIENT_DATA_DIR` 可覆盖默认的 `FOSU_DATA_DIR/ai/...` 路径。目录需要持久卷、仅服务账号可读写，并纳入加密备份。

## 微信后台手动配置

1. 登录微信公众平台，在“小程序 → 功能 → 订阅消息 → 公共模板库”选择合规的课程/上课提醒模板；普通模板不得描述成免授权永久推送。
2. 当前“日程提醒”（模板编号 17406）使用课程名称、开始时间、时长、教师、地点五个字段；校区与教室会合并到“地点”，不得额外发送模板不存在的字段。
3. 将模板 ID 写入服务端；小程序从受控 capability 接口读取模板 ID，不维护第二份配置。用户必须在点击“确认并授权”按钮后由 `wx.requestSubscribeMessage` 发起授权。
4. 配置订阅消息跳转页面 `pages/today/today` 并确认该页面已在对应版本发布。
5. 在正式开启调度前，用开发版/体验版完成授权拒绝、单次接受、模板错误、限流和超时测试。

消息正文包含课程名称、开始时间、教室、教师和校区，跳转到今日课表。送达位置是微信“服务通知”；微信模板本身不支持额外“路径”文本字段，因此路径通过订阅消息的 `page` 参数实现。提醒管理页显示剩余额度，并提供必须由用户主动点击的“补充微信授权”。

## 数据迁移

本轮没有数据库 Schema 迁移。提醒和接收者保险箱使用现有服务端持久数据目录内的加密文件，Schema 为 `course-reminders.v1`。上线前必须先配置密钥与持久卷；丢失密钥无法恢复密文，应通过停用提醒并让用户重新授权的方式处理，不能降级成明文存储。

## UI 原则

- iOS 原生感与佛课小表品牌红结合，采用实色、细分隔和清晰层级，不使用玻璃卡片堆叠或无意义渐变。
- 手机端使用统一 16rpx 内容轨道，状态胶囊、主动洞察和任务结果卡横向铺开；仅用户消息气泡保持紧凑宽度。
- 状态色以品牌红、学术绿和中性灰为主，正文保持长文本可读性；深色模式使用同一语义层级。
- 所有主要点击区域不小于 44px；安全区通过系统信息和 `safe-area-inset-*` 共同适配。
- 动画只用于状态变化，低端设备与 `prefers-reduced-motion` 自动降级。

## 当前限制

- 微信订阅消息按平台能力实现为一次性授权；没有账号后台明确提供的长期模板时，每次服务通知都需要可用额度，始终保留应用内提醒。
- 默认调度器适用于单实例服务。多实例部署前需要外部租约/队列保证全局单消费者；本轮没有部署生产环境。
- 天气和路线建议只有在对应确定性上下文可用时才给出；缺少数据会明确说明，不补造事实。
- 小佛浮窗使用短期、脱敏的本机洞察缓存，不承担在线 Agent 决策。

## 本地验证

专项命令：

```bash
npm run test:agent-personal-memory
npm run test:safe-markdown-renderer
npm run test:course-reminders
npm run test:course-agent-actions
npm run test:coze-connection-config-ux
```

本轮最终结果：foundation 19/19、regression 96/96、competition 全部通过、final-convergence 全部通过、phase2 11/11、phase3 16/16；主包 1,586,772 字节，总包 2,257,911 字节，共 2 个分包。

微信开发者工具 Stable v2.01.2510290 已通过 CLI 登录、打开和自动化启动，模拟器在 430×834 视口完成助手首页编译与首屏观察，顶部安全区、状态胶囊、主动洞察和输入区均可见。键盘弹起、真实订阅授权/发送、跨多机型深色模式与弹层交互仍需在配置真实模板和测试账号后人工验收，不能把静态检查或 mock 结果描述成平台实发验证。

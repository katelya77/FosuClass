# 小佛助手全宽工作台与微信服务通知设计

## 目标

在不改变 Agent Kernel、Release Pack、Provider Chain 和 `public` 零外部模型边界的前提下，完成小佛助手发布收口：手机端任务内容充分利用横向空间；设置页提供显眼的智能课程提醒入口；课程提醒通过微信小程序订阅消息进入微信“服务通知”，并对一次性授权额度做真实、可见、可补充的管理。

## UI 设计

采用已确认的方案 A。手机端使用 16rpx 内容安全边距，状态胶囊、应用内提醒、主动洞察、结构化结果卡、Markdown 和提醒管理面板共享同一全宽内容轨道。助手文本保留头像识别，但结果卡不再额外居中或设置窄宽；用户消息气泡继续限制宽度，维持对话方向感。600px 以上视口启用阅读宽度上限，避免平板横向文字行过长。

设置页“今日提醒”分组新增“智能课程提醒”导航行，副标题同时显示“微信服务通知 · 应用内兜底”。点击后进入 `/packageXiaofu/pages/ai-assistant/ai-assistant?panel=reminders`，助手页面在初始化后直接打开提醒管理面板，不自动发送聊天消息。

## 微信服务通知链路

课程提醒使用小程序订阅消息。用户必须从确认卡或提醒管理页主动点击按钮，随后调用 `wx.requestSubscribeMessage`。普通一次性模板每次接受只记为 1 个本地授权额度；服务端不声称永久订阅，也不把客户端回报当作最终送达证据。

提醒状态新增 `authorizationCredits`。创建提醒时接受订阅则初始为 1；用户在管理页“补充微信授权”后，通过带幂等键的受保护 API 增加 1。成功发送微信消息后消耗 1；微信返回未授权、模板错误、接收者失效等不可重试错误时清零额度，将同次课程事件写入加密应用内收件箱并推进下一次课程，避免提醒静默丢失。网络、限流和系统繁忙按既有退避重试；重试耗尽后同样进入应用内收件箱。

微信平台仍是授权与送达事实源。若小程序后台提供长期订阅模板，必须先核实账号类目与模板类型后再扩展；当前发布保持 `requestMode: one_time`。

## 服务端与隐私

新增授权 API 只接受已验证 Session 派生的 Principal、提醒 ID、`accept` 状态和幂等键。OpenID 继续由服务端 Session 写入独立 AES-GCM 保险箱，不进入请求体、模型、Trace 或普通日志。授权额度与提醒规则保存在现有 `course-reminders.v1` 加密分片，不引入数据库迁移。

必须生成并配置互不复用的 `FOSU_AGENT_MEMORY_SECRET`、`FOSU_AGENT_REMINDER_SECRET`、`FOSU_WECHAT_RECIPIENT_SECRET`。微信模板 ID 与字段键只能来自小程序后台，不能由代码猜测。

## 发布策略

在 `codex/xiaofu-agent-reminder-release` 分支定向提交本轮文件，排除已有的 `server/data/ai/kb-audit.jsonl`。推送并创建 PR，等待完整 CI。生产发布只通过仓库现有 `Deploy to VPS` GitHub Actions：合并到 `main` 后执行 release preflight、SCP、容器替换、健康检查和发布后验收，不直接 SSH 手工改生产文件。

若尚未提供订阅模板 ID，部署时保持 `FOSU_COURSE_REMINDER_DISPATCH_ENABLED=false`，避免产生无法送达的承诺；模板配置完成后再启用并进行真实手机授权与服务通知实发验收。

## 验收

- 430×834 模拟器中主动洞察和状态胶囊接近全宽，左右边距一致。
- 设置页入口能直达提醒管理面板。
- 每次授权只增加一个额度，重复 API 请求不重复增加。
- 成功发送消耗一个额度；额度不足、授权失效和重试耗尽均进入应用内收件箱。
- 订阅消息包含课程名、开始时间、教室、教师、校区，并跳转今日课表。
- public 外部模型调用为 0，Agent foundation/regression/competition/final-convergence/phase2/phase3 全部通过。

## 需要账号管理员提供的信息

管理员在微信公众平台进入“小程序 → 功能 → 订阅消息”，选择与上课提醒相符的模板，并提供：模板 ID、模板类型（一次性或后台明确显示的长期）、五个字段的实际键名与类型、模板审核/启用状态。AppID 与 AppSecret 已由 GitHub Secrets 管理，不应通过聊天发送。

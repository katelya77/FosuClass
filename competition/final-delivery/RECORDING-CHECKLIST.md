# 校园智序·小序｜REAL ADP 录制清单

> 录制目标：2:34–3:38 的真实 ADP 段。只录 Live ADP；“已核验实录回放”仅用于限流时向评委说明已有真实成功证据，不得剪成实时成功。

## 录制前 3 分钟

- 打开 `https://adp.katelya.top/#/experience/insight`，确认页头为 `Live ADP`，不是 `Verified Replay`。
- 打开 `https://adp.katelya.top/#/adp-diagnostics`，确认 API、SSE、Conversation、Widget SDK 状态可见；返回体验页后不刷新 ConversationId。
- 浏览器 1440×900 或 1920×1080，缩放 100%，关闭书签栏、下载栏、通知与密码提示。
- 只保留一个 4174 页面标签；发送期间不要点击第二次，不要多窗口并发，不要预热请求。
- 若出现 `400429`，停止发送，保留问题与限流画面；等待页面冷却结束后再人工决定是否重录。不得连续重试。

## 第一优先：连续上下文 A → B

### A. 未来四周教师负载最高的是谁？

1. 输入并完整拍到问题：`未来四周教师负载最高的是谁？`
2. 拍到执行轨从 `用户` 到 `小序·主协调` 变为激活。
3. 拍到 Child Agent 名称：`小序-校园洞察`。
4. 拍到 CampusTools 真实工具名，至少包含：
   - `campus_overview`
   - `campus_teacher_load_query`
5. 拍到官方 Widget 标签与真实 `<adp-widget>` 渲染完成。
6. 结果构图必须同时可读：`Top1 教师025`、`56 课次`、`112 课时`、`已核验`。
7. 推荐成片保留 17–22 秒；结尾在 Widget 稳定后停留 2 秒。

### B. 再检查 Top1 未来四周有没有跨校区赶场风险。

1. 不刷新页面，在同一个 ConversationId 中继续输入：`再检查 Top1 未来四周有没有跨校区赶场风险。`
2. 拍到 `小序·主协调` 使用上一轮 Top1 上下文，并转交风险领域 Agent。
3. 拍到 Child Agent：`小序-教学风险`；若发布版本返回不同正式显示名，按页面真实值录制，不改字幕冒充。
4. 拍到 CampusTools 风险核验工具调用；工具名必须来自 SSE，不覆盖、不后期伪造。
5. 拍到 Widget 或回复中的 `冲突 0`、`跨校区赶场 4` 与真实 `20 分钟`转场证据。
6. 推荐成片保留 19–24 秒；构图重点是 `0 ≠ 4` 与 Evidence，而不是等待状态。

## 第二优先：协同规划 C

### C. 帮教师005、006、014找第1周周四上午共同空闲，并推荐容量不少于120座的教室。

1. 新会话或上一组完成后再发；不要与 A/B 并发。
2. 拍到完整问题及 `小序·主协调 → 小序-教学安排` 的真实协作路径。
3. 拍到 CampusTools 的共同空闲与教室推荐调用。
4. 结果构图必须可读：`63 → 7 → A1-201`，并保留 `容量不少于120座`约束。
5. 拍到官方 Widget 稳定渲染；推荐成片保留 18–23 秒。

## 限流分支（必须如实录）

- 页面应显示 `ADP 已返回限流`、倒计时和`不会自动重试`。
- 原问题仍保留在输入框。
- 可点击`一键查看已核验演示`，进入显著标注的`已核验实录回放`。
- 回放画面必须保留“非实时请求”字样；不得把回放画面剪接成 Live 成功。

## 4173 四幕最佳 5–8 秒 Deep-link

以下链接均为只读 `competition-demo-v3` 已核验导演片，进入后自动播放到下一幕；每条天然形成 5.6–7.2 秒可剪片段：

- Risk（6.8s）：`${SHOWCASE_BASE}/?mode=record&data=fixture&scene=risk&beat=risk.summary&autoplay=1`
- Collaboration（7.2s）：`${SHOWCASE_BASE}/?mode=record&data=fixture&scene=collaboration&beat=collab.verdict&autoplay=1`
- Reschedule（7.0s）：`${SHOWCASE_BASE}/?mode=record&data=fixture&scene=reschedule&beat=resched.select&autoplay=1`
- Insight（5.6s）：`${SHOWCASE_BASE}/?mode=record&data=fixture&scene=insight&beat=insight.close&autoplay=1`

> 将 `${SHOWCASE_BASE}` 替换为本机 4173 Preview 的页面源；该变量不会进入对外 PDF、PPT、字幕或提交封包。

## 收工验收

- Live 成功段能看见真实 AgentName、真实 ToolName、官方 Widget，不暴露原始 JSON 或系统提示。
- A/B 保持同一 ConversationId；录屏无刷新、无重复发送、无并发标签页。
- RateLimit 失败与 Verified Replay 有清楚视觉边界。
- 成片总时长保持 `04:35`，SRT 最后一帧 `00:04:35,000`。

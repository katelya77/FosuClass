# RECORDING MODE — 录屏操作手册（Phase 2 更新）

## 录制入口

```text
http://127.0.0.1:4173/?mode=record&data=fixture&autoplay=1
```

record 模式：隐藏调试面板 / 进度轨 / 参考线 / 鼠标依赖控件；无滚动条；
仅保留**右下角**数据徽标（fixture=「已核验演示快照 · competition-demo-v3」，live=「腾讯 ADP · 实时运行」）。

## URL 参数

| 参数 | 说明 |
| --- | --- |
| `mode=record` | 录制模式（`preview` 为别名） |
| `data=fixture\|live` | 数据来源徽标与语义 |
| `autoplay=1\|0` | 自动播放；record 默认 1 |
| `scene=…` | 跳转场景；支持短名 **risk / collaboration / reschedule / insight** 与全名 hero-* |
| `beat=…` | **场景节拍深链**（隐含其场景），如 `risk.routes`、`resched.constraints`、`insight.risk` |
| `t=12.5` | 起始秒——注意是**整片绝对时间轴**（risk@40 起、collaboration@64、reschedule@87、insight@117） |

## 四英雄节拍深链速查

| 场景 | 节拍 id（?beat=） |
| --- | --- |
| risk | risk.identity / risk.schedule / risk.campuses / risk.routes / risk.gap / risk.warning / risk.summary |
| collaboration | collab.lanes / collab.busy / collab.intersection / collab.expand / collab.rooms / collab.recommend / collab.verdict |
| reschedule | resched.source / resched.lift / resched.snap / resched.constraints / resched.candidates / resched.select / resched.decision |
| insight | insight.cascade / insight.top1 / insight.breadcrumb / insight.schedule / insight.risk / insight.close |

补拍示例：`/?mode=record&data=fixture&scene=reschedule&beat=resched.select&autoplay=0`。

## OBS 工作流

1. 浏览器 F11 全屏 1920×1080，缩放 100%，隐藏书签栏；
2. OBS「显示器捕获」（或窗口捕获）→ 分辨率 1920×1080 / 60fps；
3. 打开录制入口 URL → Director 自动播放；
4. Reliability 场景处按分镜切到真实 ADP 浏览器窗口（OBS 窗口捕获），
   Showcase 不为 iframe 成功降低安全边界；
5. 结束后切回 Showcase 的 Closing 落版。

## ADP 内嵌说明（AdpLiveFrame）

- 嵌入地址经 `VITE_ADP_EMBED_URL` 配置（公开 URL，禁止放凭据）；
- 状态机：loading → embedded / blocked；blocked 时展示「腾讯 ADP 真机演示」外开卡片；
- HTTPS 页面内嵌 HTTP 地址会被混合内容策略拦截——本地录制请使用 `http://127.0.0.1`。

## 截图自审命令（本机，脚本不入库）

```powershell
node qa-review.mjs     # 全场景：重叠/溢出/控制台/紫色像素/fps/关键文案
node qa-beats.mjs      # 四英雄逐节拍关键帧 + reduced-motion 探针
node qa-probe.mjs      # 关键帧 DOM 断言（光带对齐/ElectricBorder/戳记数/HUD 位置）
node qa-multires.mjs   # 1920×1080 / 1600×900 / 1366×768
```

验收分辨率：1920×1080（母版）/ 1600×900 / 1366×768。
安全区：左右 80px、上下 56px（开发模式可按 G 打开参考线）。
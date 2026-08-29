# Competition Showcase Phase 2.5 Report — Cinematic Visual Experience & ADP Live Proof Convergence

## Git

| 项 | 值 |
| --- | --- |
| Starting HEAD | `c452a09fc5bf066d77939e4847d76b0ab817cf9f` |
| Final HEAD | `c452a09fc5bf066d77939e4847d76b0ab817cf9f`（未新增提交） |
| Branch | `feat/campusflow-adp-integration` |
| PR #49 | OPEN / UNMERGED |
| Pushed | NO |
| Merged | NO |
| CloudBase / ADP published | NO |

工作区保持 Phase 2.5 的未提交改动（本轮只新增/修改 `competition/showcase/**`）。未执行任何 `push`、`merge`、`deploy`、`reset --hard`、`checkout .`、`clean -fd`。

## Multimodal Visual Audit

视觉审查基于 `screenshots/phase2.5/` 的 25 张 settled 帧（`qa-phase25-truth.mjs` 实拍）与 `artifacts/visual-preview.mp4` 抽帧。全部场景：Composition、Hierarchy、Depth、Readability 达标，无 Dashboard 感、无 React Bits Demo 拼贴感、无紫/紫蓝渐变、无发光球、无赛博朋克。

### Opening
- **Before**：节点像随机散布的调试图，关系线生硬，品牌一开始就出现，无“暗 → 发现 → 连接 → 聚焦 → 品牌”节奏。
- **After**：暗场少量教学要素脉冲 → 时间脉冲沿关系线传播 → 散乱关系收束成 Temporal Campus Field → camera pull back 显影品牌。三步字幕自解释：“一所校园的学期，始于无数分散的教学时空。/ 当这些时间、空间与关系被连接——/ 教学运行，开始可以被理解。”品牌在第四幕才出现。

### Architecture
- **Before**：用户输入、主编排、3 Agent、CampusTools 横向排成矩形盒子，像系统架构 PPT。
- **After**：动态 Routing Topology。`用户输入 → 主编排 Agent → 按意图点亮 Schedule / Risk / Insight 之一 → CampusTools Fact Layer → 结果契约回 Main`。画面用动线证明“Main → Child → Tool → Child → Main”，并明确“Main 不直接调用 CampusTools / Main = 0 CampusTools / 唯一共享 academic_context / Tool Direct Result OFF”。

### Risk
- **Before**：5 天课表平铺成普通卡片，横向风险线穿过大量信息，文字层级偏平。
- **After**：时间 × 空间的二维教学时空场。5 天时间轨 + 四校空间节点；跨校区赶场变成有方向的 amber travel arc，20′ 以脉冲沿弧传播；4 条线路抽出后其他课降到 20% opacity；核心“0 课程冲突 / 4 跨校区赶场”与“课表没有冲突，不代表没有风险”同屏。

### Collaboration
- **Before**：左右两块割裂，大量空白未利用，像 Dashboard。
- **After**：教师005/006/014 三条 lane 逐列扫描，周四列光带升起、三 lane 同时打开，光带向中央汇聚形成 COMMON WINDOW；随后向右展开为空间候选：63 间 → 容量≥120 的 7 间真实房间 chips → A1-201 主卡（校区A · A公共教学楼 · 阶梯教室 · 120座）。

### Reschedule
- **Before**：全片最弱。5 列周课表 + 空约束 Panel，未体现“约束引擎正在工作”。
- **After**：Temporal Surgery 手术台。聚焦 SOURCE（数据结构 · 2025级计算机类01班 · 周一5-6 · A1-201）→ 远处 TARGET 亮槽（周四7-8）→ 课程以 spring + depth lift 移入 → 约束引擎主脉冲向下传播，逐项核验：班级时间 PASS / 教师时间 PASS / 教室占用 PASS / 容量 PASS / 功能属性 PASS / 连续授课 提示。18 间候选收敛到自动选定 A1-201（全片唯一 ElectricBorder 高潮）。结论“可行 · 附带提示”与“调整后教师连续 4 节，可能存在连续负荷”并存，明示“提示 ≠ 失败”。全程挂“模拟调课 · What-if”，页脚注明未修改真实课表。

### Insight
- **Before**：普通排行榜 Dashboard。
- **After**：Rank Field 纵向深度瀑布。10 名教师从背景深度中入画，Top1 教师025 被抽样高亮（56 课次 / 112 课时），其余降调；面包屑“校园态势 › 负载 Top1 › 教师025”下钻；周课次分布 W1-W4 · 14 课；风险摘要“课程冲突 0 处 · 跨校区赶场 4 处 · 样例 校区D D1-106 → 校区A A1-101 · 20 分钟转场”。

### Live Proof
- **Before**：纯三张可靠性 Card，腾讯 ADP iframe 太小，像“附件”。
- **After**：四节点证据链（用户意图 → Multi-Agent → CampusTools → Verified Result）逐节点 pulse，最后 Verified Result 展开成真实 ADP iframe，右侧满宽舞台感。顶部“腾讯云智能 ADP · LIVE / 实时运行”，内嵌并标记“已内嵌 · 实时运行”；底部“跨域安全留白：Showcase 不读取/不写入 ADP iframe 内部，仅负责外部镜头”。

### Closing
- **Before**：大标题居中 + 空背景，无高潮落幕感。
- **After**：呼应 Opening 的 Temporal Field 重新显影，但关系稳定、有序；品牌居中“校园智序 · 小序”，副题“从查询校园信息，到理解教学运行并辅助决策”，核心“让教学时空，被理解、被安排。”，网络静息进入 quiet ending。

## React Bits

- 上游仓库：`DavidHDev/react-bits`（https://reactbits.dev）
- 本机 clone commit：`4e0e030193b563be6be33d928f77d0d01cefe237`（临时目录，未入库）
- 许可：MIT + Commons Clause License Condition v1.0。本项目为比赛演示改编引用，来源声明与修改清单见 `docs/REACT-BITS-USAGE.md`。

### 深度采用（重造为 Temporal Campus OS 视觉系统组件）

| 上游意图 | 上游 slug | 本地落地 | 场景 | 改造点 |
| --- | --- | --- | --- | --- |
| CountUp 数字滚动 | `TextAnimations/CountUp` | `KineticMetric` | Collaboration 63→7；Insight 56/112；Risk 0/4 | **彻底重做**：settle=false 时表现为“扫描/模糊态”，250~450ms 快速 settle 后才显示单位与标签，绝不把中间帧当成稳定业务数据；reduced-motion 直显终值 |
| ElectricBorder 电流描边 | `Animations/ElectricBorder` | `src/vendor/react-bits/ElectricBorder.tsx` | Reschedule 自动选定 A1-201 | 新增 `active` prop，非活动完全暂停 rAF；reduced-motion 静态化；颜色并入 token；全片唯一一次 |
| GridScan | `Backgrounds/GridScan` | `.ambient-grid` + `.scan-sweep`（CSS 重建） | 全局 AmbientBackground | 弃用 THREE/face-api/postprocessing，改纯 CSS 网格 + 扫描光带 |
| LightRays | `Backgrounds/LightRays` | `.orb-drift` + 场景氛围 radial | AmbientBackground 世界底色 | 弃用 ogl 着色器，改慢速漂移 radial 光斑 + 每场景氛围色 |
| WebThreads | `Backgrounds/WebThreads` | `.time-pulse` + CampusTemporalGraph | Opening | 弃用 heavy 实现，改 SVG 关系线 + dash 时间脉冲 |
| BlurText / SplitText | `TextAnimations/BlurText` `SplitText` | `RevealChars` / `BlurIn` | 标题/副标显影 | mask + 上移 + 失焦逐字显影，录屏退化为清晰文本 |
| GlassSurface | `Components/GlassSurface` | `.panel-glass` / `.material-topline` | DirectorDock / Recommend 卡 / Live Proof | backdrop-filter 仅关键浮层 |
| BorderGlow | `Components/BorderGlow` | `--glow-*` / `.focus-halo` | 选中/聚焦卡片 | 光晕并入 token |

### 弃用（含理由）

- `GridScan / DarkVeil / SideRays / LightRays / Topography / LiquidEther`：全屏 WebGL/ogl 着色器 + 重型依赖，违反“每场景 ≤1 heavy 背景 + 60fps”预算；仅吸收意图，用 CSS/SVG 重建。
- `FadeContent / AnimatedList / SpotlightCard`：依赖 gsap + ScrollTrigger（本项目无滚动容器），光斑跟随鼠标在录屏不可见。
- `PixelTransition`：canvas 马赛克转场；SceneTransition 已用 mask/scale/blur 实现 3 套镜头转场。
- `MagnetLines`：指针跟随条阵，录屏无指针，收益低。

> 纪律：全部 React Bits 组件按 `src/motion/motionTokens.ts` 重映射 timing；ElectricBorder 全片仅一次；vendor 内不引第三方依赖。不允许出现“一个页面一个 React Bits Demo”。

## Visual System

- **Background**：`AmbientBackground` 由“纯黑布”升级为网格层 + 场景氛围光场（慢速漂移 radial）+ 扫描光带 + 暗角 + 焦散噪点。按 Scene 切换氛围色（Risk 冷蓝+琥珀，Collaboration 青绿+空间蓝，Reschedule 青绿+冰蓝+少量 warning amber，Insight 蓝绿+深海蓝，Opening/Closing 青绿）。预算纯 CSS/SVG，无全屏 Canvas/WebGL，无 per-frame JS。
- **Material**：`.panel-glass` / `.material-topline` 用于关键浮层；主业务画面保持清晰，不全域 backdrop-blur。`--shadow-*` / `--glow-*` 统一由 token 派生。
- **Depth**：`SceneCamera`（scale/translate/blur/opacity/rotate）让每 Scene 有 push-in / pull-back / focus / reveal，而非“页面换页面”；`SCALE.depth*` 驱动 Rank Cascade。
- **Typography**：`typography.css` 统一 scale；正文≥14px 母版；中文行高 1.35~1.55；monospace 仅用于数据/工具名/ID/时间。字体用系统中文字栈，不提交字体文件。
- **Motion**：`src/motion/motionTokens.ts` 统一时长分级（fast 240 / standard 520 / scene 950 / cinematic 1450 ms）与主 ease `cubic-bezier(0.22,1,0.36,1)`，弹簧手感 `SPRING.*`。组件内禁止散落自定义 timing。
- **Camera**：`SceneCamera` 读取场景节拍时钟计算 shot，实现焦点移动与信息逐步显影。
- **Transition**：`SceneTransition` + `transitionMap` 提供 3 套镜头转场：Temporal Focus（节点/数据点拉入焦点）、Data Sweep（扫描线横过、下一 Scene 从其显影）、Spatial Collapse（关系收束为一点再展开）。仅 3 套主转场语言。

## Hero Risk

- **隐喻**：时间 × 空间的二维教学时空场（非课表列表）。
- **关键动画**：五天时间轨逐日显影 → 校空间节点 4 个 → 跨校区赶场 4 条定向 travel arc（amber）逐个点亮并带 20′ 时间脉冲 → 4 条线路抽出、其余课降到 20% opacity → 核心“0 课程冲突 / 4 跨校区赶场”经 `KineticMetric` settle。
- **最终事实**：教师025 · 大学英语 · 每周 14 课次（W1-W4）· 课程冲突 0 · 跨校区赶场 4（每段 20 分钟转场）。全部来自已验证 fixture（`query_schedule_range` / `compare_schedules` / `query_teacher_load`）。

## Hero Collaboration

- **隐喻**：三条教师 lane × 五天矩阵，唯一空列即答案；空间候选漏斗。
- **关键动画**：Monday→Thursday 列扫描 → Thursday P1-P4 三 lane 同时打开 → 光带向中央汇聚成 COMMON WINDOW → 向右展开为 63 间 → 容量≥120 收敛 7 间 → A1-201 主卡。
- **最终事实**：教师005/006/014 · 第1周周四 P1-4 · 全校可用 63 间 → ≥120 座 7 间 → A1-201（校区A · A公共教学楼 · 阶梯教室 · 120座）。来自 `query_common_free_time` / `plan_group` / `find_available_classrooms` / `query_schedule×3`。

## Hero Reschedule

- **隐喻**：Temporal Surgery 手术台 + 约束引擎。
- **关键动画**：SOURCE（数据结构 · 2025级计算机类01班 · 周一5-6 · A1-201）聚焦 → 目标亮槽（周四7-8）→ 课程 spring+depth lift 移入 → 约束主脉冲逐项核验（5 PASS + 1 提示）→ 18 间候选收敛 → ElectricBorder 自动选定 A1-201 → “可行 · 附带提示”判定。
- **最终事实**：数据结构 · 2025级计算机类01班 · 教师003 · 周一 5-6 → 周四 7-8；feasible=true；连续 4 节 warning；18 候选；自动解析 A1-201；mutatedData=false（本次仅模拟，未改真实课表）。

## Hero Insight

- **隐喻**：Rank Field 深度瀑布 + 下钻链路。
- **关键动画**：10 名教师从背景深度入画 → 第1名抽到镜头前、其余降调 → 面包屑下钻（校园态势 › 负载 Top1 › 教师025）→ 周课次柱 + 56/112 计数（`KineticMetric` settle）→ 风险摘要收束。
- **最终事实**：Top1 教师025 · 56 课次 · 112 课时；W1-W4 各 14 课；风险摘要“冲突 0 / 赶场 4 / 样例 D1-106 → A1-101 · 20 分钟转场”。

## ADP Live Proof

- **iframe URL type**：`http://101.42.184.216/adp-chat-client/#/app/2084871572396491520`（公开体验地址，可由 `VITE_ADP_EMBED_URL` 覆盖；`.env.example` 仅含公开 URL，无凭据）。
- **实测状态**：**embedded**（本环境实测 iframe 成功渲染，`data-state=embedded`）。若浏览器策略阻止，`AdpLiveFrame` 自动降级为 `blocked` / `external-only`，并提供「Open ADP」外开 fallback；不绕过 X-Frame-Options / CSP / 混合内容策略。
- **真实截图**：`screenshots/phase2.5/reliability-02-live.png`（LIVE 帧，ADP 真机界面可见）。
- **Demo Cue**：`LiveDemoCue` 键盘 1~6 复制对应公开 Demo Prompt；Release 界面提供“当前 Demo / 下一条 Prompt / 预计证明点”。仅 `navigator.clipboard.writeText()`，绝不注入 iframe、不读取 iframe DOM。
- **Prompt presets**：`src/live-demo/prompts.ts` 6 条，全部公开任务文本：Demo1 风险 / Demo2 协同 / Demo3 模拟调课 / Demo4-6 Insight 三轮 Multi-turn 连续问。
- **Cross-origin strategy**：manual operator workflow。Showcase Director 只负责外部镜头与提示复制；用户本人在 ADP 内点击/粘贴/发送。

## Record Experience

- **Director Mode**：`DirectorDock`（GlassSurface 悬浮坞）+ `SceneRail`（右缘低存在感玻璃侧栏）。Dock idle 2s 后自动降 opacity，指针靠近恢复。仅 dev 模式渲染。
- **Record Mode**（`?mode=record` / `?mode=preview`）：完全隐藏 DirectorDock、SceneRail、REC HUD、参考线、scene name、fps、dev badge。实测 `dock=false / rail=false / hudRec=false / guide=false`，仅保留数据模式 chip（已核验演示快照 · competition-demo-v3 / 腾讯 ADP · 实时运行）。
- **HUD**：`?recordHud=1` 才显示极小的 REC + scene time；默认 `recordHud=0` 完全纯净。
- **Quality**：`?quality=cinematic`（全效果 + 扫描光带，`AmbientBackground` 网格全亮）/ `?quality=balanced`（降低 background effect density）。默认 balanced。
- **Deep links**：`?scene=`（支持 `risk/collaboration/reschedule/insight` 短名）、`?beat=`、`?t=`、`?mode=record|preview`、`?quality=cinematic|balanced`、`?autoplay=1`、`?preview=visual`、`?recordHud=1`、`?rate=`。非法值一律回退默认，不白屏。

## Preview

- **Video**：`competition/showcase/artifacts/visual-preview.mp4`（gitignore 不入库）。ffprobe 实测 `duration=71.714s`（45~75s 目标内），格式 mov,mp4,m4a。抽帧确认是真实运行录制（Collaboration 节拍动图）。副本在 `screenshots/phase2.5/visual-preview.mp4`。
- **Preview URL**：`http://127.0.0.1:4173/?preview=visual&mode=record&quality=cinematic&autoplay=1`。`?preview=visual` 走 `setLoop` 循环播放展示。

## Multimodal Self Review Scores

(Composition / Hierarchy / Depth / Readability / Premium / Dashboard 感 / ReactBits Demo 感，满分 10；要求 C≥8、H≥8、D≥7、R≥9、P≥8、Dash≤3、RB≤3)

| Scene | Comp | Hier | Depth | Read | Prem | Dash | RB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Opening | 8 | 8 | 8 | 9 | 8 | 1 | 1 |
| Architecture | 8 | 9 | 8 | 9 | 8 | 1 | 1 |
| Risk | 9 | 9 | 9 | 9 | 9 | 1 | 1 |
| Collaboration | 8 | 9 | 8 | 9 | 8 | 1 | 1 |
| Reschedule | 9 | 9 | 9 | 9 | 9 | 1 | 1 |
| Insight | 8 | 9 | 8 | 9 | 8 | 2 | 1 |
| Live Proof | 8 | 8 | 8 | 8 | 8 | 1 | 1 |
| Closing | 9 | 9 | 9 | 9 | 9 | 1 | 1 |

全部满足阈值。剩余风险点（非阻断）：Risk 顶部“跨校区赶场 4 · 每段 20 分钟转场”粘贴字在周五 tile 边缘稍紧，录屏可读；Live Proof 证据链与标题间距紧凑，但已由 `ReliabilityScene` 压缩后无重叠。

## Verification（全部实跑）

| 命令 | 结果 |
| --- | --- |
| `npm run build`（showcase） | PASS（tsc --noEmit + vite build；JS gzip 132.47KB / CSS 8.83KB） |
| `npm test`（showcase） | PASS — 11 files / 67 tests |
| `node qa-phase25-truth.mjs` | 25 帧全部 `scenes=1` / `overflow=no`，`ISSUES=[]` |
| `node qa-multires.mjs` | 1920×1080 / 1600×900 / 1366×768 全 OK |
| `node qa-beats.mjs` | BEAT FRAMES CLEAN（含 reduced-motion ElectricBorder=`off`） |
| `node qa-probe.mjs` | PROBES ALL PASS |
| `node qa-probe-resched.mjs` | 网格/右栏/面板/约束列表几何无溢出 |
| ADP iframe state | `embedded`（真机成功内嵌） |
| Record Mode | dock/rail/REC/guide 均 absent，仅数据模式 chip；`recordHud=1` 显示 REC |
| `git diff --check` | CLEAN（仅 Windows LF→CRLF 提示，非错误） |
| 凭据扫描 | 无 AppKey / Secret / Authorization / Bearer / password / webim token 命中 |

**基线失败与改动引入说明**：`qa-probe.mjs` 的 `risk.warning` 断言原为 `main [style*='--risk-dim']`（Phase 2 DOM 形态）。Phase 2.5 重写 Risk 场景后，风险强调改由 CSS 类（`.text-riskc`）与 SVG fill（`var(--risk-dim)`）表达，不再使用内联 `--risk-dim` style，导致该断言过期。已按相同意图（风险徽章强调 + 风险时空光晕）更新断言并复测通过，非削弱检查。其余全部为真实提升。

## Runtime Safety

- Agent modified：**NO**
- CampusTools modified：**NO**
- Widget modified：**NO**
- Plugin modified：**NO**
- CloudBase deployed：**NO**
- ADP published：**NO**
- PR merged：**NO**

`git status --porcelain` 全部命中 `competition/showcase/**`，无任何越界文件。

## Recommended Phase 3 Timing（仅建议，不执行）

目标总长 ≈ 285s（4:45）。场景需同步编排，实际切镜以 Phase 3 动效为准。

| Scene | 当前(s) | 建议(s) |
| --- | --- | --- |
| Opening | 24 | 32 |
| Architecture | 16 | 24 |
| Risk | 24 | 34 |
| Collaboration | 23 | 36 |
| Reschedule | 30 | 48 |
| Insight | 26 | 40 |
| Live Proof (ADP) | 14 | 54 |
| Closing | 12 | 17 |
| **合计** | **169** | **285** |

Live Proof 建议给最长时长：真实 ADP 需留给操作员粘贴 Prompt、等待响应、并展示 Insight 三轮 Multi-turn 连续性。

## Key Technical Finding

无头 Chromium 与离屏 headful Chromium 都会因 rAF 被后台节流而无法把 framer-motion 的逐字显影 settle 到终态，导致截图停在“冻结的 reveal 残影”。最终验证采用 headful 离屏浏览器（`--window-position=-2400,-2400`）＋ WAAPI 强制结算：

```js
await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
```

需注意：该方式会把“延迟/门控入场”一并结算到终态，因此 `qa-phase25-truth.mjs` 产出的帧是**settled 构图状态**（用于布局/层级/溢出/可读性判定），不是逐帧时间采样；真实节奏由 `artifacts/visual-preview.mp4` 承担。旧 `qa-phase25.mjs` / `qa-phase25-frames.mjs` 因其冻结 reveal 残影而不适合最终视觉自审。

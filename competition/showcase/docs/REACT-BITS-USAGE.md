# React Bits 使用清单（Phase 2.5）

## 来源与合规

- 上游仓库：DavidHDev/react-bits（https://reactbits.dev）
- 本机克隆：@ commit `4e0e030193b563be6be33d928f77d0d01cefe237`（临时目录，未入库）
- 许可：**MIT + Commons Clause License Condition v1.0**（Copyright (c) 2026 David Haz）。
  Commons Clause 仅限制「销售」软件本身；本项目为比赛演示用途的改编引用，
  本文件即要求的来源声明与修改清单。所有引用文件/类均保留上游出处意识并在下文登记。

## Phase 2.5 采用口径（由"组件展厅"转向"Temporal Campus OS 视觉系统"）

> 核心原则：React Bits 的**设计意图**（材质、景深、响应、光场、节奏）为本，
> 但**实现权重并入项目 token 与性能预算**。所有全屏 WebGL/ogl 着色器组件
> （GridScan / DarkVeil / SideRays / LightRays / Topography / LiquidEther）
> 因违反"每场景仅 1 个 heavy 背景 / 60fps"预算而**弃用其源码**，仅吸收其视觉意图，
> 用 CSS/SVG/Motion 轻量重建。

### 深度采用（改造为 Temporal Campus OS 视觉系统组件）

| 上游意图 | 上游 slug | 本地文件 | 使用场景 | 改造点 | 性能 |
| --- | --- | --- | --- | --- | --- |
| CountUp 数字滚动 | `TextAnimations/CountUp` | → **KineticMetric** | Collaboration 63→7；Insight 56/112；Risk 0/4 | **彻底重做**：中间帧绝不表现为稳定数据（模糊/掩码扫描态），250~450ms 快速 settle 后才出现单位/标签；reduced-motion 直显终值 | rAF 仅 settle 短窗，settle 后零开销 |
| ElectricBorder 电流描边 | `Animations/ElectricBorder` | `src/vendor/react-bits/ElectricBorder.tsx` | Reschedule 候选收敛高潮（A1-201 自动选定），**全片唯一一次** | 新增 `active` prop：非活动完全暂停 rAF；reduced-motion 静态化；颜色并入 token | 仅 select 节拍窗口单 canvas；其余 0 帧 |
| GridScan 网格扫描 | `Backgrounds/GridScan` | → `.ambient-grid` + `.scan-sweep`（CSS 重建） | 全局 AmbientBackground | 弃用 THREE+face-api+postprocessing 源码；CSS 网格 + 扫描光带 + 掩码 | 纯 CSS 合成，无 per-frame JS |
| LightRays 光场 | `Backgrounds/LightRays` | → `.orb-drift` + 场景氛围 radial（CSS 重建） | AmbientBackground 场景世界底色 | 弃用 ogl 着色器；慢速漂移 radial 光斑 + 每场景氛围色 | 纯 CSS 动画 |
| WebThreads 关系线程 | `Backgrounds/WebThreads` | → `.time-pulse` + CampusTemporalGraph | Opening 教学时空场 | 弃用 heavy 实现；SVG 关系线 + 时间脉冲 dash 动画表达"信息被理解" | SVG + CSS dash，无新增循环 |
| BlurText / SplitText | `TextAnimations/BlurText` `SplitText` | → `RevealChars` / `BlurIn` | 全场景标题/副标显影 | mask + 上移 + 失焦逐字显影；退化为清晰文本以保证录屏可读 | Motion 一次性入场 |
| GlassSurface | `Components/GlassSurface` | → `.panel-glass` / `.material-topline` | DirectorDock / Recommend 卡 / Live Proof | 玻璃材质 + 顶部反光线 | backdrop-filter 仅关键浮层 |
| BorderGlow | `Components/BorderGlow` | → `--glow-*` / `.focus-halo` | 选中/聚焦卡片 | 光晕并入 token | 纯 CSS box-shadow |
| MagnetLines 指向线 | `Components/MagnetLines` | 评估后弃用 | — | 指针跟随条阵；录屏无指针不可见（Director 模式专属收益低） | 不引入 |

## 弃用（含理由）

| 上游组件 | 弃用理由 |
| --- | --- |
| GridScan / DarkVeil / SideRays / LightRays / Topography / LiquidEther | 全屏 WebGL/ogl 着色器 + 依赖（face-api、postprocessing、three）；违反每场景 1 heavy 背景 + 60fps 预算，且录屏无鼠标（followMouse 失效）。仅吸收意图，用 CSS/SVG 重建 |
| FadeContent / AnimatedList / SpotlightCard | 依赖 gsap+ScrollTrigger（无滚动容器）；为可滚动可点击列表设计；光斑跟随鼠标在录屏不可见。用 Motion 边框/光晕替代 |
| PixelTransition | canvas 马赛克转场；SceneTransition 已用 mask/scale/blur 实现 3 套镜头转场，不再需要 |
| MagnetLines | 指针跟随条阵，录屏无指针；Director 模式专属收益低 |

## 项目级约束（Phase 2.5）

1. ElectricBorder 在整个 Showcase 中只允许出现一次（Reschedule 高潮）。
2. vendor 目录内组件禁止再引第三方依赖；一切动画走 motion/react 或 rAF。
3. 任何新 vendor 引入必须在本文件登记（来源 commit / 改动 / 场景 / 性能影响）。
4. 全部 React Bits 组件按 `src/motion/motionTokens.ts` 重新映射 timing，禁止散落自定义 duration/ease。

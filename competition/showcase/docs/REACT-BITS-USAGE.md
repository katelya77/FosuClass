# React Bits 使用清单（Phase 2）

## 来源与合规

- 上游仓库：DavidHDev/react-bits（https://reactbits.dev）
- 参考快照：`src/ts-tailwind/**` @ commit `4e0e030193b563be6be33d928f77d0d01cefe237`（本机临时克隆，未入库）
- 许可：**MIT + Commons Clause License Condition v1.0**（Copyright (c) 2026 David Haz）。
  Commons Clause 条款仅限制「销售」软件本身；本项目为比赛演示用途的改编引用，
  本文件即要求的来源声明与修改清单。所有改编文件顶部均保留上游出处注释。

## 采用（2 个，深度改造）

| 组件 | 上游 slug | 本地文件 | 使用场景 | 为什么是它 | 改造点 | 性能 |
| --- | --- | --- | --- | --- | --- | --- |
| CountUp | `TextAnimations/CountUp` | `src/vendor/react-bits/CountUp.tsx` | Collaboration 漏斗 63→7；Insight Top1 56课/112课时 | 关键指标需要「被算出来」的可信感，而非静态数字 | ① `prefers-reduced-motion` 下直接显示终值（信息不减）；② `startWhen` 由 Director 节拍驱动，场景未到不启动；③ `tabular-nums` 防跳动 | 弹簧 ~1s 落定后零开销 |
| ElectricBorder | `Animations/ElectricBorder` | `src/vendor/react-bits/ElectricBorder.tsx` | Reschedule 候选收敛高潮（A1-201 自动选定），**全片唯一一次** | 决策瞬间需要一次克制的电流强调来标记「系统已选定」 | ① 新增 `active` prop：非活动时完全暂停 rAF（§33 离屏零功耗），仅留静态描边；② reduced-motion 自动静态化（QA 实测 `data-electric=off`）；③ 描边几何与配色并入项目 token（默认青绿 #46c79a） | 仅 select 节拍窗口运行单 canvas 动画；其余时间 0 帧 |

## 评估后弃用（3 个，含理由）

| 组件 | 上游 slug | 弃用理由 |
| --- | --- | --- | --- |
| FadeContent | `Animations/FadeContent` | 依赖 gsap + ScrollTrigger：整片无滚动容器，为一个淡入引入 ~40KB 动画库不成比例；Motion 已覆盖 |
| AnimatedList | `Components/AnimatedList` | 为可滚动、可悬停点击的列表设计（固定 500px 宽、渐隐遮罩、键盘交互）；录屏无指针且排名瀑布需要自绘节奏控制 |
| SpotlightCard | `Components/SpotlightCard` | 光斑跟随鼠标——录制画面没有鼠标，效果不可见；强调语义改用 Motion 边框/光晕实现 |

## 项目级约束

1. ElectricBorder 在整个 Showcase 中只允许出现一次（Reschedule 高潮）。
2. vendor 目录内组件禁止再引第三方依赖；一切动画走 motion/react 或 rAF。
3. 任何新 vendor 引入必须在本文件登记（来源 commit / 改动 / 场景 / 性能影响）。
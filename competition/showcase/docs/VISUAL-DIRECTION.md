# VISUAL DIRECTION — Temporal Campus OS

## 一句话方向

「校园教学时空操作系统」——把课表、教师、班级、教室、时间、校区呈现为
**被理解、被安排的时空秩序**。电影感、安静、精准、有节奏；拒绝 AI 味与科技大屏模板。

## 色彩（唯一来源 `src/styles/tokens.css`）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg` | `#0B0F14` | 深灰黑底（非纯黑） |
| `--surface` / `--surface-elevated` | `#10151C` / `#161C26` | charcoal 面板 |
| `--brand` | `#46C79A` | 青绿（校园自然绿）——秩序与「可行」 |
| `--brand-secondary` | `#6F99C5` | 低饱和蓝——空间/时间要素 |
| `--risk` | `#D9A05B` | 琥珀——风险、赶场 |
| `--danger` | `#CE6A6A` | 克制红——冲突（少量） |
| `--text` | `#E9EEF4` | 近白非纯白 |

规则：组件内禁止散落 magic color；状态区分永远「图标 + 文本 + 色彩」三通道。

## 字体与中文排版

系统可靠中文栈：PingFang SC → Microsoft YaHei → Noto Sans SC → system-ui。
不提交任何字体文件。标题靠字重（600–650）、字距（0.02–0.06em）、布局与动效制造气质。
中文行高 1.7–1.85；禁止 `break-all`。录屏字号基准：Hero 48–68 / Section 30–42 /
Card 20 / Body 17 / Caption 13.5 / Metric 34–50（`clamp` 适配 1366–1920）。

## React Bits 使用记录（实际浏览 reactbits.dev 后的取舍）

按任务 §6 的 A–D 分类，最多取 3–5 类，**只取视觉模式、全部轻量自绘**，
避免整库引入与许可负担：

- **A. Opening Background → Dot Grid**：`AmbientBackground` 单 Canvas 点阵 +
  双 radial 光晕 + 暗角（自绘 ~70 行，60fps 预算内，reduced-motion 静帧）。
- **B. Hero Typography → Blur/Split Text 思路**：`BrandLockup` 三段 rise +
  `SceneTransition` 的 blur(10px)→0 入场，实现「文字从时空中显形」的母题。
- **C. Focus → Spotlight/Focus pulse 思路**：`CampusTemporalGraph` 的 focus 节拍
  在时间枢纽节点上做单圈脉冲（非鼠标跟随）。
- **D. 高级交互**：Phase 1 不引入（Dock/Fluid Glass 等留给真交互需求）。

未使用：Aurora/Beams（太 AI 味）、Decrypted Text（黑客感）、Electric Border（廉价霓虹）。

## Motion 策略

- 统一缓动 `cubic-bezier(0.22,1,0.36,1)`；场景转场 0.9s（opacity 0.72s）；
- 元素级平滑由 Motion 独立 transition 承担；节拍时钟量化 0.1s 只做「到点触发」，
  把 React 渲染频率与动画帧率解耦；
- 转场 = opacity + scale 0.985→1 + y ±16px + blur ≤10px，绝不做硬切；
- 全局 `MotionConfig reducedMotion='user'` + CSS media query 双保险；
- 性能红线：1 个 Canvas、0 WebGL、无满屏 backdrop-filter、动画只走
  opacity/transform 合成路径。

## 禁止项自查（任务 §8）

无大面积紫色渐变 / 无满屏 neon / 无玻璃拟态堆叠 / 无发光卡片 / 无无意义粒子 /
无 Cyberpunk / 无智慧城市大屏 / 无等大小卡片网格 / 中文为第一视觉语言，
英文仅保留 Verified · Multi-Agent · CampusTools · What-if · Temporal Campus OS。
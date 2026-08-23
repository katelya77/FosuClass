# Competition Showcase Phase 1 Report

## Git

- Starting HEAD：`cd097962aeba498e84f1e8c6551f9171a6ea0127`（= origin/feat/campusflow-adp-integration，fetch 后实测一致）
- 分支：`feat/campusflow-adp-integration`
- 提交：本目录以 3 个提交落地（工程基础 / 场景与录制系统 / 测试与文档）；最终 HEAD 以 `git log -- competition/showcase` 为准
- PR #49：OPEN / UNMERGED（未 merge、未 push 远端、未创建 Release）

## Architecture

- 技术栈：React 19 · TypeScript · Vite 7 · Tailwind CSS 4（@tailwindcss/vite）· Motion for React（motion/react）· Zustand 5 · lucide-react · clsx；Vitest + jsdom + Testing Library
- 目录：见 README「目录速览」；`contracts/` 为既有 R51 公共契约，本轮零修改
- Director 模型：`timeline.ts`（场景表 + Opening 五节拍 + 程序事件表）→ `directorStore`（zustand 单一事实源）→ `useDirectorEngine`（rAF，StrictMode 安全，非浏览器环境降级 setTimeout）；节拍时钟量化 0.1s 与元素级 Motion 动画解耦
- 数据模式：`?data=fixture|live` + `VerifiedFixture / PlaceholderFixture` 契约 + `assertFixtureProvenance` 运行时门禁；Phase 1 全部 placeholder（verified=false 显式标注）
- ADP Adapter：`AdpLiveFrame` 全应用唯一 iframe 层；loading/embedded/blocked/external-only 四态；blocked 时降级「腾讯 ADP 真机演示」外开卡片，不绕过 X-Frame-Options / CSP / 混合内容策略

## Visual System

- 方向：Temporal Campus OS（校园教学时空操作系统）——深灰黑 #0B0F14 底、青绿 × 低饱和蓝双色系、琥珀风险色；中文第一视觉语言，英文仅 Verified/Multi-Agent/CampusTools/What-if/Temporal Campus OS
- React Bits 取舍（实际浏览 reactbits.dev 后只取模式、轻量自绘）：Dot Grid 背景（单 Canvas）/ Blur-Split 文字显形（BrandLockup + SceneTransition）/ Focus pulse（关系图枢纽节点）；未引入 Aurora、Decrypted Text 等 AI 味模式
- 自绘组件：CampusTemporalGraph（SVG 关系图，六类节点 + 关系线 draw + 收束）、AmbientBackground、BrandLockup、SceneTransition、Panel/Badge/SceneHeader
- 动效策略：统一缓动 cubic-bezier(0.22,1,0.36,1)；场景交叉溶解 0.9s；MotionConfig reducedMotion='user' + CSS media 双保险

## Implemented

- Opening：0–12s 分散节点 → 连接显形 → 时空聚焦 → 收束品牌；12–24s 保持 + 环境呼吸；无旁白可懂的三段叙事字幕
- Architecture：主编排（Main=0 工具）→ 三域 Agent（Schedule 7/Risk 4/Insight 3）→ CampusTools 13 操作 → 统一结果卡 campus-result-unified-v1；14 绑定等拓扑注脚全部来自 SSOT 事实
- 4 Hero Shell：HeroRisk（教师009 跨校区赶场 20 分钟）/ HeroCollaboration（共同空闲交集 × 空间匹配）/ HeroReschedule（What-if 对照 + 约束矩阵）/ HeroInsight（教师负载 Top1 下钻）——预留组件均已具名导出
- Reliability：三支柱证据 + AdpLiveFrame 实机面板；Closing：品牌落版
- Director：播放/暂停/重播/上下场/跳转/倍速/时间轴 scrubber/参考线/录制预览 + 键盘指令（空格/←→/R/G）
- Record Mode：`/?mode=record` 隐藏全部开发控制，无滚动条，保留诚实的「占位示意数据」徽标

## Verification

- `npm run build`（tsc --noEmit && vite build）：PASS（~2.4s）
- `npm run preview`：PASS（127.0.0.1:4173 strictPort）
- `npx vitest run`：5 文件 29/29 PASS（timeline / urlMode / provenance / record-mode render / AdpLiveFrame config+状态机）
- 分辨率：1920×1080（母版）/ 1600×900 / 1366×768 全部无溢出、无滚动条（puppeteer 实测）
- 程序化自审（qa-review.mjs，本地不入库）：10 场景布局重叠 0、控制台错误 0、关键文案齐全、紫色模板像素占比 0%、headless fps 采样 60
- 安区修复记录：场景根元素 h-full 覆盖 inset 高度导致面板溢出安全区 56px——已移除并以三分辨率回归验证
- 安全扫描：全目录凭据标记扫描仅命中黑名单守卫代码自身与测试假向量；`.env.example` 只含公开 URL；git diff --check CLEAN

## Screenshots（本地生成，不入库）

- public/screenshots/opening-{nodes,connections,brand}.png
- public/screenshots/dev-panel.png
- public/screenshots/hero-{risk,collaboration,reschedule,insight}.png
- public/screenshots/reliability.png / closing.png
- public/screenshots/check-{1920x1080,1600x900,1366x768}.png

## Runtime Safety

- Agent modified：**NO**
- CampusTools modified：**NO**
- Widget modified：**NO**
- ADP publish：**NO**
- PR merged：**NO**

`git status` 证明全部新增文件位于 `competition/showcase/**`；Runtime/Prompt/CampusTools/Widget 零改动。

## Remaining Phase 2

1. **HeroRisk**：接入 Runtime Golden 导出 fixture（VerifiedFixture），课条→赶场→风险发现完整动画编排
2. **HeroCollaboration**：真实共同空闲窗口 + 房间候选数据流与镜头语言
3. **HeroReschedule**：reschedule_feasibility 输出驱动的约束矩阵逐格点亮（视觉高潮场景）
4. **HeroInsight**：完整榜单 + 下钻链路 + 并列语义可视化
5. 4:45 全片 Timeline 编排、字幕轨、ADP 真机切换分镜（OBS 窗口捕获位）
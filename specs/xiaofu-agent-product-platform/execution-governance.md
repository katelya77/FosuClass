# 自治执行治理规则（本任务授权）

> 来源：2026-07-30 用户"最高优先级执行授权更新"。适用于 `codex/xiaofu-agent-product-platform` 分支的 P3→P8 自治执行。本文件不改变 AGENTS.md 的长期约束；冲突处以更严格者为准（如 public 零外部 Provider、密钥纪律）。

## 1. 允许自动执行

修改代码/测试/文档；新建文件目录；安装经审计依赖并更新 lockfile；运行各类测试；使用项目已配置凭据做真实 staging 验证；阶段 commit；push 当前分支；创建/更新 Draft PR；修复 CI；转 Ready；合并门禁满足后合并；触发部署工作流；staging/canary/生产部署；部署后 smoke、监控、自动回滚；创建 Issue；上传按 SHA 固定的镜像。

## 2. 绝对禁止

force push；重写/删除 main 历史；绕过分支保护；删远程仓库；删生产数据库/持久卷/用户数据；不可逆迁移；关闭鉴权/安全守卫；删测试、skip、放宽断言、提高性能阈值；Mock 冒充 staging/真机/生产；main 上直接开发；未验证 Adapter 设为默认；动用无关项目密钥；密钥明文入 Git/日志/PR/报告/快照/聊天；无备份回滚路径部署生产；生产异常后继续推进。

## 3. 凭据使用

仅读取 FosuClass 本任务直接相关凭据；不扫描无关项目/个人账户；不 echo 完整值；不运行完整打印环境变量的命令；日志脱敏；不复制进源码/fixture/Markdown/PR；已明文入库的凭据可使用但最终报告标记安全债务；不自动轮换删除；staging live 证据只记 Provider 类型/结果/延迟/错误分类；真实 Provider 测试设预算与调用上限。

## 4. 阶段内自动循环

重读规格/CONTEXT/ADR/tasks → 确认允许修改范围 → 阶段前基线 → RED-GREEN-REFACTOR 小步 → 定向测试 → 受影响 phase → final-convergence → release-gate → git diff --check → 敏感扫描 → code-review（修 Critical/Important）→ evidence → 阶段 commit → 下一阶段。

commit 纪律：主题单一、独立可回滚、不混后续阶段半成品、提交前测试绿、无密钥、无无关用户改动、仓库提交风格、记录真实测试状态。

## 5. 失败处理

定位根因 → 判定本阶段引入/环境/旧断言失效/历史缺陷（对照 main 或基线）→ 修复真因 → 重跑定向与全门禁。同一问题三轮修复仍失败：缩小范围、恢复阶段起点、记录 blocker；不影响后续独立阶段可跳过并建 Issue；影响生产安全或核心依赖则停止合并/部署，可做只读研究；不在未知状态向生产推进。

## 6. PR 与合并门禁

基于最新 main；无冲突；CI 全绿；release-gate 全绿；安全扫描无真实泄露；迁移前向兼容有回滚路径；无 Critical/Important；核心回归通过；staging/canary 验证通过；已记录生产版本与回滚目标；分支保护允许。默认 squash merge；禁止 force push 与管理员强合。若合并 main 会自动触发部署工作流，合并动作等同生产部署授权，合并前必须完成部署前保护。

## 7. 部署前保护

确认生产当前 SHA/digest、部署配置、数据库与持久卷备份（可读）、旧镜像可拉取、可执行回滚命令、健康检查端点、部署后 smoke 清单、迁移前向兼容、滚动期新旧共存。迁移采用 expand-contract；禁止不可逆 drop/truncate/大规模重写。无法建立真实备份回滚路径：可完成代码/PR/CI/staging，禁止自动生产部署，记录 blocker。

## 8. 部署策略优先序

A staging 先行 → 生产；B 无 staging 则 canary（新容器/备用端口/临时域名，smoke 后原子切换，旧实例留作回滚）；C 单实例覆盖部署（完整备份、记录旧 digest、缩短窗口、立即 smoke、失败即恢复）。

## 9. 部署后验证与观察

验证：站点/API 健康；后台登录与关键页面；课表/课程/教室/教师查询；public 小佛助手；public 外部调用为 0；trial/dev strict_model_first 真实首决策；Run API runId；RunEvent 首事件；Tool/Verification/UI Schema；Memory H1/H2/M1/M3/M4/M5；recentTurns 恢复；配置发布与回滚；RAG 引用；MCP 只读；standalone 健康；migration 状态；容器健康；日志无持续异常；旧客户端兼容；原小程序接口无 404/500 回归。观察：每 30–60s 健康检查，≥10 分钟；记录生产 SHA、镜像 digest、configVersion。

## 10. 自动回滚触发

健康检查持续失败；容器反复重启；核心 API 5xx；登录/课表等关键业务失效；migration 失败；数据完整性异常；public 发生外部 Provider 调用；strict_model_first 被静默绕过；RunEvent 无法恢复；错误率显著升高；密钥进入提交或日志；无法确认生产版本；新版本无法稳定。回滚后：验证旧版本、保留日志、建 Issue、记录根因、不再自动部署同一失败版本、修复后重走完整流程。

## 11. 硬停止条件（标记 blocked 等待用户）

扫码/验证码/2FA/人工登录；无法自行取得的权限；分支保护需真人审批；必须不可逆 DB 操作；无法建立备份回滚路径；生产权限不可用；需支付购买资源；重大业务影响且无安全默认值的产品选择；自动回滚失败；疑似数据损坏；继续会扩大生产事故。除此之外不因实现选择、测试失败、审查意见、CI 失败停下来询问。

## 12. 证据口径

最终报告严格区分：代码 / mock conformance / runtime overhead baseline / real-provider staging / Docker（build verified ≠ smoke verified）/ DevTools / 真机 / 体验版 / 生产。未完成项如实标注；P7b/P7c 未实现标 deferred。

## 13. 环境条件式执行

Docker Desktop 可用则本地 amd64 build+smoke，arm64 归 CI buildx/QEMU 或 arm64 Runner；DevTools CLI 可用且已登录则真实 smoke，需扫码则标记未验证不阻塞；真机/体验版生成交人工清单，不冒充完成，除直接依赖真机行为且风险不可控外不阻塞服务端/PR/合并/安全部署。

## 14. UI 设计纪律（用户补充授权）

凡新增或实质改动的 UI（小程序页面/组件、后台页面、控制面），必须先调用本地设计 skill 辅助设计再实现：`frontend-design`（`C:/Users/Katelya/.agents/skills/frontend-design`，视觉方向/文案/签名元素）与 `open-design`（`C:/Users/Katelya/.agents/skills/open-design/craft/`，color/typography/state-coverage/animation-discipline/accessibility-baseline/laws-of-ux/anti-ai-slop 规则手册）为主，`ui-ux-pro-max`（设计系统检索）为辅；要求：

- 与既有整体 UI 一致统一（后台沿用 Legacy admin 视觉语言与设计令牌，小程序沿用现有设计令牌与组件体系）；brief 已钉死视觉方向时以 brief 为准，不用 skill 的通用默认配色覆盖产品既有令牌；
- 直观、简洁、美观，以成熟前端设计标准打磨布局、交互与文案（中文文案一致、无机器味、动词主导，按钮措辞与结果反馈同名）；
- 图标一律使用 SVG（内联 Heroicons/Lucide 风格单线图标或项目既有 SVG），禁止用 emoji 充当图标，hover/焦点有反馈且不引发布局位移，过渡 150–300ms；
- accent 纪律：每屏主 accent 可见用途 ≤2 处（brand mark + 主 CTA/选中态），语义色仅表状态；禁 Tailwind 默认 indigo、禁两停“信任渐变”；
- 字排纪律：UI 标签/按钮 letter-spacing ≥0.02em，全大写 ≥0.06em，权重 400/500/600 三档，字号 ≤8 级；
- 状态覆盖：加载/空/错误/有数据/边界五态齐备，toast 自动消失须可悬停暂停（WCAG 2.2.1）；
- 可访问性：对比度 ≥4.5:1、表单控件有标签、尊重 prefers-reduced-motion、色彩不作唯一信息载体、焦点可见、原生语义元素优先；
- 交付前过 skill 的 Pre-Delivery Checklist；浏览器/小程序可验证时附真实渲染证据（截图或 DevTools）。

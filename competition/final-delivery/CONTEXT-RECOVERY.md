# CONTEXT-RECOVERY｜校园智序·小序 最终评审叙事重构

> 生成时间：2026-08-31
> 生成方式：Codex 会话 Markdown 迁移快照 + 当前仓库 Reality Audit（git / 文件树 / FINAL-TRUTH / 线上实测）
> 本文是本轮"评委视角叙事重构"的开工基线。事实冲突一律以「当前 Git 工作区与真实文件」为最高优先级。

---

## 1. 项目一句话定义（本轮新冻结）

**校园智序·小序，是一套面向学生、教师与教学管理者的校园教学时空智能协同系统，用一句自然语言统一完成课表查询、空间查找、多人协同、调课核验与教学运行分析。**

- 品牌主张（保留）：让教学时空，被理解、被安排。
- 封面压缩版：面向学生、教师与教学管理者的校园教学时空智能协同系统。
- FINAL-TRUTH 原口径「让复杂的校园教学安排，简单到一句话就能问。」继续作为题图短句保留，两者不冲突。

## 2. 当前用户群（本轮叙事新主轴）

| 角色 | 高频需求 | 典型问题 |
| --- | --- | --- |
| 学生 | 课表查询、连续追问、找空教室、今日安排 | "我今天有什么课？附近哪里有空教室？" |
| 教师 | 共同空闲、空间推荐、转场风险、模拟调课 | "我们什么时候都空？能不能调整？" |
| 教学管理者 | 负载总览、资源分布、风险下钻、运行分析 | "谁最忙？哪里可能有风险？" |

注：学生场景在系统中有真实能力（个人/班级/教师/课程/教室课表查询、教室检索、连续追问），演示数据含班级与课程实体，可作为真实功能演示；四组已核验 Hero 中无学生侧固定 Golden Result，学生页不得虚构"已核验数字"。

## 3. 当前系统事实（FINAL-TRUTH @ 2026-08-24 冻结，已与仓库现状核对）

- **4 Agent**：Main（小序·主协调）、Schedule（课程空间）、Risk（风险规划）、Insight（校园洞察）
- **13 CampusTools**：唯一确定性事实层（课表/实体/教室/共同空闲/风险/日计划/调课可行性/概览/负载/利用率/上下文等）
- **14 bindings**：Schedule 7 + Risk 4 + Insight 3；`campus_academic_context` 为唯一共享绑定（13 个唯一工具形成 14 个 Child 绑定）
- **协作拓扑**：用户 → 主协调 → 专业 Agent → CampusTools → 专业 Agent → 主协调 → Widget/最终解释；Main 直接绑定 CampusTools 数量为 0；无 Child→Child
- **匿名数据**：`competition-demo-v3`，sha1:842b7959e808；规模 = 4 校区 / 6 类匿名教学单位 / 24 班级 / 40 教师 / 73 课程 / 85 教室 / 175 教学安排
- **写入边界**：What-if 仅内存模拟，`mutatedData=false`，不写真实课表
- **可靠性**：Verified + Evidence + fresh call + fail-closed；缺数据/歧义/损坏时保守返回，不制造答案

## 4. 当前四组已核验结果（source=adp-runtime-golden，verified=true）

| Hero | 一句话任务 | 核验数字 | 结论 |
| --- | --- | --- | --- |
| 1 教学风险发现 | 检查教师025未来四周教学风险 | 课表硬冲突 0；每周跨校区转场 4 次；最短间隔 20 分钟；每周 14 课次 | 课表没打架 ≠ 人来得及 |
| 2 多人协同规划 | 教师005/006/014 第1周周四上午共同空闲+教室 | 3 位教师 → 63 间可用 → 7 间容量≥120 → 推荐 A1-201（120座） | 三张课表收敛建一个可执行时空 |
| 3 What-if 模拟调课 | 数据结构 周一5-6节→周四7-8节 | feasible=true + warning=1（教师连堂4节提醒）；18 间可用→8 间合规→建议 A1-201；mutatedData=false | 可行 ≠ 没有提醒；只模拟不写入 |
| 4 全局教学洞察 | 未来四周谁最忙+下钻真实风险 | Top1 教师025：56 课次 / 112 课时；下钻：冲突0 / 每周赶场4 | 排名只定位对象，风险需二次核验 |

## 5. 当前交付物状态（含上传副本核对）

- **PPT**：12 页（FINAL-SUBMISSION/04_答辩PPT/，PPTX+PDF+12 页 PNG），已含原生点击动画（每页 4-8 组）
- **设计说明书**：20 页（DOCX 7.2MB + PDF + 20 页 PNG），内部黑话已清
- **视频**：04:44.212，1920×1080，H.264，332MB，LFS 管理，未重新编码
- **程序交付包**：ZIP 55 条目，含 A_ADP工程（v20260827164200 人工导出）/ B_CampusTools / C_Widget / D_Agent配置 / E_Data(v3+schema+VERSION+PROVENANCE) / F_Verification(FINAL-TRUTH+verify-minimal) / README / ARCHITECTURE / MANIFEST-SHA256
- **其他可选材料**：在线演示与权限说明 PDF/TXT、二维码 PNG（本轮需追加 .url 快捷方式）
- **生成管线**（final-delivery/source/，全部可复用）：build-final-submission-pptx.mjs → export-office-artifacts.ps1 → add-ppt-animations.ps1 → update-final-submission-docx.py → assemble-final-submission.py → final-submission-qa.py（31 项）

## 6. 当前网站状态（https://adp.katelya.top/ 实测）

- 源码：`competition/demo-portal/`（React 19 + Vite 7 + Tailwind 4 + Cloudflare Functions；wrangler.toml）
- 实测 HTTP 200，匿名可访问，无需账号；QR 指向正确
- 当前导航 5 个一级入口：首页 / 开始体验 / 能力地图 / 演示案例 / 关于作品
- 已内置 Live ADP（服务端 Native ADP SSE）与 Verified Replay 双模式
- 首页主标题：「说一句话，校园教学安排就清楚了。」；能力页 6 项；问题集含 Golden 标记
- **本轮目标**：导航收敛为 4 个：首页 / 角色与能力 / 已核验案例 / 真实体验；首页补三类角色按钮与 1500+ 严谨口径；已核验案例改为 4 组 Verified Replay（明确标注非实时）；真实体验降为第二入口并加真实体验说明

## 7. 当前 Git / 线上状态（2026-08-31 Reality Audit）

- 本地分支：`codex/daily-knowledge-management`（HEAD=212edb7 = origin/main = main；该分支只是本地工作名，内容与 main 同步）
- 工作区仅 2 个无关 png 变更（output/agent-config-plane-browser/，与本轮无关，不触碰）
- **PR #49（feat/campusflow-adp-integration）已 MERGED（2026-08-09）**
- **PR #50（deliver/competition-final）已 MERGED（2026-08-29）**——Codex 快照中"OPEN/未合并"已过时
- 其后 main 另有 #51~#54 合并（课程提醒/CloudBase 知识，属主项目侧，与比赛材料无冲突）
- 比赛材料已随 #50 进入 main；本轮修改将基于当前 main 内容继续
- 部署：demo-portal 经 Cloudflare（wrangler.toml）；视频经 Git LFS

## 8. 本轮老师反馈（叙事策略依据，非业务事实源）

核心判断：**项目做得太多，但评委不知道先看什么。技术能力清楚，用户角色不清楚。**

要求转化为：谁在用 → 他遇到什么问题 → 小序怎样帮助他 → 背后为什么能做到 → 为什么可信 → 已经验证到什么程度 → 未来为什么值得继续做。

## 9. 本轮允许修改

- PPT 叙事顺序、信息层级、逐页观点、截图使用、动画节奏（12-14 页，保留 Auroraqua 视觉与原生动画机制）
- 设计说明书前半段叙事（产品是什么→谁在用→为什么产生→怎样工作），保持 20 页与官方必选章节
- demo-portal 导航与页面结构（4 入口、角色优先、Replay/Live 分离）
- README 产品简介（只改表述不改事实）
- 新增：CONTEXT-RECOVERY.md、PPT-SPEAKER-NOTES.md、VIDEO-RESTRUCTURE-NOTES.md、FINAL-REVIEW-CHANGELOG.md、在线体验 .url
- FINAL-SUBMISSION 内对应成品同步重建 + MANIFEST/QA 重跑

## 10. 本轮禁止修改（锁定事实）

- 4 Agent / 13 CampusTools / 14 bindings / Main→Child→Main / Main 不直接调工具
- competition-demo-v3 及其 sha1 与规模数字
- 四组已核验 Hero 数字（0/4/20min、3→63→7→A1-201、feasible+warning+mutatedData=false、025/56/112）
- 1500+ 只能表述为「底层课表服务累计服务用户 1500+」，禁止扩展 DAU/满意度/增长率
- Agent / CampusTools / Widget 既有业务语义、Schema、数据、bindings
- 不 merge、不删分支、不重新发布 ADP 生产、不改业务数据、不重剪视频
- 匿名硬约束：真实学校/学院/姓名/学号/内部地址/本机路径/账号/密钥 = 0

## 11. 已否决方向（历史确认，不得回潮）

- 不把作品定义成：一个课表 / 一个 AI 聊天机器人 / 一个排课后台 / 一个教务管理系统 / 一个万能校园助手
- 不从"我们用了 Multi-Agent"开始讲
- 不造假演示数据、不编造调查结果；演示等待用 Verified Replay（明确标注非实时）解决，不造假"实时"
- 视觉红线：不要 AI 紫、科技蓝后台、赛博朋克、满页玻璃卡片、模板感、大段文字堆砌
- 叙事红线：正文不出现 4173/4174/R47-R51/PHASE/Hero/Golden/fail-closed 等内部术语（内部材料除外）
- 1500+ 不得写成"当前所有多智能体能力已拥有 1500+ 用户"

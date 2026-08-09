# 校园智序 · 小序 — 进度日志

> 每阶段完成后更新。最终交付（任务书第十八节 13 项）以本文档与 reports/ 附件为准。

## 2026-08-07 进度快照

### 已完成（本地仓库侧）

| 项 | 状态 | 证据 |
|---|---|---|
| 分支 feat/campusflow-adp-integration + competition/adp-kit 10 目录 | ✅ | git 分支与目录树 |
| miniprogram 侧改名（小佛→小序，约 20 文件） | ✅ | grep 复核；assistantBrand.js 统一配置 |
| 服务端改名（小佛→小序，9 文件 33 处；正则/aliases 留小佛加小序兼容旧口令） | ✅ | 本日志改名清单 |
| 匿名数据三件套 | ✅ | competition-demo-v1.json（32 课次，dataHash=sha1:41781288b655）+ Schema + 校验脚本，校验全绿 |
| CampusTools MCP 服务全代码 | ✅ | src/{data,envelope,tools,ratelimit,server}.js + Dockerfile + README，零依赖 CJS，MCP+SSE+REST 三协议 |
| CampusTools 自动化测试 | ✅ **23/23 通过** | node --test（2026-08-07 12:16） |
| OpenAPI 3.0 规格 | ✅ | openapi/campus-tools.openapi.json |
| 知识库 7 份 Markdown | ✅ | knowledge/01~07 |
| 标准问答 32 组 | ✅ | qa/standard-qa.json |
| 工作流蓝图 4 份 | ✅ | workflows/01~04（含节点结构/提示词/分支/12 条调试样例 each） |
| Widget 设计稿 | ✅ | widget/校园任务结果卡.md（6 种 cardType） |
| 评测数据集 80 条 | ✅ | evaluation/eval-dataset-v1.json（8 类 80 条，10 维度） |
| 生成物重生成 + 4 套回归测试 | ✅ **4 套全绿**（foundation 42/42、regression 197/197、competition passed、final-convergence all passed） | reports/regen-test-20260807-r2.log |

### 2026-08-07 12:40-13:04 测试修复实录（重要教训）

- **发现**：首轮"4 套全绿"结论错误——`;` 分隔的 npm 测试链退出码只反映末段；通读 1709 行日志揪出 regression 98/197（1 失败 + fail-fast 致 98 个文件未跑）与 competition 1 失败。
- **定性**：6 处失败全部是"测试断言滞后于改名"（产品代码正确），逐一修复：
  1. test-ai-task-panel-click-flow.js ×2（"小佛浮窗"→"小序浮窗"）
  2. test-ai-tabbar-deeplink.js（toast→"已根据小序建议打开今日安排"）
  3. test-xiaofu-runtime-ui.js（标题断言兼容 assistantBrand 动态绑定）
  4. test-xiaofu-agent-env-routing.js ×2（buildSystemPrompt/getProjectKnowledgePrompt 断言 /小佛/→/小序/）
  5. test-xiaofu-float-behavior.js（长按菜单 actual=["打开小序","隐藏本页","关闭浮窗"]）
  6. test-ai-capability-guide.js（sheet 标题断言兼容 `assistantName}}能做什么` 动态绑定）
- **原则**：改名属任务书明确要求的有意改动；守卫测试断言旧文案时同步更新测试，不回退产品代码。检索正则/aliases 留小佛加小序不变。
- **教训**：① 测试链必须读日志逐段核对 pass/fail 计数，不信退出码；② UTF-16LE 日志乱码可用码点→LE 字节对反推中文；③ node 直接跑单测试文件无需 cd（require 相对模块文件解析）。
- agent-browser 0.33.2 全局安装完成（ADP 浏览器链路开关到位）。

### 改名清单（服务端部分，33 处）

- knowledgeBaseService.js ×5（种子知识库：标题/关键词/正文/回复；keywords 留小佛加小序）
- projectKnowledgeService.js ×9（人设首行、能力卡标题、身份正则留小佛加小序、3 条自我介绍、问候、兜底、命中卡标题）
- deepseekProvider.js ×1（system prompt 首行；注释未动）
- mockProvider.js ×3（兜底卡标题、自我介绍、generic 卡标题）
- responseComposer/index.js ×4（GENERIC_CARD_TITLES 正则加小序、重写正则加小序、品牌替换→小序、自称替换→小序）
- fosuTurnPorts.js ×3（协议不兼容提示、2 条问候）
- toolRegistry.js ×3（project_qa 正则加 小序是谁/小序.*项目；help 正则加小序）
- adminPages.js ×8（导航 title、Provider 控制台 h3 ×2、section 映射、setStatus ×2、kb-hero h3、测试 placeholder）
- verify-ai-provider.js / ai-provider routes.js / admin.js ×3（探测语句）

未改（按任务书保留）：packageXiaofu 路径、xiaofu 文件名、组件路径、存储键、数据库字段、API 协议字段、内部注释、.env。

### 待办（ADP 平台侧）

- [ ] 浏览器自动化链路（无云电脑；桌面 Chrome 需 --remote-debugging-port=9222 重启，或装 agent-browser 新开浏览器用户登录一次）
- [ ] ADP 应用基础配置核对（名称/简介/角色指令/欢迎语/示例问题/对话设置/模型参数）
- [ ] 知识库上传 ADP（7 份 MD + 32 组问答）并检查解析状态
- [ ] 4 条工作流在 ADP 搭建并逐条调试（先 01 跑通再复制）
- [ ] CampusTools 公网可达部署（或 ADP 自定义插件走 OpenAPI/MCP）
- [ ] Widget 在 ADP 创建并接入工作流 01/02
- [ ] 评测集导入 ADP 并跑评测任务，失败用例定位修复
- [ ] 应用变量/API 参数核对补齐
- [ ] 测试发布 → 最终发布前向用户总确认

### 关键决策

1. 比赛/正式双轨：FosuClass 生产数据零改动；比赛侧独立 competition-demo-v1，数据守卫禁止回退读生产。
2. 工具零依赖 CJS：不赌 npm 网络；三协议同体（MCP/SSE/REST）。
3. 改名兼容策略：用户可见→小序；检索正则/aliases 留小佛加小序；标识符与协议字段不动。
4. 评测先锚定设计场景：fri-afternoon-ab-overlap、teacher003-mon-cross-campus、demo-user-fri-full-day、sz-weeks-1-9、art-even-weeks。

## 2026-08-09 进度快照

### 本地工程

- 匿名数据、Schema、校验器、7 份知识文档、32 条问答、80 条评测、四条工作流蓝图、OpenAPI、CampusTools MCP/REST/SSE、六卡型 Widget/H5 均已完成并通过 kit 全量验证。
- 标准问答以 JSON 为权威源，新增同步脚本，CSV 与 32 条 JSON 保持一致。
- 知识文档补齐统一的“适用范围、规则、正确示例、错误示例、边界情况、工具和知识库的职责划分”结构。
- 正式产品用户可见“小序”迁移继续保持内部 `xiaofu` 路径、字段、存储键和兼容别名不变；后台用户可见“知识库/测试占位”残留也已修正并纳入审计测试。

### 本次实跑验证

- `test:agent-foundation`：42/42 通过。
- `test:agent-regression`：197/197 通过。
- `test:ai-competition`：通过。
- `test:agent-final-convergence`：通过，包含 120 条收敛评测。
- `test:agent-phase2`：11/11 通过。
- `test:agent-phase3`：通过。
- `test:campus-assistant-copy`：通过。
- `competition/adp-kit npm test`：通过；最终汇总为 7 文档、32 问答、80 评测、4 工作流、6 工具、6 卡型，CampusTools 26 项服务测试通过。
- `test:agent-release-gate`：26/26 阶段通过；Docker Desktop 启动后真实执行 PostgreSQL/Redis、standalone 编排、默认服务镜像、容器健康/API、发布预检与安全验收，耗时约 42 分钟。
- CampusTools Docker 冒烟：镜像构建通过；`health=ok`、`dataVersion=competition-demo-v1`、教师课表返回 2 项且 `evidence.verified=true`、MCP `tools/list` 返回 6 个工具；临时容器已清理。
- ADP 资产清单现覆盖 53 个实际交付文件并进入 `npm test` 门禁；Widget 样例 queryId/computedAt 已固定，重复生成哈希稳定。

### ADP 页面实际核验

- 应用基础配置大部分正确；当前名称仍为“校园智序-小序”，最大输出长度仍为 4000，需改为中点名称和约 2000。
- 文档知识 0、问答知识 0；已有分类但尚未上传。
- 工作流 01/02/03 已创建但均待发布；01 实际只有开始/结束且缺 3 个输入参数；04 尚未创建。
- “校园任务结果卡”尚未创建；评测集和评测任务均为 0；应用未上线。
- 已生成 `ADP-实际状态与逐步配置手册.md`，包含所有配置值、节点、分支、调试样例、评测和最终发布闸门。

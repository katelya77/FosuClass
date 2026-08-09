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
- [x] CampusTools 公网可达部署：独立 CloudBase HTTP Function，health/401/200 确定性调用均实测
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
- `competition/adp-kit npm test`：通过；最终汇总为 7 文档、32 问答、80 评测、4 工作流、6 工具、6 卡型，CampusTools 30/30、Golden 33/33、提交包递归扫描 0 发现。
- `test:agent-release-gate`：26/26 阶段通过；Docker Desktop 启动后真实执行 PostgreSQL/Redis、standalone 编排、默认服务镜像、容器健康/API、发布预检与安全验收，本轮耗时约 31 分 58 秒。
- CampusTools Docker 冒烟：镜像构建通过；`health=ok`、`dataVersion=competition-demo-v1`、教师课表返回 2 项且 `evidence.verified=true`、MCP `tools/list` 返回 6 个工具；临时容器已清理。
- ADP 内部资产清单现覆盖 73 个实际交付文件；Widget 样例 queryId/computedAt 已固定，重复生成哈希稳定。

### ADP 页面实际核验

- 应用模型与对话参数已核验为目标值（含最大输出 2000）；当前名称仍为“校园智序-小序”，页面未找到安全的原地重命名入口。
- 文档知识 0、问答知识 0；已有分类但尚未上传。
- 工作流 01/02/03 已创建但均待发布；初始画布均只有开始/结束。
- “校园任务结果卡”尚未创建；评测集和评测任务均为 0；应用未上线。
- 已生成 `ADP-实际状态与逐步配置手册.md`，包含所有配置值、节点、分支、调试样例、评测和最终发布闸门。

### 2026-08-09 15:50–17:06 ADP 自动化实录

- 保持 v2rayN `10808` 的“自动配置代理 + 绕过大陆”，未切换全局代理；ADP 始终由大陆直连。
- 实际创建 `04-今日校园计划`，workflow_id 为 `6445d4f9-e89c-446d-9f50-a4e6143562ca`，触发描述已填写。
- 01 开始节点从 4 个输入补齐为 7 个：`entity_type, entity_name, date_text, week, weekday, period_scope, campus`；页面显示自动保存。
- 02 开始节点从 0 个输入补齐为 9 个：`campus, date_text, week, weekday, start_period, end_period, consecutive_periods, building, capacity`；页面回读 9/9，自动保存时间 17:06。
- 03 开始节点从 0 个输入补齐为 6 个：`first_entity_type, first_entity_name, second_entity_type, second_entity_name, date_range, period_scope`；超时后重新读取页面，确认 6/6 均已写入。
- 03 的 6 个启动输入已经 DOM 回读确认；原页面截图因存在后台/账号上下文风险，已从 PR 删除，只保留文字证据。
- 04 开始节点补齐 4 个输入：`visitor_id, date_text, preferred_campus, preferred_study_duration`；页面自动保存时间 16:38。
- 四条工作流当前都仍只有开始/结束，未搭建参数提取、条件分支、CampusTools、结果核验、Widget/回复节点；不得将启动参数完成描述为工作流跑通。
- 文档上传控件已实际打开且支持多选 Markdown；扩展调用 `setFiles` 返回 `Not allowed`。需要在 Chrome 扩展详情中开启“允许访问文件网址”后再上传。该权限问题不影响普通 DOM 配置。
- 浏览器扩展访问自身 Statsig 服务偶发 10 秒超时，但 ADP DOM 操作和自动保存有效；每次不确定结果均先重读页面后再补缺项，未盲目重复写入。

### 2026-08-09 18:00–18:45 CampusTools 比赛测试部署与回归

- CloudBase 当前环境未开通云托管资源；三次安全尝试均在创建服务前失败，未生成残留云托管服务。随后按 CloudBase 托管运行时能力改用独立 HTTP Function，没有更改佛课小表生产服务。
- 已部署函数 `campusflowAdpTools`（Node.js 18 HTTP Function，Active/Available）和独立网关 `/campusflow-adp-tools`。
- 公网入口：`https://cloud1-d3g17rpe7566d3d5c-1442900641.ap-shanghai.app.tcloudbase.com/campusflow-adp-tools`。只读取 `competition-demo-v1`，使用 Bearer token；token 不进入仓库、报告或截图。
- 公网实测：`GET /health` → 200，`status=ok`、6 tools；无 token 的 `POST /api/query_schedule` → 401；轮换 token 后的同请求 → 200、`success=true`、`evidence.verified=true`、4 items。
- 新增 `cloudfunctions/campusflowAdpTools/` 可复现部署包、权威源同步检查和本地 HTTP Function 冒烟；OpenAPI 已包含实际比赛测试 server；资产清单增至 65 个文件。
- ADP 环境变量表已确认 `ENV.campus_api_base_url`、`ENV.campus_api_token` 两项存在；token 通过一次性本机桥接安全传递，不应再次读取变量列表全文。
- 本轮修改后重新执行：ADP Kit 全量测试通过；`test:agent-foundation` 42/42、`test:agent-regression` 197/197、`test:ai-competition`、`test:agent-final-convergence`（120 cases）和 `test:agent-phase2` 11/11 全部退出码 0。
- CloudBase 交付审阅发现托管包装不应继承通用服务的本地无鉴权模式；已改为缺少 `CAMPUS_API_TOKEN` 时拒绝冷启动并强制 token 模式，新增失败关闭测试，重新部署函数后再次实测 health=200、无 token=401、授权查询 4 项且 verified=true。
- ADP 生成模型参数已改为并回读 `temperature=0.2`、`top_p=0.6`、`max_output=2000`、`context_rounds=8`。
- 一次变量列表全文读取使旧 token 进入浏览器工具日志；旧值已立即在 CloudBase 与 ADP 双端轮换作废，新值只经一次性 localhost 桥接和虚拟剪贴板传递，公网授权查询再次通过，临时文件已删除。
- 应用名仍为“校园智序-小序”。实际检查应用列表“更多”菜单仅有复制、导出、删除，应用设置标题无编辑控件；为避免破坏四条既有工作流，未采用复制/删除应用的高风险绕行。

### 2026-08-09 PR #49 比赛收口与契约修正

- 将匿名演示学期调整为 2026-2027 学年第一学期：2026-08-31 至 2027-01-17，20 周；新 `dataHash=sha1:fefef4bf425b`，CloudBase 本地同步副本一致。
- `get_academic_context` 新增确定性 `date/dateText/baseDate` 契约和受控中文相对时间解析；新增测试全部通过。
- 四条工作流蓝图收口为 12 / 11 / 12 / 9 节点；删除无意义的 ADP 预解析节点，统一 03 时间容器，04 固定注入匿名 visitor。ADP 现有开始输入未被覆盖。
- 新增 33 条 Golden Result 事实预言与源 hash 锁，实测 33/33、verified=100%。
- 新增独立 `competition/submission-package/`；52 个文本文件递归扫描，findings=0、credentialCandidates=0，OpenAPI 仅留 `{host}` 占位符。
- 旧称“小佛助手浮窗怎么开”“打开小佛浮窗”“小佛可以做什么”“你是小佛吗”行为回归 4/4 通过；UI 仅显示“小序/小序浮窗/小序设置”，头像文字 fallback 改为“序”。
- 删除 3 张 ADP 后台截图，发布门禁生成的 2 张二进制截图已还原，不进入本轮差异。
- 本轮实跑：`test:campus-assistant-copy`、ADP Kit 全套、Agent Foundation 42/42、Regression 197/197、AI Competition、Final Convergence（120 cases）、Phase 2 11/11、Release Gate 26/26 全部通过。
- 未合并 main，未部署正式产品，未发布 ADP 测试版或最终比赛版。ADP 真实未完成状态仍为：7 文档/32 问答未上传，四画布只有开始/结束，插件/Widget/平台评测/发布未完成。

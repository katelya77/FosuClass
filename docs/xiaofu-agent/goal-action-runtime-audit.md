# 小佛助手真实任务执行能力审计（复现记录）

> 日期：2026-07-25 | 基线：main `294cc2a7`（PR #30）| 分支：feat/xiaofu-agent-goal-action-runtime
> 方法：直接调用服务端 `toolRegistry.resolveIntent` 与 `memoryCandidateExtractor.extractMemoryCandidates` 复现（tools/_tmp_repro_goal.js，用后已删）；线上端点用只读 GET 验证。

## 断点 1：「将24动医1的课表设为当前首页课表」误判为教师查询

- **输入**：将24动医1的课表设为当前首页课表
- **路由**：`resolveIntentChinese` → 命中 `课表` 关键词 → `inferSearchTypeChinese` → 文本无「班」字、无「老师/教师」→ **默认分支 `return "teacher"`**（toolRegistry.js `inferSearchType` / `inferSearchTypeChinese` 末尾）
- **工具**：`search_school_index { type: "teacher", q: "将24动医1设为当前首页" }`（q 还残留操作词）
- **Action**：无（查询工具，不触发任何设置行为）
- **执行结果**：按教师名搜索「将24动医1设为当前首页」→ 无结果或错误候选
- **断点定位**：① 无「设置/切换/绑定」操作类意图，操作动词完全被忽略；② 类型推断兜底为 teacher；③ 无班级别名解析（24动医1 → 24动物医学1班）

## 断点 2：「我的女朋友叫陈晓娜」无法形成上下文

- **输入**：我的女朋友叫陈晓娜（不说「记住」）
- **路由**：不命中任何校园意图 → conversational_help / rag_search 兜底
- **工具**：rag_search 或闲聊
- **记忆候选**：`extractFromMessage` 返回 `[]` —— 抽取器只有 preferredName/campus/building/reminder/class 五类正则，**没有关系记忆类型，也没有 Working Memory 普通陈述通道**
- **执行结果**：同一会话内追问「我女朋友叫什么」无法回答
- **断点定位**：memoryCandidateExtractor.js 缺少 namedRelation 候选类型；Working Memory 不接收普通陈述

## 断点 3：「请记住我的女朋友叫陈晓娜」误写 preferredName

- **输入**：请记住我的女朋友叫陈晓娜
- **记忆候选**：`preferredName = "的女朋友叫陈晓娜"`（正则 `记住(?:我)?(?:的名字)?(?:是|叫)?` 直接吞掉后续全部文本）
- **执行结果**：用户称呼被污染为「的女朋友叫陈晓娜」，后续回复会以此称呼用户
- **断点定位**：memoryCandidateExtractor.js preferredName 正则未排除「我的<关系>叫<名字>」结构；normalizeValue 无关系词黑名单
- **对照**：「我叫王奕章」→ preferredName="王奕章" ✅ 正常

## 断点 4：语音代码存在但未上线

- 代码：`cloudfunctions/aiVoiceTranscribe/`（handler/index/package.json/README）已合并 main
- **断点**：云函数未部署到 CloudBase `cloud1-d3g17rpe7566d3d5c`；`TENCENT_ASR_SECRET_ID/SECRET_KEY` 未配置；`AI_VOICE_INPUT_ENABLED` 未开启
- 链路：小程序录音 → 云函数 → 腾讯 ASR → 返回文本——第一环就断

## 断点 5：Coze Tool Gateway 生产 404

- 代码：`server/src/services/ai/cozeToolGatewayService.js` + `routes/cozeToolGateway.js` + OpenAPI 生成物已合并
- **断点**：`COZE_TOOL_GATEWAY_ENABLED` 生产未设置 → 路由不挂载 → `GET /api/coze/tools` 返回 404（2026-07-24 实测）
- 另有设计约束：Gateway Token 不得复用 Coze PAT（任务书第六章）

## 断点 6：26 条知识种子仅有草稿

- 文件：`docs/fosu-knowledge-seeds/seeds.json`（26 条，ingest 脚本禁自动 publish）
- **断点**：种子缺 sourceUrl/sourcePublisher/publishedAt/authorityLevel/contentHash/verifiedAt 等证据字段；未经官方来源核验不能发布
- 链路：official fetch → 抽取 → 对比 → 风险检查 → Draft → Validate → Diff → 人工复核 → Publish——目前只有 Draft 之前的第一步

## 总结：「输入 → 路由 → 工具 → Action → 执行结果」断点全景

| # | 断在哪一环 | 根因 |
|---|---|---|
| 1 | 路由 | 无操作类意图；类型兜底 teacher；无别名解析 |
| 2 | 记忆 | 无关系记忆类型；Working Memory 无普通陈述通道 |
| 3 | 记忆 | preferredName 正则过宽，无关系词排除 |
| 4 | 部署 | 云函数未部署、密钥未配置 |
| 5 | 配置 | 生产开关未启用、Token 未配置 |
| 6 | 数据 | 种子缺官方证据链 |

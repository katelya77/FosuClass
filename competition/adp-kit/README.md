# 校园智序 · 小序 ADP Kit

本目录是腾讯云智能体开发平台 ADP 比赛专用空间的**内部开发与接力工作区**，与正式微信小程序“佛课小表”的真实数据面隔离。可直接交给评委的独立匿名包由 `build-submission-package.js` 生成到 `../submission-package/`。

## 目录

- `knowledge/`：7份稳定知识文档与分类清单。
- `qa/`：32组标准问答，JSON为权威源，CSV可用于ADP问答知识导入。
- `evaluation/`：80条 ADP 评测集、10维评分规则与 33 条 Golden 事实预言。
- `mock-data/`：`competition-demo-v1`匿名数据、Schema、生成器和校验脚本。
- `workflows/`：应用配置、角色指令、4条工作流规格和调试样例。
- `openapi/`：CampusTools OpenAPI 3.0定义。
- `mcp/`：只读CampusTools MCP/REST服务。
- `cloudfunctions/`：从 CampusTools 权威实现同步生成的 CloudBase HTTP Function 部署包与冒烟测试。
- `widget/`：校园任务结果卡与独立匿名H5兜底。
- `screenshots/`：仅限本机临时证据，不进入 PR 或匿名提交包；不得包含账号、密钥或真实身份。
- `reports/`：页面差异、实际配置、测试、评测和失败修复记录。

## ADP 网页端接力

- `reports/ADP-实际状态与逐步配置手册.md`：基于 2026-08-09 实际页面读取的当前状态、逐节点配置、调试、评测与发布闸门。可完整发送给已登录 ADP 的 ChatGPT 网页端继续执行。
- `reports/ChatGPT网页端-项目审阅与ADP手动配置接力.md`：面向网页端 GPT 的首条提示、PR 批判性审阅任务、真实 ADP 页面文字、证据边界和分阶段手动配置顺序。建议优先发送本文件，再按需读取完整逐节点手册。
- `reports/本地工程交付报告.md`：本地实现、测试结果、未验证项和回滚路径。

## 生成

```powershell
npm run generate --prefix competition/adp-kit
npm test --prefix competition/adp-kit
npm run eval:golden --prefix competition/adp-kit
npm run build:submission --prefix competition/adp-kit
npm run validate:submission --prefix competition/adp-kit
```

动态校园事实不得写入知识库；只能从匿名数据经CampusTools返回。比赛接口失败后禁止回退读取production真实数据。

独立比赛测试入口为 `https://cloud1-d3g17rpe7566d3d5c-1442900641.ap-shanghai.app.tcloudbase.com/campusflow-adp-tools`。该地址只承载匿名 `competition-demo-v1`，需要 Bearer token；token 仅保存在部署环境和 ADP 环境变量中，不进入仓库。

知识文档、工作流说明和评测集是经过人工审阅的权威文件，`generate` 不覆盖它们；命令只重建匿名数据、问答 CSV、OpenAPI、Widget 样例、HTTP Function 部署包和资产哈希清单，并在最后执行整包校验。

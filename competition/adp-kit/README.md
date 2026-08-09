# 校园智序 · 小序 ADP Kit

本目录是腾讯云智能体开发平台 ADP 比赛专用空间的匿名交付包，与正式微信小程序“佛课小表”的真实数据面隔离。

## 目录

- `knowledge/`：7份稳定知识文档与分类清单。
- `qa/`：32组标准问答，JSON为权威源，CSV可用于ADP问答知识导入。
- `evaluation/`：80条评测集与10维评分规则。
- `mock-data/`：`competition-demo-v1`匿名数据、Schema、生成器和校验脚本。
- `workflows/`：应用配置、角色指令、4条工作流规格和调试样例。
- `openapi/`：CampusTools OpenAPI 3.0定义。
- `mcp/`：只读CampusTools MCP/REST服务。
- `widget/`：校园任务结果卡与独立匿名H5兜底。
- `screenshots/`：ADP阶段截图；不得包含账号、密钥或真实身份。
- `reports/`：页面差异、实际配置、测试、评测和失败修复记录。

## ADP 网页端接力

- `reports/ADP-实际状态与逐步配置手册.md`：基于 2026-08-09 实际页面读取的当前状态、逐节点配置、调试、评测与发布闸门。可完整发送给已登录 ADP 的 ChatGPT 网页端继续执行。
- `reports/本地工程交付报告.md`：本地实现、测试结果、未验证项和回滚路径。

## 生成

```powershell
npm run generate --prefix competition/adp-kit
npm test --prefix competition/adp-kit
```

动态校园事实不得写入知识库；只能从匿名数据经CampusTools返回。比赛接口失败后禁止回退读取production真实数据。

知识文档、工作流说明和评测集是经过人工审阅的权威文件，`generate` 不覆盖它们；命令只重建匿名数据、问答 CSV、OpenAPI、Widget 样例和资产哈希清单，并在最后执行整包校验。

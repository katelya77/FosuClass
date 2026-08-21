# 校园智序 · 小序

CampusFlow / CampusTools 匿名评审工程包。动态课程、空教室、冲突和计划事实全部由只读 CampusTools 基于 `competition-demo-v1` 确定性计算；生成模型不参与最终事实计算。

## 数据与隐私真值

- 本包只使用**匿名化、脱敏后的教学数据**，映射为统一校园教学数据模型。
- 课表、空间、负载、风险等动态结论通过受控 CampusTools 核验，不是语言模型猜测。
- 本包**不包含、不读取真实学生账号、密码或任何未经授权的个人教务信息**。
- 真实部署时由学校授权数据源按权限接入；不得声称已连接学校官方课表系统或能读取个人课程。

## 内容

- `mock-data/`：2026-2027 学年第一学期匿名演示数据与 Schema
- `tools/campus-tools-mcp/`：MCP、SSE、REST 兼容的 CampusTools 源码与测试
- `openapi/`：只含 `{host}` 占位符的 OpenAPI 模板
- `knowledge/`、`qa/`：稳定规则知识；不含动态课表事实
- `workflows/`：四条最小 ADP 工作流契约
- `widget/`：校园任务结果卡源码与匿名样例
- `evaluation/`：81 条任务评测与 33 条确定性 Golden Result

## 验证

`npm test`

结果必须同时通过 CampusTools 行为测试、Golden 事实比对和全目录匿名扫描。部署前请在 OpenAPI 中把 `{host}` 绑定到独立评审环境；不要连接任何真实校园数据源。

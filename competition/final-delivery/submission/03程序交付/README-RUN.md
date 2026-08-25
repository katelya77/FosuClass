# 校园智序·小序｜程序交付材料运行说明

本目录是比赛复现所需的最小程序材料，不是完整仓库副本。它只包含确定性 CampusTools 核心、当前 OpenAPI、R51 prompts、Agent/Tool bindings、匿名演示数据、最终 Widget、Golden Result 与最小高价值测试。

## 环境

- Node.js 18 或更高版本
- 无需安装第三方依赖
- 无需真实用户数据、外部 Provider 或任何密钥

## 一键验证

在本目录执行：

```bash
node tests/verify-delivery.js
```

验证内容：

1. 匿名数据版本、哈希与实体计数；
2. 4 Agent、13 个唯一 CampusTools、14 个 Child bindings；
3. Main 工具绑定为 0，领域角色之间没有转发关系；
4. 四个 Hero 场景的冻结结果；
5. What-if 的 `feasible=true`、提醒共存与 `mutatedData=false`；
6. Widget、OpenAPI 与 Golden Result 的版本一致性。

预期输出：

```text
PASS final-delivery verification: 4 agents / 13 tools / 14 bindings / 4 verified heroes
```

## 核心目录

```text
campus-tools/src/   确定性计算与 Agent-facing 映射
openapi/            当前 CampusTools OpenAPI
prompts/            当前 R51 四角色 prompts
bindings/           Agent / Tool 权威绑定快照
data/               competition-demo-v3 匿名数据与 schema
widget/             当前统一结果卡导出文件
golden/             四个已核验 Hero Result
tests/              最小高价值复现测试
```

## 复现边界

- 动态校园事实只由 `campus-tools/src/tools.js` 基于 `data/competition-demo-v3.json` 确定性计算。
- `campus-tools/src/data.js` 仅接受当前匿名数据文件；不会回退读取其他数据。
- What-if 只在内存候选上核验，恒不写入数据。
- 本最小源码目录不内嵌控制台导出；PHASE 3.2 正式提交树会把已接收的 ADP 应用、CampusTools 插件与 Widget 原始导出作为相邻文件封包，并分别保留 SHA-256。
- 本材料不用于直接部署生产环境。

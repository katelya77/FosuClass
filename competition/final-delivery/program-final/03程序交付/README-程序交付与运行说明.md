# 校园智序·小序｜程序交付与运行说明

## 1. 这是什么

这是“校园智序·小序”比赛作品的最小充分程序交付包。作品是腾讯 ADP 平台承载的 Multi-Agent 编排，与自定义 CampusTools 确定性事实层、统一 Widget、匿名演示数据和 Golden Result 组合而成的混合方案。

## 2. 组件边界

- `A_ADP工程/`：最新 ADP 应用人工导出 ZIP，由平台承载 4 Agent、流程和应用配置。
- `B_CampusTools/`：最新自定义插件 ZIP、13 个 operation 定义、OpenAPI 与确定性核心源码。
- `C_Widget/`：最终 `.widget` 人工导出，以及可继续编辑的 Template、Schema、Default 和数据契约。
- `D_Agent配置/`：4 Agent 最终 prompt、14 Child bindings 与 Main → Child → Main 流程说明。
- `E_Data/`：`competition-demo-v3` 匿名演示数据、schema 与版本来源。
- `F_Verification/`：4 个 Verified Golden Result、FINAL-TRUTH 与最小复现测试。

## 3. 导入 / 运行

1. 在腾讯 ADP 控制台导入 `A_ADP工程/` 中的应用 ZIP。
2. 导入 `B_CampusTools/` 中的自定义插件 ZIP；按 `OpenAPI/` 和 `operation-yaml/` 核对 13 个 operation。
3. 用 `D_Agent配置/Prompts/` 配置 Main、Schedule、Risk、Insight；按 bindings JSON 完成 14 个 Child bindings。Main 不直接绑定工具。
4. 导入 `C_Widget/` 中的 `.widget`，核对 Template、Schema 与 Default。
5. 本地复现确定性核心：安装 Node.js 18+，在本目录运行 `node F_Verification/verify-minimal.js`。

## 4. Verified snapshot

本交付包的可核查事实只来自 `competition-demo-v3`、CampusTools、Golden Result 与 FINAL-TRUTH。生成模型负责理解、路由和解释，不是动态校园事实源。任何真实平台运行所需的环境配置由评审环境或导入目标环境单独提供，不写入交付文件。

## 5. 在线演示

https://adp.katelya.top/

评委可直接从自然语言问题进入课程查询、多人协同、模拟调课与校园洞察。匿名访问，无需测试账号。

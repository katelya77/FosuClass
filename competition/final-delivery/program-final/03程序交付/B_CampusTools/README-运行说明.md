# CampusTools 运行说明

`校园智序-CampusTools.zip` 是最新平台自定义插件人工导出。`core-src/` 是与比赛四个场景直接相关的最小确定性核心，`OpenAPI/` 是脱敏后的接口结构，`operation-yaml/` 保留 13 个平台 operation 定义。

本地最小验证：在程序交付根目录运行 `node F_Verification/verify-minimal.js`。测试会核对数据版本、4/13/14 架构事实、四个 Golden Result 与风险、协同、调课、洞察结果。

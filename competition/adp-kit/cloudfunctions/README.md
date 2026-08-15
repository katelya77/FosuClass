# CampusTools CloudBase HTTP Function

本目录是 `mcp/campus-tools-mcp/` 的 CloudBase 托管运行时包装，用于独立的匿名比赛测试环境。`src/` 与 `mock-data/competition-demo-v*.json` 是生成副本；权威实现仍位于 MCP 服务和顶层 mock-data 目录，禁止在这里单独修改业务逻辑。

## 同步与本地验证

```powershell
node competition/adp-kit/cloudfunctions/sync-campusflow-function.js
node competition/adp-kit/cloudfunctions/sync-campusflow-function.js --check
node competition/adp-kit/cloudfunctions/test-http-function.js
```

CloudBase HTTP Function 固定监听 `9000`。`index.js` 在冷启动时强制 token 模式并校验数据版本：缺少 `CAMPUS_API_TOKEN` 会拒绝启动；显式设置 `CAMPUS_DATA_PATH` 时尊重该值，否则默认读取部署包内 `mock-data/competition-demo-v2.json`，数据只接受 `competition-demo-*`；没有 production 数据路径或失败回退。部署包内保留 v1 文件仅供显式回滚，运行时默认不会回退到 v1。

## 已部署的比赛测试实例

- 函数：`campusflowAdpTools`
- 运行时：Node.js 18，HTTP Function
- 网关路径：`/campusflow-adp-tools`
- 公网入口：`https://cloud1-d3g17rpe7566d3d5c-1442900641.ap-shanghai.app.tcloudbase.com/campusflow-adp-tools`
- 数据版本：`competition-demo-v2`（部署包内同时保留 v1 仅供显式回滚）
- 认证：`Authorization: Bearer <ADP 环境变量 campus_api_token>`

token 只允许保存在 CloudBase 函数环境变量和 ADP 环境变量中；不要写入代码、OpenAPI、日志、截图或 Git 历史。轮换 token 后必须分别更新两端，并重新执行 401/200 双路径验证。

## 发布边界

此函数与佛课小表生产服务完全独立。当前 CloudBase 环境未开通云托管资源，因此采用托管 HTTP Function；不要为了比赛部署修改现有生产服务。最终比赛提交版本发布仍需用户总确认。

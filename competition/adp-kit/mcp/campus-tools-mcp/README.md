# CampusTools MCP 服务

「校园智序 · 小序」参赛智能体的确定性校园工具层。
动态校园事实（课表、空教室、冲突、今日计划）全部由本服务基于**匿名演示数据**确定性计算，不经过任何生成式模型，保证结果可核验、可复现。

## 安全边界（比赛铁律）

- **只读** `competition-demo-*` 匿名数据集（数据文件名守卫：仅允许加载 `competition-demo-*` 文件，其他路径直接抛出 `DATA_GUARD`）；
- **严禁**任何入口在失败后回退读取 production 真实数据；本服务无 production 数据路径；
- 服务内无真实学校、学院、教师、学生身份信息。

## 数据版本与运行形态

不同运行形态的数据版本语义不同，不要笼统说“全部改为 v2”：

| 运行形态 | 默认数据 | 说明 |
|---|---|---|
| reusable MCP（本地 `npm start`） | `mock-data/competition-demo-v1.json` | 默认 v1，供 Golden / QA / Widget 样例等评审资产回归锚定；可通过 `CAMPUS_DATA_PATH` 显式指向任意 `competition-demo-*` 文件（如 v2） |
| CloudBase 比赛 HTTP Function | `competition-demo-v2.json`（强制） | 默认且强制 v2；缺 token 拒绝启动；数据缺失即冷启动失败，**无 v1 / production 回退**；部署包内保留 v1 仅供显式 `CAMPUS_DATA_PATH` 回滚 |
| R49 Multi-Agent（正式比赛动态事实） | `competition-demo-v2` | 5 个 Agent Tool 的正式动态事实只由 CampusTools → v2 确定性输出 |

`/health` 返回当前实际加载的 `dataVersion` / `dataHash`，以该值为准，不要凭文档假设数据版本。

## 七个工具

| 工具 | 说明 |
| --- | --- |
| `resolve_entity` | 解析班级/教师/教室/课程/校区/学院/演示用户，返回唯一实体或歧义候选 |
| `get_academic_context` | 确定性解析绝对/相对日期 → 教学周/星期/学期/节次时间轴 |
| `query_schedule` | 按班级/教师/教室/课程查课表（教学周+星期 或 具体日期，支持节次过滤） |
| `find_available_classrooms` | 指定日期/星期 + 连续节次范围的空闲教室（校区/楼栋/容量过滤） |
| `compare_schedules` | 比较两实体课表冲突，附跨校区赶场提醒 |
| `generate_day_plan` | 演示用户某日校园计划：课程、空闲时段、自习建议、跨校区提醒 |
| `get_campus_teaching_overview` | 从匿名课表确定性聚合准备期与四周校园教学负载、空间压力、教师负载和风险指标 |

## 统一结果信封

```json
{
  "success": true,
  "queryId": "q-20260805143000-a1b2c3",
  "dataVersion": "competition-demo-v2",
  "resolvedEntity": { "type": "teacher", "id": "teacher-009", "name": "教师009" },
  "items": [],
  "actions": [],
  "evidence": { "dataVersion": "competition-demo-v2", "dataHash": "sha1:4f3bbbb45d1f", "verified": true },
  "error": null
}
```

错误码：`MISSING_PARAM` / `INVALID_PARAM` / `ENTITY_NOT_FOUND` / `AMBIGUOUS_ENTITY` / `OUT_OF_RANGE` / `EMPTY_RESULT` / `DATA_GUARD` / `UNAUTHORIZED` / `RATE_LIMITED` / `TIMEOUT` / `NOT_FOUND` / `INTERNAL`。
所有错误都返回统一信封，供 ADP 工作流做确定性分支。

## 确定性时间契约

`get_academic_context` 接受可选 `date`、`dateText`、`baseDate`，优先级为 `date > dateText > baseDate`。`dateText` 支持今天、明天、后天、本周/这周/下周的周一至周日、第 N 周周一至周日和 `YYYY-MM-DD`。`baseDate` 仅用于固定评测基准；未传时使用 Asia/Shanghai 当前日期。输出含 `resolvedDate/week/weekday/weekdayName/inSemester/semester/periods`，最终日期不经过生成模型计算。

## 协议

### MCP（Streamable HTTP）

```
POST /mcp   Content-Type: application/json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "query_schedule", "arguments": { "entityType": "teacher", "entityName": "教师003", "week": 1, "weekday": 3 } } }
```

### SSE 兼容传输

```
GET  /sse                      → event: endpoint → /messages?sessionId=xxx
POST /messages?sessionId=xxx   → 响应经 SSE event: message 下发
```

### REST（同一套工具）

```
POST /api/query_schedule
POST /api/resolve_entity
POST /api/get_academic_context
POST /api/find_available_classrooms
POST /api/compare_schedules
POST /api/generate_day_plan
POST /api/get_campus_teaching_overview
GET  /health
```

OpenAPI 3.0 规范见 `../../openapi/campus-tools.openapi.json`，可直接用于 ADP 自定义插件。

## 运行

```bash
# 本地
npm start                    # 默认端口 8787

# 环境变量
PORT=8787                    # 端口
CAMPUS_API_TOKEN=xxx         # 可选 Bearer 鉴权（/health 除外）
CAMPUS_API_SIGNING_SECRET=xxx # 可选 HMAC 签名密钥，不写入仓库
CAMPUS_API_AUTH_MODE=token    # none/token/hmac/either/both
REQUEST_TIMEOUT_MS=10000     # 请求超时
RATE_LIMIT_RPM=120           # 限流：每分钟
RATE_LIMIT_BURST=30          # 限流：突发
LOG_LEVEL=info               # 日志级别

# Docker（构建上下文为 adp-kit 目录）
cd competition/adp-kit
docker build -f mcp/campus-tools-mcp/Dockerfile -t campus-tools-mcp .
docker run -p 8787:8787 campus-tools-mcp

# 测试（node:test；服务运行时零第三方依赖）
npm test
npm run typecheck            # TypeScript 契约与客户端
npm run check:openapi        # OpenAPI 与 tools/list 同源检查
```

## 目录

```
campus-tools-mcp/
├── package.json
├── Dockerfile
├── README.md
├── src/
│   ├── data.js        # 数据层 + competition-demo 文件名守卫
│   ├── envelope.js    # 统一结果信封与错误结构
│   ├── tools.js       # 7 个工具纯函数 + TOOL_DEFS + callTool 分发
│   ├── ratelimit.js   # 令牌桶限流
│   ├── server.js      # HTTP：/health + /mcp + /sse + /api/*
│   ├── contracts.ts   # TypeScript 输入/输出契约
│   └── client.ts      # TypeScript REST 客户端（Bearer/HMAC/超时）
└── test/
    └── tools.test.js  # 正反用例 + 服务端集成测试
```

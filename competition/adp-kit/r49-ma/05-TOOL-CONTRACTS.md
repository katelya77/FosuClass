# 05 — Agent Tool Contracts（确定性工具底座）

## 0. 设计原则

- 5 个 Agent Tool **从稳定 CampusTools 抽象**，不暴露 `resolve_entity` / `get_academic_context` 等内部能力。
- 动态事实**完全来自 competition-demo-v2**，由 CampusTools 确定性计算；模型不得生成最终事实字段。
- **Fail Closed**：任何缺失/非法/越界/未知工具 → 返回明确错误状态，不降级到猜测。
- 每个工具输出保留 `source / dataVersion / dataHash / verified` 等核验字段。
- 不向用户 UI 泄漏敏感内部信息（token、内部路径、内部工具名）。

## 1. 五个 Agent Tool 总览

| # | Agent Tool | 归属 Agent | 底层 CampusTools（REST/MCP） | 核心场景 |
|---|---|---|---|---|
| 1 | `campus_schedule_query` | 课程空间 | `query_schedule`（+内部 resolve/date） | 教师/班级/教室/课程课表、整周/单日/节次 |
| 2 | `campus_classroom_search` | 课程空间 | `find_available_classrooms` | 空教室、校区/楼栋/容量/连续节次 |
| 3 | `campus_risk_check` | 风险规划 | `compare_schedules`（self/compare 两态） | 单对象自身风险 / 显式双对象冲突 |
| 4 | `campus_day_plan` | 风险规划 | `generate_day_plan` | 演示用户某日计划 + 下一天推进 |
| 5 | `campus_overview` | 校园洞察 | `get_campus_teaching_overview` | 未来四周校园负载/空间/教师负载/风险 |

## 2. 统一输出信封（复用 CampusTools Envelope）

```
{
  "success": true,
  "queryId": "q-...",
  "dataVersion": "competition-demo-v2",
  "resolvedEntity": { "type": "teacher", "id": "teacher-009", "name": "教师009" } | null,
  "items": [...],
  "actions": [...],
  "evidence": {
    "dataVersion": "competition-demo-v2",
    "dataHash": "sha1:4f3bbbb45d1f",
    "source": "campus-tools-mcp",
    "computedAt": "...",
    "verified": true,
    "note": "EMPTY_RESULT | ..."
  },
  "error": { "code": "...", "message": "...", "details": null } | null
}
```

**状态语义**（Agent 据此判定）：

| 状态 | 判定 | Agent 行为 |
|---|---|---|
| `success=true, items>0` | 有结果 | 组装展示 |
| `success=true, items=[]`（note=EMPTY_RESULT） | 无结果 | 如实说明 + 放宽建议 |
| `error.code=ENTITY_NOT_FOUND` | 实体不存在 | 告知可查范围 |
| `error.code=AMBIGUOUS_ENTITY` | 多候选 | 交 Main 澄清 |
| `error.code=MISSING_PARAM/INVALID_PARAM/OUT_OF_RANGE` | 参数问题 | 交 Main 澄清 |
| `error.code=DATA_GUARD/UNAUTHORIZED/INTERNAL` | 内部/安全 | 不展示细节，提示稍后重试 |

## 3. `campus_risk_check` —— self/compare 两态契约（P0 修复核心）

> 这是本轮最关键的工具契约：**绝不允许再出现 `second_entity required` 导致 self-risk 失败**。

### 3.1 Input Schema

```json
{
  "name": "campus_risk_check",
  "description": "检查单个校园实体的自身时间冲突/跨校区赶场风险（self 模式），或显式比较两个实体的课表冲突（compare 模式）。动态事实由 CampusTools 确定性计算。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mode": { "type": "string", "enum": ["self", "compare"], "description": "self=单对象自身风险（默认，无需第二对象）；compare=显式双对象冲突比较" },
      "entityType": { "type": "string", "enum": ["class", "teacher", "room", "course"], "description": "第一对象类型" },
      "entityName": { "type": "string", "description": "第一对象名称，如 教师009 / T09" },
      "secondEntityType": { "type": "string", "enum": ["class", "teacher", "room", "course"], "description": "compare 模式必填：第二对象类型" },
      "secondEntityName": { "type": "string", "description": "compare 模式必填：第二对象名称" },
      "week": { "type": "integer", "minimum": 1, "maximum": 20, "description": "教学周（可选，与 date 二选一）" },
      "weekday": { "type": "integer", "minimum": 1, "maximum": 7, "description": "星期 1-7（可选，省略=整周比较）" },
      "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$", "description": "具体日期 YYYY-MM-DD（可选）" },
      "periodStart": { "type": "integer", "minimum": 1, "maximum": 10 },
      "periodEnd": { "type": "integer", "minimum": 1, "maximum": 10 }
    },
    "required": ["entityType", "entityName"],
    "if": { "properties": { "mode": { "const": "compare" } } },
    "then": { "required": ["secondEntityType", "secondEntityName"] }
  }
}
```

- `required` 仅 `entityType + entityName`。
- `secondEntityType/secondEntityName` 仅当 `mode=compare` 时才必填（JSON Schema `if/then` 条件约束）。
- `mode` 缺省按 `self` 处理。

### 3.2 到 CampusTools 的确定性映射（adapter 职责）

```
self 模式：  → 调用 compare_schedules(firstType=entityType, firstName=entityName,
                                      secondType=entityType, secondName=entityName, ...)
              （second 由 adapter 确定性复制 first，不依赖模型）
compare 模式：→ 调用 compare_schedules(first..., second...)
```

CampusTools `compare_schedules` **已内置 selfCompare**（first/second 相同实体时自动跳过自身同课冲突并输出单对象赶场风险）。因此 self 模式不需要新算法，只修复「入口契约不强制 second」——由 adapter 层完成。

### 3.3 输出摘要（Risk 相关）

```
summary: {
  conflictCount, firstBusySlots, secondBusySlots,
  hasConflict, selfCompare, rushWarningCount
}
compared: [ {type,name}, {type,name} ]
rushWarnings: [ {entity, weekday, from, to, gapMinutes} ]
```

## 4. 其余四个工具 Input Schema（要点）

### 4.1 campus_schedule_query
```json
{
  "description": "查询班级/教师/教室/课程在指定周、星期或日期的课表（可加节次过滤）。动态事实由 CampusTools 计算。",
  "properties": {
    "entityType": {"enum":["class","teacher","room","course"]},
    "entityName": {"type":"string"},
    "week": {"type":"integer","minimum":1,"maximum":20},
    "weekday": {"type":"integer","minimum":1,"maximum":7},
    "date": {"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$"},
    "periodStart": {"type":"integer","minimum":1,"maximum":10},
    "periodEnd": {"type":"integer","minimum":1,"maximum":10}
  },
  "required": ["entityType","entityName"]
}
```

### 4.2 campus_classroom_search
```json
{
  "description": "查询指定日期/星期、连续节次范围内的空闲教室，支持校区、楼栋、最小容量过滤。",
  "properties": {
    "campus": {"type":"string","description":"校区A/校区B/校区C"},
    "date": {"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$"},
    "week": {"type":"integer","minimum":1,"maximum":20},
    "weekday": {"type":"integer","minimum":1,"maximum":7},
    "periodStart": {"type":"integer","minimum":1,"maximum":10},
    "periodEnd": {"type":"integer","minimum":1,"maximum":10},
    "minCapacity": {"type":"integer","minimum":1},
    "building": {"type":"string"},
    "consecutivePeriods": {"type":"integer","minimum":1,"maximum":10}
  },
  "required": []
}
```
（注：时间必须能解析出 weekday；否则返回 MISSING_PARAM 由 Main 澄清。）

### 4.3 campus_day_plan
```json
{
  "description": "为演示用户生成指定日期的校园计划：课程、空闲空档、自习教室建议与跨校区提醒。",
  "properties": {
    "visitorId": {"type":"string","description":"演示用户（唯一真源 competition-demo-v2.json demoUsers[0].id = user-demo-001）"},
    "date": {"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$"},
    "preferredCampus": {"type":"string"},
    "preferredStudyDuration": {"type":"integer","minimum":1,"maximum":10}
  },
  "required": ["date"]
}
```

### 4.4 campus_overview
```json
{
  "description": "确定性汇总 2026-08-25 至 2026-09-27 校园教学态势：四周负载、校区空间压力、教师负载 Top、全局风险。",
  "properties": {
    "windowStart": {"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$"},
    "teachingStart": {"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$"},
    "windowEnd": {"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$"}
  },
  "required": []
}
```
（首版固定窗口 2026-08-25 / 2026-08-31 / 2026-09-27，越界返回 INVALID_PARAM。）

## 5. Fail-Closed 规则汇总

1. 未知工具名 → 拒绝。
2. 缺少必填参数 → `MISSING_PARAM`（Agent 不猜值）。
3. 实体不存在/歧义 → `ENTITY_NOT_FOUND` / `AMBIGUOUS_ENTITY`（交 Main 澄清，不选默认）。
4. 周次/日期越界 → `OUT_OF_RANGE`。
5. 数据文件非 `competition-demo-*` → `DATA_GUARD`，拒绝加载。
6. 接口失败 → 不补造事实，提示稍后重试。
7. 没有真实腾讯导出物（AgentID/PluginID/WidgetID）时 → 使用占位符并标注 `FAIL_CLOSED`，绝不猜测真实 ID。

## 6. 安全与隔离

- 输出信封可包含 `dataVersion/dataHash/source/verified` 供展示「已核验」，但**不**输出 token、CAMPUS_API_TOKEN、内部签名、内部函数名以外的敏感细节。
- Agent Tool 契约文件与 OpenAPI 均在 `r49-ma/tools/` 下；真实 URL / ID 缺失时以 `PLACEHOLDER` + `FAIL_CLOSED` 标注。

"use strict";
// R49.1.2 新增测试：ADP OpenAPI 输出契约硬化
// 验证：import + canonical 两个 OpenAPI 的每个 array 都有合法 items；
//       13 个 operation 各自拥有独立且可解析的 200 响应 Schema；
//       risk/day_plan/overview 响应声明 summary（含所需子字段）、risk 声明 compared+rushWarnings；
//       响应 Schema 声明的字段覆盖真实运行时 13 个 façade 的实际返回（防 OpenAPI 与运行时漂移）；
//       OpenAPI 不含 token/密钥类属性名；canonical 与 import 响应 Schema 完全镜像。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const IMPORT_PATH = path.join(__dirname, "..", "tools", "openapi", "campus-agent-tools.adp-import.json");
const CANONICAL_PATH = path.join(__dirname, "..", "tools", "openapi", "campus-agent-tools.openapi.json");
const spec = JSON.parse(fs.readFileSync(IMPORT_PATH, "utf8"));
const canonical = JSON.parse(fs.readFileSync(CANONICAL_PATH, "utf8"));

// 强制使用 competition-demo-v2（比赛主数据源）。必须在 require mcp tools 之前设置。
const V2_PATH = path.join(__dirname, "..", "..", "mock-data", "competition-demo-v2.json");
process.env.CAMPUS_DATA_PATH = V2_PATH;
const agentTools = require("../../mcp/campus-tools-mcp/src/agent-tools.js");
const v2Dataset = JSON.parse(fs.readFileSync(V2_PATH, "utf8"));
const V2_FIRST_TEACHERS = v2Dataset.teachers.slice(0, 2).map((t) => ({ type: "teacher", id: t.id, name: t.name }));
const V2_FIRST_LESSON_ID = v2Dataset.lessons[0].id;

const RESPONSE_SCHEMA_OF = {
  campus_schedule_query: "ScheduleQueryResponse",
  campus_schedule_range_query: "ScheduleRangeQueryResponse",
  campus_classroom_search: "ClassroomSearchResponse",
  campus_risk_check: "RiskCheckResponse",
  campus_day_plan: "DayPlanResponse",
  campus_overview: "OverviewResponse",
  campus_teacher_load_query: "TeacherLoadQueryResponse",
  campus_entity_search: "EntitySearchResponse",
  campus_academic_context: "AcademicContextResponse",
  campus_common_free_time_query: "CommonFreeTimeResponse",
  campus_room_utilization_query: "RoomUtilizationResponse",
  campus_reschedule_feasibility: "RescheduleFeasibilityResponse",
  campus_group_plan: "GroupPlanResponse",
};

function resolveRef(ref, doc) {
  assert.ok(typeof ref === "string" && ref.startsWith("#/components/schemas/"), `$ref 格式非法: ${ref}`);
  const name = ref.slice("#/components/schemas/".length);
  assert.ok(doc.components.schemas[name], `$ref 无法解析: ${ref}`);
  return doc.components.schemas[name];
}

function operationResponseSchema(doc) {
  return Object.fromEntries(
    Object.entries(doc.paths).map(([p, ops]) => {
      const resp = ops.post.responses["200"];
      assert.ok(resp && resp.content && resp.content["application/json"], `${p} 缺 200 application/json 响应`);
      const schema = resolveRef(resp.content["application/json"].schema.$ref, doc);
      return [p.slice("/api/".length), { ref: resp.content["application/json"].schema.$ref, schema }];
    }),
  );
}

/** 收集所有 type=array 的节点（跳过 $ref 与 items 子树） */
function collectArrays(node, nodePath, out) {
  if (!node || typeof node !== "object") return;
  if (node.$ref) return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectArrays(item, `${nodePath}[${i}]`, out));
    return;
  }
  if (node.type === "array") out.push({ nodePath, node });
  for (const [key, value] of Object.entries(node)) {
    if (key === "items") continue;
    collectArrays(value, `${nodePath}.${key}`, out);
  }
}

function walkSchemaProperties(node, fn) {
  if (!node || typeof node !== "object" || node.$ref) return;
  if (node.properties) {
    for (const [name, prop] of Object.entries(node.properties)) fn(name, prop, node);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties") continue;
    walkSchemaProperties(value, fn);
  }
}

test("R49.1.2：所有 array 类型都必须有合法 items Schema（import + canonical）", () => {
  for (const [label, doc] of [["import", spec], ["canonical", canonical]]) {
    const failures = [];
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      const found = [];
      collectArrays(schema, `components.schemas.${name}`, found);
      for (const { nodePath, node } of found) {
        if (!node.items) failures.push(`${label}: ${nodePath} 的 array 缺少 items`);
        else if (!node.items.type && !node.items.$ref) failures.push(`${label}: ${nodePath} 的 items 缺少 type/$ref`);
      }
    }
    assert.deepStrictEqual(failures, [], `${label}: 存在无 items 的 array`);
  }
});

test("R49.1.2：13 个 operation 各自拥有独立且可解析的响应 Schema", () => {
  const responses = operationResponseSchema(spec);
  assert.strictEqual(Object.keys(responses).length, 13, "必须恰有 13 个 operation 响应");
  for (const [name, expected] of Object.entries(RESPONSE_SCHEMA_OF)) {
    assert.strictEqual(responses[name].ref, `#/components/schemas/${expected}`, `${name} 应使用 ${expected}`);
    assert.strictEqual(responses[name].schema.type, "object", `${name} 响应 Schema 应为 object`);
  }
  const refs = Object.values(responses).map((r) => r.ref);
  assert.strictEqual(new Set(refs).size, 13, "13 个响应 Schema 必须各不相同（每个 operation 输出语义独立）");
});

test("R49.1.2：risk 响应声明 summary（selfCompare/conflictCount/hasConflict）+ compared + rushWarnings", () => {
  const risk = spec.components.schemas.RiskCheckResponse;
  assert.ok(risk.properties.summary, "risk 响应必须声明 summary");
  const summary = resolveRef(risk.properties.summary.$ref, spec);
  assert.strictEqual(summary, spec.components.schemas.RiskSummary);
  for (const key of ["selfCompare", "conflictCount", "hasConflict", "rushWarningCount", "firstBusySlots", "secondBusySlots"]) {
    assert.ok(summary.properties[key], `RiskSummary 必须声明 ${key}`);
  }
  assert.strictEqual(summary.properties.selfCompare.type, "boolean");
  assert.strictEqual(summary.properties.conflictCount.type, "integer");
  assert.strictEqual(summary.properties.hasConflict.type, "boolean");
  const compared = risk.properties.compared;
  assert.ok(compared && compared.type === "array" && compared.items.$ref === "#/components/schemas/ResolvedEntity", "compared 必须为 ResolvedEntity 数组");
  assert.ok(risk.properties.rushWarnings.type === "array" && risk.properties.rushWarnings.items.$ref === "#/components/schemas/RushWarning", "rushWarnings 必须为 RushWarning 数组");
  assert.ok(risk.properties.items.items.$ref === "#/components/schemas/ConflictItem", "items 必须为 ConflictItem 数组");
  assert.ok(risk.properties.success && risk.properties.evidence && risk.properties.error, "risk 响应必须声明 success/evidence/error");
});

test("R49.1.2：day_plan 响应声明 summary（lessonCount/hasCrossCampus）", () => {
  const dayPlan = spec.components.schemas.DayPlanResponse;
  assert.ok(dayPlan.properties.summary, "day_plan 响应必须声明 summary");
  assert.strictEqual(dayPlan.properties.summary.$ref, "#/components/schemas/DayPlanSummary");
  const summary = spec.components.schemas.DayPlanSummary;
  assert.strictEqual(summary.properties.lessonCount.type, "integer");
  assert.strictEqual(summary.properties.hasCrossCampus.type, "boolean");
  assert.ok(dayPlan.properties.resolvedEntity, "day_plan 响应必须声明 resolvedEntity");
});

test("R49.1.2：overview 响应声明 summary（OverviewSummary）+ items（OverviewItem）", () => {
  const overview = spec.components.schemas.OverviewResponse;
  assert.ok(overview.properties.summary, "overview 响应必须声明 summary");
  assert.strictEqual(overview.properties.summary.$ref, "#/components/schemas/OverviewSummary");
  const summary = spec.components.schemas.OverviewSummary;
  for (const key of ["weekCount", "lessonOccurrences", "teacherCount", "activeTeacherCount", "roomCount", "activeRoomCount", "campusCount"]) {
    assert.ok(summary.properties[key], `OverviewSummary 必须声明 ${key}`);
  }
  assert.strictEqual(overview.properties.items.items.$ref, "#/components/schemas/OverviewItem");
  const item = spec.components.schemas.OverviewItem;
  for (const key of ["window", "summary", "matrix", "campusResources", "teacherLoadTop", "peakSlot", "risks"]) {
    assert.ok(item.properties[key], `OverviewItem 必须声明 ${key}`);
  }
});

test("R49.1.2：schedule / classroom 响应声明 query + items + resolvedEntity", () => {
  for (const [name, responseSchema, itemSchema] of [
    ["campus_schedule_query", "ScheduleQueryResponse", "LessonItem"],
    ["campus_classroom_search", "ClassroomSearchResponse", "RoomItem"],
  ]) {
    const response = spec.components.schemas[responseSchema];
    assert.ok(response.properties.query, `${name} 响应必须声明 query`);
    assert.ok(response.properties.resolvedEntity, `${name} 响应必须声明 resolvedEntity`);
    assert.strictEqual(response.properties.items.items.$ref, `#/components/schemas/${itemSchema}`, `${name} items 应为 ${itemSchema}`);
  }
});

test("R49.1.2：响应 Schema 声明字段覆盖真实运行时 13 个 façade 实际返回（防漂移）", () => {
  const responses = operationResponseSchema(spec);
  const cases = [
    { name: "campus_schedule_query", params: { entityType: "teacher", entityName: "T09", week: 1 }, responseSchema: "ScheduleQueryResponse", itemSchema: "LessonItem" },
    { name: "campus_schedule_range_query", params: { entityType: "teacher", entityName: "T09", weekStart: 1, weekEnd: 4 }, responseSchema: "ScheduleRangeQueryResponse", itemSchema: "ScheduleRangeItem" },
    { name: "campus_classroom_search", params: { campus: "校区A", date: "2026-09-03", periodStart: 5, periodEnd: 6, minCapacity: 60 }, responseSchema: "ClassroomSearchResponse", itemSchema: "RoomItem" },
    { name: "campus_risk_check", params: { mode: "compare", entityType: "teacher", entityName: "T03", secondEntityType: "teacher", secondEntityName: "T09", week: 1 }, responseSchema: "RiskCheckResponse", itemSchema: "ConflictItem" },
    { name: "campus_day_plan", params: { date: "2026-09-04" }, responseSchema: "DayPlanResponse", itemSchema: "DayPlanItem" },
    { name: "campus_overview", params: {}, responseSchema: "OverviewResponse", itemSchema: "OverviewItem" },
    { name: "campus_teacher_load_query", params: { weekStart: 1, weekEnd: 1, topN: 3 }, responseSchema: "TeacherLoadQueryResponse", itemSchema: "TeacherLoadItem" },
    { name: "campus_entity_search", params: { entityType: "teacher", limit: 5 }, responseSchema: "EntitySearchResponse", itemSchema: "EntitySearchItem" },
    { name: "campus_academic_context", params: { intent: { kind: "future_weeks", count: 4 }, baseDate: "2026-08-18" }, responseSchema: "AcademicContextResponse", itemSchema: "AcademicContextItem" },
    { name: "campus_common_free_time_query", params: { entities: V2_FIRST_TEACHERS, week: 1, minConsecutivePeriods: 1 }, responseSchema: "CommonFreeTimeResponse", itemSchema: "CommonFreeTimeItem" },
    { name: "campus_room_utilization_query", params: { weekStart: 1, weekEnd: 4, sort: "highest", topN: 3 }, responseSchema: "RoomUtilizationResponse", itemSchema: "RoomUtilizationItem" },
    { name: "campus_reschedule_feasibility", params: { sourceLessonId: V2_FIRST_LESSON_ID, target: { week: 1, weekday: 1, periodStart: 3, periodEnd: 4 } }, responseSchema: "RescheduleFeasibilityResponse", itemSchema: "RescheduleItem" },
    { name: "campus_group_plan", params: { entities: V2_FIRST_TEACHERS, week: 1, minConsecutivePeriods: 1 }, responseSchema: "GroupPlanResponse", itemSchema: "GroupPlanItem" },
  ];
  for (const item of cases) {
    const env = agentTools.callAgentTool(item.name, item.params);
    assert.ok(env && env.success === true, `${item.name}: 运行时调用应成功`);
    const responseSchema = spec.components.schemas[item.responseSchema];
    const declared = new Set(Object.keys(responseSchema.properties));
    for (const key of Object.keys(env)) {
      assert.ok(declared.has(key), `${item.name}: 运行时返回 ${key} 未在 ${item.responseSchema} 声明`);
    }
    const itemSchema = spec.components.schemas[item.itemSchema];
    const declaredItem = new Set(Object.keys(itemSchema.properties));
    for (const entry of env.items) {
      for (const key of Object.keys(entry)) {
        assert.ok(declaredItem.has(key), `${item.name}: items 元素字段 ${key} 未在 ${item.itemSchema} 声明`);
      }
    }
    if (env.rushWarnings && env.rushWarnings.length > 0) {
      const rushSchema = spec.components.schemas.RushWarning;
      const declaredRush = new Set(Object.keys(rushSchema.properties));
      for (const key of Object.keys(env.rushWarnings[0])) {
        assert.ok(declaredRush.has(key), `${item.name}: rushWarnings 字段 ${key} 未在 RushWarning 声明`);
      }
    }
    if (env.summary) {
      const summaryRef = responseSchema.properties.summary.$ref;
      const summarySchema = resolveRef(summaryRef, spec);
      const declaredSummary = new Set(Object.keys(summarySchema.properties));
      for (const key of Object.keys(env.summary)) {
        assert.ok(declaredSummary.has(key), `${item.name}: summary 字段 ${key} 未在 ${summaryRef} 声明`);
      }
    }
  }
});

test("R49.1.2：OpenAPI 不含 token/密钥类属性名", () => {
  const raw = fs.readFileSync(IMPORT_PATH, "utf8");
  const secretName = /["'](?:token|api[_-]?key|secret|password|authorization|cookie)["']\s*:/i;
  assert.ok(!secretName.test(raw), "不得出现 token/密钥类属性名");
  for (const doc of [spec, canonical]) {
    const hits = [];
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      walkSchemaProperties(schema, (propName) => {
        if (secretName.test(JSON.stringify({ [propName]: null }))) hits.push(`${name}.${propName}`);
      });
    }
    assert.deepStrictEqual(hits, [], "components.schemas 不得含 token/密钥类属性名");
  }
});

test("R49.1.2：canonical 与 import 的响应 Schema 完全镜像", () => {
  const importResponses = operationResponseSchema(spec);
  const canonicalResponses = operationResponseSchema(canonical);
  assert.deepStrictEqual(
    Object.keys(canonicalResponses).sort(),
    Object.keys(importResponses).sort(),
    "canonical 与 import 的 operation 集合必须一致",
  );
  for (const name of Object.keys(importResponses)) {
    assert.strictEqual(
      canonicalResponses[name].ref,
      importResponses[name].ref,
      `${name} 的响应 Schema $ref 必须镜像一致`,
    );
  }
  for (const schemaName of Object.values(RESPONSE_SCHEMA_OF)) {
    assert.deepStrictEqual(
      canonical.components.schemas[schemaName],
      spec.components.schemas[schemaName],
      `${schemaName} 必须与 import 完全一致`,
    );
  }
});
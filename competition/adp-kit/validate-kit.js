#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const EXPECTED_DISTRIBUTION = {
  "多维课表查询": 20,
  "空教室查询": 15,
  "冲突比较": 10,
  "今日计划": 10,
  "多轮上下文": 10,
  "缺参和歧义": 5,
  "无结果和工具失败": 5,
  "匿名与提示注入": 5,
};
const WORKFLOW_NAMES = [
  "01-多维课表查询",
  "02-空教室规划",
  "03-课程冲突比较",
  "04-今日校园计划",
];
const CARD_TYPES = ["schedule", "classroom", "conflict", "day_plan", "error", "choice"];
const DYNAMIC_CARD_TYPES = ["schedule", "classroom", "conflict", "day_plan"];
const WIDGET_ACTION_TYPES = ["sys.chat", "sys.go_to_url", "sys.download"];
const REQUIRED_KNOWLEDGE_SECTIONS = [
  "适用范围",
  "规则",
  "正确示例",
  "错误示例",
  "边界情况",
  "工具和知识库的职责划分",
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8").replace(/^\uFEFF/, "");
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}

function unique(items, label) {
  assert.strictEqual(new Set(items).size, items.length, `${label} 必须唯一`);
}

function validateKnowledge() {
  const files = fs.readdirSync(path.join(ROOT, "knowledge"))
    .filter((name) => /^\d{2}-.*\.md$/.test(name))
    .sort();
  assert.strictEqual(files.length, 7, "知识库 Markdown 必须恰好 7 份");
  files.forEach((name) => {
    const content = read(path.join("knowledge", name));
    REQUIRED_KNOWLEDGE_SECTIONS.forEach((section) => {
      assert(content.includes(section), `${name} 缺少章节：${section}`);
    });
  });
}

function validateQa() {
  const qa = json("qa/standard-qa.json");
  assert.strictEqual(qa.count, qa.items.length, "问答 count 与 items 不一致");
  assert(qa.items.length >= 30, "标准问答不足 30 组");
  unique(qa.items.map((item) => item.id), "问答 id");
  qa.items.forEach((item) => {
    assert(item.question && item.answer && item.category, `${item.id} 缺少必填字段`);
    assert(Array.isArray(item.tags) && item.tags.length > 0, `${item.id} 缺少标签`);
  });
}

function validateEvaluation() {
  const dataset = json("evaluation/evaluation-dataset.json");
  assert.strictEqual(dataset.count, 80, "评测集必须恰好 80 条");
  assert.strictEqual(dataset.items.length, 80, "评测 items 必须恰好 80 条");
  assert.deepStrictEqual(dataset.distribution, EXPECTED_DISTRIBUTION, "评测类别分布不正确");
  unique(dataset.items.map((item) => item.id), "评测 id");
  dataset.items.forEach((item) => {
    assert(Array.isArray(item.turns) && item.turns.length > 0, `${item.id} 缺少对话轮次`);
    assert.strictEqual(item.expected.noFabrication, true, `${item.id} 未启用防虚构断言`);
    assert.strictEqual(item.expected.anonymousOnly, true, `${item.id} 未启用匿名断言`);
  });
  const jsonlRows = read("evaluation/evaluation-dataset.jsonl").trim().split(/\r?\n/);
  assert.strictEqual(jsonlRows.length, 80, "JSONL 行数必须为 80");
  jsonlRows.forEach((row) => JSON.parse(row));
}

function validateWorkflows() {
  const specs = json("workflows/workflow-specs.json");
  assert.strictEqual(specs.schema, "campus-adp-workflows/v2", "工作流契约必须为 v2 简化版");
  assert.strictEqual(specs.workflows.length, 4, "核心工作流必须恰好 4 条");
  assert.deepStrictEqual(specs.workflows.map((workflow) => workflow.name), WORKFLOW_NAMES);
  assert.deepStrictEqual(specs.workflows.map((workflow) => workflow.nodeCount), [12, 11, 12, 9], "工作流节点数必须保持最小稳定结构");
  specs.workflows.forEach((workflow) => {
    assert(workflow.trigger, `${workflow.name} 缺少触发描述`);
    assert(workflow.params.length > 0, `${workflow.name} 缺少参数`);
    assert(workflow.samples.length >= 10, `${workflow.name} 调试样例必须至少 10 条`);
    assert.strictEqual(workflow.nodes.length, workflow.nodeCount, `${workflow.name} nodeCount 不一致`);
    assert(!workflow.nodes.some((item) => item.tool === "resolve_entity"), `${workflow.name} 不应重复调用 resolve_entity`);
    assert(workflow.failurePolicy && workflow.contextPolicy && workflow.branchPolicy.length > 0, `${workflow.name} 缺少分支策略`);
    assert.strictEqual(workflow.replanLimit, 0, `${workflow.name} 不应在 ADP 蓝图内扩建重规划 Runtime`);
  });

  const [schedule, classroom, conflict, dayPlan] = specs.workflows;
  const names = (workflow) => workflow.params.map((item) => item.name);
  assert.deepStrictEqual(schedule.required, ["entity_type", "entity_name"], "01 只强制实体类型和名称");
  assert(!names(schedule).includes("campus"), "01 不得保留未使用的 campus 业务参数");
  assert(schedule.legacyStartInputs.some((item) => item.name === "campus"), "01 必须说明已有 campus 输入的兼容策略");
  assert(classroom.required.includes("campus"), "02 必须要求校区");
  assert(names(conflict).includes("date_range"), "03 必须统一使用 date_range");
  assert(!names(conflict).includes("date_text") && !names(conflict).includes("week") && !names(conflict).includes("weekday"), "03 不得同时使用两套顶层时间字段");
  assert(!names(dayPlan).includes("visitor_id"), "04 不得从用户业务参数获取 visitor_id");
  assert.strictEqual(dayPlan.constants.demoVisitorId, "visitor-demo-001", "04 必须注入固定匿名 visitor");
  assert(dayPlan.legacyStartInputs.some((item) => item.name === "visitor_id"), "04 必须说明已有 visitor_id 输入的兼容策略");
}

function validateApplication() {
  const app = json("workflows/application-config.json");
  assert.strictEqual(app.name, "校园智序 · 小序");
  assert.strictEqual(app.mode, "标准模式");
  assert.strictEqual(app.models.thinking, "youtu-intent-pro");
  assert.strictEqual(app.models.generation, "youtu-mrc-pro");
  assert.strictEqual(app.conversation.webSearch, false);
  assert.strictEqual(app.appVariables.environment, "competition");
  assert.strictEqual(app.appVariables.data_mode, "anonymous");
  assert.strictEqual(app.appVariables.data_version, "competition-demo-v1");
  assert.deepStrictEqual(Object.keys(app.appVariables), [
    "environment", "data_mode", "data_version", "timezone", "default_language", "default_campus",
  ], "应用变量必须保持 6 个已核验项，不添加评测时钟等业务变量");
  assert.deepStrictEqual(app.environmentVariables, ["campus_api_base_url", "campus_api_token"], "当前 ADP 使用 Bearer token 的两个环境变量");
  ["visitor_id", "session_id", "client_type", "request_trace_id"].forEach((key) => {
    assert(app.apiParameters.includes(key), `缺少 API 参数：${key}`);
  });
}

function validateWidgetAction(action, label) {
  assert(action && action.id && action.label && action.type, `${label} Action 缺少 id/label/type`);
  assert(WIDGET_ACTION_TYPES.includes(action.type), `${label} Action 类型不允许：${action.type}`);
  const serialized = JSON.stringify(action);
  ["authorization", "campus_api_token", "nodeid", "varbizid", "system prompt", "系统提示词"].forEach((term) => {
    assert(!serialized.toLowerCase().includes(term.toLowerCase()), `${label} Action 含内部敏感字段：${term}`);
  });
}

function validateInterfaces() {
  const openapi = json("openapi/campus-tools.openapi.json");
  const operations = Object.values(openapi.paths)
    .flatMap((entry) => Object.values(entry))
    .map((operation) => operation.operationId)
    .filter(Boolean);
  [
    "resolve_entity",
    "get_academic_context",
    "query_schedule",
    "find_available_classrooms",
    "compare_schedules",
    "generate_day_plan",
  ].forEach((tool) => assert(operations.includes(tool), `OpenAPI 缺少 ${tool}`));
  const academicSchema = openapi.paths["/api/get_academic_context"].post.requestBody.content["application/json"].schema;
  ["date", "dateText", "baseDate"].forEach((field) => {
    assert(academicSchema.properties[field], `get_academic_context 缺少 ${field}`);
  });

  const schema = json("widget/widget-schema.json");
  assert.strictEqual(schema.properties.schemaVersion.const, "campus-widget/v2", "Widget Schema 必须为 campus-widget/v2");
  assert.deepStrictEqual(schema.properties.cardType.enum, CARD_TYPES, "Widget cardType 不完整");
  assert.strictEqual(schema.properties.actions.maxItems, 3, "Widget 主动作必须最多 3 个");
  assert.deepStrictEqual(schema.properties.actions.items.properties.type.enum, WIDGET_ACTION_TYPES, "Widget Action 类型合同不一致");

  const samples = json("widget/sample-results.json");
  CARD_TYPES.forEach((type) => {
    const sample = samples[type];
    assert(sample, `Widget 缺少 ${type} 样例`);
    assert.strictEqual(sample.schemaVersion, "campus-widget/v2", `${type} 样例不是 v2 ViewModel`);
    assert.strictEqual(sample.cardType, type, `${type} cardType 不匹配`);
    assert(Array.isArray(sample.actions) && sample.actions.length <= 3, `${type} Action 数量超过限制`);
    sample.actions.forEach((action) => validateWidgetAction(action, type));
    if (type === "choice") {
      assert.strictEqual(sample.interaction.waitForUser, true, "Choice Widget 必须等待用户操作");
      sample.items.forEach((item) => validateWidgetAction(item.action, "choice item"));
    }
  });
  DYNAMIC_CARD_TYPES.forEach((type) => {
    assert.strictEqual(samples[type].success, true, `${type} 动态样例必须成功`);
    assert.strictEqual(samples[type].dataVersion, "competition-demo-v1", `${type} 数据版本不正确`);
    assert.strictEqual(samples[type].evidence.verified, true, `${type} 动态样例必须 verified=true`);
  });
}

function validateAnonymousCompetitionAssets() {
  const targets = ["knowledge", "qa", "evaluation", "workflows", "widget"];
  const deny = ["佛山大学", "仙溪校区", "江湾校区", "河滨校区", "小佛助手", "小佛AI"];
  const files = targets.flatMap((dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter((name) => /\.(md|json|jsonl|csv|txt|html|js|css)$/.test(name))
    .map((name) => path.join(dir, name)));
  files.forEach((file) => {
    const content = read(file);
    deny.forEach((term) => assert(!content.includes(term), `${file} 含赛事禁用真实/旧品牌词：${term}`));
  });
}

function run() {
  validateKnowledge();
  validateQa();
  validateEvaluation();
  validateWorkflows();
  validateApplication();
  validateInterfaces();
  validateAnonymousCompetitionAssets();
  const qaCount = json("qa/standard-qa.json").items.length;
  console.log(`ADP kit validation passed: 7 docs, ${qaCount} QA, 80 evals, 4 workflows, 6 tools, 6 widget v2 card types`);
}

run();

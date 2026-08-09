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
  assert.strictEqual(specs.workflows.length, 4, "核心工作流必须恰好 4 条");
  assert.deepStrictEqual(specs.workflows.map((workflow) => workflow.name), WORKFLOW_NAMES);
  specs.workflows.forEach((workflow) => {
    assert(workflow.trigger, `${workflow.name} 缺少触发描述`);
    assert(workflow.params.length > 0, `${workflow.name} 缺少参数`);
    assert.strictEqual(workflow.samples.length, 10, `${workflow.name} 调试样例必须为 10 条`);
    assert(workflow.nodes.length >= 10, `${workflow.name} 节点数过少`);
    assert(workflow.failurePolicy && workflow.emptyPolicy && workflow.contextPolicy, `${workflow.name} 缺少分支策略`);
    assert.strictEqual(workflow.replanLimit, 2, `${workflow.name} replan 上限必须为 2`);
  });
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
  ["visitor_id", "session_id", "client_type", "request_trace_id"].forEach((key) => {
    assert(app.apiParameters.includes(key), `缺少 API 参数：${key}`);
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

  const schema = json("widget/widget-schema.json");
  assert.deepStrictEqual(schema.properties.cardType.enum, CARD_TYPES, "Widget cardType 不完整");
  const samples = json("widget/sample-results.json");
  CARD_TYPES.forEach((type) => assert(samples[type], `Widget 缺少 ${type} 样例`));
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
  console.log(`ADP kit validation passed: 7 docs, ${qaCount} QA, 80 evals, 4 workflows, 6 tools, 6 card types`);
}

run();

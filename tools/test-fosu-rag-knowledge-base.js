const assert = require("assert");

const knowledgeBase = require("../miniprogram/data/fosuKnowledgeBase");
const ragRetriever = require("../miniprogram/services/ragRetriever");

const REQUIRED_FIELDS = [
  "id",
  "title",
  "summary",
  "content",
  "category",
  "entryType",
  "keywords",
  "aliases",
  "sourceUrl",
  "relatedLinks",
  "updatedAt",
  "confidence",
];

function assertEntryShape(entry) {
  REQUIRED_FIELDS.forEach((field) => {
    assert(Object.prototype.hasOwnProperty.call(entry, field), `${entry.id || entry.title} should keep ${field}`);
  });
  assert(Array.isArray(entry.keywords), `${entry.id} keywords should be array`);
  assert(Array.isArray(entry.aliases), `${entry.id} aliases should be array`);
  assert(Array.isArray(entry.relatedLinks), `${entry.id} relatedLinks should be array`);
}

function requireDoc(id) {
  const doc = knowledgeBase.docs.find((item) => item.id === id);
  assert(doc, `knowledge base should include ${id}`);
  assertEntryShape(doc);
  return doc;
}

function topFor(query, options) {
  const result = ragRetriever.searchKnowledge(query, options || {});
  return result.top || {};
}

function run() {
  knowledgeBase.docs.forEach(assertEntryShape);
  [
    "academic_affairs_portal",
    "library_portal",
    "undergraduate_admission_portal",
    "employment_center_portal",
    "recruitment_system_portal",
    "graduate_related_portal",
    "journal_editorial_portal",
    "campus_map_entry",
    "personal_schedule_sync_entry",
    "personal_schedule_xls_import_guide",
    "xiaofu_data_source_explanation",
  ].forEach(requireDoc);

  assert.strictEqual(topFor("个人课表同步主入口").id, "personal_schedule_sync_entry", "full title should rank first");
  assert.strictEqual(topFor("打开导入入口").id, "personal_schedule_sync_entry", "generic import entry should prefer sync main page");
  assert.strictEqual(topFor("XLS导入").id, "personal_schedule_xls_import_guide", "explicit XLS query should prefer XLS guide");
  assert.strictEqual(topFor("图书馆入口在哪里").entryType, "navigation", "entry query should prefer navigation");
  assert.strictEqual(topFor("教务系统在哪里").id, "academic_affairs_portal", "academic affairs alias should rank first");
  assert(topFor("数据来源说明").id === "xiaofu_data_source_explanation" || topFor("数据来源说明").category === "app_help", "data source query should resolve to app help");

  const weather = ragRetriever.searchKnowledge("今天要不要带伞");
  assert.strictEqual(weather.blockedByToolIntent, "weather", "weather query should not enter campus RAG");
  const status = ragRetriever.searchKnowledge("课表数据更新到什么时候");
  assert.strictEqual(status.blockedByToolIntent, "schedule_status", "schedule status query should not enter campus RAG");

  const unknown = ragRetriever.searchKnowledge("校医院开放时间");
  assert(!unknown.hasReliableResult, "unsupported high-risk detail should not use school overview fallback");

  console.log("test-fosu-rag-knowledge-base passed");
}

run();

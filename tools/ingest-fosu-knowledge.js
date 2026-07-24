// 佛山大学知识摄取流水线
// 从 docs/fosu-knowledge-seeds/seeds.json 读取候选知识，逐条导入知识库 **草稿态**。
// 铁律：本脚本绝不调用 publish()；候选知识必须人工审核后在管理端手动发布。
// 用法:
//   node tools/ingest-fosu-knowledge.js --dry-run   # 只预览，不写库
//   node tools/ingest-fosu-knowledge.js             # 写入 draft（upsert 幂等）
// 环境变量:
//   FOSU_ASSISTANT_KB_PATH  指定知识库存储文件（测试/隔离环境用）

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const SEEDS_PATH = path.join(root, "docs/fosu-knowledge-seeds/seeds.json");
const ALLOWED_SCOPES = ["public", "trial", "dev"];
const MAX_BODY_LENGTH = 4000;
const MIN_COUNT = 20;
const MAX_COUNT = 40;

function toMarkdown(seed) {
  const keywords = (seed.keywords || []).join(", ");
  const tags = (seed.tags || []).join(", ");
  return [
    "---",
    `title: ${seed.title}`,
    `sourceId: ${seed.sourceId}`,
    `scope: [${ALLOWED_SCOPES.join(", ")}]`,
    `keywords: [${keywords}]`,
    `tags: [${tags}]`,
    "---",
    "",
    seed.body.trim(),
    "",
  ].join("\n");
}

function validateSeed(seed) {
  const problems = [];
  if (!seed || typeof seed !== "object") problems.push("not-an-object");
  if (!seed.sourceId || !/^fosu-[a-z0-9-]+$/.test(seed.sourceId)) problems.push("bad-sourceId");
  if (!seed.title || seed.title.length > 60) problems.push("bad-title");
  if (!seed.body || seed.body.length < 30) problems.push("body-too-short");
  if (seed.body && seed.body.length > MAX_BODY_LENGTH) problems.push("body-too-long");
  if (!Array.isArray(seed.keywords) || seed.keywords.length < 2) problems.push("keywords-too-few");
  return problems;
}

function loadSeeds(seedsPath = SEEDS_PATH) {
  const raw = JSON.parse(fs.readFileSync(seedsPath, "utf8"));
  const seeds = Array.isArray(raw.seeds) ? raw.seeds : [];
  if (seeds.length < MIN_COUNT || seeds.length > MAX_COUNT) {
    throw new Error(`seeds count ${seeds.length} outside required range ${MIN_COUNT}~${MAX_COUNT}`);
  }
  const seen = new Set();
  seeds.forEach((seed) => {
    const problems = validateSeed(seed);
    if (problems.length) {
      throw new Error(`seed ${seed && seed.sourceId} invalid: ${problems.join(",")}`);
    }
    if (seen.has(seed.sourceId)) {
      throw new Error(`duplicate sourceId: ${seed.sourceId}`);
    }
    seen.add(seed.sourceId);
  });
  return seeds;
}

function ingest(options = {}) {
  const dryRun = options.dryRun === true;
  const knowledgeBaseService = options.knowledgeBaseService || require(path.join(root, "server/src/services/ai/knowledgeBaseService.js"));
  const seeds = loadSeeds(options.seedsPath);
  const report = { total: seeds.length, imported: 0, skipped: 0, blocked: 0, failed: 0, items: [] };

  seeds.forEach((seed) => {
    const markdown = toMarkdown(seed);
    try {
      if (dryRun) {
        const preview = knowledgeBaseService.importMarkdown({ markdown, commit: false }).preview;
        report.items.push({ sourceId: seed.sourceId, status: preview.blocked ? "blocked" : "preview", risks: preview.risks });
        if (preview.blocked) report.blocked += 1;
        return;
      }
      const result = knowledgeBaseService.importMarkdown({ markdown, commit: true, conflictMode: "upsert" });
      if (result.skipped) {
        report.skipped += 1;
        report.items.push({ sourceId: seed.sourceId, status: "skipped" });
      } else {
        report.imported += 1;
        report.items.push({ sourceId: seed.sourceId, status: "draft", id: result.entry && result.entry.id });
      }
    } catch (error) {
      report.failed += 1;
      report.items.push({ sourceId: seed.sourceId, status: "failed", code: error.code || "INGEST_FAILED" });
    }
  });
  return report;
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  const report = ingest({ dryRun });
  console.log(JSON.stringify(report, null, 2));
  if (report.failed > 0 || report.blocked > 0) process.exit(1);
  console.log(dryRun ? "dry-run ok: no writes performed" : "ingest ok: all entries are DRAFT, publish manually after review");
}

module.exports = { ingest, loadSeeds, toMarkdown, validateSeed, SEEDS_PATH };

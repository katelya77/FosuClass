// 佛大知识摄取流水线测试
// 覆盖：种子数量区间 / 字段校验 / dry-run 零写入 / 导入全为 draft / publish 绝不被调用
// 运行: node tools/test-fosu-knowledge-ingest.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");

// 隔离存储：测试用临时知识库文件，绝不碰真实数据
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-kb-"));
process.env.FOSU_ASSISTANT_KB_PATH = path.join(tmpDir, "knowledge-docs.json");

const ingester = require(path.join(root, "tools/ingest-fosu-knowledge.js"));
const knowledgeBaseService = require(path.join(root, "server/src/services/ai/knowledgeBaseService.js"));

// ---------- 1. 种子数据自身质量 ----------
{
  const seeds = ingester.loadSeeds();
  assert.ok(seeds.length >= 20 && seeds.length <= 40, `种子数量 ${seeds.length} 必须在 20~40 区间`);
  seeds.forEach((seed) => {
    assert.deepStrictEqual(ingester.validateSeed(seed), [], `${seed.sourceId} 字段必须合法`);
    assert.ok(seed.sourceId.startsWith("fosu-"), "sourceId 统一 fosu- 前缀");
    assert.ok(!/\b1[3-9]\d{9}\b/.test(seed.body), `${seed.sourceId} 不得包含手机号`);
    assert.ok(!/\b\d{17}[\dXx]\b/.test(seed.body), `${seed.sourceId} 不得包含身份证号`);
    assert.ok(!/(密码|password|cookie|token|secret|apikey)/i.test(seed.body), `${seed.sourceId} 不得包含密钥类敏感词`);
  });
}

// ---------- 2. dry-run 零写入 ----------
{
  const before = knowledgeBaseService.listKnowledge({ status: "draft" });
  const report = ingester.ingest({ dryRun: true });
  const after = knowledgeBaseService.listKnowledge({ status: "draft" });
  assert.strictEqual(report.failed, 0);
  assert.strictEqual(report.blocked, 0, "种子不得被安全校验拦截");
  assert.strictEqual(after.entries.length, before.entries.length, "dry-run 不得写入任何条目");
}

// ---------- 3. 正式摄取：全部 draft，published 零变化 ----------
{
  const publishedBefore = knowledgeBaseService.listKnowledge({ status: "published" });
  const report = ingester.ingest({ dryRun: false });
  assert.strictEqual(report.failed, 0, JSON.stringify(report.items));
  assert.strictEqual(report.imported + report.skipped, report.total);
  assert.ok(report.imported >= 20, "至少导入 20 条");

  const drafts = knowledgeBaseService.listKnowledge({ status: "draft" });
  const fosuDrafts = (drafts.entries || []).filter((item) => String(item.sourceId || "").startsWith("fosu-"));
  assert.ok(fosuDrafts.length >= 20, "draft 中必须能找到全部 fosu- 条目");
  fosuDrafts.forEach((entry) => {
    assert.strictEqual(entry.status, "draft", `${entry.sourceId} 必须是 draft 态`);
  });

  const publishedAfter = knowledgeBaseService.listKnowledge({ status: "published" });
  assert.strictEqual(publishedAfter.entries.length, publishedBefore.entries.length, "摄取前后 published 数量必须零变化（禁止自动 Publish）");

  // 幂等：再跑一遍，全部 upsert，draft 数量不翻倍
  const second = ingester.ingest({ dryRun: false });
  const draftsAfterSecond = knowledgeBaseService.listKnowledge({ status: "draft" });
  assert.strictEqual(draftsAfterSecond.entries.length, drafts.entries.length, "重复摄取必须幂等，不得产生重复条目");
  assert.strictEqual(second.failed, 0);
}

// ---------- 4. 脚本源码不含 publish 调用 ----------
{
  const source = fs.readFileSync(path.join(root, "tools/ingest-fosu-knowledge.js"), "utf8");
  assert.ok(!/\.publish\s*\(/.test(source), "摄取脚本源码中禁止出现 publish() 调用");
  assert.ok(!/require.*publish/i.test(source), "摄取脚本不得引入发布能力");
}

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("test-fosu-knowledge-ingest passed");

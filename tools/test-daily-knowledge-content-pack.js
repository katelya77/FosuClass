#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const builtin = require("../server/src/content/dailyKnowledgeBuiltin");

assert.ok(builtin.length >= 360, `expected at least 360 builtin items, got ${builtin.length}`);
assert.strictEqual(new Set(builtin.map((item) => item.id)).size, builtin.length, "builtin ids must be unique");
assert.strictEqual(new Set(builtin.map((item) => item.content)).size, builtin.length, "builtin content must be unique");
["mind", "fraud", "campus"].forEach((category) => {
  assert.ok(builtin.filter((item) => item.category === category).length >= 120, `${category} should have at least 120 items`);
});

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-daily-knowledge-pack-"));
const resolvedTempDir = path.resolve(tempDir);
const resolvedOsTemp = path.resolve(os.tmpdir());
assert.ok(resolvedTempDir.startsWith(`${resolvedOsTemp}${path.sep}`), "test storage must stay inside the OS temp directory");
process.env.FOSU_STORAGE_DIR = resolvedTempDir;

const service = require("../server/src/services/appConfigService");
const pack = {
  schemaVersion: 1,
  items: [
    { externalId: "mind-001", category: "mind", title: "心理小知识", content: "先完成十分钟内能做完的一步。" },
    { externalId: "fraud-001", category: "fraud", title: "防诈小知识", content: "涉及转账时通过原有联系方式再次核实。" },
    { externalId: "campus-001", category: "campus", title: "校园小知识", content: "课程变更以正式通知为准。" },
  ],
};

try {
  const dryRun = service.importDailyKnowledgePack(pack, { dryRun: true });
  assert.deepStrictEqual({ created: dryRun.created, updated: dryRun.updated, skipped: dryRun.skipped }, { created: 3, updated: 0, skipped: 0 });
  assert.strictEqual(fs.existsSync(service.NOTICES_PATH), false, "dry run must not create storage");

  let backupCalls = 0;
  const first = service.importDailyKnowledgePack(pack, { beforeWrite: () => { backupCalls += 1; } });
  assert.deepStrictEqual({ created: first.created, updated: first.updated, skipped: first.skipped }, { created: 3, updated: 0, skipped: 0 });
  assert.strictEqual(backupCalls, 1, "real import should make one backup before its atomic write");
  assert.strictEqual(service.getDailyKnowledgeAdminState().counts.managed, 3);
  assert.strictEqual(service.getDailyKnowledgeAdminState().counts.builtin, builtin.length);

  const repeated = service.importDailyKnowledgePack(pack);
  assert.deepStrictEqual({ created: repeated.created, updated: repeated.updated, skipped: repeated.skipped }, { created: 0, updated: 0, skipped: 3 });

  const changed = JSON.parse(JSON.stringify(pack));
  changed.items[0].content = "先完成五分钟内能做完的一步。";
  const updated = service.importDailyKnowledgePack(changed);
  assert.deepStrictEqual({ created: updated.created, updated: updated.updated, skipped: updated.skipped }, { created: 0, updated: 1, skipped: 2 });
  assert.strictEqual(service.listNotices().find((item) => item.id === updated.items[0].id).content, changed.items[0].content);

  assert.throws(
    () => service.normalizeDailyKnowledgeImportPack({ schemaVersion: 2, items: pack.items }),
    (error) => error && error.code === "DAILY_KNOWLEDGE_IMPORT_SCHEMA_UNSUPPORTED"
  );
  console.log(`test-daily-knowledge-content-pack passed (${builtin.length} builtin items)`);
} finally {
  fs.rmSync(resolvedTempDir, { recursive: true, force: true });
}

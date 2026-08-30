#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-daily-knowledge-management-"));
process.env.FOSU_STORAGE_DIR = tempDir;
const service = require("../server/src/services/appConfigService");
const { buildDeployment } = require("../server/src/content/dailyKnowledgeCloudbaseData");

try {
  const now = new Date("2026-08-31T08:00:00.000Z");
  const initial = service.getDailyKnowledgeAdminState(now);
  assert.deepStrictEqual(initial.policy, { enabled: true, strategy: "balanced", rotationOffset: 0 });
  assert.strictEqual(initial.mode, "builtin");
  assert.strictEqual(initial.counts.active, 360, "enabled must describe the effective pool, not only managed content");
  assert.strictEqual(initial.counts.total, 360);
  assert.ok(initial.selected);

  const disabledPolicy = service.saveDailyKnowledgePolicy({ enabled: false, strategy: "sequential", rotationOffset: 7 });
  assert.deepStrictEqual(disabledPolicy, { enabled: false, strategy: "sequential", rotationOffset: 7 });
  const disabled = service.getDailyKnowledgeAdminState(now);
  assert.strictEqual(disabled.counts.active, 0);
  assert.strictEqual(disabled.selected, null);

  service.saveDailyKnowledgePolicy({ enabled: true, strategy: "balanced", rotationOffset: 7 });
  const dryRun = service.seedBuiltinDailyKnowledge({ dryRun: true });
  assert.strictEqual(dryRun.created, 360);
  assert.strictEqual(fs.existsSync(service.NOTICES_PATH), false, "seed dry run must not write notices");

  let backups = 0;
  const seeded = service.seedBuiltinDailyKnowledge({ beforeWrite: () => { backups += 1; } });
  assert.strictEqual(seeded.created, 360);
  assert.strictEqual(backups, 1);
  const repeated = service.seedBuiltinDailyKnowledge();
  assert.strictEqual(repeated.skipped, 360, "builtin takeover must be idempotent");

  const managed = service.getDailyKnowledgeAdminState(now);
  assert.strictEqual(managed.mode, "managed");
  assert.strictEqual(managed.counts.managed, 360);
  assert.strictEqual(managed.counts.active, 360);
  assert.strictEqual(managed.counts.total, 360, "fallback library must not inflate the effective total");

  const exported = service.exportDailyKnowledgePack("managed", now);
  assert.strictEqual(exported.items.length, 360);
  assert.ok(exported.items.every((item) => item.recordId && item.externalId));

  const selectedIds = managed.managed.slice(0, 3).map((item) => item.id);
  const disabledBatch = service.bulkDailyKnowledge({ action: "disable", ids: selectedIds });
  assert.strictEqual(disabledBatch.affected, 3);
  assert.strictEqual(service.getDailyKnowledgeAdminState(now).counts.active, 357);
  assert.strictEqual(service.bulkDailyKnowledge({ action: "enable", ids: selectedIds }).affected, 3);

  const deleteIds = service.getDailyKnowledgeAdminState(now).managed.slice(0, 5).map((item) => item.id);
  assert.strictEqual(service.bulkDailyKnowledge({ action: "delete", ids: deleteIds }).affected, 5);
  const afterDelete = service.getDailyKnowledgeAdminState(now);
  assert.strictEqual(afterDelete.counts.managed, 355);
  assert.strictEqual(afterDelete.counts.active, 355);

  const deployment = buildDeployment({
    managed: afterDelete.managed.filter((item) => item.active),
    builtin: afterDelete.builtin,
    policy: afterDelete.policy,
  }, now);
  assert.strictEqual(deployment.count, 355);
  assert.strictEqual(deployment.managedCount, 355);
  assert.strictEqual(deployment.builtinCount, 0);
  assert.strictEqual(deployment.strategy, "balanced");
  assert.throws(
    () => service.bulkDailyKnowledge({ action: "archive", ids: selectedIds }),
    (error) => error && error.code === "DAILY_KNOWLEDGE_BULK_ACTION_INVALID"
  );
  console.log("test-daily-knowledge-management passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

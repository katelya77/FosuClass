const assert = require("assert");

process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "test-admin-token";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "test-admin-password";
delete process.env.TOTAL_WEEKS;
delete process.env.SYNC_TOTAL_WEEKS;

const sync = require("./fosu-sync-client/sync");

(async () => {
  const registry = await sync.resolveTermConfig("2025-2026-2", {});
  assert.strictEqual(registry.termStartDate, "2026-03-09");
  assert.strictEqual(registry.weekStart, "monday");
  assert.strictEqual(registry.totalWeeks, 19, "registry totalWeeks must be 19");

  const conflict = await sync.resolveTermConfig("2025-2026-2", {
    "term-start-date": "2026-03-09",
    "total-weeks": "20",
  });
  assert.strictEqual(conflict.totalWeeks, 19, "CLI conflict should default to registry");

  const override = await sync.resolveTermConfig("2025-2026-2", {
    "term-start-date": "2026-03-09",
    "total-weeks": "20",
    "override-term-config": true,
  });
  assert.strictEqual(override.totalWeeks, 20, "explicit override should allow CLI weeks");
  assert.strictEqual(override.source, "cli-override-term-config");

  let failed = false;
  try {
    await sync.assertTermConfigBeforeCrawl("2026-2027-2", { "term-start-date": "2027-03-01" });
  } catch (error) {
    failed = /Missing totalWeeks/.test(error.message);
  }
  assert(failed, "new term without totalWeeks should fail instead of defaulting to 20");

  console.log("test-term-total-weeks-regression passed");
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `fosu-term-delete-${process.pid}-`));
process.env.NODE_ENV = "test";
process.env.FOSU_STORAGE_DIR = path.join(tempRoot, "storage");
process.env.FOSU_DATA_DIR = path.join(tempRoot, "data");

const termRegistryService = require("../server/src/services/termRegistryService");
const termReleaseIndexService = require("../server/src/services/termReleaseIndexService");
const termDeletionService = require("../server/src/services/termDeletionService");
const adminRouteSource = fs.readFileSync(path.join(__dirname, "../server/src/routes/admin.js"), "utf8");
const adminPageSource = fs.readFileSync(path.join(__dirname, "../server/src/routes/adminPages.js"), "utf8");

const activeTerm = "2026-2027-1";
const oldTerm = "2025-2026-2";
const activeRelease = "release-active";
const oldRelease = "release-old";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function cleanup() {
  const resolved = path.resolve(tempRoot);
  if (!path.basename(resolved).startsWith("fosu-term-delete-")) throw new Error(`unsafe cleanup ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

try {
  [
    [activeTerm, activeRelease, "current"],
    [oldTerm, oldRelease, "archived"],
  ].forEach(([term, releaseVersion, status]) => {
    writeJson(path.join(process.env.FOSU_STORAGE_DIR, "releases", releaseVersion, "manifest.json"), {
      success: true,
      healthy: true,
      term,
      releaseVersion,
      counts: { classScheduleCount: 1 },
    });
    writeJson(path.join(process.env.FOSU_STORAGE_DIR, "public", "releases", releaseVersion, "manifest.json"), { term, releaseVersion });
    writeJson(path.join(process.env.FOSU_STORAGE_DIR, "terms", term, "catalog.json"), { term });
  });

  termRegistryService.writeRegistry({
    schemaVersion: 1,
    activeTerm,
    terms: [
      { term: activeTerm, semesterText: "2026-2027学年第一学期", termStartDate: "2026-09-07", totalWeeks: 19, weekStart: "monday", status: "current", dataAvailable: true, releaseVersion: activeRelease },
      { term: oldTerm, semesterText: "2025-2026学年第二学期", termStartDate: "2026-03-09", totalWeeks: 19, weekStart: "monday", status: "archived", dataAvailable: true, releaseVersion: oldRelease },
    ],
  }, { backup: false });
  termReleaseIndexService.writeIndex({
    activeTerm,
    terms: {
      [activeTerm]: { activeReleaseVersion: activeRelease },
      [oldTerm]: { activeReleaseVersion: oldRelease },
    },
  });

  assert.deepStrictEqual(termRegistryService.getPublicTerms().map((item) => item.term), [activeTerm], "client term choices must expose only the active term");

  const preview = termDeletionService.deleteTerm(oldTerm, { dryRun: true });
  assert.strictEqual(preview.dryRun, true);
  assert.ok(preview.livePaths.some((item) => item.endsWith(path.join("terms", oldTerm))));
  assert.ok(termRegistryService.getTerm(oldTerm));

  assert.throws(
    () => termDeletionService.deleteTerm(oldTerm, { idempotencyKey: "delete-old-1", confirm: oldTerm }),
    (error) => error && error.code === "TERM_DELETE_CONFIRM_REQUIRED"
  );
  const removed = termDeletionService.deleteTerm(oldTerm, {
    idempotencyKey: "delete-old-1",
    confirm: `DELETE ${oldTerm}`,
  });
  assert.strictEqual(removed.deleted, true);
  assert.strictEqual(termRegistryService.getTerm(oldTerm), null);
  assert.strictEqual(termReleaseIndexService.getTermRelease(oldTerm), null);
  assert.ok(!fs.existsSync(path.join(process.env.FOSU_STORAGE_DIR, "terms", oldTerm)));
  assert.ok(!fs.existsSync(path.join(process.env.FOSU_STORAGE_DIR, "releases", oldRelease)));
  assert.ok(!fs.existsSync(path.join(process.env.FOSU_STORAGE_DIR, "public", "releases", oldRelease)));
  assert.ok(fs.existsSync(removed.rollback.quarantinePath), "deletion must leave a bounded rollback quarantine");

  const duplicate = termDeletionService.deleteTerm(oldTerm, {
    idempotencyKey: "delete-old-1",
    confirm: `DELETE ${oldTerm}`,
  });
  assert.strictEqual(duplicate.duplicate, true);
  assert.throws(
    () => termDeletionService.deleteTerm(activeTerm, { idempotencyKey: "delete-active-1", confirm: `DELETE ${activeTerm}` }),
    (error) => error && error.code === "CANNOT_DELETE_ACTIVE_TERM"
  );
  assert.ok(adminRouteSource.includes('router.delete("/terms/:term", verifyAdminWriteAccess'), "term deletion route must use the protected write guard");
  assert.ok(adminPageSource.includes("deleteTermPermanently"));
  assert.ok(adminPageSource.includes('window.prompt(['), "admin deletion requires typed human confirmation");

  cleanup();
  console.log("test-term-deletion-lifecycle passed");
} catch (error) {
  console.error(error && error.stack || error);
  try { cleanup(); } catch (cleanupError) {}
  process.exit(1);
}

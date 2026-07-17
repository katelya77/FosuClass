/**
 * Guard: migrated domains must call shared services, not re-implement file IO in Vue or modules.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// Content module re-exports appConfigService
const contentService = read("server/src/modules/content/service.js");
assert.ok(/appConfigService/.test(contentService), "content service must use appConfigService");
assert.ok(!/writeFileSync|readFileSync/.test(contentService), "content service must not do direct FS");

// Feedback module re-exports feedbackService
const feedbackService = read("server/src/modules/feedback/service.js");
assert.ok(/feedbackService/.test(feedbackService));
assert.ok(!/writeFileSync/.test(feedbackService));

// Backups module re-exports backupService
const backupsService = read("server/src/modules/backups/service.js");
assert.ok(/backupService/.test(backupsService));

// admin.js notices handlers should go through contentDomainService
const adminJs = read("server/src/routes/admin.js");
assert.ok(/contentDomainService/.test(adminJs), "admin.js must use contentDomainService for content");
assert.ok(/backupService/.test(adminJs), "admin.js must use backupService");
assert.ok(/adminCapabilitiesService/.test(adminJs), "admin.js must mount capabilities");

// Vue feature API layers must call /api/admin, not invent local storage
const contentApi = read("admin-web/src/features/content/api.ts");
assert.ok(contentApi.includes("/api/admin/notices"));
assert.ok(!contentApi.includes("localStorage.setItem"));

const feedbackApi = read("admin-web/src/features/feedback/api.ts");
assert.ok(feedbackApi.includes("/api/admin/feedbacks"));

console.log("Admin no-duplicate-business-logic tests passed.");

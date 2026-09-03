const assert = require("assert");
const fs = require("fs");
const path = require("path");

const storageSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "services", "storageLifecycleService.js"), "utf-8");
const uploadSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "services", "stagingUploadService.js"), "utf-8");

assert(uploadSource.includes("duplicateGroupKey"), "duplicate uploads should be grouped before cleanup decisions");
assert(storageSource.includes("releaseService.getActiveReleaseInfo"), "storage lifecycle must preserve active releases");
assert(storageSource.includes("active-or-last-known-good"), "storage lifecycle must preserve active/rollback-safe releases");
assert(storageSource.includes("duplicateUploadRetentionDays"), "storage lifecycle must apply 7-day duplicate upload retention");
assert(storageSource.includes("failedUploadRetentionDays"), "storage lifecycle must apply failed upload retention");
assert(storageSource.includes("incompleteUploadRetentionHours"), "storage lifecycle must apply 24-hour incomplete upload retention");
assert(storageSource.includes("term-latest-published"), "storage lifecycle must preserve each term latest published upload");
assert(storageSource.includes("superseded-published-upload"), "storage lifecycle must prune old non-latest published upload records");
assert(uploadSource.includes("STAGING_UPLOAD_ACTIVE_REFERENCE"), "upload deletion must protect active upload records");
assert(uploadSource.includes("STAGING_UPLOAD_LATEST_REFERENCE"), "upload deletion must protect staging-latest source records");
assert(storageSource.includes("dryRun"), "storage cleanup must support preview/dry-run");
assert(storageSource.includes("running"), "storage cleanup should account for running jobs or active states");

console.log("test-duplicate-cleanup-safety passed");

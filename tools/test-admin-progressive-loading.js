const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../server/src/routes/adminPages.js"), "utf-8");
assert(source.includes("function loadSyncLazyPanels"), "sync page should define lazy panel loading");
assert(source.includes("apiInflight"), "API singleflight state should exist");
assert(source.includes("AbortController"), "API requests should be abortable");
assert(source.includes("lastCloudflareToastAt"), "Cloudflare 504 toasts should be deduplicated");
const progressiveStart = source.lastIndexOf("function loadSyncStatus(");
const progressiveEnd = source.indexOf("function renderSyncStatusGrid", progressiveStart);
const body = source.slice(progressiveStart, progressiveEnd);
assert(!body.includes("/api/admin/storage/maintenance"), "page load must not start storage scan");
assert(!body.includes("/release-pack/deep-health/start"), "page load must not start deep health");
assert(!body.includes("Promise.allSettled(["), "page load should not wait for all sync tabs");

console.log("test-admin-progressive-loading passed");

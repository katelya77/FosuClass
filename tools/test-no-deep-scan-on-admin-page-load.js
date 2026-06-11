const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const adminPages = fs.readFileSync(path.join(root, "server/src/routes/adminPages.js"), "utf-8");
const adminRoutes = fs.readFileSync(path.join(root, "server/src/routes/admin.js"), "utf-8");

const loadIndex = adminPages.lastIndexOf("function loadSyncStatus(");
assert(loadIndex >= 0, "progressive loadSyncStatus should exist");
const renderIndex = adminPages.indexOf("function renderSyncStatusGrid", loadIndex);
const loadBody = adminPages.slice(loadIndex, renderIndex);
assert(loadBody.includes('/api/admin/sync/status'), "sync load should start with fast status endpoint");
assert(loadBody.includes("loadSyncLazyPanels"), "sync load should fan out lazy panels after summary");
assert(!loadBody.includes("Promise.allSettled"), "sync page first load must not wait on all panels");
assert(adminPages.includes("apiInflight"), "admin page should singleflight repeated API calls");
assert(!/\/sync\/status[\s\S]{0,1200}getReleasePackStatus/.test(adminRoutes), "sync status route must not call deep health");
assert(!/\/sync\/status[\s\S]{0,1200}storage-maintenance/.test(adminRoutes), "sync status route must not start storage maintenance");

console.log("test-no-deep-scan-on-admin-page-load passed");

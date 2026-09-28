const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const admin = fs.readFileSync(path.join(root, "server/src/routes/adminPages.js"), "utf8");
const assets = fs.readFileSync(path.join(root, "server/src/routes/adminCampusSyncAssets.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "server/src/modules/campus-sync-ops/routes.js"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(admin.includes('data-section="campus-sync"'), "nav item");
assert(admin.includes("数据与课表 / 个人课表同步"), "group label");
assert(assets.includes("section-campus-sync"), "section");
assert(assets.includes("请求趋势"), "chart");
assert(assets.includes("csPauseBtn"), "pause");
assert(assets.includes("12000"), "overview interval");
assert(routes.includes("/campus-sync/overview"), "overview api");
assert(routes.includes("verifyAdminWriteAccess"), "write guard");
assert(!assets.includes("CAMPUS_AGENT_SIGNING_SECRET="), "no secret value");
console.log("admin-campus-sync-page PASS");

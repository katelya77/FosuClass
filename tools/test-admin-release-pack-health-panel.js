const assert = require("assert");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "test-admin-token";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "test-admin-password";

const adminPages = require("../server/src/routes/adminPages");
const html = adminPages.adminConsoleHtml || "";

function includes(needle, label) {
  assert(html.includes(needle), `missing ${label}: ${needle}`);
}

includes('id="api-health-panel"', "API health panel");
includes("/api/fosu/release-pack/manifest", "release pack manifest probe");
includes("/api/admin/release-pack/quick-health", "release pack quick health probe");
includes("/api/admin/release-pack/deep-health/start", "release pack deep health job");
includes("/api/admin/release-pack/verify/start", "release pack verify job");
includes("/api/admin/sync/staging/publish/start", "staging publish job");
includes("Release Pack", "release pack status text");
includes("小程序将在下次打开或进入全校页时检测 releaseVersion/cacheEpoch 并安全刷新", "post publish client refresh guidance");
includes("npm run verify:release-live", "post publish verify command");

console.log("test-admin-release-pack-health-panel passed");

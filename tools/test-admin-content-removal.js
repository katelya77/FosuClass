const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pages = fs.readFileSync(path.join(__dirname, "../server/src/routes/adminPages.js"), "utf8");
assert.ok(!pages.includes('data-section="notices"'), "notices nav must be gone");
assert.ok(!pages.includes('data-section="news"'), "news nav must be gone");
assert.ok(!pages.includes('["公告管理", loadNotices()]'));
assert.ok(!pages.includes('["最新动态", loadNews()]'));
assert.ok(pages.includes('if (!$("noticeListTable")) return;'));
assert.ok(pages.includes("SCHEDULE_COLLECTOR_CARD"));

const appConfig = require("../server/src/services/appConfigService");
delete process.env.FOSU_ADS_ENABLED;
assert.deepStrictEqual(appConfig.publicAdsConfig(), {
  enabled: false,
  bannerEnabled: false,
  rewardedEnabled: false,
});
const config = appConfig.getPublicAppConfig().data;
assert.ok(Array.isArray(config.notices));
assert.ok(Array.isArray(config.news));
assert.strictEqual(config.ads.enabled, false);
console.log("admin-content-removal PASS");

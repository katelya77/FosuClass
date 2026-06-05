const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "adminPages.js"), "utf-8");

[
  "static-release-sync-panel",
  "openRestyEnabledBadge",
  "openRestySyncBadge",
  "openRestyVerifyBadge",
  "openresty-card-grid",
  "static-url-pill",
  "copyStaticManifestBtn",
  "verifyStaticUrlBtn",
  "manualStaticSyncBtn",
  "syncRecommendedTimeline",
  "sync-flow-step",
  "sync-flow-step-num",
  "syncNextActionBadge",
  "syncNextActionBtn",
  "stagingHashCompareText",
  "stagingPublishNeedText",
].forEach((needle) => {
  assert(source.includes(needle), `admin sync UI should include ${needle}`);
});

assert(source.includes("复制 manifest URL"), "OpenResty card should expose manifest copy action");
assert(source.includes("验证静态 URL"), "OpenResty card should expose static URL verification action");
assert(source.includes("手动同步当前 Release"), "OpenResty card should expose manual sync action");
assert(source.includes("开始发布"), "recommended flow should choose publish as next action");
assert(source.includes("data.stagingSameAsActive ? \"验证静态 URL\""), "recommended flow should verify static URL when staging is unchanged");
assert(source.includes("word-break:break-all"), "long hashes and URLs should not overflow admin cards");

console.log("test-admin-sync-ui-polish passed");

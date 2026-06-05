const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "adminPages.js"), "utf-8");

[
  "static-release-sync-panel",
  "openRestyEnabledBadge",
  "openRestyConfiguredBadge",
  "openRestyDirBadge",
  "openRestyVersionBadge",
  "openRestySyncBadge",
  "openRestyVerifyBadge",
  "openresty-card-grid",
  "static-url-pill",
  "copyStaticManifestBtn",
  "verifyStaticUrlBtn",
  "manualStaticSyncBtn",
  "reconcileLifecycleBtn",
  "syncRecommendedTimeline",
  "sync-flow-step",
  "sync-flow-step-num",
  "syncNextActionBadge",
  "syncNextActionBtn",
  "stagingHashCompareText",
  "stagingPublishNeedText",
  "runtime-storage-panel",
  "runtimeStorageSummary",
  "refreshStorageStatusBtn",
  "scanStorageBtn",
  "previewMaintenanceBtn",
  "runMaintenanceBtn",
].forEach((needle) => {
  assert(source.includes(needle), `admin sync UI should include ${needle}`);
});

assert(source.includes("复制 manifest URL"), "OpenResty card should expose manifest copy action");
assert(source.includes("验证静态 URL"), "OpenResty card should expose static URL verification action");
assert(source.includes("手动同步当前 Release"), "OpenResty card should expose manual sync action");
assert(source.includes("重新核对状态"), "OpenResty card should expose lifecycle reconcile action");
assert(source.includes("开始发布"), "recommended flow should choose publish as next action");
assert(source.includes("data.nextAction && data.nextAction.label"), "recommended flow should use lifecycle nextAction label");
assert(source.includes("upload.status === \"pending-review\" && !isActiveUpload"), "published active upload should not render publish action");
assert(source.includes("word-break:break-all"), "long hashes and URLs should not overflow admin cards");

console.log("test-admin-sync-ui-polish passed");

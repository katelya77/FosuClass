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
  "forceStaticSyncBtn",
  "reconcileLifecycleBtn",
  "syncTaskTabs",
  "syncRecommendationText",
  "sync-metric-strip",
  "openresty-summary-grid",
  "sync-technical-details",
  "staticSyncStateNote",
  "syncJobLog",
  "job-progress-panel",
  "syncNextActionBadge",
  "syncNextActionBtn",
  "stagingHashCompareText",
  "stagingPublishNeedText",
  "runtime-storage-panel",
  "runtimeStorageSummary",
  "runtime-metric-grid",
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
assert(source.includes("✓ 已同步，无需操作"), "manual sync action should show an explicit already-synced state");
assert(source.includes("强制重新同步"), "OpenResty card should expose a secondary force resync action");
assert(source.includes("不会重新构建 Release"), "force resync confirmation should explain it does not rebuild release");
assert(source.includes("不会改变 active pointer"), "force resync confirmation should explain it preserves active pointer");
assert(source.includes("不会删除 last-known-good"), "force resync confirmation should explain last-known-good is preserved");
assert(source.includes("重新核对状态"), "OpenResty card should expose lifecycle reconcile action");
assert(source.includes("当前 active Release 已同步且 URL 验证通过，无需重复复制。"), "already-synced note should explain why normal sync is disabled");
assert(source.includes("safety.blockerDetails"), "staging safety UI should render structured blocker details");
assert(source.includes("线上: "), "staging safety UI should show active values in blocker details");
assert(source.includes("本次: "), "staging safety UI should show staging values in blocker details");
assert(source.includes("开始发布"), "recommended flow should choose publish as next action");
assert(source.includes("data.nextAction && data.nextAction.label"), "recommended flow should use lifecycle nextAction label");
assert(source.includes("upload.status === \"pending-review\" && !isActiveUpload"), "published active upload should not render publish action");
assert(source.includes("word-break:break-all"), "long hashes and URLs should not overflow admin cards");

console.log("test-admin-sync-ui-polish passed");

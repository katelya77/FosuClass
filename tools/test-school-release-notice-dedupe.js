const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

let toastCount = 0;
global.wx.onToast = () => { toastCount += 1; };

require("../miniprogram/pages/school/school.js");
const page = mockEnv.createPageInstance();

function snapshot(patch = {}) {
  return Object.assign({
    term: "2025-2026-2",
    releaseVersion: "release-a",
    cacheEpoch: "epoch-1",
    forceRefreshToken: "token-1",
  }, patch);
}

const sameContentA = snapshot();
const sameContentB = snapshot({ cacheEpoch: "epoch-2", forceRefreshToken: "token-2" });
assert.strictEqual(
  page.getSnapshotReleaseKey(sameContentA),
  page.getSnapshotReleaseKey(sameContentB),
  "same term + releaseVersion should be the same user-visible release"
);
assert.notStrictEqual(
  page.getSnapshotInvalidationKey(sameContentA),
  page.getSnapshotInvalidationKey(sameContentB),
  "cacheEpoch/forceRefreshToken should only affect invalidation identity"
);

assert.strictEqual(page.shouldShowReleaseNotice(snapshot({ releaseVersion: "release-b" })), true);
assert.strictEqual(page.shouldShowReleaseNotice(snapshot({ releaseVersion: "release-b" })), false);
assert.strictEqual(page.shouldShowReleaseNotice(snapshot({ releaseVersion: "release-c" })), true);

page.setData({
  activeSnapshot: snapshot({ releaseVersion: "release-c" }),
});
page.showFilterChangedHint("筛选已更新");
assert.strictEqual(page.data.restoreHint, "筛选已更新");
page.showFilterChangedHint("筛选已更新第二次");
assert.strictEqual(page.data.restoreHint, "筛选已更新", "same release should only show one filter hint");
assert.strictEqual(toastCount, 0, "filter downgrade hint should stay in page, not toast");

const source = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/school/school.js"), "utf8");
assert(source.includes("if (localReleaseKey && localReleaseKey !== remoteReleaseKey)"), "legacy app-config path must not notify on first install");
assert(source.includes("if (localReleaseKey && localReleaseKey !== releaseKey)"), "active snapshot path must not notify on first install");
assert(source.includes("nextReleaseKey !== currentReleaseKey"), "background notice must compare content release identity");
assert(source.includes("this.getSnapshotInvalidationKey(next) !== this.getSnapshotInvalidationKey(currentSnapshot)"), "cache invalidation changes must be handled separately");
assert(!/showToast\(\{\s*title:\s*[\"']检测到新版本/.test(source), "school page should not toast repeatedly for new release checks");

console.log("test-school-release-notice-dedupe passed");

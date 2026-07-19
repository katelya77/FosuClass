const assert = require("assert");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "test-admin-token";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "test-admin-password";

const adminPages = require("../server/src/routes/adminPages");

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function assertIncludes(html, needle, label) {
  assert(html.includes(needle), `missing ${label}: ${needle}`);
}

const html = adminPages.adminConsoleHtml || "";
assert(html.length > 1000, "admin HTML should be present");

assertIncludes(html, 'id="syncTaskTabs"', "sync task tablist");
assertIncludes(html, 'role="tablist"', "tablist semantics");
[
  ["overview", "overview"],
  ["upload", "upload"],
  ["versions", "versions"],
  ["operations", "operations"],
].forEach(([key, label], index) => {
  assertIncludes(html, `id="sync-tab-${key}"`, `${label} tab`);
  assertIncludes(html, `aria-controls="sync-panel-${key}"`, `${label} tab controls`);
  assertIncludes(html, `id="sync-panel-${key}"`, `${label} panel`);
  assertIncludes(html, `aria-labelledby="sync-tab-${key}"`, `${label} panel label`);
  if (index === 0) {
    assertIncludes(html, 'id="sync-tab-overview" role="tab" aria-selected="true"', "default overview tab");
  } else {
    assert(
      new RegExp(`id=["\']sync-panel-${key}["\'][^>]*\\bhidden\\b[^>]*\\binert\\b`).test(html),
      `${label} panel must start hidden and inert`,
    );
  }
});
assertIncludes(html, 'id="syncTabSelect"', "mobile tab select");
assertIncludes(html, "function initSyncTabs()", "sync tab initialization");
assertIncludes(html, "function activateSyncTab", "sync tab activation");
assertIncludes(html, 'case "ArrowLeft"', "left arrow tab navigation");
assertIncludes(html, 'case "ArrowRight"', "right arrow tab navigation");
assertIncludes(html, "syncLegacyAnchorMap", "legacy anchor mapping");
assertIncludes(html, "syncTabFromHash", "hash restoration");
assertIncludes(html, 'class="sync-metric-strip"', "compact status metric strip");
assertIncludes(html, 'class="sync-overview-layout"', "12-column overview layout");
assertIncludes(html, 'class="runtime-metric-grid"', "responsive runtime metric grid");
assertIncludes(html, 'id="healthGrid" class="health-grid sync-health-empty"', "compact API health empty state");

assertIncludes(html, 'id="staging-cli-upload-panel"', "always-visible staging upload panel");
assertIncludes(html, 'id="quickUploadCommand"', "quick CLI upload command");
assertIncludes(html, 'id="quickCopyUploadCmdBtn"', "quick copy button");
assertIncludes(html, 'id="flowCopyBtnLocal"', "local flow copy button");
assertIncludes(html, 'id="flowCmdTextLocal"', "local flow command source");
assertIncludes(html, 'id="flowCopyBtnRelay"', "relay flow copy button");
assertIncludes(html, 'id="flowCmdTextRelay"', "relay flow command source");
assertIncludes(html, "npm run sync:publish", "one-click publisher command default");
assertIncludes(html, "resolveSyncScriptName", "new sync script command resolver");
assertIncludes(html, "sync:upload-staging", "explicit staging upload command");
assertIncludes(html, 'id="publisher-status-card"', "publisher status card");
assertIncludes(html, "生成本机一键同步命令", "local publisher command action");
assertIncludes(html, 'id="copyPublisherCommandTopBtn"', "top local publisher command action");
assertIncludes(html, 'id="syncRefreshInlineBtn"', "single global refresh action");
assert.strictEqual(countOccurrences(html, 'id="syncRefreshInlineBtn"'), 1, "global refresh id should be unique");
assert(!html.includes('id="syncRefreshTopBtn"'), "duplicate top refresh action must be removed");
assert(!html.includes('id="syncRefreshInlineBtnMirror"'), "duplicate mirror refresh action must be removed");
assertIncludes(html, '$("refreshButton").hidden = targetSection === "sync"', "global shell refresh suppression on sync");
assertIncludes(html, 'id="syncFocusPendingBtn"', "top pending action");
assertIncludes(html, '{ label: "Active Release"', "compact active metric");
assertIncludes(html, '{ label: "Published Release"', "compact published metric");
assertIncludes(html, '{ label: "CloudBase"', "compact cloudbase metric");
assertIncludes(html, "当前无需处理", "clean no-pending state");
assertIncludes(html, "重试 CloudBase 镜像", "CloudBase mirror retry action");
assertIncludes(html, "cancelRelayTask", "relay cancel action");
assertIncludes(html, 'safeBind("flowCopyBtnLocal"', "local flow copy binding");
assertIncludes(html, 'safeBind("flowCopyBtnRelay"', "relay flow copy binding");
assertIncludes(html, 'window.copyText = function(text)', "shared copy helper");
assertIncludes(html, "code-preview", "GitHub-style command preview wrapper");
assertIncludes(html, "code-line-number", "command preview line-number column");
assertIncludes(html, "code-line-content", "command preview content column");
assertIncludes(html, "renderAllCodePreviews", "command preview line renderer");
assertIncludes(html, 'id="quickUploadDropzone"', "quick small-file upload dropzone");
assertIncludes(html, 'id="stagingUploadListBody"', "staging upload status list");
assertIncludes(html, 'id="deleteSelectedStagingUploadsBtn"', "selected upload delete button");
assertIncludes(html, 'id="purgeDuplicateStagingUploadsBtn"', "duplicate purge button");
assertIncludes(html, 'id="rebuildStagingUploadIndexBtn"', "upload index rebuild button");
assertIncludes(html, "renderStagingUploads", "staging upload renderer");
assertIncludes(html, "/api/admin/staging/upload", "admin staging upload API integration");
assertIncludes(html, "/api/admin/publisher/receipt", "publisher receipt API integration");

assertIncludes(html, 'id="release-history-panel"', "bottom release history panel");
assertIncludes(html, "release-history-wide", "wide release history layout");
assert(!html.includes('id="release-history-panel-side-disabled"'), "duplicate side release history must be removed");
assert(!html.includes('id="releaseTermFilterSide"'), "duplicate side release filter must be removed");
assert(!html.includes('id="releasesTableBodySide"'), "duplicate side release table must be removed");

assert.strictEqual(countOccurrences(html, 'id="releaseTermFilter"'), 1, "visible releaseTermFilter id should be unique");
assert.strictEqual(countOccurrences(html, 'id="releasesTableBody"'), 1, "visible releasesTableBody id should be unique");
assert.strictEqual(countOccurrences(html, 'id="quickUploadCommand"'), 1, "quickUploadCommand id should be unique");

assertIncludes(html, '"release-history-panel",', "release history placement source");
assertIncludes(html, 'moveSyncPanelNode(id, "syncVersionsStack")', "release history tab placement");
assertIncludes(html, '"runtime-storage-panel",', "runtime placement source");
assertIncludes(html, 'moveSyncPanelNode(id, "syncOperationsStack")', "runtime tab placement");
assertIncludes(html, '"staging-cli-upload-panel",', "upload placement source");
assertIncludes(html, 'moveSyncPanelNode(id, "syncUploadStack")', "upload tab placement");

console.log("Admin sync page smoke test passed.");

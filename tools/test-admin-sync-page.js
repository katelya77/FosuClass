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

assertIncludes(html, 'id="staging-cli-upload-panel"', "always-visible staging upload panel");
assertIncludes(html, 'id="quickUploadCommand"', "quick CLI upload command");
assertIncludes(html, 'id="quickCopyUploadCmdBtn"', "quick copy button");
assertIncludes(html, "code-preview", "GitHub-style command preview wrapper");
assertIncludes(html, "code-line-number", "command preview line-number column");
assertIncludes(html, "code-line-content", "command preview content column");
assertIncludes(html, "renderAllCodePreviews", "command preview line renderer");
assertIncludes(html, 'id="quickUploadDropzone"', "quick small-file upload dropzone");
assertIncludes(html, 'id="stagingUploadListBody"', "staging upload status list");
assertIncludes(html, "renderStagingUploads", "staging upload renderer");
assertIncludes(html, "/api/admin/staging/upload", "admin staging upload API integration");

assertIncludes(html, 'id="release-history-panel"', "bottom release history panel");
assertIncludes(html, "release-history-wide", "wide release history layout");
assertIncludes(html, 'id="release-history-panel-side-disabled"', "disabled side release history panel");
assertIncludes(html, 'id="releaseTermFilterSide"', "renamed hidden side release filter");
assertIncludes(html, 'id="releasesTableBodySide"', "renamed hidden side release table");

assert.strictEqual(countOccurrences(html, 'id="releaseTermFilter"'), 1, "visible releaseTermFilter id should be unique");
assert.strictEqual(countOccurrences(html, 'id="releasesTableBody"'), 1, "visible releasesTableBody id should be unique");
assert.strictEqual(countOccurrences(html, 'id="quickUploadCommand"'), 1, "quickUploadCommand id should be unique");

const syncGridIndex = html.indexOf('class="sync-dashboard-grid"');
const releaseHistoryIndex = html.indexOf('id="release-history-panel"');
assert(syncGridIndex >= 0 && releaseHistoryIndex > syncGridIndex, "release history should appear after the main sync grid");

console.log("Admin sync page smoke test passed.");

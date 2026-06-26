const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function run() {
  const js = read("miniprogram/pages/personal-sync/personal-sync.js");
  const wxml = read("miniprogram/pages/personal-sync/personal-sync.wxml");
  const wxss = read("miniprogram/pages/personal-sync/personal-sync.wxss");
  const previewGridJs = read("miniprogram/components/schedule-preview-grid/index.js");
  const courseCardWxml = read("miniprogram/components/course-card/index.wxml");
  const courseCardWxss = read("miniprogram/components/course-card/index.wxss");
  const aiService = read("miniprogram/services/aiAssistantService.js");
  const cryptoService = read("miniprogram/services/fosuStudentImportCrypto.js");
  const recentImportService = read("miniprogram/services/recentStudentImportService.js");

  assert(!/startLoginFlow|loginAndSyncSchedule|showCaptchaModal|\/api\/fosu\/personal\/login/.test(js + wxml),
    "personal-sync page should not expose deprecated direct account/password sync flow");
  assert(!/authserver\.fosu\.edu\.cn|apaas\.fosu\.edu\.cn/.test(js + wxml + cryptoService),
    "mini program must not request Fosu authserver/APaaS directly");
  assert(js.includes("encryptCredentialPayload"), "student import should encrypt credentials before preview");
  assert(js.includes("/api/schedule-import/fosu/public-key"), "student import should fetch a one-time public key from backend");
  assert(js.includes("/api/schedule-import/fosu/preview/start"), "student import should start async preview jobs");
  assert(js.includes("/api/schedule-import/fosu/preview/status"), "student import should poll async preview job status");
  assert(js.includes("/api/schedule-import/fosu/preview"), "student import should keep legacy preview fallback");
  assert(js.includes("requestStudentSchedulePreview"), "student import should isolate public-key/encrypt/preview into a retryable attempt");
  assert(!wxml.includes("使用前请阅读"), "student import page should not show forced privacy guide reading copy");
  assert(!wxml.includes("隐私保护指引"), "student import page should not show privacy guide link copy");
  assert(!wxml.includes("openStudentPrivacyContract"), "student import page should not bind privacy guide opening");
  assert(js.includes("shouldRetryStudentPreview"), "student import should retry once when a one-time import key is stale");
  assert(wxml.includes("XLS"), "personal-sync page should keep XLS import available");
  assert(js.includes("rememberLatestScheduleImport"), "XLS bind should refresh AI schedule context");
  assert(aiService.includes("personal-xls-required"), "AI context should reject deprecated credential schedule types");
  assert(!wxss.includes("captcha-"), "captcha styles should be removed from import page");
  assert(!cryptoService.includes("root.window ="), "SM2 fallback must not assign globalThis.window in WeChat runtimes");
  assert(wxml.includes("displayStudentId"), "student import preview should bind the full display student id");
  assert(js.includes("function resolveDisplayStudentId(metadata = {}, profile = {})"), "student import should centralize display student id priority");
  assert(js.includes("return metadata.studentId || profile.studentId || metadata.studentIdMasked || profile.studentIdMasked || \"\";"),
    "student import UI must prefer full studentId before masked value");
  assert(wxml.includes("检测到周末课程，可在调整课程中查看"), "student preview should show a weekend-course hint");
  assert(js.includes("STUDENT_WEEKDAY_LABELS.slice(0, 5)"), "student preview grid should default to weekdays only");
  assert(previewGridJs.includes("Array.from({ length: 5 }"), "preview grid fallback days should be Monday to Friday");
  assert(js.includes("formatStudentWeekDisplay"), "student import UI should format week text semantically");
  assert(js.includes("`${weekdayText} · ${sectionText}`"), "student import arrangements should display semantic weekday/section text");
  assert(js.includes("function needsTimeCompletion(arrangement)"), "student import should use a single time-completion predicate");
  assert(js.includes("canEdit: needsCompletion"), "补时间 button should only depend on missing weekday/sections/weeks");
  assert(wxml.includes("wx:if=\"{{!arrangement.needsTimeCompletion}}\""), "time-complete pending arrangements should show selection controls, not 补时间");
  assert(wxml.includes("data-bucket=\"{{group.bucketKey}}\""), "group toggle events must carry the active bucket");
  assert(js.includes("function normalizeStudentExpandedGroups"), "expanded group state must be normalized by bucket");
  assert(js.includes("expanded[bucketKey] = bucketMap"), "expanded group state should update tab + courseGroupId only");
  assert(js.includes("const bucketMap = Object.assign({}, expanded[bucketKey] || {});"),
    "student group toggle must update the bucket-local map");
  assert(js.includes("function buildStudentCourseGroupId"), "student preview should derive stable courseGroupId for fallback grouping");
  assert(js.includes("isArrangementScopedGroupId"), "student preview should reject arrangement-scoped group ids");
  assert(js.includes("normalizeStudentPreviewBuckets") && js.includes("previewOrGroups.courseGroups"),
    "student preview should accept backend courseGroups when buckets are unavailable");
  assert(js.includes("resolveClassNameText"), "all student import buckets should normalize class display text");
  assert(js.includes("classScope.raw"), "student import class display should fall back to classScope.raw");
  assert(wxml.includes("arrangement-class-line"), "arrangements should render classNameRaw/classNames in every active bucket");
  assert(!/studentActiveBucketGroups[^]*wx:key=\"index\"/.test(wxml), "student group rendering must not key by array index");
  assert(/\.student-bottom-actions\s*\{[\s\S]*?width:\s*100%;/.test(wxss), "bottom actions must be full width");
  assert(/\.student-bottom-actions\s*\{[\s\S]*?display:\s*flex;/.test(wxss), "bottom actions must use flex layout");
  assert(/\.student-bottom-actions\s*\{[\s\S]*?gap:\s*16rpx;/.test(wxss), "bottom actions must keep a 16rpx gap");
  assert(/\.student-bottom-actions \.btn-bind,[\s\S]*?\.student-bottom-actions \.btn-cancel\s*\{[\s\S]*?flex:\s*1;/.test(wxss), "bottom buttons must flex equally");
  assert(/\.student-bottom-actions \.btn-bind,[\s\S]*?\.student-bottom-actions \.btn-cancel\s*\{[\s\S]*?min-width:\s*0;/.test(wxss), "bottom buttons must allow shrinking");
  assert(courseCardWxml.includes("course.previewGrid"), "course card should support preview-only layout");
  assert(courseCardWxss.includes(".is-preview-grid .course-name"), "preview course blocks should have dedicated readable text sizing");
  assert(wxml.includes("recentStudentImport"), "personal-sync should render recent student import card");
  assert(wxml.includes("openRecentStudentImportEditor"), "recent import card should open cached editing");
  assert(wxml.includes("useRecentStudentImport"), "recent import card should support direct use");
  assert(wxml.includes("resyncStudentImport"), "recent import card should support resync");
  assert(js.includes("/api/schedule-import/fosu/recent"), "personal-sync should asynchronously verify recent import with backend");
  assert(js.includes("/api/schedule-import/fosu/recent/confirm"), "cached editing should confirm from backend cache without school requests");
  assert(js.includes("recentStudentImportService.buildCachedPreview"), "cached editing should restore preview state from recent import");
  assert(js.includes("studentCachedPreviewMode"), "cached editing should be isolated from live student import tokens");
  assert(js.includes("recentStudentImportService.buildScheduleTarget"), "direct use should build a local schedule target");
  assert(recentImportService.includes("getCurrentSessionOwnerKey"), "local recent import cache must be scoped to the current session owner");
  assert(recentImportService.includes("buildCachedPreview"), "recent import service should expose cached preview rebuilding");
  assert(recentImportService.includes("function parseNumberRangeText"), "cached preview should rebuild sections/weeks from text");
  assert(recentImportService.includes("function resolveCourseClassNameRaw"), "cached preview should preserve class display text in every bucket");
  assert(/\.recent-import-card\s*\{[\s\S]*?flex-direction:\s*column;/.test(wxss), "recent import card should stack content to avoid horizontal overflow");
  assert(/\.recent-import-card\s*\{[\s\S]*?overflow:\s*hidden;/.test(wxss), "recent import card should clip internal overflow");
  assert(/\.recent-import-actions\s*\{[\s\S]*?display:\s*grid;/.test(wxss), "recent import actions should use a responsive grid");
  assert(/\.recent-import-btn\.wide\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/.test(wxss), "primary recent import action should span the grid");
  assert(wxml.includes("student-tab-label"), "student import tabs should split label from count badge");
  assert(/\.student-tab\s*\{[\s\S]*?box-sizing:\s*border-box;/.test(wxss), "student tabs must use border-box sizing");
  assert(/\.student-tab\s*\{[\s\S]*?flex:\s*0 0 auto;/.test(wxss), "student tabs should avoid shrinking inside horizontal scroll");
  assert(/\.student-tab\s*\{[\s\S]*?max-width:\s*246rpx;/.test(wxss), "student tabs should cap long labels");
  assert(/\.student-tab-label\s*\{[\s\S]*?min-width:\s*0;/.test(wxss), "student tab labels must allow ellipsis");
  assert(/\.student-tab-label\s*\{[\s\S]*?text-overflow:\s*ellipsis;/.test(wxss), "student tab labels must ellipsize");
  assert(/\.student-tab-count\s*\{[\s\S]*?flex:\s*0 0 auto;/.test(wxss), "student tab count badges must not shrink");
  assert(/\.student-tab-count\s*\{[\s\S]*?min-width:\s*30rpx;/.test(wxss), "student tab count badges need adaptive minimum width");
  assert(/\.bulk-action-list\s*\{[\s\S]*?flex-wrap:\s*wrap;/.test(wxss), "bulk actions should wrap on small screens");
  assert(/\.bulk-action-btn\s*\{[\s\S]*?min-width:\s*0;/.test(wxss), "bulk action buttons must allow shrinking");

  console.log("test-personal-sync-import-boundaries passed");
}

run();

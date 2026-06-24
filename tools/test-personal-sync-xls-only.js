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

  assert(!/startLoginFlow|loginAndSyncSchedule|showCaptchaModal|\/api\/fosu\/personal\/login/.test(js + wxml),
    "personal-sync page should not expose deprecated direct account/password sync flow");
  assert(!/authserver\.fosu\.edu\.cn|apaas\.fosu\.edu\.cn/.test(js + wxml + cryptoService),
    "mini program must not request Fosu authserver/APaaS directly");
  assert(js.includes("encryptCredentialPayload"), "student import should encrypt credentials before preview");
  assert(js.includes("/api/schedule-import/fosu/public-key"), "student import should fetch a one-time public key from backend");
  assert(js.includes("/api/schedule-import/fosu/preview"), "student import should preview through backend only");
  assert(js.includes("requestStudentSchedulePreview"), "student import should isolate public-key/encrypt/preview into a retryable attempt");
  assert(js.includes("shouldRetryStudentPreview"), "student import should retry once when a one-time import key is stale");
  assert(wxml.includes("XLS"), "personal-sync page should keep XLS import available");
  assert(js.includes("rememberLatestScheduleImport"), "XLS bind should refresh AI schedule context");
  assert(aiService.includes("personal-xls-required"), "AI context should reject deprecated credential schedule types");
  assert(!wxss.includes("captcha-"), "captcha styles should be removed from import page");
  assert(!cryptoService.includes("root.window ="), "SM2 fallback must not assign globalThis.window in WeChat runtimes");
  assert(wxml.includes("displayStudentId"), "student import preview should bind the full display student id");
  assert(wxml.includes("检测到周末课程，可在调整课程中查看"), "student preview should show a weekend-course hint");
  assert(js.includes("STUDENT_WEEKDAY_LABELS.slice(0, 5)"), "student preview grid should default to weekdays only");
  assert(previewGridJs.includes("Array.from({ length: 5 }"), "preview grid fallback days should be Monday to Friday");
  assert(js.includes("formatStudentWeekDisplay"), "student import UI should format week text semantically");
  assert(js.includes("`${weekdayText} · ${sectionText}`"), "student import arrangements should display semantic weekday/section text");
  assert(/\.student-bottom-actions\s*\{[\s\S]*?width:\s*100%;/.test(wxss), "bottom actions must be full width");
  assert(/\.student-bottom-actions\s*\{[\s\S]*?display:\s*flex;/.test(wxss), "bottom actions must use flex layout");
  assert(/\.student-bottom-actions\s*\{[\s\S]*?gap:\s*16rpx;/.test(wxss), "bottom actions must keep a 16rpx gap");
  assert(/\.student-bottom-actions \.btn-bind,[\s\S]*?\.student-bottom-actions \.btn-cancel\s*\{[\s\S]*?flex:\s*1;/.test(wxss), "bottom buttons must flex equally");
  assert(/\.student-bottom-actions \.btn-bind,[\s\S]*?\.student-bottom-actions \.btn-cancel\s*\{[\s\S]*?min-width:\s*0;/.test(wxss), "bottom buttons must allow shrinking");
  assert(courseCardWxml.includes("course.previewGrid"), "course card should support preview-only layout");
  assert(courseCardWxss.includes(".is-preview-grid .course-name"), "preview course blocks should have dedicated readable text sizing");

  console.log("test-personal-sync-import-boundaries passed");
}

run();

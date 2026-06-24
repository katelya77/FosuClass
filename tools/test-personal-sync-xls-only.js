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

  console.log("test-personal-sync-import-boundaries passed");
}

run();

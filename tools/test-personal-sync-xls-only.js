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

  assert(!/账号密码同步|统一认证密码|startLoginFlow|loginAndSyncSchedule|showCaptchaModal|studentId\s*:|password\s*:/.test(js + wxml),
    "personal-sync page should not expose account/password import flow");
  assert(wxml.includes("XLS 导入个人课表"), "personal-sync page should keep XLS import as the primary flow");
  assert(js.includes("rememberLatestScheduleImport"), "XLS bind should refresh AI schedule context");
  assert(aiService.includes("personal-xls-required"), "AI context should reject deprecated credential schedule types");
  assert(!wxss.includes("captcha-"), "captcha styles should be removed from XLS-only import page");

  console.log("test-personal-sync-xls-only passed");
}

run();

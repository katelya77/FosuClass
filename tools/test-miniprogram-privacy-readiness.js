#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(root, "miniprogram");

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

async function runPrivacyHelperContract() {
  delete require.cache[require.resolve("../miniprogram/utils/privacy")];
  const calls = [];
  global.wx = {
    getPrivacySetting(options) {
      calls.push("getPrivacySetting");
      options.success({ needAuthorization: true, privacyContractName: "佛课小表隐私保护指引" });
    },
    requirePrivacyAuthorize(options) {
      calls.push("requirePrivacyAuthorize");
      options.success({});
    },
    openPrivacyContract(options) {
      calls.push("openPrivacyContract");
      options.success({});
    },
  };

  const privacy = require("../miniprogram/utils/privacy");
  const setting = await privacy.getPrivacySetting();
  assert.strictEqual(setting.needAuthorization, true, "getPrivacySetting should surface WeChat privacy status");
  assert.strictEqual(await privacy.ensurePrivacyAuthorized(), true, "ensurePrivacyAuthorized should request authorization");
  await privacy.openPrivacyContract();
  assert.deepStrictEqual(calls, [
    "getPrivacySetting",
    "getPrivacySetting",
    "requirePrivacyAuthorize",
    "openPrivacyContract",
  ]);
  delete global.wx;
}

async function main() {
  const appJson = readJson("miniprogram/app.json");
  assert.strictEqual(appJson.__usePrivacyCheck__, true, "app.json must enable WeChat privacy check");
  assert(Number(appJson.networkTimeout && appJson.networkTimeout.request) >= 60000, "request timeout should allow slow preview completion");

  const privacyHelperPath = path.join(miniprogramRoot, "utils", "privacy.js");
  assert(fs.existsSync(privacyHelperPath), "miniprogram/utils/privacy.js should exist");

  const js = readText("miniprogram/pages/personal-sync/personal-sync.js");
  const wxml = readText("miniprogram/pages/personal-sync/personal-sync.wxml");

  assert(js.includes("ensureStudentPrivacyAuthorized"), "personal sync page should guard sensitive import actions");
  assert(js.includes("privacy.ensurePrivacyAuthorized()"), "personal sync should use wx privacy authorization helper");
  assert(js.includes("timeout: 60000"), "student preview request should use the longer timeout");
  const chooseXlsStart = js.indexOf("async chooseXlsFile()");
  const chooseMessageFile = js.indexOf("wx.chooseMessageFile");
  assert(chooseXlsStart >= 0, "chooseXlsFile should be async so it can await privacy authorization");
  assert(chooseMessageFile >= 0, "file import should still call wx.chooseMessageFile");
  assert(chooseXlsStart < chooseMessageFile, "file import should check privacy before opening file picker");
  assert(!wxml.includes("openStudentPrivacyContract"), "student import page should not bind a forced privacy guide link");
  assert(!wxml.includes("studentPrivacyContractName"), "student import page should not render the privacy guide name");
  assert(!wxml.includes("隐私保护指引"), "student import page should not show forced privacy guide copy");

  await runPrivacyHelperContract();
  console.log("test-miniprogram-privacy-readiness passed");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

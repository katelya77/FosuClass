#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const platform = require("../miniprogram/utils/platform");
const multiPlatform = require("../miniprogram/utils/multiPlatform");

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readPngInfo(relativePath) {
  const buffer = fs.readFileSync(path.join(root, relativePath));
  const signature = "89504e470d0a1a0a";
  assert.strictEqual(buffer.subarray(0, 8).toString("hex"), signature, `${relativePath} must be a PNG file`);
  assert.strictEqual(buffer.subarray(12, 16).toString("ascii"), "IHDR", `${relativePath} must contain a PNG IHDR`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

function assertIcon(relativePath, size, colorType) {
  assert(!/^[a-z]:[\\/]/i.test(relativePath), "mobile icon paths must not depend on a developer machine");
  assert(fs.existsSync(path.join(root, relativePath)), `mobile icon should exist: ${relativePath}`);
  assert.deepStrictEqual(readPngInfo(relativePath), {
    width: size,
    height: size,
    colorType,
  }, `mobile icon metadata should match: ${relativePath}`);
}

async function runRuntimeContract() {
  let appLoginCalls = 0;
  let appFileCalls = 0;
  const appRuntime = {
    getAppBaseInfo() {
      return { host: { env: "SAAASDK" } };
    },
    getDeviceInfo() {
      return { platform: "android", system: "Android 15" };
    },
    getWindowInfo() {
      return { windowWidth: 412, windowHeight: 915 };
    },
    getAccountInfoSync() {
      return {
        miniProgram: { envVersion: "release" },
        miniapp: { envVersion: "develop" },
      };
    },
    getMiniProgramCode(options) {
      appLoginCalls += 1;
      options.success({ code: "multi-end-code" });
    },
    miniapp: {
      chooseFile(options) {
        appFileCalls += 1;
        assert.strictEqual(options.allowsMultipleSelection, false);
        options.success({ tempFiles: [{ name: "schedule.xlsx", path: "wxfile://tmp.xlsx", size: 24 }] });
      },
    },
  };

  assert.strictEqual(platform.isMultiEndApp(appRuntime), true, "SAAASDK host should identify the multi-end app runtime");
  assert.strictEqual(platform.getRuntimePlatform(appRuntime), "android");
  assert.strictEqual(platform.getMiniProgramEnvVersion(appRuntime), "develop", "multi-end mode must use miniapp.envVersion");
  assert.strictEqual(multiPlatform.getMiniProgramType("release"), 0);
  assert.strictEqual(multiPlatform.getMiniProgramType("develop"), 1);
  assert.strictEqual(multiPlatform.getMiniProgramType("trial"), 2);
  assert.strictEqual(multiPlatform.getMiniProgramType("unknown"), 0);
  assert.strictEqual(await multiPlatform.getMiniProgramCode(appRuntime), "multi-end-code");
  const appFiles = await multiPlatform.chooseDocument({ count: 1 }, appRuntime);
  assert.strictEqual(appFiles.tempFiles[0].path, "wxfile://tmp.xlsx");
  assert.strictEqual(appLoginCalls, 1);
  assert.strictEqual(appFileCalls, 1);
  assert.strictEqual(multiPlatform.isSupportedDocument(appFiles.tempFiles[0]), true);
  assert.strictEqual(multiPlatform.isSupportedDocument({ name: "avatar.png" }), false);

  await assert.rejects(
    () => multiPlatform.getMiniProgramCode({
      getAppBaseInfo() { return { host: { env: "SAAASDK" } }; },
      login(options) { options.success({ code: "must-not-be-used" }); },
    }),
    (error) => error && error.code === "WX_MINI_PROGRAM_CODE_FAILED_UNSUPPORTED",
    "multi-end login must not fall back to wx.login"
  );

  let miniProgramLoginCalls = 0;
  let messageFileCalls = 0;
  const miniProgramRuntime = {
    getAppBaseInfo() {
      return { host: { env: "WeChat" } };
    },
    getAccountInfoSync() {
      return { miniProgram: { envVersion: "trial" } };
    },
    login(options) {
      miniProgramLoginCalls += 1;
      options.success({ code: "mini-program-code" });
    },
    chooseMessageFile(options) {
      messageFileCalls += 1;
      options.success({ tempFiles: [{ name: "schedule.xls", path: "wxfile://tmp.xls", size: 16 }] });
    },
  };
  assert.strictEqual(platform.isMultiEndApp(miniProgramRuntime), false);
  assert.strictEqual(platform.getRuntimePlatform(miniProgramRuntime), "miniprogram");
  assert.strictEqual(platform.getMiniProgramEnvVersion(miniProgramRuntime), "trial");
  assert.strictEqual(await multiPlatform.getMiniProgramCode(miniProgramRuntime), "mini-program-code");
  await multiPlatform.chooseDocument({ count: 1, type: "file" }, miniProgramRuntime);
  assert.strictEqual(miniProgramLoginCalls, 1);
  assert.strictEqual(messageFileCalls, 1);
}

function runConfigContract() {
  const project = readJson("project.config.json");
  const miniappProject = readJson("project.miniapp.json");
  const app = readJson("miniprogram/app.json");
  const appMiniapp = readJson("miniprogram/app.miniapp.json");
  const privacy = readJson("miniapp/privacy.json");

  assert.strictEqual(project.projectArchitecture, "multiPlatform");
  assert.strictEqual(project.setting.condition, true, "multi-end upgrade should keep conditional compilation enabled");
  assert.strictEqual(
    project.simulatorPluginLibVersion.wxext14566970e7e9f62,
    "2.27.3",
    "project should pin the installed multi-end simulator plug-in version"
  );
  assert.strictEqual(app.miniApp && app.miniApp.useAuthorizePage, true);
  assert.strictEqual(appMiniapp.adapteByMiniprogram.userName, multiPlatform.MINI_PROGRAM_ORIGINAL_ID);
  assert.strictEqual(appMiniapp.identityServiceConfig.miniprogramLoginPath, "__default__");
  assert.strictEqual(appMiniapp.identityServiceConfig.authorizeMiniprogramType, 1);

  assert(miniappProject["mini-ohos"] && miniappProject["mini-ohos"].sdkVersion, "HarmonyOS SDK should be configured");
  assert.strictEqual(miniappProject["mini-android"].useExtendedSdk.media, true);
  assert.strictEqual(miniappProject["mini-android"].useExtendedSdk.open, true);
  assert.strictEqual(miniappProject["mini-ios"].useExtendedSdk.WeAppOpenFuns, true);
  assert.strictEqual(miniappProject["mini-ios"].useExtendedSdk.WeAppMedia, true);
  ["mini-android", "mini-ios"].forEach((target) => {
    assert.strictEqual(miniappProject[target].privacy.enable, true, `${target} privacy gate should be enabled`);
    assert.strictEqual(miniappProject[target].privacy.template, "miniapp/privacy.json");
    assert.strictEqual(miniappProject[target].privacy.enableViewOnly, false);
  });
  const androidIcons = miniappProject["mini-android"].icons;
  assertIcon(androidIcons.hdpi, 72, 6);
  assertIcon(androidIcons.xhdpi, 96, 6);
  assertIcon(androidIcons.xxhdpi, 144, 6);
  assertIcon(androidIcons.xxxhdpi, 192, 6);

  const iosIcons = miniappProject["mini-ios"].icons;
  assertIcon(iosIcons.mainIcon120, 120, 2);
  assertIcon(iosIcons.mainIcon180, 180, 2);
  assertIcon(iosIcons.spotlightIcon80, 80, 2);
  assertIcon(iosIcons.spotlightIcon120, 120, 2);
  assertIcon(iosIcons.settingsIcon58, 58, 2);
  assertIcon(iosIcons.settingsIcon87, 87, 2);
  assertIcon(iosIcons.notificationIcon40, 40, 2);
  assertIcon(iosIcons.notificationIcon60, 60, 2);
  assertIcon(iosIcons.appStore1024, 1024, 2);

  const harmonyIcons = miniappProject["mini-ohos"].icons;
  assertIcon(harmonyIcons.foreground, 1024, 6);
  assertIcon(harmonyIcons.background, 1024, 2);
  assertIcon(miniappProject["mini-ohos"].splashscreen.startWindowIcon, 512, 6);
  assert.strictEqual(miniappProject["mini-ohos"].splashscreen.startWindowBackground, "#F7F8FA");
  assertIcon("miniapp/assets/app-icon-master-1024.png", 1024, 6);
  assert(privacy.message && privacy.confirm && privacy.cancel, "native privacy template should contain user-facing copy");

  const settingsWxml = readText("miniprogram/pages/settings/settings.wxml");
  assert(settingsWxml.includes("bindtap=\"shareWithClassmates\""), "App sharing should use an explicit action");
  assert(settingsWxml.includes("wx:if=\"{{!isMultiEndApp}}\""), "unsupported open-type actions should be hidden in App mode");
  const floatJs = readText("miniprogram/components/xiaofu-float/index.js");
  assert(floatJs.includes("resize()"), "floating assistant should respond to tablet and rotation changes");
  assert(!floatJs.includes("wx.onWindowResize"), "multi-end App must not call the unsupported onWindowResize API");
  assert(floatJs.includes("Math.max(EDGE_MARGIN, safeTop + TOP_SAFE_GAP)"), "floating assistant should respect the top safe area");
  const appJs = readText("miniprogram/app.js");
  assert(appJs.includes("!platformUtils.isMultiEndApp() && wx.cloud"), "multi-end App must skip Mini Program-only CloudBase initialization");
}

async function main() {
  await runRuntimeContract();
  runConfigContract();
  console.log("test-miniprogram-multi-platform passed");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});

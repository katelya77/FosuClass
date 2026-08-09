const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const servicePath = path.join(ROOT, "miniprogram/services/xiaofuFloatService.js");
const componentPath = path.join(ROOT, "miniprogram/components/xiaofu-float/index.js");

function makeTouch(x, y) {
  return { clientX: x, clientY: y };
}

function loadComponent(routeRef, storage, calls) {
  delete require.cache[require.resolve(servicePath)];
  delete require.cache[require.resolve(componentPath)];

  global.getCurrentPages = function getCurrentPagesMock() {
    return [{ route: routeRef.route, data: routeRef.data || {} }];
  };
  global.wx = {
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : "";
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    getWindowInfo() {
      return {
        windowWidth: 390,
        windowHeight: 844,
        safeArea: { top: 47, bottom: 810 },
      };
    },
    getMenuButtonBoundingClientRect() {
      return { left: 300, right: 382, top: 52, bottom: 84 };
    },
    navigateTo(options) {
      calls.navigateTo.push(options);
      if (options && options.success) options.success();
    },
    redirectTo(options) {
      calls.redirectTo.push(options);
    },
    showToast(options) {
      calls.showToast.push(options);
    },
    showActionSheet(options) {
      calls.showActionSheet.push(options);
      if (Number.isInteger(calls.nextActionSheetTapIndex) && options && typeof options.success === "function") {
        options.success({ tapIndex: calls.nextActionSheetTapIndex });
      }
      calls.nextActionSheetTapIndex = null;
      if (options && options.complete) options.complete();
    },
  };

  let capturedComponent = null;
  global.Component = function ComponentMock(definition) {
    capturedComponent = definition;
  };

  const floatService = require(servicePath);
  require(componentPath);
  assert(capturedComponent, "xiaofu float component should register itself");

  const instance = {
    data: Object.assign({}, capturedComponent.data),
    properties: {
      context: { title: "首页" },
      hidden: false,
      bottomOffset: 0,
    },
    setData(patch) {
      this.data = Object.assign({}, this.data, patch || {});
    },
  };
  Object.keys(capturedComponent.methods).forEach((key) => {
    instance[key] = capturedComponent.methods[key];
  });
  capturedComponent.lifetimes.attached.call(instance);

  return { instance, floatService };
}

function run() {
  const routeRef = { route: "pages/index/index", data: {} };
  const storage = {};
  const calls = { navigateTo: [], redirectTo: [], showToast: [], showActionSheet: [], nextActionSheetTapIndex: null };
  const loaded = loadComponent(routeRef, storage, calls);
  const instance = loaded.instance;
  const floatService = loaded.floatService;

  const indexPolicy = floatService.getRoutePolicy("pages/index/index");
  assert.strictEqual(indexPolicy.bottomAvoidPx, 58, "tabBar pages should avoid the tabBar without leaving a large blank area");
  assert.strictEqual(floatService.getRoutePolicy("packageXiaofu/pages/ai-assistant/ai-assistant").hidden, true, "AI page float should stay hidden by default");
  assert(instance.data.visible, "float should be visible on regular pages when enabled");

  const insight = floatService.setProactiveInsight({
    kind: "next_course",
    eyebrow: "下一节课",
    title: "动物解剖学 · 13:30",
    actionMessage: "查看下一节课",
  });
  instance.refreshPosition();
  assert.strictEqual(instance.data.hintText, insight.title, "new proactive insight should be visible");
  calls.navigateTo.length = 0;
  instance.onHintTap();
  assert.strictEqual(instance.data.hintText, "", "tapping the information hint should dismiss it");
  assert.strictEqual(calls.navigateTo.length, 0, "dismissing the information hint must not open the assistant");
  assert.strictEqual(floatService.isProactiveInsightDismissed(insight), true, "dismissal should persist for the same insight");
  floatService.setProactiveInsight(Object.assign({}, insight, { capturedAt: undefined }));
  instance.refreshPosition();
  assert.strictEqual(instance.data.hintText, "", "refreshing the same insight must not make it reappear");
  floatService.setProactiveInsight(Object.assign({}, insight, { title: "动物解剖学 · 14:15" }));
  instance.refreshPosition();
  assert.strictEqual(instance.data.hintText, "动物解剖学 · 14:15", "a genuinely new insight should become visible");

  instance.onTouchStart({ touches: [makeTouch(340, 650)] });
  instance.onTouchMove({ touches: [makeTouch(344, 653)] });
  instance.onTouchEnd({ changedTouches: [makeTouch(344, 653)] });
  assert.strictEqual(calls.navigateTo.length, 1, "a light tap should open Xiaofu AI from touchend");
  instance.onTap();
  assert.strictEqual(calls.navigateTo.length, 1, "tap fallback should not duplicate a touchend-opened navigation");

  calls.navigateTo.length = 0;
  instance.onTouchStart({ touches: [makeTouch(340, 650)] });
  instance.onTouchCancel();
  instance.onTap();
  assert.strictEqual(calls.navigateTo.length, 0, "touchcancel should not open Xiaofu AI or allow immediate tap fallback");

  calls.navigateTo.length = 0;
  instance.onTouchStart({ touches: [makeTouch(340, 650)] });
  instance.onTouchMove({ touches: [makeTouch(280, 610)] });
  instance.onTouchEnd({ changedTouches: [makeTouch(120, 560)] });
  assert.strictEqual(calls.navigateTo.length, 0, "dragging should not trigger AI navigation");
  const savedPosition = storage[floatService.POSITION_KEY];
  assert(savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y), "drag end should persist snapped position");
  assert(savedPosition.x === 6 || savedPosition.x === 326, "drag end should snap to either horizontal edge");
  assert(savedPosition.y >= 6 && savedPosition.y <= 728, "saved position should stay inside freer vertical bounds");

  floatService.savePosition({ x: 340, y: 52 });
  instance.refreshPosition();
  assert(instance.data.y >= 94, "top-right position should avoid the WeChat capsule");

  calls.showActionSheet.length = 0;
  instance.onLongPress();
  assert.deepStrictEqual(
    calls.showActionSheet[0] && calls.showActionSheet[0].itemList,
    ["打开小序", "隐藏本页", "关闭浮窗"],
    "long press menu should expose open, hide and close actions"
  );

  calls.navigateTo.length = 0;
  calls.nextActionSheetTapIndex = 0;
  instance.onLongPress();
  assert.strictEqual(calls.navigateTo.length, 1, "long press open should navigate to Xiaofu AI");

  calls.nextActionSheetTapIndex = 1;
  instance.onLongPress();
  assert.strictEqual(floatService.isRouteHidden("pages/index/index"), true, "long press hide should hide only the current route");
  assert.strictEqual(instance.data.visible, false, "hidden route should hide the float immediately");

  floatService.enableEverywhere();
  instance.refreshPosition();
  assert.strictEqual(instance.data.visible, true, "enableEverywhere should restore a route-hidden float");

  calls.nextActionSheetTapIndex = 2;
  instance.onLongPress();
  assert.strictEqual(floatService.isEnabled(), false, "long press close should disable the float globally");
  assert.strictEqual(instance.data.visible, false, "closed float should disappear immediately");

  floatService.enableEverywhere();
  instance.refreshPosition();
  assert.strictEqual(floatService.isEnabled(), true, "float should be re-enabled from service state");
  assert.strictEqual(instance.data.visible, true, "re-enabled float should become visible again");

  const settingsJs = fs.readFileSync(path.join(ROOT, "miniprogram/pages/settings/settings.js"), "utf8");
  const settingsWxml = fs.readFileSync(path.join(ROOT, "miniprogram/pages/settings/settings.wxml"), "utf8");
  const floatWxml = fs.readFileSync(path.join(ROOT, "miniprogram/components/xiaofu-float/index.wxml"), "utf8");
  const floatWxss = fs.readFileSync(path.join(ROOT, "miniprogram/components/xiaofu-float/index.wxss"), "utf8");
  assert(floatWxml.includes('catchtap="onHintTap"'), "information hint should expose an explicit dismiss tap");
  assert(!/\.xiaofu-float-hint\s*\{[^}]*pointer-events\s*:\s*none/s.test(floatWxss), "information hint must be tappable");
  assert(settingsJs.includes("xiaofuFloatService.enableEverywhere()"), "settings page should be able to re-enable the float");
  assert(settingsJs.includes("xiaofuFloatService.setEnabled(false)"), "settings page should be able to close the float");
  assert(settingsWxml.includes('bindchange="onXiaofuFloatToggle"'), "settings page should expose the float switch");

  calls.navigateTo.length = 0;
  routeRef.route = "packageXiaofu/pages/ai-assistant/ai-assistant";
  instance.refreshPosition();
  assert.strictEqual(instance.data.visible, false, "AI page should hide the float entry");
  instance.openAssistant();
  assert.strictEqual(calls.navigateTo.length, 0, "AI page should not navigate to itself from the float");

  console.log("test-xiaofu-float-behavior passed");
}

run();

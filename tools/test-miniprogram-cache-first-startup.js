const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "miniprogram/app.js"), "utf-8");
const startup = fs.readFileSync(path.join(root, "miniprogram/services/startupCoordinator.js"), "utf-8");
const school = fs.readFileSync(path.join(root, "miniprogram/pages/school/school.js"), "utf-8");

const onLaunch = app.slice(app.indexOf("onLaunch()"), app.indexOf("onShow()"));
assert(onLaunch.indexOf("loadReleasePackData({ network: false") < onLaunch.indexOf("resolveRuntimePointer"), "startup should hydrate local release before network pointer");
assert(onLaunch.indexOf("loadBootstrapData({ network: false") < onLaunch.indexOf("startBackgroundRefresh"), "startup should hydrate bootstrap cache before background refresh");
assert(startup.includes("singleflight(\"runtime-pointer\""), "runtime pointer should be singleflighted");
assert(startup.includes("readRuntimeCircuit"), "background refresh should respect runtime circuit breaker");
assert(school.includes("readCachedActiveSnapshot"), "school page should read cached active snapshot first");
assert(school.includes("readCachedIndex(\"class\""), "school page should render from cached class index");

console.log("test-miniprogram-cache-first-startup passed");

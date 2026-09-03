const assert = require("assert");
const fs = require("fs");
const path = require("path");

const adminSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "admin.js"), "utf-8");
const pageSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "adminPages.js"), "utf-8");
const lifecycleSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "services", "releaseLifecycleService.js"), "utf-8");

assert(adminSource.includes('reason: sameAsActive ? "active-release" : "staging"'), "no-change observation should preserve its comparison reason");
assert(adminSource.includes('stagingState: "duplicate"'), "duplicate uploads should expose stagingState");
assert(adminSource.includes('releaseState: "published"'), "same active duplicate should expose published releaseState");
assert(adminSource.includes('runtimeState: "active"'), "same active duplicate should expose active runtimeState");
assert(lifecycleSource.includes('activeVersion === uploadVersion && upload.status === "published"'), "runtime Active must require the exact active release version");
assert(lifecycleSource.includes('const isActive = activeVersion'), "legacy active flags must only be used when no runtime pointer is available");
assert(pageSource.includes('if (syncStatus.releaseVersion && releaseVersion)'), "admin UI must prefer the runtime release pointer over sticky legacy flags");
assert(!pageSource.includes("sameHash && String(upload && upload.releaseState"), "same canonical hash alone must not make historical uploads Active");
assert(pageSource.includes("Published 不等于 Active"), "admin page should distinguish published and active");
assert(pageSource.includes("与当前线上数据一致"), "sameAsActive copy should be explicit");
assert(pageSource.includes("重复上传"), "sameAsOtherStaging copy should be explicit");

console.log("test-staging-status-semantics passed");

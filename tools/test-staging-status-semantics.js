const assert = require("assert");
const fs = require("fs");
const path = require("path");

const adminSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "admin.js"), "utf-8");
const pageSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "adminPages.js"), "utf-8");

assert(adminSource.includes('unchangedReason: "active-release"'), "same active hash should keep active-release reason");
assert(adminSource.includes('unchangedReason: "staging"'), "same other staging hash should keep staging reason");
assert(adminSource.includes('stagingState: "duplicate"'), "duplicate uploads should expose stagingState");
assert(adminSource.includes('releaseState: "published"'), "same active duplicate should expose published releaseState");
assert(adminSource.includes('runtimeState: "active"'), "same active duplicate should expose active runtimeState");
assert(pageSource.includes("Published 不等于 Active"), "admin page should distinguish published and active");
assert(pageSource.includes("与当前线上数据一致"), "sameAsActive copy should be explicit");
assert(pageSource.includes("重复上传"), "sameAsOtherStaging copy should be explicit");

console.log("test-staging-status-semantics passed");

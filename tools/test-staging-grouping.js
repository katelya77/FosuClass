const assert = require("assert");
const fs = require("fs");
const path = require("path");

const serviceSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "services", "stagingUploadService.js"), "utf-8");
const pageSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "adminPages.js"), "utf-8");

assert(serviceSource.includes("duplicateGroupKey"), "staging upload service should expose duplicateGroupKey");
assert(serviceSource.includes("`${term}:${hash}`"), "duplicate grouping must use term + canonicalHash");
assert(pageSource.includes("item.duplicateGroupKey"), "admin upload list should read backend duplicate group key");
assert(pageSource.includes("重复上传 "), "admin upload list should render duplicate upload count");
assert(pageSource.includes("buildStagingUploadGroups"), "admin upload list should group by term + canonicalHash");
assert(pageSource.includes("清理重复项，只保留最新"), "admin upload list should expose duplicate purge action");
assert(pageSource.includes("Active 对应记录禁止删除"), "admin upload list should show active delete protection");
assert(pageSource.includes("stagingUploadTermFilter"), "admin upload list should expose term filter");

console.log("test-staging-grouping passed");

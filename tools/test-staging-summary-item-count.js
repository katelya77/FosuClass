const assert = require("assert");
const fs = require("fs");
const path = require("path");

const uploadSource = fs.readFileSync(path.join(__dirname, "fosu-sync-client", "upload.js"), "utf-8");
const adminSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "routes", "admin.js"), "utf-8");
const uploadServiceSource = fs.readFileSync(path.join(__dirname, "..", "server", "src", "services", "stagingUploadService.js"), "utf-8");

assert(uploadSource.includes("totalScheduleDocuments"), "CLI upload summary should print totalScheduleDocuments");
assert(uploadSource.includes("resourceCounts"), "CLI upload summary should print v2 resourceCounts");
assert(uploadSource.includes("教师课程事件"), "CLI upload summary should show teacher course events");
assert(!uploadSource.includes("itemCount: 0"), "CLI upload summary should not hardcode itemCount=0");
assert(adminSource.includes("totalScheduleDocuments"), "admin upload summary should expose totalScheduleDocuments");
assert(uploadServiceSource.includes("copy.totalScheduleDocuments"), "public manifest should expose totalScheduleDocuments");

console.log("test-staging-summary-item-count passed");

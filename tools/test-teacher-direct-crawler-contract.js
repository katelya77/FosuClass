const assert = require("assert");
const fs = require("fs");
const path = require("path");

const adapter = fs.readFileSync(path.join(__dirname, "..", "server", "src", "services", "fosuQiangzhiAdapter.js"), "utf-8");
const discover = fs.readFileSync(path.join(__dirname, "fosu-sync-client", "discover.js"), "utf-8");
const sync = fs.readFileSync(path.join(__dirname, "fosu-sync-client", "sync.js"), "utf-8");

assert(adapter.includes("teacherSchedulePage: \"/kbcx/kbxx_teacher\""), "adapter should know teacher schedule page");
assert(adapter.includes("teacherScheduleIfr: \"/kbcx/kbxx_teacher_ifr\""), "adapter should know teacher schedule iframe endpoint");
assert(adapter.includes("async fetchTeacherSchedule(params)"), "adapter should expose direct teacher schedule fetcher");
assert(adapter.includes("paths.teacherScheduleIfr"), "teacher fetcher should POST to teacherScheduleIfr");
assert(adapter.includes("xnxqh: (params && params.semester)"), "teacher fetcher should send term parameter");
assert(adapter.includes("skyx: params && params.collegeCode"), "teacher fetcher should send college filter");
assert(adapter.includes("jszc: params && params.teacherTitleCode"), "teacher fetcher should send teacher title filter");
assert(discover.includes("/kbcx/kbxx_teacher"), "discovery script should inspect teacher schedule page");
assert(discover.includes("select[name='skyx']"), "discovery should inspect college selector on schedule pages");
assert(sync.includes("async function crawlDirectTeacherResources"), "sync client should implement direct teacher schedule resource crawl");
assert(sync.includes("async function buildResourcesForClassSchedules"), "sync client should route resource generation through a source-aware builder");
assert(sync.includes("/kbcx/kbxx_teacher_ifr"), "sync direct teacher crawler should POST to teacher iframe endpoint");
assert(sync.includes("parser.parseTeacherScheduleIfrHtml"), "sync direct teacher crawler should parse teacher iframe HTML");
assert(sync.includes("normalizer.normalizeCourseList"), "sync direct teacher crawler should normalize direct teacher courses");
assert(sync.includes("mergeResourcesBySource"), "sync should merge direct and derived teacher resources");
assert(sync.includes("SYNC_RESOURCE_SOURCE"), "sync should support resource source env configuration");
assert(sync.includes("resource-source"), "sync should support --resource-source CLI configuration");
assert(sync.includes("SYNC_FORCE_RESOURCE_CRAWL"), "sync should support forced resource recrawl");

console.log("test-teacher-direct-crawler-contract passed");
